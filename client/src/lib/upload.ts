// Direct-to-Cloudinary image upload.
//
// The server hands out a short-lived signature (GET /api/uploads/signature);
// the browser then POSTs the file STRAIGHT to Cloudinary. The image bytes never
// touch our own backend, and the Cloudinary secret never touches the browser.
import { api } from './api';

interface Signature {
  cloudName: string;
  apiKey: string;
  timestamp: number;
  folder: string;
  signature: string;
}

// Upload one image and return its permanent Cloudinary URL.
export async function uploadImage(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error('Please choose an image file');
  if (file.size > 8 * 1024 * 1024) throw new Error('Image must be under 8 MB');

  // api.get throws a friendly error if uploads aren't configured (HTTP 422).
  const sig: Signature = await api.get('/uploads/signature');

  const form = new FormData();
  form.append('file', file);
  form.append('api_key', sig.apiKey);
  form.append('timestamp', String(sig.timestamp));
  form.append('folder', sig.folder);
  form.append('signature', sig.signature);

  const res = await fetch(`https://api.cloudinary.com/v1_1/${sig.cloudName}/image/upload`, {
    method: 'POST',
    body: form, // NOTE: no Content-Type header — the browser sets the multipart boundary
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.secure_url) {
    throw new Error(data?.error?.message || 'Upload failed — please try again');
  }
  return data.secure_url as string;
}
