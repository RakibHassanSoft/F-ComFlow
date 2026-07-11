# Connecting Real Social Channels (Messenger, Instagram, WhatsApp)

F-ComFlow's real integration is fully built: a signature-verified webhook receives messages from all three platforms, routes each one to the right merchant, and replies go back out through Meta's official APIs. This guide is what YOU (the platform owner) do on Meta's side to switch it on.

**The system works in two modes, automatically:**
- No channels connected → the inbox runs on the **simulator** (demo mode)
- Channel connected → **real messages** flow in through the same pipeline; simulated and real conversations coexist happily

**Merchants have TWO ways to connect (Settings → Connected channels):**

1. **One-click (the friendly way):** press **Connect with Facebook** → the official Facebook popup opens → log in, pick your Page → done. The linked Instagram connects with one checkbox. **Connect WhatsApp** opens Meta's Embedded Signup popup the same way. Tokens are exchanged server-side; the merchant never sees or pastes anything, and the Page is auto-subscribed to the webhook.
2. **Advanced (manual):** paste a Page/phone ID + access token. Useful in development before OAuth is configured.

One-click needs three extra values from your Meta app (all one-time, platform-owner work):
`META_APP_ID` in `server/.env`, `NEXT_PUBLIC_META_APP_ID` in `client/.env.local` (same value), and — for the WhatsApp button — `NEXT_PUBLIC_META_WA_CONFIG_ID` (Meta app → WhatsApp → Embedded signup → Configuration ID). Facebook Login also requires your site's URL in the Meta app's *Facebook Login → Settings → Allowed Domains* (use the https ngrok/production URL; the FB popup requires HTTPS).

---

## One-time prerequisite: a Meta developer app (~15 minutes, free)

1. Go to **developers.facebook.com** → *My Apps* → **Create App** → type **Business**.
2. In the app dashboard, note two values:
   - **App ID** (public)
   - **App Secret** (*Settings → Basic → App Secret → Show*)
3. Put the App Secret in `server/.env`:
   ```
   META_APP_SECRET="paste-it-here"
   ```
   (`META_VERIFY_TOKEN` is already generated in your .env — leave it.)

## One-time: expose your webhook URL

Meta must be able to reach your server over **public HTTPS**. Two options:

- **Deployed server:** your URL is `https://api.yourdomain.com/api/meta/webhook` — done.
- **Local development:** run a tunnel, e.g. `ngrok http 4000` → your URL is
  `https://<random>.ngrok-free.app/api/meta/webhook`.

## One-time: subscribe the webhook

In the Meta app dashboard, for **each** product you add (Messenger / Instagram / WhatsApp), find its **Webhooks / Configuration** section and enter:

| Field | Value |
|---|---|
| Callback URL | `https://<your-host>/api/meta/webhook` |
| Verify token | the `META_VERIFY_TOKEN` value from `server/.env` |

Press **Verify and Save** — F-ComFlow answers Meta's handshake automatically (you'll see `[meta] webhook verified ✅` in the server log). Then subscribe to the fields:

- Messenger → `messages`
- Instagram → `messages`
- WhatsApp → `messages`

---

## Channel 1 — Facebook Page (Messenger)

1. In the app dashboard: **Add product → Messenger** → *Messenger API settings*.
2. **Connect your Facebook Page** (you must be its admin) and **Generate token** → this is the **Page access token**.
3. Get your **Page ID**: it's shown next to the page in the same screen (or Page → About).
4. In F-ComFlow → **Settings → Connected channels**: choose *Facebook Page (Messenger)*, paste the **Page ID** and the **Page access token**, press **Verify & connect**. F-ComFlow calls the live Graph API to check the token before saving — a bad token is rejected on the spot.
5. **Test:** from a personal Facebook account, message your Page. It appears in the F-ComFlow inbox within seconds. Reply from the inbox — it arrives in the customer's Messenger.

> Development mode note: until your app passes Meta **App Review**, only people with a role in the app (admins/developers/testers you add) can message the Page and be received. That's perfect for a demo; App Review + Business Verification lifts it for the public.

## Channel 2 — Instagram

