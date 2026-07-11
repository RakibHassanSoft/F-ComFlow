# F-ComFlow — Social Commerce OS 🇧🇩

Everything a Bangladeshi f-commerce merchant needs in one dashboard: unified Messenger/Instagram/WhatsApp inbox, AI order parsing from Banglish chats, central inventory, courier booking, Bangla QR payments, and an ML-powered COD risk score on every order.

Built phase-by-phase following the **F-ComFlow Developer Implementation Guide** (the PDF in this folder).

## Architecture

```
F_comFlow/
├── client/     Next.js 14 + TypeScript + Tailwind   — the dashboard   (port 3000)
├── server/     Express + TypeScript + Prisma         — the API        (port 4000)
├── ai/         Python FastAPI + scikit-learn         — AI service     (port 8000)
│               ├─ NLP order parser (rule-based, or real Gemini via GEMINI_API_KEY)
│               └─ COD risk model (trained on a synthetic 10k dataset, AUC-gated)
├── docs/       GUIDE.md (phase-by-phase) + DEPLOY.md (production)
└── docker-compose.yml   the entire stack in one command
```

The Node API calls the AI service for parsing and risk scoring. If the AI service is unreachable, it **automatically falls back** to built-in TypeScript engines — nothing ever hard-fails. Messaging, couriers, and payments are simulated (no API keys needed); each mock keeps the real API's contract so real credentials are a one-file swap.

## Quickest start — Docker (everything at once)

Needs only Docker Desktop:

```bash
copy .env.example .env        # macOS/Linux: cp .env.example .env  — then edit the secrets
docker compose up -d --build
docker compose exec server npm run db:seed
```

Open **http://localhost:3000** → log in with `demo@fcomflow.com / demo1234`.

## Dev start — run each app yourself

Needs Node.js 20+, Python 3.11+, Docker (for the database only).

```bash
# 1. Database
docker compose up -d postgres

# 2. API server (terminal 1)
cd server
copy .env.example .env
npm install
npm run db:migrate
npm run db:seed
npm run dev                    # -> http://localhost:4000

# 3. AI service (terminal 2)
cd ai
copy .env.example .env
pip install -r requirements.txt
python train/train_model.py    # trains the risk model (~10s, prints AUC)
uvicorn app.main:app --port 8000 --reload

# 4. Dashboard (terminal 3)
cd client
npm install
npm run dev                    # -> http://localhost:3000
```

The AI service is optional in dev — without it the API uses its built-in fallback engines and everything still works.

## The 5-minute demo path

1. **Inbox** → **"Simulate incoming message"** → a Banglish customer chat appears live (no refresh).
2. Open it → **Extract Order** → the AI fills a draft-order form (uncertain fields highlighted) → create.
3. **Confirm order** → stock atomically reserved + **COD risk score** (from the trained model) in the timeline.
4. **Book courier** → compare Pathao/RedX/Paperfly rates → book → tracking + SMS logged → **Print label**.
5. **Create QR invoice** → **Simulate customer payment** → order flips to PAID, ledger gains an entry (1% MDR + 15% VAT, exact decimals).
6. High-risk order? A red banner offers **one-click 20% advance payment** before dispatch.

## Presentation demo (no backend needed)

`presentation/index.html` is a **static, offline replica** of the dashboard — double-click it to open in any browser. Same design, scripted data, and the entire 5-minute demo path is clickable (simulate message → AI extract → confirm + risk → book courier → QR payment → ledger). Use it for slides, rehearsal, or as the offline fallback if venue internet fails.

## Documentation

- **[docs/GUIDE.md](docs/GUIDE.md)** — every phase: what it built, which files, how to test its exit gate.
- **[docs/DEPLOY.md](docs/DEPLOY.md)** — production deployment: single VPS with Docker, or Vercel + Railway/Render, with HTTPS/cookie settings explained.
"# F-ComFlow" 
