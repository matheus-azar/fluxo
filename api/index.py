"""Fluxo API: FastAPI compatible with Vercel Python functions."""

import hashlib
import hmac
import os
import secrets
import smtplib
import sqlite3
import threading
import uuid
from datetime import datetime, timedelta, timezone
from email.message import EmailMessage
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field


APP_ENV = os.getenv("APP_ENV", "production" if os.getenv("VERCEL") else "development")
APP_URL = os.getenv("APP_URL", f"https://{os.getenv('VERCEL_URL')}" if os.getenv("VERCEL_URL") else "http://localhost:5173").rstrip("/")
DATABASE_URL = os.getenv("DATABASE_URL", "")
DB_PATH = Path(os.getenv("SQLITE_PATH", Path(__file__).resolve().parent.parent / "data" / "fluxo.db"))
SESSION_DAYS = 30
MAX_ATTEMPTS = 15
LOCK_MINUTES = 15
_schema_ready = False
_schema_lock = threading.Lock()


def now():
    return datetime.now(timezone.utc).isoformat()


def future(minutes=0, days=0):
    return (datetime.now(timezone.utc) + timedelta(minutes=minutes, days=days)).isoformat()


def uid():
    return str(uuid.uuid4())


def digest(value):
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def hash_password(password):
    salt = secrets.token_bytes(16)
    derived = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, 310000)
    return f"pbkdf2_sha256$310000${salt.hex()}${derived.hex()}"


def check_password(password, encoded):
    try:
        _, rounds, salt, expected = encoded.split("$")
        actual = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt), int(rounds))
        return hmac.compare_digest(actual, bytes.fromhex(expected))
    except (ValueError, AttributeError):
        return False


class Database:
    def __init__(self):
        if DATABASE_URL:
            from psycopg import connect as pg_connect
            from psycopg.rows import dict_row
            self.conn = pg_connect(DATABASE_URL, row_factory=dict_row)
            self.sqlite = False
        else:
            if APP_ENV == "production":
                raise RuntimeError("DATABASE_URL é obrigatório em produção.")
            DB_PATH.parent.mkdir(parents=True, exist_ok=True)
            self.conn = sqlite3.connect(DB_PATH, timeout=10)
            self.conn.row_factory = sqlite3.Row
            self.conn.execute("PRAGMA foreign_keys=ON")
            self.sqlite = True

    def execute(self, sql, params=()):
        if self.sqlite:
            sql = sql.replace("%s", "?")
        return self.conn.execute(sql, params)

    def one(self, sql, params=()):
        row = self.execute(sql, params).fetchone()
        return dict(row) if row else None

    def all(self, sql, params=()):
        return [dict(row) for row in self.execute(sql, params).fetchall()]

    def commit(self):
        self.conn.commit()

    def close(self):
        self.conn.close()


SCHEMA = [
    """CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
      password_hash TEXT NOT NULL, role TEXT NOT NULL, created_at TEXT NOT NULL
    )""",
    """CREATE TABLE IF NOT EXISTS companies (
      id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(id), name TEXT NOT NULL,
      invite_hash TEXT NOT NULL UNIQUE, invite_hint TEXT NOT NULL, created_at TEXT NOT NULL
    )""",
    """CREATE TABLE IF NOT EXISTS memberships (
      id TEXT PRIMARY KEY, company_id TEXT NOT NULL REFERENCES companies(id),
      client_id TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL,
      UNIQUE(company_id, client_id)
    )""",
    """CREATE TABLE IF NOT EXISTS demands (
      id TEXT PRIMARY KEY, company_id TEXT NOT NULL REFERENCES companies(id),
      client_id TEXT NOT NULL REFERENCES users(id), title TEXT NOT NULL,
      description TEXT NOT NULL, priority TEXT NOT NULL, status TEXT NOT NULL,
      created_at TEXT NOT NULL, started_at TEXT, paused_at TEXT, completed_at TEXT,
      delivered_at TEXT, active_seconds INTEGER NOT NULL DEFAULT 0, last_resumed_at TEXT
    )""",
    """CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
      title TEXT NOT NULL, body TEXT NOT NULL, demand_id TEXT, created_at TEXT NOT NULL,
      read_at TEXT
    )""",
    """CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
      expires_at TEXT NOT NULL, created_at TEXT NOT NULL
    )""",
    """CREATE TABLE IF NOT EXISTS login_attempts (
      email TEXT PRIMARY KEY, attempts INTEGER NOT NULL, locked_until TEXT,
      updated_at TEXT NOT NULL
    )""",
    """CREATE TABLE IF NOT EXISTS reset_tokens (
      token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
      expires_at TEXT NOT NULL, used_at TEXT
    )""",
    "CREATE INDEX IF NOT EXISTS idx_demands_company ON demands(company_id, created_at)",
    "CREATE INDEX IF NOT EXISTS idx_demands_client ON demands(client_id, created_at)",
    "CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, created_at)",
]


