// Cloudinary signed uploads — the server hands out a short-lived signature and
// the browser uploads directly (secret stays server-side). Set CLOUDINARY_URL.
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
