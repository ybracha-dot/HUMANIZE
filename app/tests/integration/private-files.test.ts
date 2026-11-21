// Private original files and source retrieval with two real test identities (plus a read-only member) against the running API code path.
// Active runtime: SQLite + local disk files. This is the local-first persistence/tenancy path, not the hosted Supabase one.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it, afterEach } from 'vitest';
import { clock, DATA_DIR } from '../../server/db.ts';
import { addMember } from '../../server/store.ts';
import { makePdf } from '../../server/pdfgen.ts';
import { client, freshDb, newUser } from './helpers.ts';

const sha = (b: Buffer | Uint8Array) => crypto.createHash('sha256').update(b).digest('hex');
const realNow = clock.now;
afterEach(() => {
  clock.now = realNow;
});

async function upload(u: Awaited<ReturnType<typeof newUser>>, course: string, bytes: Uint8Array, name: string) {
  const f = new FormData();
  f.append('kind', 'reading');
  f.append('file', new File([new Uint8Array(bytes)], name, { type: 'application/pdf' }));
  const r = await u.api.upload(`courses/${course}/sources`, f);
  return r.data.results[0] as { sourceId: string; status: string };
}

describe('private files: upload / read / link / expiry / delete, two identities', () => {
  const { db } = freshDb('files');
  it('owner reads the exact original; another workspace is denied everywhere; links expire; delete removes bytes and derived data', async () => {
    const a = await newUser(db, 'A');
    const b = await newUser(db, 'B');
    const viewer = await newUser(db, 'V');
    addMember(db, a.workspaceId, viewer.userId, 'viewer');
    const vc = client(db, viewer.token, a.workspaceId);

    const courseA = (await a.api.post('courses', { name: 'A course' })).data.id;
    const courseB = (await b.api.post('courses', { name: 'B course' })).data.id;
    const asgA = (await a.api.post(`courses/${courseA}/assignments`, { title: 'A essay' })).data.id;
    const pdf = await makePdf([{ lines: ['Frequent attendees averaged 84 on the final exam. Students chose whether to attend.'] }]);
    const up = await upload(a, courseA, pdf, 'reading.pdf');
    expect(up.status).toBe('ok');

    // 1. owner reads the exact bytes, with a content hash
    const read = await a.api.get(`sources/${up.sourceId}/file`);
    expect(read.status).toBe(200);
    expect(sha(read.data)).toBe(sha(pdf));
    expect(read.headers.get('x-file-hash')).toBe(sha(pdf));
    expect(read.headers.get('cache-control')).toMatch(/no-store/);

    // 2. retrieval works for the owner and is invisible to the second workspace
    const own = await a.api.get(`assignments/${asgA}/search?q=attend`);
    expect(own.data.length).toBeGreaterThan(0);
    const passageId = own.data[0].id;
    for (const url of [`sources/${up.sourceId}/file`, `sources/${up.sourceId}`, `passages/${passageId}`, `assignments/${asgA}/search?q=attend`]) {
      expect((await b.api.get(url)).status, url).toBe(404);
    }
    expect((await b.api.post(`sources/${up.sourceId}/file-link`, {})).status).toBe(404); // cannot mint a link to someone else's file
    expect((await b.api.del(`sources/${up.sourceId}`)).status).toBe(404); // cannot delete it either
    expect((await client(db).get(`sources/${up.sourceId}/file`)).status).toBe(401);

    // 3. the same bytes uploaded by B are a separate copy in B's workspace
    const upB = await upload(b, courseB, pdf, 'same.pdf');
    expect(fs.existsSync(path.join(DATA_DIR, 'files', `${a.workspaceId}_${sha(pdf)}`))).toBe(true);
    expect(fs.existsSync(path.join(DATA_DIR, 'files', `${b.workspaceId}_${sha(pdf)}`))).toBe(true);

    // 4. read-only member may read and mint a short link, but cannot delete
    expect((await vc.get(`sources/${up.sourceId}/file`)).status).toBe(200);
    expect((await vc.del(`sources/${up.sourceId}`)).status).toBe(403);

    // 5. signed link: works without a session, for exactly that file; tampering and expiry are refused
    const link = (await a.api.post(`sources/${up.sourceId}/file-link`, { ttlSeconds: 60 })).data;
    expect(link.ttlSeconds).toBe(60);
    const anon = client(db);
    const got = await anon.get(link.url.replace(/^\/api/, ''));
    expect(got.status).toBe(200);
    expect(sha(got.data)).toBe(sha(pdf));
    const [payload, sig] = link.url.split('/').pop().split('.');
    expect((await anon.get(`files/${payload}.${sig.slice(0, -2)}xx`)).status).toBe(403);
    const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(payload, 'base64url').toString()), w: b.workspaceId })).toString('base64url');
    expect((await anon.get(`files/${forged}.${sig}`)).status).toBe(403); // a link cannot be re-pointed at another workspace
    expect((await anon.get('files/garbage')).status).toBe(403);
    clock.now = () => realNow() + 61_000;
    const expired = await anon.get(link.url.replace(/^\/api/, ''));
    expect(expired.status).toBe(410);
    expect(expired.data.error.code).toBe('expired');
    clock.now = realNow;
    expect((await anon.get(link.url.replace(/^\/api/, ''))).status).toBe(200); // still valid before expiry on the real clock

    // 6. delete: bytes, passages and links are gone; B's identical copy is untouched
    const del = await a.api.del(`sources/${up.sourceId}`);
    expect(del.status).toBe(200);
    expect(del.data.filesRemoved).toBe(1);
    expect(del.data.passagesRemoved).toBeGreaterThan(0);
    expect(fs.existsSync(path.join(DATA_DIR, 'files', `${a.workspaceId}_${sha(pdf)}`))).toBe(false);
    expect((await a.api.get(`sources/${up.sourceId}/file`)).status).toBe(404);
    expect((await anon.get(link.url.replace(/^\/api/, ''))).status).toBe(404);
    expect((await a.api.get(`assignments/${asgA}/search?q=attend`)).data).toEqual([]);
    expect((await a.api.get(`passages/${passageId}`)).status).toBe(404);
    expect((await b.api.get(`sources/${upB.sourceId}/file`)).status).toBe(200);
    expect(sha((await b.api.get(`sources/${upB.sourceId}/file`)).data)).toBe(sha(pdf));
  });
});
