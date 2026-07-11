# F-ComFlow — Complete User Workflow & Honest Status

This document walks through **everything a user does in the product, first to last**, and tells you plainly for each step whether it is real, simulated, or waiting on outside approval. Read it top to bottom and you'll know exactly what to claim confidently and what to caveat.

**Legend used throughout:**

- ✅ **REAL** — actual working code; runs live on your machine, judges can poke it
- 🎭 **SIMULATED** — works end-to-end in the demo, but the external party (Meta, courier, bank) is played by a realistic stand-in; the code keeps the real API's contract
- 🔑 **NEEDS APPROVAL** — the real version is blocked only by third-party credentials/verification (paperwork), not by missing code

---

## Step 0 — The merchant discovers F-ComFlow and signs up

The merchant opens the site, clicks **Create your store**, enters business name, their name, email, password.

| What happens | Status |
|---|---|
| A brand-new **tenant** (isolated workspace) is created in PostgreSQL | ✅ REAL |
| Password hashed with bcrypt, JWT session in httpOnly cookies, refresh rotation | ✅ REAL |
| Complete isolation: this store can never see another store's data (every query is tenant-scoped) | ✅ REAL |
| Rate limiting on login (brute-force protection), audit log of logins | ✅ REAL |

**Verdict: fully real.** Two people can register two stores right now and prove isolation to a judge.

---

## Step 1 — The merchant connects their channels

In the finished product: merchant clicks "Connect Facebook Page" → Facebook OAuth popup → picks their Page → done. Messages start flowing in automatically. Same for Instagram and WhatsApp Business.

| What happens | Status |
|---|---|
| The "Connect" OAuth flow with Meta | 🔑 NEEDS APPROVAL — requires a Meta developer app passing App Review + Business Verification (paperwork, days–weeks). No code obstacle. |
| Receiving messages via webhooks | 🎭 SIMULATED — the **"Simulate incoming message"** button stands in for Meta's webhook. It creates a realistic Banglish conversation and pushes it through the *identical* pipeline (database → socket → dashboard) a real webhook would use. |
| WhatsApp personal accounts | ❌ Not possible legally for anyone — only WhatsApp **Business** API accounts can be connected. This is a Meta rule, not our limitation. |

**Verdict: this is the one honest gap in the whole product**, and it's a credentials gap, not an engineering gap. Say exactly that if asked.

---

## Step 2 — A customer messages, the merchant answers (Unified Inbox)

A customer writes "Cotton Panjabi ta ki ache? 2 ta nibo, 01712345678, Dhanmondi Dhaka" on Messenger at 11pm.