def db_open():
    global _schema_ready
    db = Database()
    if not _schema_ready:
        with _schema_lock:
            if not _schema_ready:
                for sql in SCHEMA:
                    db.execute(sql)
                db.commit()
                _schema_ready = True
    return db


def fail(status, message):
    raise HTTPException(status_code=status, detail=message)


def clean_email(value):
    value = value.strip().lower()
    if len(value) > 254 or "@" not in value or "." not in value.split("@")[-1]:
        fail(400, "Informe um email válido.")
    return value


def public_user(user):
    return {key: user[key] for key in ("id", "email", "name", "role")}


def require_user(db, request, role=None):
    token = request.cookies.get("fluxo_session")
    if not token:
        fail(401, "Entre na sua conta para continuar.")
    user = db.one(
        "SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id "
        "WHERE s.token_hash=%s AND s.expires_at>%s",
        (digest(token), now()),
    )
    if not user:
        fail(401, "Sua sessão expirou. Entre novamente.")
    if role and user["role"] != role:
        fail(403, "Esta área não pertence ao seu perfil.")
    return user


def session_cookie(response, db, user_id):
    token = secrets.token_urlsafe(40)
    db.execute(
        "INSERT INTO sessions(token_hash,user_id,expires_at,created_at) VALUES(%s,%s,%s,%s)",
        (digest(token), user_id, future(days=SESSION_DAYS), now()),
    )
    response.set_cookie(
        "fluxo_session", token, max_age=SESSION_DAYS * 86400, httponly=True,
        secure=APP_ENV == "production", samesite="lax", path="/",
    )


def send_email(to, subject, body):
    host = os.getenv("SMTP_HOST")
    if not host:
        return False
    message = EmailMessage()
    message["From"] = os.getenv("SMTP_FROM", os.getenv("SMTP_USER", "Fluxo"))
    message["To"] = to
    message["Subject"] = subject
    message.set_content(body)
    port = int(os.getenv("SMTP_PORT", "587"))
    try:
        if port == 465:
            smtp = smtplib.SMTP_SSL(host, port, timeout=8)
        else:
            smtp = smtplib.SMTP(host, port, timeout=8)
            smtp.starttls()
        with smtp:
            username = os.getenv("SMTP_USER")
            if username:
                smtp.login(username, os.getenv("SMTP_PASSWORD", ""))
            smtp.send_message(message)
        return True
    except (OSError, smtplib.SMTPException):
        return False


def notify(db, user_id, title, body, demand_id=None):
    db.execute(
        "INSERT INTO notifications(id,user_id,title,body,demand_id,created_at,read_at) "
        "VALUES(%s,%s,%s,%s,%s,%s,NULL)",
        (uid(), user_id, title, body, demand_id, now()),
    )


def company_for_owner(db, company_id, owner_id):
    company = db.one("SELECT * FROM companies WHERE id=%s AND owner_id=%s", (company_id, owner_id))
    if not company:
        fail(404, "Empresa não encontrada.")
    return company


class RegisterIn(BaseModel):
    name: str = Field(min_length=2, max_length=100)
    email: str
    password: str = Field(min_length=8, max_length=128)
    role: str
    company_name: str = ""
    invite_code: str = ""


class LoginIn(BaseModel):
    email: str
    password: str


class EmailIn(BaseModel):
    email: str


class ResetIn(BaseModel):
    token: str
    password: str = Field(min_length=8, max_length=128)


class CompanyIn(BaseModel):
    name: str = Field(min_length=2, max_length=100)


