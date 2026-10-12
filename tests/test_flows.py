"""Core workflow checks. Run with `python -m unittest discover -s tests`."""

import os
import unittest
from http.cookies import SimpleCookie
from pathlib import Path

from fastapi import HTTPException, Request, Response


class FluxoFlows(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.db_path = Path(__file__).resolve().parent.parent / "data" / "test-flows.db"
        cls.db_path.parent.mkdir(parents=True, exist_ok=True)
        cls.db_path.unlink(missing_ok=True)
        os.environ["SQLITE_PATH"] = str(cls.db_path)
        os.environ["APP_ENV"] = "development"
        from api import index as api
        cls.api = api

    @classmethod
    def tearDownClass(cls):
        cls.db_path.unlink(missing_ok=True)

    def request(self, token=""):
        cookie = f"fluxo_session={token}".encode()
        return Request({"type": "http", "method": "POST", "path": "/", "headers": [(b"cookie", cookie)]})

    def register(self, name, email, role, company_name="", invite_code=""):
        response = Response()
        result = self.api.register(self.api.RegisterIn(
            name=name, email=email, password="SenhaForte123", role=role,
            company_name=company_name, invite_code=invite_code
        ), response)
        cookies = SimpleCookie()
        cookies.load(response.headers["set-cookie"])
        return result, cookies["fluxo_session"].value

    def assert_http(self, code, operation):
        with self.assertRaises(HTTPException) as ctx:
            operation()
        self.assertEqual(ctx.exception.status_code, code)

    def test_invite_isolation_and_status_flow(self):
        provider, ptoken = self.register("Ana Empresa", "empresa@test.local", "provider", "Estúdio Ana")
        code = provider["invite_code"]
        company = self.api.companies(self.request(ptoken))["companies"][0]
        _, ctoken = self.register("Bia Cliente", "bia@test.local", "client", invite_code=code)
        _, other_token = self.register("Caio Cliente", "caio@test.local", "client", invite_code=code)
        self.assert_http(403, lambda: self.api.company_clients(company["id"], self.request(ctoken)))
        self.assertEqual(self.api.demands(self.request(other_token))["demands"], [])
        demand = self.api.create_demand(self.api.DemandIn(
            company_id=company["id"], title="Atualizar meu site",
            description="Preciso atualizar a página principal do meu site.", priority="normal"
        ), self.request(ctoken))
        demand_id = demand["id"]
        self.assertEqual(self.api.notifications(self.request(ptoken))["unread"], 1)
        self.assertEqual(self.api.demands(self.request(other_token))["demands"], [])
        self.assert_http(403, lambda: self.api.update_status(demand_id, self.api.StatusIn(status="in_progress"), self.request(other_token)))
        for status in ("in_progress", "paused", "in_progress", "completed", "delivered"):
            self.assertTrue(self.api.update_status(demand_id, self.api.StatusIn(status=status), self.request(ptoken))["ok"])
        self.assertEqual(self.api.demands(self.request(ctoken))["demands"][0]["status"], "delivered")
        self.assertEqual(self.api.notifications(self.request(ctoken))["unread"], 5)
        self.assertEqual(self.api.notifications(self.request(other_token))["unread"], 0)
        self.assertEqual(self.api.dashboard(self.request(ctoken))["delivered"], 1)

    def test_login_lock_and_password_reset(self):
        for _ in range(14):
            self.assert_http(401, lambda: self.api.login(self.api.LoginIn(email="absent@test.local", password="wrong"), Response()))
        self.assert_http(429, lambda: self.api.login(self.api.LoginIn(email="absent@test.local", password="wrong"), Response()))
        self.assert_http(429, lambda: self.api.login(self.api.LoginIn(email="absent@test.local", password="wrong"), Response()))
        _, token = self.register("Dora Empresa", "dora@test.local", "provider", "Dora Design")
        forgot = self.api.forgot(self.api.EmailIn(email="dora@test.local"))
        reset_token = forgot["development_reset_url"].split("reset=")[1]
        self.assertTrue(self.api.reset(self.api.ResetIn(token=reset_token, password="NovaSenhaForte123"))["ok"])
        self.assert_http(401, lambda: self.api.me(self.request(token)))
        response = Response()
        logged_in = self.api.login(self.api.LoginIn(email="dora@test.local", password="NovaSenhaForte123"), response)
        self.assertEqual(logged_in["user"]["role"], "provider")


if __name__ == "__main__":
    unittest.main()
