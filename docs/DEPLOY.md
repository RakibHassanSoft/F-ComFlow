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

# Optional add-ons (all safe to leave blank — features stay off):
CLOUDINARY_URL=                               # product photo uploads (cloudinary://key:secret@cloud)
REDIS_URL=redis://redis:6379                  # durable webhook queue (a redis service is included)
RLS_ENABLED=false                             # DB-level tenant isolation; set true only after prisma/rls.sql
```

> The compose file now includes a **redis** service, so `REDIS_URL` defaults to
> `redis://redis:6379` and the durable webhook queue works out of the box. Leave
> it blank to process webhooks inline instead.

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
| `server/` | Railway / Render | build `npm install && npx prisma generate && npm run build`, start `npm run start:prod`, env: `DATABASE_URL`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `CLIENT_URL`, `AI_SERVICE_URL`, `COOKIE_SECURE=true` (+ optional `CLOUDINARY_URL`, `REDIS_URL`, `RLS_ENABLED`, channel/courier/payment keys) |
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

## Turning your four flows on (what each needs)

| Flow | Works with just env? | What to set |
|---|---|---|
| **Register / login** | ✅ Yes | `DATABASE_URL`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`. Nothing else. A new merchant signs up at `/register`. |
| **Connect a messaging account** | ⚠️ Env **+ one-time Meta-side setup** | For Messenger/Instagram/WhatsApp you (the platform owner) create a Meta app, set `META_APP_ID` / `META_APP_SECRET` / `META_VERIFY_TOKEN`, and subscribe the webhook `https://<api>/api/meta/webhook`. **Telegram** needs only a BotFather token (works with strangers instantly, no review). Full steps: `docs/CONNECT_CHANNELS.md`. |
| **Chat through their account** | ✅ Once the channel is connected | Inbound arrives via the signed webhook; replies go back out through Meta/Telegram APIs. Set `PUBLIC_API_URL` so Telegram/Viber webhooks can reach you. |
| **Courier booking + tracking** | ✅ Yes (per courier) | Fill `PATHAO_*`, `REDX_ACCESS_TOKEN`, or `STEADFAST_*`. Blank = sandbox mock. (Paperfly stays mock until they issue you API docs.) |

> **Important reality for Meta channels:** your own test/admin accounts can chat
> immediately, but **strangers'** messages only flow after Meta **App Review +
> Business Verification** (days–weeks, Meta-side only — no code change). For a
> public launch demo that works with anyone today, use **Telegram** or the
> **website chat widget**.

## Post-deploy checklist (run these after `docker compose up --build`)

1. `GET /api/health` → `{"status":"ok"}` (API up, DB reachable).
2. Open the client URL → register a new merchant → you land in the dashboard.
3. Settings → Connected channels → connect **Telegram** (fastest) → message the bot → it appears in the Inbox → reply → it arrives back in Telegram.
4. Inventory → add a product with a photo (needs `CLOUDINARY_URL`) → it shows a thumbnail and stock.
5. Orders → confirm an order → Shipping → book a courier → a tracking code appears (mock or live per your keys).
6. (If enabled) verify tenant isolation: a second merchant cannot see the first's data.

## What happens if a service dies

- **AI service down** → the Node API automatically falls back to its built-in TypeScript parser and rule-based risk scorer. Parsing and confirmations keep working; the timeline notes the fallback. This is by design (Phase 7 exit gate).
- **Database down** → the API returns 500s until Postgres is back; Docker's `restart: unless-stopped` restarts it automatically.
