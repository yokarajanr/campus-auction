const TOKEN_KEY = 'campus-auction-token';

let token: string | null = localStorage.getItem(TOKEN_KEY);
let clockOffsetMs = 0;

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function getToken() {
  return token;
}

export function setToken(value: string | null) {
  token = value;
  if (value) localStorage.setItem(TOKEN_KEY, value);
  else localStorage.removeItem(TOKEN_KEY);
}

// The server clock decides when auctions close, so countdowns use it instead of the laptop clock.
export function serverNow() {
  return Date.now() + clockOffsetMs;
}

interface RequestOptions {
  method?: string;
  json?: unknown;
  form?: FormData;
}

export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;

  let body: BodyInit | undefined;
  if (options.json !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(options.json);
  } else if (options.form) {
    body = options.form;
  }

  let res: Response;
  try {
    res = await fetch(`/api${path}`, { method: options.method ?? 'GET', headers, body });
  } catch {
    throw new ApiError(0, 'Cannot reach the server. Is it running?');
  }

  const data = await res.json().catch(() => null);
  if (data && typeof data.serverNow === 'number') clockOffsetMs = data.serverNow - Date.now();
  if (!res.ok) throw new ApiError(res.status, data?.error ?? `Request failed (${res.status})`);
  return data as T;
}
