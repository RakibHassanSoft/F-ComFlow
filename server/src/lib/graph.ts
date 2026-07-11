// One shared Meta Graph API client for the whole server.
// Before this, the base URL + fetch/parse/error-map boilerplate was copied in
// ads.routes.ts, channel.routes.ts and channels.ts. Keep it in one place so the
// API version and error handling only ever change here.
import { ApiError } from './errors';

export const GRAPH_VERSION = 'v21.0';
export const GRAPH = `https://graph.facebook.com/${GRAPH_VERSION}`;

export interface GraphOptions {
  token?: string; // appended as ?access_token=… when given (query-string auth)
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
}

// Call the Graph API and return parsed JSON. Throws ApiError(422) on any
// non-2xx response, surfacing Meta's own error message when present.
export async function graph(path: string, opts: GraphOptions = {}): Promise<any> {
  const { token, method, headers, body, timeoutMs = 10_000 } = opts;
  let url = `${GRAPH}/${path}`;
  if (token) url += (path.includes('?') ? '&' : '?') + `access_token=${encodeURIComponent(token)}`;

  const res = await fetch(url, { method, headers, body, signal: AbortSignal.timeout(timeoutMs) });
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(422, data?.error?.message || `Graph API error ${res.status}`);
  return data;
}
