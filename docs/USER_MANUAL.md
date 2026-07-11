# F-ComFlow — User Manual (First to Last)

Follow this document top to bottom. By the end you will have F-ComFlow running on your computer, will have walked through every feature exactly as described in the project report, and will know how to deploy it.

**Good news: every `.env` file is already created and filled in.** Your database URL and Gemini API key are already configured. You provide nothing else.

---

## Part 1 — Install the prerequisites (once)

| Tool | Why | Get it |
|---|---|---|
| Node.js 20+ | runs the API server & dashboard | nodejs.org |
| Python 3.11+ | runs the AI service | python.org (tick "Add to PATH" on Windows) |
| PostgreSQL | the database | you already have it running (`localhost:5432`, user `postgres`) |

Check they work — open a terminal and run:

```bash
node --version     # v20 or higher
python --version   # 3.11 or higher
```

---

## Part 2 — First-time setup (once, ~10 minutes)

Open a terminal in the `F_comFlow` folder.

### Step 1 — Set up the API server + database

```bash
cd server
npm install
npm run db:migrate
```

`db:migrate` creates the `ai_sales` database (if missing) and all tables. When it asks for a migration name, just press Enter.

```bash
npm run db:seed
```

This creates the demo store with products, conversations and orders. You'll see: `Login: demo@fcomflow.com / demo1234`.

### Step 2 — Set up the AI service

```bash
cd ../ai
pip install -r requirements.txt
python train/train_model.py
```

The last command generates the 10,000-transaction synthetic dataset and trains the **XGBoost COD risk model**. You should see `Held-out AUC: 0.8+ (exit gate: >= 0.78)` and `✅ Saved risk_model_v1.joblib`.

### Step 3 — Set up the dashboard

```bash
cd ../client
npm install
```

Setup is done. You never repeat Part 2.

---

## Part 3 — Starting F-ComFlow (every time)

Open **three terminals** in the `F_comFlow` folder:

| Terminal | Commands | Ready when you see |
|---|---|---|
| 1 — API | `cd server` → `npm run dev` | `F-ComFlow API running on http://localhost:4000` |
| 2 — AI | `cd ai` → `python -m uvicorn app.main:app --port 8000` | `Uvicorn running on http://127.0.0.1:8000` |
| 3 — Dashboard | `cd client` → `npm run dev` | `Ready` / `Local: http://localhost:3000` |

Now open **http://localhost:3000** in your browser.

> Terminal 2 is optional — without it, parsing and risk scoring silently use the built-in fallback engines. With it, you get real Gemini parsing and the XGBoost model.

---

## Part 4 — Using every feature (the full walkthrough)

### 4.1 Log in

Email `demo@fcomflow.com`, password `demo1234`. You land on the **Overview** page — cards for conversations, orders, products and ledger balance, plus the order pipeline.

