# F-ComFlow — Step-by-Step Phase Guide

This maps every phase of the Developer Implementation Guide (the PDF) to the code in this repo. Each phase lists **what was built**, **where it lives** (client + backend built in parallel), and **how to test it** against the PDF's exit gate.

> **Mocked integrations:** Meta/WhatsApp webhooks, Gemini, the three couriers, and SSLCOMMERZ are simulated so the demo needs zero API keys. Every mock lives in one file and keeps the real API's contract — the swap-in points are noted per phase.

---

## Phase 0 — Foundations & DevOps

**What:** repo structure, one-command database, environment discipline, CI.

| Piece | File |
|---|---|
| PostgreSQL 16 in one command | `docker-compose.yml` |
| All secrets in env (never committed) | `server/.env.example`, `.gitignore` |
| Database schema + migrations (Prisma) | `server/prisma/schema.prisma` |
| CI: typecheck + build on every push | `.github/workflows/ci.yml` |
| Health check endpoint | `server/src/index.ts` → `GET /api/health` |

**Test the gate:** fresh clone → `docker compose up -d` → server `npm install && npm run db:migrate && npm run dev` → `http://localhost:4000/api/health` returns `{"status":"ok"}`. Migrations re-apply cleanly with `npm run db:reset`.

---

## Phase 1 — Multi-Tenant Core & Authentication

**What:** merchant registration creates an isolated **tenant**; JWT auth in httpOnly cookies with refresh rotation; every business table carries `tenantId` and **every query filters by it**.

| Piece | File |
|---|---|
| Register / login / refresh / logout / me | `server/src/routes/auth.routes.ts` |
| Auth middleware (token → userId + tenantId) | `server/src/middleware/auth.ts` |
| Rate limiting on auth endpoints | `server/src/middleware/rateLimit.ts` |
| Login & register pages | `client/src/app/login`, `client/src/app/register` |
| Protected dashboard shell + sidebar | `client/src/app/dashboard/layout.tsx` |
| Session context for all pages | `client/src/lib/session.tsx` |

