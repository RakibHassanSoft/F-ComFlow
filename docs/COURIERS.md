# Real Courier Tracking (Pathao, RedX & Steadfast)

The courier layer runs in two modes per carrier, decided automatically by `server/.env`:

- **Credentials blank** → sandbox mocks: booking, tracking codes, labels and the journey all work; statuses advance with the *Sync* button. The demo never breaks.
- **Credentials filled** → the REAL carrier API: real price quotes (Pathao), real consignment booking, and **real tracking that appears on the website by itself** — the exact status the courier reports.

## How live updates reach the screen (three paths, one pipeline)

1. **Pathao webhook** — Pathao pushes every status change to `POST /api/webhooks/courier/pathao` the moment it happens (signature-verified).
2. **Background poller** — the server automatically polls every live-carrier shipment (default every 3 minutes; `COURIER_POLL_MS` to change).
3. **Manual Sync button** — pulls the latest status right now.

All three call the same update function: it writes the timeline event, moves the order to DELIVERED/RETURNED when the carrier says so (returns even restock automatically), and **broadcasts over Socket.io — the Shipping page progress bars and the order timeline move on screen with no refresh.**

## Getting Pathao credentials

1. Register as a Pathao merchant (free — any shop can) and ask merchant support for **Courier API access**; they issue `client_id`, `client_secret`, and you use your merchant login as `username`/`password`. A **sandbox** environment is available for developers.
2. Note your **Store ID** from the merchant panel.
3. Fill in `server/.env`: `PATHAO_CLIENT_ID`, `PATHAO_CLIENT_SECRET`, `PATHAO_USERNAME`, `PATHAO_PASSWORD`, `PATHAO_STORE_ID`. Leave `PATHAO_BASE_URL` blank for sandbox; for production set `PATHAO_BASE_URL=https://api-hermes.pathao.com`.
4. For push updates, configure a webhook in the Pathao panel pointing at `{PUBLIC_API_URL}/api/webhooks/courier/pathao` and put the same secret in `PATHAO_WEBHOOK_SECRET`. The endpoint verifies Pathao's `X-PATHAO-Signature`, echoes the required `X-Pathao-Merchant-Webhook-Integration-Secret` response header, answers the `webhook_integration` handshake, and reads the status from Pathao's `event` field (e.g. `order.delivered`, `order.in-transit`, `order.returned`). Without the webhook, the background poller still keeps everything current.

## Getting RedX credentials

1. Sign up as a RedX merchant → the developer portal issues a JWT **API access token**.
2. Fill `REDX_ACCESS_TOKEN` in `server/.env`. Leave `REDX_BASE_URL` blank for sandbox; for production set `REDX_BASE_URL=https://openapi.redx.com.bd/v1.0.0-beta`.
3. `pickup_store_id` is optional — leave `REDX_PICKUP_STORE_ID` blank and the app auto-detects your first pickup store (RedX otherwise uses your account default). Set it explicitly if you have several.
4. RedX supports webhooks: point the RedX panel's callback URL at `{PUBLIC_API_URL}/api/webhooks/courier/redx?token=YOUR_TOKEN` and set the same value in `REDX_WEBHOOK_TOKEN`. Statuses (ready-for-delivery, delivery-in-progress, delivered, agent-hold, agent-returning, returned) are mapped automatically. Even without the webhook, the background poller pulls RedX tracking every few minutes.

## Getting Steadfast credentials

1. Sign up at portal.packzy.com → the panel issues an **Api-Key** and **Secret-Key**.
2. Fill `STEADFAST_API_KEY` and `STEADFAST_SECRET_KEY` in `server/.env`. `STEADFAST_BASE_URL` defaults to `https://portal.packzy.com/api/v1`.
3. Steadfast tracking is pulled by the background poller (`status_by_trackingcode`).

## What was NOT changed

Booking flow, the idempotency guard (double-click can't double-book), labels, rate-comparison UI, SMS timeline entries — all identical in both modes. Paperfly remains a sandbox mock (they issue API docs to registered merchants on request); its adapter class is the single file to fill in when that happens.
