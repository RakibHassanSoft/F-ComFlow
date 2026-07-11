# Deploying F-ComFlow

The whole stack is containerized: **postgres** (database), **ai** (FastAPI, port 8000), **server** (Express API, port 4000), **client** (Next.js, port 3000). Add a `.env` file and run one command — that's the entire deployment.

## Option A — One server with Docker (recommended)

Works on any VPS (DigitalOcean, Hetzner, Lightsail, a university server) with Docker installed.

### 1. Get the code onto the server

```bash
git clone <your-repo-url> fcomflow && cd fcomflow
```

### 2. Create the env file

```bash
cp .env.example .env
nano .env
```

Set real values:

```env
POSTGRES_PASSWORD=a-strong-db-password
JWT_ACCESS_SECRET=long-random-string-1        # e.g. openssl rand -hex 32
JWT_REFRESH_SECRET=long-random-string-2
CLIENT_URL=http://YOUR_SERVER_IP:3000         # or https://app.yourdomain.com
NEXT_PUBLIC_API_URL=http://YOUR_SERVER_IP:4000  # or https://api.yourdomain.com
COOKIE_SECURE=false                           # true only when both URLs are https
GEMINI_API_KEY=                               # optional — real Gemini parsing
```

### 3. Build and start everything

```bash
docker compose up -d --build
```

This boots the database, trains + serves the risk model in the AI container, applies all migrations, and starts the API and dashboard.

### 4. Seed the demo data (once)

```bash
docker compose exec server npm run db:seed
```

### 5. Done

Open `http://YOUR_SERVER_IP:3000` → log in with `demo@fcomflow.com / demo1234`.

**Updating later:** `git pull && docker compose up -d --build` (migrations re-apply automatically).

### Adding a domain + HTTPS

Put a reverse proxy (Caddy is easiest) in front:

```
app.yourdomain.com  -> localhost:3000
api.yourdomain.com  -> localhost:4000
```

Then set `CLIENT_URL=https://app.yourdomain.com`, `NEXT_PUBLIC_API_URL=https://api.yourdomain.com`, `COOKIE_SECURE=true`, and rebuild: `docker compose up -d --build`.

## Option B — Managed platforms (no Docker knowledge needed)

Deploy the three apps separately; each platform gives you a URL.

| App | Platform | Settings |
|---|---|---|
| Database | Neon / Supabase / Railway Postgres | copy the connection string |
| `server/` | Railway / Render | build `npm install && npx prisma generate && npm run build`, start `npm run start:prod`, env: `DATABASE_URL`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `CLIENT_URL`, `AI_SERVICE_URL`, `COOKIE_SECURE=true` |
| `ai/` | Railway / Render (Python) | build `pip install -r requirements.txt && python train/train_model.py`, start `uvicorn app.main:app --host 0.0.0.0 --port $PORT` |
| `client/` | Vercel | root dir `client`, env `NEXT_PUBLIC_API_URL=https://<your-api-url>` |

Because client and API end up on different domains, `COOKIE_SECURE=true` is required (it switches cookies to `Secure; SameSite=None`), and both must be HTTPS — which all of these platforms give you automatically.

## Health checks (all three services)

```
GET https://<client>            -> the login page
GET https://<api>/api/health    -> {"status":"ok","service":"fcomflow-api"}
GET https://<ai>/api/health     -> {"status":"ok","service":"fcomflow-ai","risk_model":{"engine":"ml","version":"v1",...}}
```

If `risk_model.engine` says `"rules"`, the model artifact is missing — run `python train/train_model.py` in the `ai/` folder (the Docker build does this automatically).

## What happens if a service dies

- **AI service down** → the Node API automatically falls back to its built-in TypeScript parser and rule-based risk scorer. Parsing and confirmations keep working; the timeline notes the fallback. This is by design (Phase 7 exit gate).
- **Database down** → the API returns 500s until Postgres is back; Docker's `restart: unless-stopped` restarts it automatically.