class JoinIn(BaseModel):
    invite_code: str


class DemandIn(BaseModel):
    company_id: str
    title: str = Field(min_length=3, max_length=120)
    description: str = Field(min_length=10, max_length=4000)
    priority: str = "normal"


class StatusIn(BaseModel):
    status: str


app = FastAPI(title="Fluxo API", docs_url=None, redoc_url=None)


@app.middleware("http")
async def origin_guard(request: Request, call_next):
    if request.method not in ("GET", "HEAD", "OPTIONS") and APP_ENV == "production":
        origin = request.headers.get("origin")
        if origin and origin.rstrip("/") != APP_URL:
            return JSONResponse(status_code=403, content={"detail": "Origem não permitida."})
    return await call_next(request)


@app.get("/api/health")
def health():
    db = db_open()
    try:
        db.one("SELECT 1 AS ok")
        return {"ok": True}
    finally:
        db.close()


@app.post("/api/auth/register")
def register(data: RegisterIn, response: Response):
    if data.role not in ("provider", "client"):
        fail(400, "Escolha empresa ou cliente.")
    if data.role == "provider" and len(data.company_name.strip()) < 2:
        fail(400, "Informe o nome da empresa.")
    email = clean_email(data.email)
    db = db_open()
    try:
        if db.one("SELECT id FROM users WHERE email=%s", (email,)):
            fail(409, "Já existe uma conta com este email.")
        company = None
        if data.role == "client":
            company = db.one("SELECT * FROM companies WHERE invite_hash=%s", (digest(data.invite_code.strip().upper()),))
            if not company:
                fail(400, "Código de convite inválido. Peça um novo à empresa.")
        user_id = uid()
        db.execute(
            "INSERT INTO users(id,email,name,password_hash,role,created_at) VALUES(%s,%s,%s,%s,%s,%s)",
            (user_id, email, data.name.strip(), hash_password(data.password), data.role, now()),
        )
        invite_code = None
        if data.role == "provider":
            invite_code = secrets.token_hex(5).upper()
            db.execute(
                "INSERT INTO companies(id,owner_id,name,invite_hash,invite_hint,created_at) "
                "VALUES(%s,%s,%s,%s,%s,%s)",
                (uid(), user_id, data.company_name.strip(), digest(invite_code), invite_code[-4:], now()),
            )
        else:
            db.execute(
                "INSERT INTO memberships(id,company_id,client_id,created_at) VALUES(%s,%s,%s,%s)",
                (uid(), company["id"], user_id, now()),
            )
        session_cookie(response, db, user_id)
        db.commit()
        return {"user": {"id": user_id, "email": email, "name": data.name.strip(), "role": data.role}, "invite_code": invite_code}
    finally:
        db.close()


@app.post("/api/auth/login")
def login(data: LoginIn, response: Response):
    email = clean_email(data.email)
    db = db_open()
    try:
        attempt = db.one("SELECT * FROM login_attempts WHERE email=%s", (email,))
        if attempt and attempt["locked_until"] and attempt["locked_until"] > now():
            fail(429, "Muitas tentativas. Aguarde 15 minutos antes de tentar novamente.")
        user = db.one("SELECT * FROM users WHERE email=%s", (email,))
        if not user or not check_password(data.password, user["password_hash"]):
            count = (attempt["attempts"] if attempt and attempt["updated_at"] > future(minutes=-15) else 0) + 1
            lock = future(minutes=LOCK_MINUTES) if count >= MAX_ATTEMPTS else None
            db.execute(
                "INSERT INTO login_attempts(email,attempts,locked_until,updated_at) VALUES(%s,%s,%s,%s) "
                "ON CONFLICT(email) DO UPDATE SET attempts=%s,locked_until=%s,updated_at=%s",
                (email, count, lock, now(), count, lock, now()),
            )
            db.commit()
            if lock:
                fail(429, "Muitas tentativas. Sua conta foi bloqueada por 15 minutos.")
            fail(401, f"Email ou senha incorretos. Restam {MAX_ATTEMPTS - count} tentativas.")
        db.execute("DELETE FROM login_attempts WHERE email=%s", (email,))
        session_cookie(response, db, user["id"])
        db.commit()
        return {"user": public_user(user)}
    finally:
        db.close()


