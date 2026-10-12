# Fluxo

Plataforma de demandas para empresas prestadoras e seus clientes. Frontend em React/Vite, API em FastAPI, banco SQLite para desenvolvimento local e PostgreSQL para produção na Vercel.

## Funcionalidades

- Cadastro separado de empresa e cliente. A empresa cria sua conta sem convite; o cliente precisa de um código da empresa.
- Uma conta de empresa pode administrar várias empresas e seus clientes. Um cliente pode se conectar a várias empresas, mas só acessa as próprias demandas. A lista de clientes de uma empresa é exclusiva do prestador.
- Demandas com prioridade, descrição e etapas **nova → em andamento → pausada/retomada → finalizada → entregue**.
- Painel com métricas e gráfico de barras para quantidade, tempo total e tempo médio por mês.
- Notificações dentro do painel, atualizadas a cada 30 segundos, e avisos por email quando o SMTP está configurado.
- Sessão em cookie HttpOnly, senha com PBKDF2, bloqueio por 15 minutos após 15 erros, recuperação de senha por link de 30 minutos.

## Executar localmente

Requer Node.js 20+ e Python 3.12+.

```powershell
npm install
python -m pip install -r requirements.txt
npm run dev
```

`npm run dev` inicia a API Python na porta 8000 e o React na porta 5173. Se algum dos dois já estiver ativo, ele é reutilizado. O script procura Python em `PYTHON_EXECUTABLE`, em `.venv`, no sistema e no runtime local do Codex. Se o site já estiver aberto, basta atualizar a página depois que a API iniciar.

Para rodar os serviços separadamente, use dois terminais:

```powershell
python -m uvicorn api.index:app --reload --host 127.0.0.1 --port 8000
npm run dev:frontend
```

Abra `http://127.0.0.1:5173`. O Vite encaminha `/api` para o FastAPI. Sem `DATABASE_URL`, os dados locais ficam em `data/fluxo.db`. O email de recuperação retorna um link visível na própria tela **somente em desenvolvimento** quando o SMTP não está configurado.

## Publicar na Vercel

1. Importe esta pasta como projeto Vite na Vercel ou faça o deploy com o CLI. O arquivo `vercel.json` configura o build do React, a função Python em `api/index.py` e as rotas da SPA.
2. Crie um banco PostgreSQL gerenciado (por exemplo, Neon ou Supabase) e configure `DATABASE_URL` nas variáveis de ambiente da Vercel. A API cria as tabelas no primeiro acesso. SQLite é recusado em produção porque o disco da função não é persistente.
3. Configure `APP_ENV=production` e `APP_URL=https://seu-dominio.vercel.app`. `APP_URL` deve corresponder ao domínio usado para acessar o site.
4. Para avisos por email e recuperação de senha, configure `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD` e `SMTP_FROM` com um serviço SMTP transacional. Sem SMTP, as notificações internas funcionam, mas emails e recuperação de senha em produção não serão enviados.
5. Execute `npm run build` e publique. O arquivo `.env.example` lista todas as variáveis necessárias.

## Verificação

```powershell
npm run build
python -m unittest discover -s tests -v
```

O teste cobre cadastro por convite, isolamento entre clientes, etapas da demanda, notificações, bloqueio de login e recuperação de senha.
