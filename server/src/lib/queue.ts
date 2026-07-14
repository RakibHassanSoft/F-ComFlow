// Durable webhook ingestion queue (Redis) — the report's §4.2 / §7.1 pipeline.
//
// Env-gated: set REDIS_URL to turn it on. When ON, inbound Meta/WhatsApp
// webhooks are acknowledged with 200 instantly and their raw payloads are
// LPUSH'd onto a Redis list (a durable task queue). A background worker then
// BRPOPs and processes them, so a burst of flash-sale traffic can't overwhelm
// the request path, and a crash mid-processing never loses an event.
//
// No REDIS_URL -> the queue is disabled and webhooks are processed inline,
// exactly as before. Nothing else in the app changes.
import Redis from 'ioredis';

const QUEUE_KEY = 'fcomflow:webhooks';       // the durable task list
const DEAD_KEY = 'fcomflow:webhooks:dead';   // poison payloads land here

let producer: Redis | null = null;

export function isQueueEnabled(): boolean {
  return Boolean(process.env.REDIS_URL);
}

// One lazily-created connection for pushing (shared across requests).
function producerClient(): Redis {
  if (!producer) {
    producer = new Redis(process.env.REDIS_URL as string, { maxRetriesPerRequest: null });
    producer.on('error', (e: Error) => console.warn('[queue] redis error:', e.message));
  }
  return producer;
}

// Producer: push a raw webhook payload onto the durable queue. `source` lets a
// single worker route different webhook types (meta, whatsapp, …).
export async function enqueueWebhook(source: string, payload: unknown): Promise<void> {
  await producerClient().lpush(QUEUE_KEY, JSON.stringify({ source, payload, at: Date.now() }));
}

// Consumer: block-pop items forever and hand each to `handler`. Runs on its OWN
// Redis connection (BRPOP holds the socket). A failed payload is moved to a
// dead-letter list so one poison message never wedges the whole worker.
export async function startWebhookWorker(
  handler: (source: string, payload: unknown) => Promise<void>,
): Promise<void> {
  const consumer = new Redis(process.env.REDIS_URL as string, { maxRetriesPerRequest: null });
  consumer.on('error', (e: Error) => console.warn('[queue] worker redis error:', e.message));
  console.log('[queue] webhook worker started (Redis durable queue)');

  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      const popped = await consumer.brpop(QUEUE_KEY, 5); // [key, value] | null after 5s idle
      if (!popped) continue;
      const raw = popped[1];
      try {
        const { source, payload } = JSON.parse(raw);
        await handler(source, payload);
      } catch (err) {
        console.error('[queue] processing failed, dead-lettering:', (err as Error).message);
        await consumer.lpush(DEAD_KEY, raw);
      }
    } catch (err) {
      // Connection blip etc. — pause briefly so we don't hot-loop.
      console.warn('[queue] worker loop error, retrying:', (err as Error).message);
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
}