@app.post("/api/auth/logout")
def logout(request: Request, response: Response):
    token = request.cookies.get("fluxo_session")
    if token:
        db = db_open()
        try:
            db.execute("DELETE FROM sessions WHERE token_hash=%s", (digest(token),))
            db.commit()
        finally:
            db.close()
    response.delete_cookie("fluxo_session", path="/")
    return {"ok": True}


@app.get("/api/me")
def me(request: Request):
    db = db_open()
    try:
        return {"user": public_user(require_user(db, request))}
    finally:
        db.close()


@app.post("/api/auth/forgot")
def forgot(data: EmailIn):
    email = clean_email(data.email)
    db = db_open()
    try:
        user = db.one("SELECT id,email FROM users WHERE email=%s", (email,))
        dev_link = None
        if user:
            token = secrets.token_urlsafe(40)
            db.execute(
                "INSERT INTO reset_tokens(token_hash,user_id,expires_at,used_at) VALUES(%s,%s,%s,NULL)",
                (digest(token), user["id"], future(minutes=30)),
            )
            db.commit()
            link = f"{APP_URL}/?reset={token}"
            sent = send_email(email, "Redefina sua senha no Fluxo", f"Use este link para criar uma nova senha (válido por 30 minutos):\n\n{link}\n\nSe você não pediu isso, ignore esta mensagem.")
            if APP_ENV != "production" and not sent:
                dev_link = link
        result = {"message": "Se o email estiver cadastrado, você receberá um link para redefinir a senha."}
        if dev_link:
            result["development_reset_url"] = dev_link
        return result
    finally:
        db.close()


@app.post("/api/auth/reset")
def reset(data: ResetIn):
    db = db_open()
    try:
        record = db.one("SELECT * FROM reset_tokens WHERE token_hash=%s AND used_at IS NULL AND expires_at>%s", (digest(data.token), now()))
        if not record:
            fail(400, "Este link expirou ou já foi usado.")
        db.execute("UPDATE users SET password_hash=%s WHERE id=%s", (hash_password(data.password), record["user_id"]))
        db.execute("UPDATE reset_tokens SET used_at=%s WHERE token_hash=%s", (now(), record["token_hash"]))
        db.execute("DELETE FROM sessions WHERE user_id=%s", (record["user_id"],))
        db.commit()
        return {"ok": True}
    finally:
        db.close()


@app.get("/api/companies")
def companies(request: Request):
    db = db_open()
    try:
        user = require_user(db, request)
        if user["role"] == "provider":
            rows = db.all(
                "SELECT c.id,c.name,c.invite_hint,c.created_at,"
                "(SELECT COUNT(*) FROM memberships m WHERE m.company_id=c.id) AS client_count,"
                "(SELECT COUNT(*) FROM demands d WHERE d.company_id=c.id) AS demand_count "
                "FROM companies c WHERE c.owner_id=%s ORDER BY c.created_at DESC", (user["id"],),
            )
        else:
            rows = db.all(
                "SELECT c.id,c.name,c.created_at,m.created_at AS joined_at FROM memberships m "
                "JOIN companies c ON c.id=m.company_id WHERE m.client_id=%s ORDER BY m.created_at DESC",
                (user["id"],),
            )
        return {"companies": rows}
    finally:
        db.close()


@app.post("/api/companies")
def create_company(data: CompanyIn, request: Request):
    db = db_open()
    try:
        user = require_user(db, request, "provider")
        code = secrets.token_hex(5).upper()
        company_id = uid()
        db.execute(
            "INSERT INTO companies(id,owner_id,name,invite_hash,invite_hint,created_at) VALUES(%s,%s,%s,%s,%s,%s)",
            (company_id, user["id"], data.name.strip(), digest(code), code[-4:], now()),
        )
        db.commit()
        return {"company": {"id": company_id, "name": data.name.strip()}, "invite_code": code}
    finally:
        db.close()


