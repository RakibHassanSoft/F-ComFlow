// Cloudinary signed uploads for product photos.
//
// The browser uploads images DIRECTLY to Cloudinary; our server only hands out
// a short-lived signature. That means the API secret never leaves the backend
// and large image files never pass through this Node process.
//
// Config comes from ONE env var (exactly what the Cloudinary dashboard gives
// you — Settings ▸ API keys ▸ "API environment variable"):
//
//   CLOUDINARY_URL=cloudinary://<api_key>:<api_secret>@<cloud_name>
//
// Env-gated like every other integration: no CLOUDINARY_URL -> uploads are
// disabled and the UI falls back to pasting an image URL by hand.
import crypto from 'crypto';

interface CloudinaryConfig { cloudName: string; apiKey: string; apiSecret: string; }

function parseConfig(): CloudinaryConfig | null {
  const raw = process.env.CLOUDINARY_URL;
  if (!raw) return null;
  try {
    // cloudinary://<key>:<secret>@<cloud_name>
    const u = new URL(raw);
    const cloudName = u.hostname;
    const apiKey = decodeURIComponent(u.username);
    const apiSecret = decodeURIComponent(u.password);
    if (!cloudName || !apiKey || !apiSecret) return null;
    return { cloudName, apiKey, apiSecret };
  } catch {
    return null;
  }
}

export function isCloudinaryEnabled(): boolean {
  return parseConfig() !== null;
}

export const UPLOAD_FOLDER = 'fcomflow/products';

// Cloudinary's signature = SHA1 of the params that will be sent with the upload
// (everything EXCEPT file, api_key, resource_type and cloud_name), sorted
// alphabetically, joined as key=value&key=value, with the api_secret appended.
// The browser must post back EXACTLY these same params or Cloudinary rejects it.
export function signUpload(folder = UPLOAD_FOLDER): {
  cloudName: string; apiKey: string; timestamp: number; folder: string; signature: string;
} {
  const cfg = parseConfig();
  if (!cfg) throw new Error('Cloudinary is not configured');
  const timestamp = Math.floor(Date.now() / 1000);
  const toSign = `folder=${folder}&timestamp=${timestamp}`;
  const signature = crypto.createHash('sha1').update(toSign + cfg.apiSecret).digest('hex');
  return { cloudName: cfg.cloudName, apiKey: cfg.apiKey, timestamp, folder, signature };
}