1. Requirement: an Instagram **Business or Creator** account **linked to your Facebook Page** (Instagram app → Settings → Business tools → connect Page — free, 2 minutes).
2. In the Meta app: **Add product → Instagram** → enable Instagram messaging; the same **Page access token** from Channel 1 is used.
3. Get the **Instagram account ID** (shown in the app dashboard's Instagram settings, or via Graph Explorer: `me/accounts?fields=instagram_business_account`).
4. In F-ComFlow → Settings: choose *Instagram*, paste the **IG account ID** + the **Page access token** → **Verify & connect**.
5. Also enable in the Instagram app itself: *Settings → Messages → Connected tools → Allow access*.
6. **Test:** DM your Instagram account from another account → appears in the inbox; replies flow back.

## Channel 3 — WhatsApp Business (Cloud API)

1. In the Meta app: **Add product → WhatsApp**. Meta instantly gives you:
   - a free **test phone number**,
   - its **Phone number ID** (shown right on the API Setup screen),
   - a **temporary access token** (24h). For permanent use, create a **System User** in Meta Business Settings → generate a non-expiring token with `whatsapp_business_messaging` permission.
2. In F-ComFlow → Settings: choose *WhatsApp*, paste the **Phone number ID** + the **token** → **Verify & connect**.
3. **Test:** on the API Setup screen, add your own phone as a recipient, send yourself the hello template, then reply to it from your phone → your message appears in the F-ComFlow inbox. Inbox replies arrive on your WhatsApp.

> Rule to remember: you can freely message a customer for **24 hours after their last message** (a "service window"). Outside it, only pre-approved template messages are allowed. Receiving is always free.

---

## What F-ComFlow does with all this (already built, nothing to code)

| Concern | How it's handled |
|---|---|
| Webhook handshake | `GET /api/meta/webhook` echoes `hub.challenge` only when the verify token matches |
| Forged events | Every POST's raw body is HMAC-SHA256-checked against `X-Hub-Signature-256` (timing-safe compare); mismatches get 403 and are never processed |
| Fast ACK | Meta gets its `200 OK` immediately; processing happens after the response, so retries/duplicates don't pile up |
| Multi-tenant routing | The event's Page ID / IG ID / phone-number ID is matched to the merchant who connected it — messages can never land in the wrong store |
| Customer identity | PSID / IGSID / WhatsApp number stored per customer; Messenger names looked up via the Graph API |
| Replies | Saved + shown locally always; delivered out via `me/messages` (Messenger/IG) or `{phone_number_id}/messages` (WhatsApp); a delivery failure never loses the reply |
| Credential safety | Tokens are verified against the live Graph API before saving, shown only as previews afterwards, and stored per-tenant |

## Channels 4–7 — Telegram, Viber, Website widget, Email (no Meta, no approval!)

### Telegram — the easiest real channel (great for live demos)
1. In Telegram, message **@BotFather** → `/newbot` → pick a name → copy the token.
2. Set `PUBLIC_API_URL` in `server/.env` (your ngrok https URL locally, or your API domain).
3. F-ComFlow → Settings → **Telegram** → paste the token → Connect. F-ComFlow verifies the token AND registers the webhook automatically.
4. **Test:** message your bot from any Telegram account → it appears in the inbox instantly; replies arrive back in Telegram. **This works for complete strangers immediately — no review of any kind.**

### Viber
1. Create a bot at **partners.viber.com** (free) → copy the auth token.
2. Settings → **Viber** → paste → Connect (webhook auto-registered via `PUBLIC_API_URL`). Inbound events are HMAC-signature-verified with the bot token.

### Website chat widget — 100% ours, works instantly
1. Settings → **Website chat widget** → Enable → copy the one-line `<script>` snippet.
2. Paste it into any website's HTML. A chat bubble appears; visitor messages land in the inbox as a **WEBCHAT** conversation; your replies show up in the visitor's widget (it polls every 3 s).
No third parties, no keys, no approval. Also perfect as a second live channel in demos.

### Email
1. Settings → **Email** → enter your support address → Connect.
2. **Outbound replies:** fill `SMTP_*` in `server/.env` (any provider — a Gmail app password works).
3. **Inbound mail:** point an "inbound parse" webhook (Mailgun Routes / SendGrid Inbound Parse / CloudMailin) at `POST {PUBLIC_API_URL}/api/email/inbound` with header `x-email-token: EMAIL_WEBHOOK_TOKEN` and JSON body `{to, from, fromName, subject, text}`.

## Ads: attribution + campaign control

The **Ads** page in the sidebar has two parts:

1. **Ad → Order attribution** — needs NOTHING extra. Click-to-Messenger, click-to-Instagram-Direct and click-to-WhatsApp ads all tag the incoming chat with the ad's id (our webhook captures it across all three surfaces), so the table shows per ad: conversations, orders, revenue, and how many of those orders were high-risk COD. In demo mode, simulated conversations carry demo ad tags so the page is never empty.
2. **Live campaigns** — press **Connect ad account** (Facebook popup, scopes `ads_read` + `ads_management`), pick the ad account, and the page lists real campaigns with spend/impressions/clicks and Pause/Resume buttons. Works immediately for your own ad account in development mode; strangers' accounts need App Review of those scopes (Meta reviews ads permissions more strictly than messaging ones).

## Going public (beyond your own test accounts)

For strangers' messages to flow in, the Meta app needs **App Review** (screencast how you use `pages_messaging`, `instagram_manage_messages`) and **Business Verification** (business document upload). Allow days to a few weeks. Nothing in F-ComFlow changes — it's purely Meta-side approval.

## After pulling this update

The database gained two things (channel connections + customer platform IDs), so run once:

```bash
cd server
npm run db:migrate
```
