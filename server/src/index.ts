// F-ComFlow API server — entry point.
// Express app + Socket.io on the same HTTP server.
import express from 'express';
import http from 'http';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { config } from './config';
import { initSocket } from './lib/socket';
import { ApiError } from './lib/errors';
import { startTrackingPoller } from './services/tracker';
import { isQueueEnabled, startWebhookWorker } from './lib/queue';
import { normalizeWebhook, ingestInbound } from './services/channels';

import authRoutes from './routes/auth.routes';
import inboxRoutes from './routes/inbox.routes';
import aiRoutes from './routes/ai.routes';
import productRoutes from './routes/product.routes';
import orderRoutes from './routes/order.routes';
import courierRoutes from './routes/courier.routes';
import paymentRoutes from './routes/payment.routes';
import statsRoutes from './routes/stats.routes';
import webhookRoutes from './routes/webhook.routes'; // external store sync
import metaRoutes from './routes/meta.routes';       // REAL Meta/WhatsApp webhooks
import channelRoutes from './routes/channel.routes'; // Channel connections (Settings)
import telegramRoutes from './routes/telegram.routes'; // Telegram bot webhook
import viberRoutes from './routes/viber.routes';       // Viber bot webhook
import livechatRoutes from './routes/livechat.routes'; // Website chat widget
import emailRoutes from './routes/email.routes';       // Email inbound webhook
import adsRoutes from './routes/ads.routes';           // Ads attribution + Marketing API
import templateRoutes from './routes/templates.routes'; // Quick-reply templates
import payRoutes from './routes/pay.routes';           // PUBLIC customer pay link
import customerRoutes from './routes/customer.routes'; // Customer directory
import { storeRouter, shopRouter } from './routes/store.routes'; // Public storefront (fcom.com/<slug>)
import uploadRoutes from './routes/upload.routes';     // Cloudinary signed image uploads

const app = express();
const server = http.createServer(app);
initSocket(server);

app.set('trust proxy', 1); // correct client IPs behind a reverse proxy (deployment)
app.use(cors({ origin: config.clientUrl, credentials: true }));
// Keep the RAW request bytes — Meta's webhook signature (HMAC-SHA256) must be
// computed over the exact raw body, not the re-serialized JSON.
app.use(express.json({
  verify: (req: any, _res, buf) => { req.rawBody = buf; },
}));
// SSLCOMMERZ (and some courier webhooks) post form-encoded bodies
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());

// health check
app.get('/api/health', (_req, res) => res.json({ status: 'ok', service: 'fcomflow-api' }));

app.use('/api/auth', authRoutes);
app.use('/api/inbox', inboxRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/products', productRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/couriers', courierRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/stats', statsRoutes);
app.use('/api/webhooks', webhookRoutes);
app.use('/api/meta', metaRoutes);       // public: Meta calls this
app.use('/api/channels', channelRoutes); // authed: merchant connects channels
app.use('/api/telegram', telegramRoutes); // public: Telegram calls this
app.use('/api/viber', viberRoutes);       // public: Viber calls this
app.use('/api/livechat', livechatRoutes); // public: the website widget calls this
app.use('/api/email', emailRoutes);       // public: mail provider calls this
app.use('/api/ads', adsRoutes);           // authed: ads attribution + campaigns
app.use('/api/templates', templateRoutes); // authed: quick-reply templates
app.use('/api/pay', payRoutes);            // public: customer advance-payment link
app.use('/api/customers', customerRoutes); // authed: customer directory
app.use('/api/uploads', uploadRoutes);     // authed: Cloudinary upload signatures
app.use('/api/store', storeRouter);        // authed: merchant manages their storefront
app.use('/api/shop', shopRouter);          // public: customers browse + order + fee callbacks

// Global error handler: ApiError -> its status code; anything else -> 500.
// Never leaks stack traces to the client.
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (err instanceof ApiError) {
    return res.status(err.status).json({ error: err.message });
  }
  console.error('[error]', err);
  res.status(500).json({ error: 'Something went wrong' });
});

server.listen(config.port, () => {
  console.log(`✅ F-ComFlow API running on http://localhost:${config.port}`);
  startTrackingPoller(); // auto-pulls live courier statuses in the background

  // Durable webhook worker: only runs when REDIS_URL is configured. It drains
  // the queue that the Meta webhook fills, decoupling ingestion from processing.
  if (isQueueEnabled()) {
    startWebhookWorker(async (source, payload) => {
      if (source === 'meta') {
        const messages = normalizeWebhook(payload);
        for (const m of messages) await ingestInbound(m);
      }
    }).catch((e) => console.error('[queue] worker crashed:', e.message));
  }
});
