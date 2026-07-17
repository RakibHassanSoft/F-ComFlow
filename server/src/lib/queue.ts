// Optional durable webhook queue (Redis). Set REDIS_URL to buffer inbound
// webhooks on a Redis list and drain them in a background worker; blank =
// process inline. Nothing else changes.
// ioredis is loaded LAZILY (require inside the functions) so the server runs
// WITHOUT the package installed when the queue is off (REDIS_URL blank).
// Install it only when you actually enable the queue:  npm install ioredis
function loadRedis(): any {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require('ioredis');
}

const QUEUE_KEY = 'fcomflow:webhooks';       // the durable task list
const DEAD_KEY = 'fcomflow:webhooks:dead';   // poison payloads land here

let producer: any = null;

export function isQueueEnabled(): boolean {
  return Boolean(process.env.REDIS_URL);
}

// One lazily-created connection for pushing (shared across requests).
function producerClient(): any {
  if (!producer) {
    const Redis = loadRedis();
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
  const Redis = loadRedis();
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
