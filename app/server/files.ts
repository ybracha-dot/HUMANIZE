// Private original files: authorized read, expiring signed links, and deletion. Files live on local disk at
// <DATA_DIR>/files/<workspace>_<sha256>. They are never served from a public path; every read is either an authenticated, tenant-checked
// request or a link signed with a server-side secret that names the workspace, file and expiry.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR, all, clock, one, own, run, tx } from './db.ts';
import { HttpError, requireWrite, type Ctx } from './store.ts';

const dir = () => path.join(DATA_DIR, 'files');
const fileFor = (ws: string, hash: string) => path.join(dir(), `${ws}_${hash}`);

function secret(): Buffer {
  if (process.env.STUDIO_LINK_SECRET) return Buffer.from(process.env.STUDIO_LINK_SECRET);
  const f = path.join(DATA_DIR, 'link-secret');
  if (!fs.existsSync(f)) {
    fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
    fs.writeFileSync(f, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
  }
  return Buffer.from(fs.readFileSync(f, 'utf8').trim());
}
const sign = (payload: string) => crypto.createHmac('sha256', secret()).update(payload).digest('base64url');

export interface SourceFile {
  bytes: Buffer;
  filename: string;
  mime: string;
  hash: string;
}

export function readSourceFile(c: Ctx, sourceId: string, versionId?: string): SourceFile {
  const s = own(c.db, 'sources', sourceId, c.ws);
  if (!s) throw new HttpError(404, 'not_found', 'source not found');
  const v = one(c.db, 'SELECT * FROM source_versions WHERE id=? AND workspace_id=? AND source_id=?', versionId ?? s.current_version_id, c.ws, sourceId);
  if (!v) throw new HttpError(404, 'not_found', 'source version not found');
  const f = fileFor(c.ws, v.file_hash);
  if (!fs.existsSync(f)) throw new HttpError(404, 'file_gone', 'The original file is no longer stored.');
  return { bytes: fs.readFileSync(f), filename: v.filename ?? `${s.title}`, mime: v.mime ?? 'application/octet-stream', hash: v.file_hash };
}

/** A link is a bearer credential for ONE file until it expires. Anyone holding it can read that file; nothing else. */
export function mintFileLink(c: Ctx, sourceId: string, ttlSeconds = 300, versionId?: string) {
  const ttl = Math.max(10, Math.min(3600, Math.floor(ttlSeconds)));
  const f = readSourceFile(c, sourceId, versionId); // also proves the caller may read it
  const exp = clock.now() + ttl * 1000;
  const payload = Buffer.from(JSON.stringify({ w: c.ws, s: sourceId, v: versionId ?? null, h: f.hash, e: exp })).toString('base64url');
  return { token: `${payload}.${sign(payload)}`, expiresAt: exp, ttlSeconds: ttl };
}

export type LinkResult = { ok: true; file: SourceFile } | { ok: false; status: 403 | 404 | 410; reason: 'bad_signature' | 'expired' | 'gone' };

export function openFileLink(db: Ctx['db'], token: string): LinkResult {
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return { ok: false, status: 403, reason: 'bad_signature' };
  const expected = sign(payload);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return { ok: false, status: 403, reason: 'bad_signature' };
  let p: { w: string; s: string; v: string | null; h: string; e: number };
  try {
    p = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return { ok: false, status: 403, reason: 'bad_signature' };
  }
  if (clock.now() > p.e) return { ok: false, status: 410, reason: 'expired' };
  // still-existing, still in the workspace the link names
  const s = own(db, 'sources', p.s, p.w);
  const v = s && one(db, 'SELECT * FROM source_versions WHERE workspace_id=? AND source_id=? AND file_hash=?', p.w, p.s, p.h);
  const f = fileFor(p.w, p.h);
  if (!s || !v || !fs.existsSync(f)) return { ok: false, status: 404, reason: 'gone' };
  return { ok: true, file: { bytes: fs.readFileSync(f), filename: v.filename ?? s.title, mime: v.mime ?? 'application/octet-stream', hash: p.h } };
}

/** Delete a source with every version, its derived passages, evidence audits and brief items, then remove files no other version needs. */
export function deleteSource(c: Ctx, sourceId: string) {
  requireWrite(c);
  const s = own(c.db, 'sources', sourceId, c.ws);
  if (!s) throw new HttpError(404, 'not_found', 'source not found');
  const hashes = all(c.db, 'SELECT DISTINCT file_hash h FROM source_versions WHERE workspace_id=? AND source_id=?', c.ws, sourceId).map((r) => r.h as string);
  const removed = tx(c.db, () => {
    const passageIds = all(c.db, 'SELECT id FROM passages WHERE workspace_id=? AND source_id=?', c.ws, sourceId).map((r) => r.id as string);
    for (const id of passageIds) run(c.db, 'DELETE FROM claim_audits WHERE workspace_id=? AND passage_id=?', c.ws, id);
    run(c.db, 'DELETE FROM passages WHERE workspace_id=? AND source_id=?', c.ws, sourceId);
    run(c.db, 'DELETE FROM brief_items WHERE workspace_id=? AND source_id=?', c.ws, sourceId);
    run(c.db, 'DELETE FROM source_versions WHERE workspace_id=? AND source_id=?', c.ws, sourceId);
    run(c.db, 'DELETE FROM sources WHERE id=? AND workspace_id=?', sourceId, c.ws);
    return passageIds.length;
  });
  let filesRemoved = 0;
  for (const h of hashes) {
    const stillUsed = one(c.db, 'SELECT 1 x FROM source_versions WHERE workspace_id=? AND file_hash=?', c.ws, h);
    if (!stillUsed && fs.existsSync(fileFor(c.ws, h))) {
      fs.rmSync(fileFor(c.ws, h));
      filesRemoved++;
    }
  }
  return { passagesRemoved: removed, filesRemoved };
}