(Or click **Create your store** to register a brand-new merchant — that's a completely isolated second tenant; it will see none of the demo data.)

### 4.2 Unified Inbox — receive and answer customers

Sidebar → **Inbox**.

1. Two seeded conversations are already there (Messenger + WhatsApp).
2. Press **"Simulate incoming message"** (top right) — a new Banglish customer conversation appears **live, without refreshing**. This stands in for a real Meta/WhatsApp webhook.
3. Click a conversation → read the thread → type in the reply box → **Send**.
4. Press **Claim** to assign the conversation to yourself so a teammate doesn't answer the same customer twice.

### 4.3 AI Smart Order Parser — one click, chat → draft order

With a conversation open:

1. Press **✨ Extract Order**. The chat goes to the FastAPI service → **Gemini 1.5 Flash** parses it (rule-based NLP if Gemini is unavailable).
2. A draft-order form appears, pre-filled with name, 11-digit phone, address, district, product and quantity. Fields the AI wasn't sure about are highlighted **CHECK THIS** — edit them.
3. Invalid values physically cannot be saved (wrong phone format or fake district → clear error).
4. Press **Create draft order** → you're taken to the order page.

### 4.4 Confirm the order — atomic stock + AI risk score

On the order page press **Confirm order (reserve stock)**. In one atomic step:

- Stock is decremented (two people can never buy the last unit — the database allows exactly one through)
- The **COD risk score** is computed by the XGBoost model and written to the timeline **with its reasons**

If the score is at/above your threshold (default 60), a red **High COD risk** banner appears with **Request advance payment** — one click creates a 20% booking-fee QR invoice (see 4.6). Try order **#1003** in the Orders list to see this immediately.

### 4.5 Courier dispatch — compare, book, label, track

Still on the confirmed order:

1. **Book courier** → live rate comparison across **Pathao / RedX / Paperfly** (price + ETA).
2. Press **Book** on one → order becomes DISPATCHED, a tracking code is stored, and the customer SMS is logged in the timeline. Double-clicking Book can't create two shipments.
3. **Print label** → a shipping label opens; press *Print / Save PDF*.
4. Sidebar → **Shipping** shows every parcel with a progress bar. Press **Sync status** to pull the next carrier update — when the carrier reports *Delivered*, the order automatically becomes DELIVERED.

### 4.6 Bangla QR payment — invoice, scan, settle

On any unpaid order:

1. **Create QR invoice** → a Bangla-QR invoice appears with the amount.
2. Press **Simulate customer payment** (stands in for scanning with bKash/Nagad/a bank app in the SSLCOMMERZ sandbox).
3. Instantly and atomically: order → **PAID**, and a ledger entry is written — gross, **1% MDR fee, 15% VAT on the fee**, net. Replaying the same payment can never create a second entry.

### 4.7 Payments & Ledger

Sidebar → **Payments**: running balance card, every settlement with its fee breakdown, and **Export CSV**.

### 4.8 Inventory

Sidebar → **Inventory**: add/edit products, restock. When stock crosses a product's reorder threshold you get **one** live low-stock alert (restocking re-arms it). The *Classic Watch* is seeded already-low so you can see the warning banner.

External store sync (Shopify/WooCommerce style): an external store can call
`POST http://localhost:4000/api/webhooks/store/<tenantId>/order` with `{"sku":"TSH-001","quantity":1,"source":"shopify"}` — central stock decrements atomically and the dashboard updates.

### 4.9 Settings

Sidebar → **Settings**: your profile + the **COD risk threshold** slider that controls when the high-risk banner appears.

### The 5-minute demo script (for judges)

Login → Inbox → *Simulate incoming message* → open it → *Extract Order* → *Create draft order* → *Confirm* (watch the risk score) → *Book courier* → *Print label* → *Create QR invoice* → *Simulate customer payment* → show **Payments** ledger → show **Inventory** stock drop. That's the exact end-to-end path from the report.

---

## Part 5 — Deploying to the internet

See **[DEPLOY.md](DEPLOY.md)** for full details. Short version — on any server with Docker:

```bash
docker compose up -d --build
docker compose exec server npm run db:seed
```

The root `.env` is already prepared (for a public server, change `CLIENT_URL` / `NEXT_PUBLIC_API_URL` to your domain and set `COOKIE_SECURE=true` once you have HTTPS).

---

## Part 6 — If something goes wrong

| Symptom | Fix |
|---|---|
| `db:migrate` can't connect | Is PostgreSQL running? Password `postgres` correct? Check `server/.env` → `DATABASE_URL` |
| Dashboard says *Request failed* | Terminal 1 (API) isn't running |
| Extract Order says engine `local` | Terminal 2 (AI) isn't running, or the Gemini key was rejected — everything still works via fallback |
| Port already in use | Something else is on 3000/4000/8000 — close it or change the port in the env files |
| Want a clean slate | `cd server` → `npm run db:reset` (wipes + re-migrates + re-seeds) |
