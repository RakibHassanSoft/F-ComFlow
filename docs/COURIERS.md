# Real Courier Tracking (Pathao & RedX)

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
3. Fill in `server/.env`: `PATHAO_CLIENT_ID`, `PATHAO_CLIENT_SECRET`, `PATHAO_USERNAME`, `PATHAO_PASSWORD`, `PATHAO_STORE_ID`. Leave `PATHAO_BASE_URL` blank for sandbox; set it to the production URL when going live.
4. For push updates, configure a webhook in the Pathao panel pointing at `{PUBLIC_API_URL}/api/webhooks/courier/pathao` and put the same secret in `PATHAO_WEBHOOK_SECRET`. (Without the webhook, the background poller still keeps everything current.)

## Getting RedX credentials

1. Sign up as a RedX merchant → the merchant panel / developer portal issues an **API access token**.
2. Fill `REDX_ACCESS_TOKEN` in `server/.env`. Leave `REDX_BASE_URL` blank for their sandbox.
3. RedX has no webhook — the background poller pulls its tracking automatically.

## What was NOT changed

Booking flow, the idempotency guard (double-click can't double-book), labels, rate-comparison UI, SMS timeline entries — all identical in both modes. Paperfly remains a sandbox mock (they issue API docs to registered merchants on request); its adapter class is the single file to fill in when that happens.
