import fs from 'node:fs';
import path from 'node:path';
import { openDb, type DB } from '../../server/db.ts';
import { buildApi } from '../../server/api.ts';
import { runWorker } from '../../server/worker.ts';

export function freshDb(name = 'db'): { db: DB; file: string } {
  const dir = path.resolve('.data-test', name + '-' + Math.random().toString(36).slice(2, 8));
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'studio.db');
  return { db: openDb(file), file };
}

export function client(db: DB, token?: string, ws?: string) {
  const api = buildApi(db);
  const call = async (method: string, url: string, body?: unknown, form?: FormData) => {
    const headers: Record<string, string> = {};
    if (token) headers.authorization = `Bearer ${token}`;
    if (ws) headers['x-workspace'] = ws;
    let init: RequestInit = { method, headers };
    if (form) init.body = form;
    else if (body !== undefined) {
      headers['content-type'] = 'application/json';
      init.body = JSON.stringify(body);
    }
    const res = await api.request('/' + url.replace(/^\//, ''), init);
    const ct = res.headers.get('content-type') ?? '';
    const data = ct.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer());
    return { status: res.status, data: data as any, headers: res.headers };
  };
  return {
    get: (u: string) => call('GET', u),
    post: (u: string, b?: unknown) => call('POST', u, b ?? {}),
    put: (u: string, b?: unknown) => call('PUT', u, b ?? {}),
    del: (u: string) => call('DELETE', u),
    upload: (u: string, form: FormData) => call('POST', u, undefined, form),
  };
}

export async function newUser(db: DB, name = 'Writer') {
  const anon = client(db);
  const r = await anon.post('session', { name });
  return { ...r.data, api: client(db, r.data.token) } as {
    token: string;
    userId: string;
    workspaceId: string;
    api: ReturnType<typeof client>;
  };
}

/** Drain the queue in-process (same code the separate worker process runs). */
export async function drain(db: DB, leaseMs = 5000) {
  await runWorker(db, { once: true, leaseMs, pollMs: 5 });
}

export async function waitRun(api: ReturnType<typeof client>, db: DB, runId: string) {
  for (let i = 0; i < 40; i++) {
    await drain(db);
    const r = await api.get(`runs/${runId}`);
    if (['done', 'failed', 'canceled', 'blocked'].includes(r.data.status)) return r.data;
  }
  throw new Error('run did not finish');
}