**How isolation works (read this — it's the core rule):** `requireAuth` decodes the JWT and sets `req.tenantId`. Every single Prisma query in every route includes `where: { tenantId: req.tenantId }`. Fetching another tenant's record ID returns 404, never data. (The PDF's Postgres RLS layer is the production hardening step on top of this; app-level scoping keeps the code beginner-readable.)

**Test the gate:** register two stores (Tenant A, B) in two browsers. Each sees only its own data everywhere. Refresh the page — session survives. 6 rapid failed logins → `429 Too many attempts`. Wrong password → 401, never 500.

---

## Phase 2 — Messaging Ingestion & Unified Inbox

**What:** customer conversations from 3 channels in one inbox, updating live via Socket.io with **per-tenant rooms**.

| Piece | File |
|---|---|
| Message simulator (stands in for Meta webhooks) | `server/src/services/simulator.ts` |
| Inbox API: list, thread, reply, assign | `server/src/routes/inbox.routes.ts` |
| Socket.io: tenant rooms, verified join | `server/src/lib/socket.ts`, `client/src/lib/socket.ts` |
| Inbox UI: list + thread + reply box | `client/src/app/dashboard/inbox/page.tsx` |

**Real-integration swap:** replace `simulator.ts` with a webhook route that verifies Meta's HMAC signature, pushes payloads to a queue, and lets a worker call the same "create message + `emitToTenant`" code.

**Test the gate:** press **Simulate incoming message** — the conversation appears in under a second without refresh. Reply from the thread. Open the same tenant in two tabs: both update simultaneously; **Claim** prevents double-handling. Tenant B never sees Tenant A's messages (rooms are joined only after JWT verification).

---

## Phase 3 — AI Order Parser

**What:** one click turns a Banglish/Bengali/English chat into a validated draft order.

| Piece | File |
|---|---|
| Parser: phone, district, product, qty, address | `server/src/services/aiParser.ts` |
| 64-district list + spelling normalizer | `server/src/data/districts.ts` |
| Endpoint + per-tenant daily quota | `server/src/routes/ai.routes.ts` |
| Extract Order button → editable draft form | `client/src/app/dashboard/inbox/page.tsx` |

**Validation you can't bypass:** phone must match `01[3-9]XXXXXXXX`, district must be one of the official 64 — enforced again server-side on order creation (`order.routes.ts`), so invalid values are impossible to save. Low-confidence fields come back flagged and the form highlights them with "CHECK THIS".

**Real-integration swap:** in `aiParser.ts`, replace the pattern-matching body with a Gemini call using a schema-constrained prompt — the return shape stays identical.

**Test the gate:** Extract Order on a simulated chat → fields pre-filled, uncertain ones highlighted. Try saving a 10-digit phone → clear 400 error. Empty conversation → readable error, no crash.

---

## Phase 4 — Inventory & Order Management

**What:** product catalog, order state machine, and the **atomic stock decrement** that kills double-selling.

| Piece | File |
|---|---|
| Product CRUD + restock re-arms alerts | `server/src/routes/product.routes.ts` |
| State machine + atomic confirm + restock | `server/src/routes/order.routes.ts` |
| Inventory UI + low-stock banner | `client/src/app/dashboard/inventory/page.tsx` |
| Orders list + filters | `client/src/app/dashboard/orders/page.tsx` |
| Order detail + timeline + actions | `client/src/app/dashboard/orders/[id]/page.tsx` |

**The double-selling fix, explained:** confirmation runs `updateMany({ where: { id, stockQuantity: { gte: qty } }, data: { decrement } })` inside a transaction. The stock check and the decrement are **one database statement**, so two simultaneous confirmations of the last unit can never both pass — the DB serializes them and exactly one wins; the other gets a clean 409.

**Test the gate:** illegal transitions (Draft → Delivered) return 422. Cancel a confirmed order → stock comes back. Confirm orders until stock crosses the reorder threshold → exactly one live toast alert; restock above it and re-cross → it fires again.

---

## Phase 5 — Courier Dispatch

**What:** compare rates across Pathao / RedX / Paperfly, book, print label, sync tracking.

| Piece | File |
|---|---|
| Adapter interface + 3 implementations | `server/src/services/couriers.ts` |
| Rates, idempotent booking, status sync | `server/src/routes/courier.routes.ts` |
| Booking modal with rate comparison | `client/src/app/dashboard/orders/[id]/page.tsx` |
| Shipping page with journey progress | `client/src/app/dashboard/shipping/page.tsx` |
| Printable label (print → Save as PDF) | `client/src/app/dashboard/orders/[id]/label/page.tsx` |

**Design notes matching the PDF:** one `CourierAdapter` contract — a 4th carrier is a new class, not a rewrite. `compareRates` uses `Promise.allSettled`, so one dead carrier still returns the other two. Booking checks `trackingCode` first — double-clicking Book can never create two consignments. Dispatch "SMS" is logged in the order timeline.

**Test the gate:** book from the rate modal → order becomes DISPATCHED with tracking code → label prints with correct recipient → **Sync status** walks the journey → final sync flips the order to DELIVERED.

---

## Phase 6 — Payments, Bangla QR & Settlement Ledger

**What:** QR invoices, idempotent webhook settlement, an always-consistent ledger.

| Piece | File |
|---|---|
| Invoices, atomic settlement, ledger, CSV | `server/src/routes/payment.routes.ts` |
| QR invoice modal + sandbox pay button | `client/src/app/dashboard/orders/[id]/page.tsx` |
| QR rendering | `client/src/components/QrMock.tsx` |
| Ledger UI + running balance + export | `client/src/app/dashboard/payments/page.tsx` |

**Financial correctness, matching the PDF's bar:**
- Settlement is one `prisma.$transaction`: invoice → ledger entry → order payment status. Any failure rolls all three back — no half-paid states.
- **Idempotency twice over:** an already-PAID invoice returns early, and `transactionId` + `invoiceId` carry unique constraints — replaying the webhook 10 times produces exactly one ledger entry.
- Amounts are `Decimal(10,2)` in PostgreSQL, rounded to exactly 2 places: fee = 1% of gross, VAT = 15% of the fee, net = gross − fee − VAT.

**Test the gate:** pay an invoice → check the ledger arithmetic by hand (e.g. ৳1100 → fee 11.00, VAT 1.65, net 1087.35). A webhook for a cancelled order → clean 422, logged, no crash.

---

## Phase 7 — COD Risk Predictor + Demo Prep

**What:** every confirmed order gets a 0–100 risk score; high-risk orders get a banner and a one-click advance-payment request.

| Piece | File |
|---|---|
| Feature pipeline + weighted scoring | `server/src/services/riskScorer.ts` |
| Scoring wired into confirm (graceful) | `server/src/routes/order.routes.ts` |
| High-risk banner + advance request | `client/src/app/dashboard/orders/[id]/page.tsx` |
| Configurable threshold | `client/src/app/dashboard/settings/page.tsx` |
| Demo tenant seed | `server/prisma/seed.ts` |

**The features (same pipeline the PDF's XGBoost model would use):** phone validity 25%, address completeness 30%, customer's historical return rate 25%, regional district risk 20%. Every score is written to the order timeline **with its reasons**, so the merchant sees *why*. Replace the weighted sum with a model-serving call later — the interface doesn't change.

**Graceful degradation:** scoring is wrapped in try/catch — if it fails, the order confirms anyway with "Risk score unavailable" in the timeline. Dispatch is never blocked by a scoring outage.

**Test the gate:** seed order #1003 (Rangpur, sparse address, new customer) scores HIGH → banner shows → **Request advance payment** creates a 20% QR invoice → paying it sets the order to PARTIAL. Lower the threshold in Settings and watch more orders flag.

---

## Production-hardening map (mock → real)

| Mock in this repo | Real replacement |
|---|---|
| `services/simulator.ts` | Meta/WhatsApp webhooks + HMAC validation + Redis queue + workers |
| AI parsing (`ai/app/parser.py` rules) | **Already wired:** set `GEMINI_API_KEY` in `ai/.env` → real Gemini 1.5 Flash with schema-constrained prompt + re-validation |
| Risk scoring (`ai/app/risk.py`) | **Already wired:** trained gradient-boosting model served from FastAPI (`python train/train_model.py`, AUC-gated ≥ 0.78) |
| `services/couriers.ts` (3 classes) | Pathao/RedX/Paperfly sandbox APIs + OAuth token cache |
| `payments` sandbox pay button | SSLCOMMERZ session + signed IPN webhook |
| In-memory rate limits/quotas | Redis counters |
| App-level tenant scoping | + PostgreSQL Row-Level Security policies |

For production deployment (Docker single-server or managed platforms), see **[DEPLOY.md](DEPLOY.md)**.