@app.post("/api/companies/join")
def join_company(data: JoinIn, request: Request):
    db = db_open()
    try:
        user = require_user(db, request, "client")
        company = db.one("SELECT id,name FROM companies WHERE invite_hash=%s", (digest(data.invite_code.strip().upper()),))
        if not company:
            fail(400, "Código de convite inválido.")
        if db.one("SELECT id FROM memberships WHERE company_id=%s AND client_id=%s", (company["id"], user["id"])):
            fail(409, "Você já está conectado a esta empresa.")
        db.execute("INSERT INTO memberships(id,company_id,client_id,created_at) VALUES(%s,%s,%s,%s)", (uid(), company["id"], user["id"], now()))
        db.commit()
        return {"company": company}
    finally:
        db.close()


@app.post("/api/companies/{company_id}/invite")
def rotate_invite(company_id: str, request: Request):
    db = db_open()
    try:
        user = require_user(db, request, "provider")
        company_for_owner(db, company_id, user["id"])
        code = secrets.token_hex(5).upper()
        db.execute("UPDATE companies SET invite_hash=%s,invite_hint=%s WHERE id=%s", (digest(code), code[-4:], company_id))
        db.commit()
        return {"invite_code": code}
    finally:
        db.close()


@app.get("/api/companies/{company_id}/clients")
def company_clients(company_id: str, request: Request):
    db = db_open()
    try:
        user = require_user(db, request, "provider")
        company_for_owner(db, company_id, user["id"])
        rows = db.all(
            "SELECT u.id,u.name,u.email,m.created_at,"
            "(SELECT COUNT(*) FROM demands d WHERE d.company_id=m.company_id AND d.client_id=m.client_id) AS demand_count "
            "FROM memberships m JOIN users u ON u.id=m.client_id "
            "WHERE m.company_id=%s ORDER BY u.name", (company_id,),
        )
        return {"clients": rows}
    finally:
        db.close()


def demand_query(db, user, company_id=None):
    sql = (
        "SELECT d.*,c.name AS company_name,u.name AS client_name FROM demands d "
        "JOIN companies c ON c.id=d.company_id JOIN users u ON u.id=d.client_id WHERE "
    )
    params = []
    if user["role"] == "provider":
        sql += "c.owner_id=%s"
    else:
        sql += "d.client_id=%s"
    params.append(user["id"])
    if company_id:
        sql += " AND d.company_id=%s"
        params.append(company_id)
    sql += " ORDER BY d.created_at DESC"
    return db.all(sql, tuple(params))


@app.get("/api/demands")
def demands(request: Request, company_id: str = None):
    db = db_open()
    try:
        user = require_user(db, request)
        return {"demands": demand_query(db, user, company_id)}
    finally:
        db.close()


@app.post("/api/demands")
def create_demand(data: DemandIn, request: Request):
    if data.priority not in ("low", "normal", "high"):
        fail(400, "Prioridade inválida.")
    db = db_open()
    try:
        user = require_user(db, request, "client")
        company = db.one(
            "SELECT c.* FROM memberships m JOIN companies c ON c.id=m.company_id "
            "WHERE m.company_id=%s AND m.client_id=%s", (data.company_id, user["id"]),
        )
        if not company:
            fail(403, "Você não tem acesso a esta empresa.")
        demand_id = uid()
        db.execute(
            "INSERT INTO demands(id,company_id,client_id,title,description,priority,status,created_at,active_seconds) "
            "VALUES(%s,%s,%s,%s,%s,%s,%s,%s,0)",
            (demand_id, company["id"], user["id"], data.title.strip(), data.description.strip(), data.priority, "new", now()),
        )
        notify(db, company["owner_id"], "Nova demanda recebida", f"{user['name']} enviou: {data.title.strip()}", demand_id)
        db.commit()
        send_email(
            db.one("SELECT email FROM users WHERE id=%s", (company["owner_id"],))["email"],
            "Nova demanda no Fluxo", f"{user['name']} enviou uma nova demanda para {company['name']}:\n\n{data.title.strip()}\n\nAcesse {APP_URL} para ver os detalhes.",
        )
        return {"id": demand_id}
    finally:
        db.close()


