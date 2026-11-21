const KEY = 'studio.token';
let token: string | null = null;
try {
  token = localStorage.getItem(KEY);
} catch {
  /* storage blocked: session lives for this tab only */
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public data?: any,
  ) {
    super(message);
  }
}

export async function ensureSession(force = false): Promise<void> {
  if (token && !force) return;
  const r = await fetch('/api/session', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ local: true, name: 'Me' }),
  });
  const d = await r.json();
  token = d.token;
  try {
    localStorage.setItem(KEY, token!);
  } catch {
    /* ignore */
  }
}

async function raw(method: string, url: string, body?: unknown, form?: FormData, retried = false): Promise<Response> {
  await ensureSession();
  const headers: Record<string, string> = { authorization: `Bearer ${token}` };
  let init: RequestInit = { method, headers };
  if (form) init.body = form;
  else if (body !== undefined) {
    headers['content-type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  const res = await fetch('/api' + url, init);
  if (res.status === 401 && !retried) {
    await ensureSession(true);
    return raw(method, url, body, form, true);
  }
  return res;
}

export async function api<T = any>(method: string, url: string, body?: unknown, form?: FormData): Promise<T> {
  const res = await raw(method, url, body, form);
  const data = await res.json().catch(() => ({}));
  if (!res.ok && !(res.status === 409 && data?.status === 'conflict'))
    throw new ApiError(res.status, data?.error?.code ?? 'error', data?.error?.message ?? `Request failed (${res.status})`, data);
  return data as T;
}
export const get = <T = any>(u: string) => api<T>('GET', u);
export const post = <T = any>(u: string, b: unknown = {}) => api<T>('POST', u, b);
export const put = <T = any>(u: string, b: unknown = {}) => api<T>('PUT', u, b);
export const del = <T = any>(u: string) => api<T>('DELETE', u);
export const upload = <T = any>(u: string, f: FormData) => api<T>('POST', u, undefined, f);

export async function download(url: string, body: unknown, fallbackName: string) {
  const res = await raw('POST', url, body);
  if (!res.ok) {
    const d = await res.json().catch(() => ({}));
    throw new ApiError(res.status, d?.error?.code ?? 'error', d?.error?.message ?? 'Export failed');
  }
  const blob = await res.blob();
  const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? fallbackName;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  return {
    hash: res.headers.get('x-text-hash'),
    revisionId: res.headers.get('x-revision-id'),
    name,
  };
}

export const newKey = (p: string) => `${p}-${crypto.randomUUID()}`;
