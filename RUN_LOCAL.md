# Running F-ComFlow locally (AI + Server + Client)

F-ComFlow is three apps plus a database:

| Part | Folder | Tech | Port |
|------|--------|------|------|
| **Database** | — | PostgreSQL | 5432 |
| **AI service** | `ai/` | Python (FastAPI) | 8000 |
| **Server (API)** | `server/` | Node + Express + Prisma | 4000 |
| **Client (dashboard)** | `client/` | Next.js | 3000 |

You'll open **3 terminals** (one each for AI, server, client) after a one-time setup. Everything below assumes Windows (PowerShell or Command Prompt) and that you're in `F:\F_comFlow`.

---

## 1. Prerequisites (install once)

- **Node.js 20+** — https://nodejs.org (includes `npm`). Check: `node -v`
- **Python 3.11 or 3.12** — https://www.python.org/downloads (tick "Add Python to PATH"). Check: `python --version`
- **PostgreSQL** — either install it, or use Docker (easiest). See step 2.
- *(optional)* **Docker Desktop** — the simplest way to run the database.

---

## 2. Start the database

The server is preconfigured (in `server/.env`) to use:
`postgresql://postgres:postgres@localhost:5432/f_com`

Pick ONE option that provides exactly that.

### Option A — Docker (recommended, one command)

```
docker run --name fcom-db -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=f_com -p 5432:5432 -d postgres:16
```

That creates user `postgres`, password `postgres`, database `f_com` — matching the config. To stop/start later: `docker stop fcom-db` / `docker start fcom-db`.

### Option B — PostgreSQL installed on Windows

1. During install set the `postgres` user password to `postgres`.
2. Create the database (in "SQL Shell (psql)" or pgAdmin):
   ```
   CREATE DATABASE f_com;
   ```

> Using different credentials? Just edit `DATABASE_URL` in `server/.env` to match.

---

## 3. One-time setup of each app

### 3a. AI service (`ai/`)

```
cd ai
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
python train\train_model.py        REM trains the COD risk model (optional but recommended)
cd ..
```

- `train_model.py` creates `ai/models/risk_model_v1.joblib`. Without it the service still runs and falls back to rule-based scoring.
- Real Gemini parsing is optional: put `GEMINI_API_KEY=...` in `ai/.env` (blank = built-in NLP, which works fine).

### 3b. Server (`server/`)

```
cd server
npm install
npx prisma generate
npx prisma db push        REM creates all tables in the f_com database
npm run db:seed           REM optional: loads demo data + a demo login
cd ..
```

- `server/.env` already has working local defaults (DB, JWT secrets, AI URL, courier keys you added).

### 3c. Client (`client/`)

```
cd client
npm install
cd ..
```

- The client reads the API URL from `client/.env.local` (`NEXT_PUBLIC_API_URL=http://localhost:4000`). It's already set for local; no change needed.

---

## 4. Run it (3 terminals)

Start the database first (step 2), then open three terminals in `F:\F_comFlow`.

**Terminal 1 — AI service**
```
cd ai
venv\Scripts\activate
uvicorn app.main:app --port 8000 --reload
```

**Terminal 2 — Server (API)**
```
cd server
npm run dev
```

**Terminal 3 — Client (dashboard)**
```
cd client
npm run dev
```

Start order matters a little: **database → AI → server → client**. (The server still runs if the AI service is down — it just falls back to its built-in parser/risk engine.)

---

## 5. Check it's working

- API health: open http://localhost:4000/api/health → `{"status":"ok","service":"fcomflow-api"}`
- AI health: open http://localhost:8000/api/health → `{"status":"ok","service":"fcomflow-ai",...}`
- App: open **http://localhost:3000**

**Log in:** if you ran `npm run db:seed`, use **demo@fcomflow.com / demo1234**. Otherwise click **Register** and create a new merchant.

---

## 6. Optional extras

- **Redis durable queue** (off by default). Start Redis and enable it:
  ```
  docker run --name fcom-redis -p 6379:6379 -d redis:7-alpine
  ```
  then set `REDIS_URL=redis://localhost:6379` in `server/.env` and restart the server.
- **Courier check** (with your keys in `server/.env`):
  ```
  cd server
  npm run couriers:check            REM safe: auth + reads
  npm run couriers:check -- --book  REM also creates one test parcel
  ```
- **Everything at once with Docker** (instead of the 3 terminals): `docker compose up -d --build`, then open http://localhost:3000 and seed with `docker compose exec server npm run db:seed`.

---

## 7. Troubleshooting

| Symptom | Fix |
|--------|-----|
| `prisma db push` can't connect | The database isn't running or `DATABASE_URL` doesn't match. Recheck step 2. |
| Client loads but every action fails | The server (port 4000) isn't running, or `NEXT_PUBLIC_API_URL` is wrong in `client/.env.local`. |
| `uvicorn` not found | Activate the venv first: `venv\Scripts\activate`. |
| Port already in use | Something else is on 3000/4000/8000 — stop it, or change the port in that app's start command. |
| Login fails | Run `npm run db:seed` in `server/`, or register a fresh account at `/register`. |
| AI health shows `risk_model: rules` | The model file is missing — run `python train\train_model.py` in `ai/`. Not required; rules work fine. |

---

## Quick reference

```
DB:      docker start fcom-db           (or your local Postgres)
AI:      cd ai      -> venv\Scripts\activate -> uvicorn app.main:app --port 8000 --reload
Server:  cd server  -> npm run dev       (http://localhost:4000)
Client:  cd client  -> npm run dev       (http://localhost:3000)
Login:   demo@fcomflow.com / demo1234    (after npm run db:seed)
```