@app.post("/api/demands/{demand_id}/status")
def update_status(demand_id: str, data: StatusIn, request: Request):
    allowed = {
        "new": ("in_progress",),
        "in_progress": ("paused", "completed"),
        "paused": ("in_progress", "completed"),
        "completed": ("delivered",),
        "delivered": (),
    }
    labels = {"in_progress": "iniciada", "paused": "pausada", "completed": "finalizada", "delivered": "entregue"}
    db = db_open()
    try:
        user = require_user(db, request, "provider")
        demand = db.one(
            "SELECT d.*,c.name AS company_name FROM demands d JOIN companies c ON c.id=d.company_id "
            "WHERE d.id=%s AND c.owner_id=%s", (demand_id, user["id"]),
        )
        if not demand:
            fail(404, "Demanda não encontrada.")
        if data.status not in allowed.get(demand["status"], ()):
            fail(400, "Esta mudança de etapa não é permitida.")
        timestamp = now()
        active = demand["active_seconds"]
        if demand["status"] == "in_progress" and demand["last_resumed_at"]:
            active += max(0, int((datetime.fromisoformat(timestamp) - datetime.fromisoformat(demand["last_resumed_at"])).total_seconds()))
        started = demand["started_at"] or (timestamp if data.status == "in_progress" else None)
        resumed = timestamp if data.status == "in_progress" else None
        paused = timestamp if data.status == "paused" else demand["paused_at"]
        completed = timestamp if data.status == "completed" else demand["completed_at"]
        delivered = timestamp if data.status == "delivered" else demand["delivered_at"]
        db.execute(
            "UPDATE demands SET status=%s,started_at=%s,paused_at=%s,completed_at=%s,"
            "delivered_at=%s,active_seconds=%s,last_resumed_at=%s WHERE id=%s",
            (data.status, started, paused, completed, delivered, active, resumed, demand_id),
        )
        title = f"Demanda {labels[data.status]}"
        notify(db, demand["client_id"], title, f"{demand['company_name']}: {demand['title']}", demand_id)
        db.commit()
        email = db.one("SELECT email FROM users WHERE id=%s", (demand["client_id"],))["email"]
        send_email(email, title + " no Fluxo", f"Sua demanda '{demand['title']}' foi {labels[data.status]} por {demand['company_name']}.\n\nAcesse {APP_URL} para acompanhar.")
        return {"ok": True, "status": data.status}
    finally:
        db.close()


@app.get("/api/dashboard")
def dashboard(request: Request):
    db = db_open()
    try:
        user = require_user(db, request)
        rows = demand_query(db, user)
        total = len(rows)
        active = sum(row["status"] in ("in_progress", "paused") for row in rows)
        delivered = sum(row["status"] == "delivered" for row in rows)
        closed = [row for row in rows if row["completed_at"]]
        avg_hours = round(sum((datetime.fromisoformat(row["completed_at"]) - datetime.fromisoformat(row["created_at"])).total_seconds() / 3600 for row in closed) / len(closed), 1) if closed else 0
        month_keys = []
        current = datetime.now(timezone.utc)
        for offset in range(5, -1, -1):
            month = current.month - offset
            year = current.year
            while month < 1:
                month += 12
                year -= 1
            month_keys.append(f"{year}-{month:02d}")
        chart = []
        for key in month_keys:
            created = [row for row in rows if row["created_at"].startswith(key)]
            finished = [row for row in created if row["completed_at"]]
            hours = sum(
                (datetime.fromisoformat(row["completed_at"]) - datetime.fromisoformat(row["created_at"])).total_seconds() / 3600
                for row in finished
            )
            chart.append({"month": key, "count": len(created), "total_hours": round(hours, 1), "average_hours": round(hours / len(finished), 1) if finished else 0})
        return {"total": total, "active": active, "delivered": delivered, "average_hours": avg_hours, "chart": chart}
    finally:
        db.close()


@app.get("/api/notifications")
def notifications(request: Request):
    db = db_open()
    try:
        user = require_user(db, request)
        rows = db.all("SELECT * FROM notifications WHERE user_id=%s ORDER BY created_at DESC LIMIT 30", (user["id"],))
        return {"notifications": rows, "unread": sum(row["read_at"] is None for row in rows)}
    finally:
        db.close()


@app.post("/api/notifications/read")
def read_notifications(request: Request):
    db = db_open()
    try:
        user = require_user(db, request)
        db.execute("UPDATE notifications SET read_at=%s WHERE user_id=%s AND read_at IS NULL", (now(), user["id"]))
        db.commit()
        return {"ok": True}
    finally:
        db.close()
