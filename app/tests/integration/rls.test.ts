// Row-level security verified in a real Postgres engine (PGlite, WASM). Supabase's auth.uid() and roles are stubbed the way
// Supabase defines them (request.jwt.claim.sub). This verifies the policies and worker functions; it is NOT a hosted-project test.
import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';

const A = '00000000-0000-0000-0000-00000000000a'; const B = '00000000-0000-0000-0000-00000000000b'; const V = '00000000-0000-0000-0000-00000000000c';
let db: PGlite; let wsA = ''; let asg = ''; let stage = ''; let wsB = '';

async function as(user: string | null, role: 'authenticated' | 'anon' | 'service_role', fn: () => Promise<any>) {
  await db.exec(`select set_config('request.jwt.claim.sub', '${user ?? ''}', false); set role ${role};`);
  try { return await fn(); } finally { await db.exec('reset role;'); }
}
const q = (sql: string, p: any[] = []) => db.query<any>(sql, p);

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to anon, authenticated, service_role;`);
  await db.exec(fs.readFileSync('supabase/migrations/0001_init.sql', 'utf8'));
  await db.exec(fs.readFileSync('supabase/migrations/0002_storage.sql', 'utf8'));
  // user A builds a private paper
  await as(A, 'authenticated', async () => {
    wsA = (await q("insert into workspaces(name, owner_id) values ('A', $1) returning id", [A])).rows[0].id;
    await q("insert into memberships values ($1,$2,'owner')", [wsA, A]);
    const c = (await q("insert into courses(workspace_id,name) values ($1,'Course A') returning id", [wsA])).rows[0].id;
    asg = (await q("insert into assignments(workspace_id,course_id,title) values ($1,$2,'Essay') returning id", [wsA, c])).rows[0].id;
    const s = (await q("insert into sources(workspace_id,course_id,assignment_id,kind,title,ordinal) values ($1,$2,$3,'reading','Reading',1) returning id", [wsA, c, asg])).rows[0].id;
    const v = (await q("insert into source_versions(workspace_id,source_id,file_hash,parse_version,status) values ($1,$2,'h','p','ok') returning id", [wsA, s])).rows[0].id;
    await q('update sources set current_version_id=$1 where id=$2', [v, s]);
    await q("insert into passages(workspace_id,id,course_id,assignment_id,source_id,source_version_id,page_index,page_label,para_index,ord,text) values ($1,'src_1_p02',$2,$3,$4,$5,2,'14',1,1,'Students chose whether to attend class and frequent attendees averaged 84.')", [wsA, c, asg, s, v]);
    const d = (await q("insert into documents(workspace_id,assignment_id,title) values ($1,$2,'Draft') returning id", [wsA, asg])).rows[0].id;
    const r = (await q("insert into runs(workspace_id,document_id,assignment_id,mode,status,base_revision) values ($1,$2,$3,'quick','queued',gen_random_uuid()) returning id", [wsA, d, asg])).rows[0].id;
    stage = (await q("insert into run_stages(run_id,workspace_id,name,ord,status) values ($1,$2,'argument_edit',0,'ready') returning id", [r, wsA])).rows[0].id;
  });
  await as(B, 'authenticated', async () => {
    wsB = (await q("insert into workspaces(name, owner_id) values ('B', $1) returning id", [B])).rows[0].id;
    await q("insert into memberships values ($1,$2,'owner')", [wsB, B]);
  });
  await q("insert into memberships values ($1,$2,'viewer')", [wsA, V]); // granted by the owner (superuser here, as a stand-in for A's invite)
});

const TENANT = ['settings', 'courses', 'assignments', 'sources', 'source_versions', 'passages', 'documents', 'runs', 'run_stages'];

describe('row-level security (Postgres)', () => {
  it('owner sees their own rows', async () => {
    const n = await as(A, 'authenticated', async () => (await q('select count(*)::int n from passages')).rows[0].n);
    expect(n).toBe(1);
  });
  it('an unrelated authenticated user sees nothing in any tenant table and cannot write into the other workspace', async () => {
    await as(B, 'authenticated', async () => {
      for (const t of TENANT) expect((await q(`select count(*)::int n from ${t}`)).rows[0].n, t).toBe(0);
      await expect(q("insert into courses(workspace_id,name) values ($1,'intruder')", [wsA])).rejects.toThrow(/row-level security/);
      expect((await q("update courses set name='pwned' where workspace_id=$1", [wsA])).affectedRows).toBe(0);
      expect((await q('delete from passages where workspace_id=$1', [wsA])).affectedRows).toBe(0);
      await expect(q("insert into memberships values ($1,$2,'owner')", [wsA, B])).rejects.toThrow(/row-level security/); // cannot add self to A's workspace
      expect((await q('select count(*)::int n from workspaces where id=$1', [wsA])).rows[0].n).toBe(0);
    });
  });
  it('a read-only member can read but not insert, update or delete', async () => {
    await as(V, 'authenticated', async () => {
      expect((await q('select count(*)::int n from passages')).rows[0].n).toBe(1);
      await expect(q("insert into courses(workspace_id,name) values ($1,'x')", [wsA])).rejects.toThrow(/row-level security/);
      expect((await q("update courses set name='x' where workspace_id=$1", [wsA])).affectedRows).toBe(0);
      expect((await q('delete from courses where workspace_id=$1', [wsA])).affectedRows).toBe(0);
    });
  });
  it('anonymous callers get nothing', async () => {
    await as(null, 'anon', async () => { await expect(q('select * from passages')).rejects.toThrow(/permission denied/); });
  });
  it('passage search is scoped by the caller and by the authorised assignment: cross-tenant lookup returns nothing', async () => {
    const own = await as(A, 'authenticated', async () => (await q("select id, page_label from app.search_passages($1, 'attend')", [asg])).rows);
    expect(own).toEqual([{ id: 'src_1_p02', page_label: '14' }]);
    const other = await as(B, 'authenticated', async () => (await q("select id from app.search_passages($1, 'attend')", [asg])).rows);
    expect(other).toEqual([]);
  });
  it('the privileged worker: leases one stage, re-checks tenancy, a wrong workspace is refused, a duplicate commit adds no output', async () => {
    await as(A, 'authenticated', async () => { await expect(q('select app.lease_stage(60)')).rejects.toThrow(/permission denied/); });
    const leased = await as(null, 'service_role', async () => (await q('select * from app.lease_stage(60)')).rows[0]);
    expect(leased.id).toBe(stage); expect(leased.attempts).toBe(1);
    expect(await as(null, 'service_role', async () => (await q('select * from app.lease_stage(60)')).rows[0]?.id ?? null)).toBeNull(); // nothing else to lease
    await as(null, 'service_role', async () => { await expect(q("select app.commit_stage($1,$2,$3,'{}')", [stage, leased.lease_token, wsB])).rejects.toThrow(/tenant ownership/); });
    const ok = await as(null, 'service_role', async () => (await q("select app.commit_stage($1,$2,$3,'{\"x\":1}') ok", [stage, leased.lease_token, wsA])).rows[0].ok);
    expect(ok).toBe(true);
    const dup = await as(null, 'service_role', async () => (await q("select app.commit_stage($1,$2,$3,'{\"x\":2}') ok", [stage, leased.lease_token, wsA])).rows[0].ok);
    expect(dup).toBe(false);
    expect((await q('select count(*)::int n from stage_outputs')).rows[0].n).toBe(1);
  });
  it('an abandoned lease becomes leasable again after expiry', async () => {
    const id = (await q("insert into run_stages(run_id,workspace_id,name,ord,status,lease_token,lease_expires_at) select run_id, workspace_id, 'verify', 5, 'leased', gen_random_uuid(), now() - interval '1 minute' from run_stages limit 1 returning id")).rows[0].id;
    const again = await as(null, 'service_role', async () => (await q('select * from app.lease_stage(60)')).rows[0]);
    expect(again.id).toBe(id); expect(again.attempts).toBe(1);
  });
});
