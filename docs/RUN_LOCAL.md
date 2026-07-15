# Running F-ComFlow locally (Windows)

Four pieces: a **PostgreSQL** database, the **AI** service (FastAPI, port 8000),
the **API server** (Express, port 4000), and the **client** (Next.js, port 3000).
Run each service in its own terminal window.

> The `.env` files are already filled in (`server/.env`, `client/.env.local`) —
> you don't need to create any. Courier/Cloudinary keys are already set; blank
> keys just fall back to demo/mock mode.

## Prerequisites

- **Node.js 20+** — check: `node -v`
- **Python 3.10+** — check: `python --version`
- **PostgreSQL 14+** running locally, **or Docker Desktop** (easiest for the DB)

---

## 1. Start PostgreSQL  (one time)

The server expects `postgresql://postgres:postgres@localhost:5432/f_com`.

**Easiest — Docker** (matches that URL exactly):

```
docker run --name fcom-db -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=f_com -p 5432:5432 -d postgres:16
```

Later, start/stop it with `docker start fcom-db` / `docker stop fcom-db`.

**Or, with a local PostgreSQL install:** create a database named `f_com` (user
`postgres`, password `postgres`). In `psql`: `CREATE DATABASE f_com;`

---

## 2. AI service — Terminal 1

```
cd F:\F_comFlow\ai
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

Check: open http://localhost:8000/api/health → `{"status":"ok", ...}`

*(Optional — turn on the ML risk model instead of the built-in rule engine:
run `python train\train_model.py` once before starting uvicorn. The app works
fine without it.)*

---

## 3. API server — Terminal 2

```
cd F:\F_comFlow\server
npm install
npx prisma generate
npx prisma db push
npm run db:seed
npm run dev
```

- `prisma db push` creates all tables in the `f_com` database.
- `db:seed` loads the demo merchant + sample data (optional but recommended).
- Runs on http://localhost:4000 — check http://localhost:4000/api/health

---

## 4. Client (dashboard) — Terminal 3

```
cd F:\F_comFlow\client
npm install
npm run dev
```

Open **http://localhost:3000**

---

## 5. Log in

- **Register** a fresh account at `/register`, **or** use the seeded demo login:
  - Email: `demo@fcomflow.com`
  - Password: `demo1234`

---

## Notes & troubleshooting

- **Start order:** database first → server (needs the DB) → AI and client any time.
  If the AI service is down, the server automatically falls back to its built-in
  parser/risk rules, so the app still works.
- **`prisma generate` / `db push` fails** → make sure Postgres is running and
  `DATABASE_URL` in `server/.env` matches it.
- **Port already in use** → something else is on 3000/4000/8000; stop it or change
  the port (`PORT` in the respective `.env`).
- **Optional add-ons are OFF by default** — Redis durable queue (`REDIS_URL`) and
  DB-level RLS (`RLS_ENABLED` + `prisma/rls.sql`). Nothing to set up for local dev.
- **Verify couriers** (optional): `cd server && npm run couriers:check`
  (add `-- --book` to create a test parcel).
- **Restarting later:** `docker start fcom-db`, then `npm run dev` in `server/`
  and `client/`, and `uvicorn ...` in `ai/` (after `.venv\Scripts\activate`).
