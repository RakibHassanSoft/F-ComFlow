// One tiny API helper used by every page.
// - The API's address comes from NEXT_PUBLIC_API_URL (see client/.env.example)
// - Sends cookies with every request (that's where the JWT lives)
// - If the access token expired (401), it silently refreshes and retries once
export const API_ORIGIN = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';
const BASE = `${API_ORIGIN}/api`;

async function request(path: string, options: RequestInit = {}, retried = false): Promise<any> {
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    credentials: 'include', // send the httpOnly auth cookies
    headers: { 'Content-Type': 'application/json', ...options.headers },
  });

  // Access token expired? Refresh once, then retry the original request.
  if (res.status === 401 && !retried && path !== '/auth/refresh' && path !== '/auth/login') {
    const refresh = await fetch(`${BASE}/auth/refresh`, { method: 'POST', credentials: 'include' });
    if (refresh.ok) return request(path, options, true);
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

export const api = {
  get: (path: string) => request(path),
  post: (path: string, body?: unknown) =>
    request(path, { method: 'POST', body: body ? JSON.stringify(body) : undefined }),
  patch: (path: string, body?: unknown) =>
    request(path, { method: 'PATCH', body: JSON.stringify(body) }),
  delete: (path: string) => request(path, { method: 'DELETE' }),
};

export const API_BASE = BASE;