| What happens | Status |
|---|---|
| Message appears in the inbox **live, no page refresh** (Socket.io, tenant-scoped rooms) | ✅ REAL |
| Conversation list with channel badges, unread counts, last-message preview | ✅ REAL |
| Merchant replies from the dashboard | ✅ REAL (stored + broadcast live; the final hop back to the customer's phone is the same 🔑 Meta credential) |
| Two agents see the same thread update simultaneously; **Claim** prevents both answering | ✅ REAL |

---

## Step 3 — One click turns the chat into an order (AI Parser)

Merchant presses **✨ Extract Order**.

| What happens | Status |
|---|---|
| Chat is sent to the FastAPI AI microservice | ✅ REAL (separate Python service, actually running) |
| Parsing with **Google Gemini 1.5 Flash** | ✅ REAL *if your API key is valid* — the parse result literally tells you: `engine: "gemini"` |
| Fallback rule-based NLP (Banglish, Bengali numerals ০-৯, 64-district normalizer, catalog matching) | ✅ REAL — works with zero internet, `engine: "rules"` |
| Validation: phone must be a real 11-digit BD mobile, district must be one of the official 64 — bad values are impossible to save | ✅ REAL |
| Draft form with low-confidence fields highlighted for human review | ✅ REAL |
| Graceful failure: AI down → readable error, manual entry still possible; per-tenant daily quota | ✅ REAL |

**Verdict: fully real either way** — the only question is which engine answers, and the system tells you.

---

## Step 4 — Confirming the order (stock + risk, the transactional heart)

Merchant reviews the draft and presses **Confirm order**.

| What happens | Status |
|---|---|
| Stock reserved **atomically** — two simultaneous buyers of the last unit: exactly one succeeds, one gets a clean "out of stock". The double-selling fix. | ✅ REAL (single conditional SQL update; genuinely race-proof) |
| **COD risk score** computed before dispatch | ✅ REAL — a trained gradient-boosting/XGBoost model (10k-row synthetic dataset, AUC 0.836) served from FastAPI, with feature-based reasons shown in the timeline |
| The *training data* behind the model | 🎭 SYNTHETIC — as the project report itself discloses; real merchant history recalibrates it later |
| Risk service down → order proceeds with "score unavailable", never blocked | ✅ REAL |
| High-risk banner + one-click **Request advance payment** (20% booking fee) | ✅ REAL |
| Illegal state jumps (Draft→Delivered etc.) rejected server-side | ✅ REAL |
| Cancel/return puts stock back; totals always reconcile | ✅ REAL |

---

## Step 5 — Inventory stays truthful everywhere

| What happens | Status |
|---|---|
| Central product catalog, add/edit/restock | ✅ REAL |
| Low-stock alert — exactly one per threshold crossing, live toast, re-arms on restock | ✅ REAL |
| External store sync (Shopify/WooCommerce): inbound webhook decrements the same central stock atomically | ✅ REAL endpoint — 🎭 the *external store calling it* is simulated (a curl/Postman call plays Shopify) |

---

## Step 6 — Booking the courier

Merchant presses **Book courier** on a confirmed order.

| What happens | Status |
|---|---|
| Rate comparison across Pathao / RedX / Paperfly, side by side | ✅ REAL comparison logic — 🎭 the *prices* come from mock adapters (real ones need 🔑 sandbox credentials from each courier) |
| One adapter interface, three implementations — 4th courier = plug-in | ✅ REAL architecture |
| Booking: tracking code stored, order → DISPATCHED, double-click can't double-book | ✅ REAL (idempotency guard is real) |
| One dead courier doesn't break the other two (chaos-tolerant) | ✅ REAL |
| Printable shipping label with recipient, COD amount, tracking | ✅ REAL |
| Tracking status journey + auto-DELIVERED when courier says delivered | ✅ REAL logic — 🎭 status changes come from the **Sync** button instead of real courier webhooks |
| Customer SMS on dispatch | 🎭 SIMULATED — logged in the timeline; real bulk-SMS provider is one HTTP call + 🔑 an account |

---

## Step 7 — Getting paid (Bangla QR)

Merchant presses **Create QR invoice**; the customer scans and pays.

| What happens | Status |
|---|---|
| Invoice created (full or 20% advance), QR displayed | ✅ REAL invoice — 🎭 the QR pattern is generated locally (a real one comes from SSLCOMMERZ with 🔑 a merchant account) |
| "Customer pays" | 🎭 SIMULATED by one button (stands in for the sandbox wallet) |
| **Settlement** — the part that matters: one atomic transaction marks the order paid, writes the ledger entry, updates payment status; any failure rolls all of it back | ✅ REAL |
| **Idempotency** — the same payment webhook replayed 10× produces exactly one ledger entry | ✅ REAL (unique transaction constraint, actually enforced by the DB) |
| Fee math: 1% MDR + 15% VAT on the fee, exact 2-decimal money, never floats | ✅ REAL |
| Ledger page: running balance, per-payment breakdown, CSV export | ✅ REAL |

---

## Step 8 — Day-to-day life

| What happens | Status |
|---|---|
| Overview dashboard with live counts and pipeline | ✅ REAL |
| Settings: risk threshold slider changes when the high-risk banner appears | ✅ REAL |
| Sessions survive refresh, logout works, expired tokens auto-refresh | ✅ REAL |

---

## The honest one-paragraph summary

**Everything inside the product's own walls is real**: multi-tenant auth and isolation, the live inbox, the FastAPI AI service (real Gemini when the key is valid, real NLP fallback when not), the trained risk model, atomic inventory, the order state machine, idempotent atomic payments with correct money math, and the ledger. **Everything at the boundary with an external company is simulated with contract-faithful stand-ins**: Meta message delivery, courier price/booking/tracking feeds, the SSLCOMMERZ wallet, and SMS. Every one of those is gated by third-party credentials or business verification — paperwork, not code. The swap-in points are single files, already marked.

## What to say if a judge pushes on the simulated parts

"The webhook gateway, the queue-shaped pipeline, the adapters, and the settlement logic are all real and tested — what's simulated is the counterparty. Meta, Pathao, and SSLCOMMERZ each require business verification we can't complete as students in fest timelines, so we built contract-identical sandboxes behind the same interfaces. Connecting the real ones changes one file each and zero business logic."

## Where each claim can be verified

| Claim | Verify by |
|---|---|
| Tenant isolation | Register 2 stores in 2 browsers — try to see each other's data |
| Live inbox | Open 2 tabs, simulate a message — both update instantly |
| AI parse + validation | Extract from a chat; try saving a 10-digit phone |
| Race-proof stock | Product with stock 1, confirm 2 draft orders — one wins, one gets 409 |
| Risk model | Confirm an order to a vague address in Rangpur vs a full Dhaka address |
| Idempotent payments | Replay the payment webhook — ledger never duplicates |
| Fee math | ৳1100 → fee 11.00, VAT 1.65, net 1087.35 — check the ledger row |
