// SQLite (node:sqlite) data layer for the personal edition. The hosted edition's Postgres/Supabase schema
// with row-level security lives in supabase/migrations and mirrors these tables.
import { createRequire } from 'node:module';
import type { DatabaseSync as DatabaseSyncType } from 'node:sqlite';
// node:sqlite is loaded through require so bundlers (vitest/vite) treat it as a builtin
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as {
  DatabaseSync: typeof DatabaseSyncType;
};
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const DATA_DIR = process.env.STUDIO_DATA_DIR ?? path.resolve(process.cwd(), '.data');

export const clock = { now: () => Date.now() };

export function uid(prefix: string): string {
  return `${prefix}_${crypto.randomBytes(6).toString('base64url').replace(/[-_]/g, 'x').toLowerCase()}`;
}
export const sha256 = (s: string | Buffer) => crypto.createHash('sha256').update(s).digest('hex');

export const SCHEMA_VERSION = 1;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, name TEXT, token_hash TEXT UNIQUE NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS workspaces (id TEXT PRIMARY KEY, name TEXT NOT NULL, owner_id TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS memberships (workspace_id TEXT NOT NULL, user_id TEXT NOT NULL, role TEXT NOT NULL CHECK (role IN ('owner','editor','viewer')), PRIMARY KEY (workspace_id, user_id));
CREATE TABLE IF NOT EXISTS seq (workspace_id TEXT NOT NULL, name TEXT NOT NULL, n INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (workspace_id, name));
CREATE TABLE IF NOT EXISTS settings (workspace_id TEXT PRIMARY KEY, voice_profile TEXT, mode TEXT NOT NULL DEFAULT 'demo', prices TEXT, monthly_limit_usd REAL, default_budget_usd REAL, updated_at INTEGER);
CREATE TABLE IF NOT EXISTS courses (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, name TEXT NOT NULL, instructor TEXT, term TEXT, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS assignments (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, course_id TEXT NOT NULL, title TEXT NOT NULL, genre TEXT NOT NULL DEFAULT 'academic_argument', language TEXT NOT NULL DEFAULT 'en', budget_usd REAL, state TEXT NOT NULL DEFAULT '{}', created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS sources (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, course_id TEXT NOT NULL, assignment_id TEXT, kind TEXT NOT NULL, title TEXT NOT NULL, doc_date TEXT, ordinal INTEGER NOT NULL, current_version_id TEXT, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS source_versions (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, source_id TEXT NOT NULL, file_hash TEXT NOT NULL, parse_version TEXT NOT NULL, filename TEXT, mime TEXT, size INTEGER, status TEXT NOT NULL, error TEXT, page_count INTEGER, created_at INTEGER NOT NULL, superseded_at INTEGER);
CREATE TABLE IF NOT EXISTS passages (workspace_id TEXT NOT NULL, id TEXT NOT NULL, course_id TEXT NOT NULL, assignment_id TEXT, source_id TEXT NOT NULL, source_version_id TEXT NOT NULL, page_index INTEGER NOT NULL, page_label TEXT, section TEXT, para_index INTEGER NOT NULL, ord INTEGER NOT NULL, text TEXT NOT NULL, page_offset INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (workspace_id, id));
CREATE TABLE IF NOT EXISTS brief_items (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, assignment_id TEXT NOT NULL, kind TEXT NOT NULL, key TEXT NOT NULL, label TEXT, value TEXT, data TEXT, source_id TEXT, source_title TEXT, passage_id TEXT, quote TEXT, start INTEGER, end INTEGER, status TEXT NOT NULL DEFAULT 'extracted', created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS brief_corrections (workspace_id TEXT NOT NULL, assignment_id TEXT NOT NULL, kind TEXT NOT NULL, key TEXT NOT NULL, value TEXT, data TEXT, status TEXT NOT NULL, PRIMARY KEY (assignment_id, kind, key));
CREATE TABLE IF NOT EXISTS brief_resolutions (workspace_id TEXT NOT NULL, assignment_id TEXT NOT NULL, kind TEXT NOT NULL, chosen_source_id TEXT, note TEXT, PRIMARY KEY (assignment_id, kind));
CREATE TABLE IF NOT EXISTS feedback_rules (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, course_id TEXT NOT NULL, instructor TEXT, assignment_id TEXT, comment TEXT NOT NULL, linked_paragraph TEXT, explanation TEXT, scope TEXT NOT NULL DEFAULT 'one_off', confirmed INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS voice_samples (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, user_id TEXT, text TEXT NOT NULL, genre TEXT, language TEXT, audience TEXT, register TEXT, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS documents (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, assignment_id TEXT NOT NULL, title TEXT NOT NULL, active_branch_id TEXT, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS branches (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, document_id TEXT NOT NULL, name TEXT NOT NULL, head_revision_id TEXT, parent_branch_id TEXT, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS revisions (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, document_id TEXT NOT NULL, branch_id TEXT NOT NULL, parent_id TEXT, paragraphs TEXT NOT NULL, text_hash TEXT NOT NULL, cause TEXT NOT NULL, label TEXT, meta TEXT, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS locks (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, document_id TEXT NOT NULL, paragraph_id TEXT NOT NULL, kind TEXT NOT NULL, text TEXT NOT NULL, start INTEGER NOT NULL, end INTEGER NOT NULL, note TEXT, thesis INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, released_at INTEGER);
CREATE TABLE IF NOT EXISTS lock_notes (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, lock_id TEXT NOT NULL, note TEXT NOT NULL, source TEXT, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS proposals (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, document_id TEXT NOT NULL, run_id TEXT, base_revision TEXT NOT NULL, paragraph_id TEXT NOT NULL, original TEXT NOT NULL, replacement TEXT NOT NULL, issue TEXT NOT NULL, reason TEXT, criterion_id TEXT, evidence TEXT NOT NULL DEFAULT '[]', meaning_change TEXT, requires_decision INTEGER NOT NULL DEFAULT 0, start INTEGER NOT NULL, verifier TEXT NOT NULL, findings TEXT NOT NULL DEFAULT '[]', provider TEXT NOT NULL, policy_version TEXT, context_before TEXT, context_after TEXT, decision TEXT NOT NULL DEFAULT 'pending', rank INTEGER, disagreement TEXT, critic TEXT, created_at INTEGER NOT NULL, resolved_at INTEGER);
CREATE TABLE IF NOT EXISTS decisions (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, proposal_id TEXT, document_id TEXT NOT NULL, action TEXT NOT NULL, revision_id TEXT, idempotency_key TEXT NOT NULL, user_id TEXT, note TEXT, final_text TEXT, created_at INTEGER NOT NULL, UNIQUE (workspace_id, idempotency_key));
CREATE TABLE IF NOT EXISTS events (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, document_id TEXT NOT NULL, kind TEXT NOT NULL, data TEXT, user_id TEXT, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS claim_audits (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, document_id TEXT NOT NULL, revision_id TEXT NOT NULL, paragraph_id TEXT NOT NULL, claim_id TEXT NOT NULL, claim TEXT NOT NULL, start INTEGER, end INTEGER, verdict TEXT NOT NULL, passage_id TEXT, quote TEXT, reasons TEXT, stale INTEGER NOT NULL DEFAULT 0, engine TEXT, run_id TEXT, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, document_id TEXT NOT NULL, assignment_id TEXT NOT NULL, mode TEXT NOT NULL, status TEXT NOT NULL, base_revision TEXT NOT NULL, cancel_requested INTEGER NOT NULL DEFAULT 0, paused INTEGER NOT NULL DEFAULT 0, estimate TEXT, summary TEXT, error TEXT, budget_usd REAL, idempotency_key TEXT, created_at INTEGER NOT NULL, finished_at INTEGER, UNIQUE (workspace_id, idempotency_key));
CREATE TABLE IF NOT EXISTS run_stages (id TEXT PRIMARY KEY, run_id TEXT NOT NULL, workspace_id TEXT NOT NULL, name TEXT NOT NULL, ord INTEGER NOT NULL, depends_on TEXT NOT NULL DEFAULT '[]', status TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, max_attempts INTEGER NOT NULL DEFAULT 3, lease_token TEXT, lease_expires_at INTEGER, heartbeat_at INTEGER, not_before INTEGER NOT NULL DEFAULT 0, block_reason TEXT, request_ref TEXT, error TEXT, created_at INTEGER NOT NULL, finished_at INTEGER);
CREATE TABLE IF NOT EXISTS stage_outputs (stage_id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, output TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS spend (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, assignment_id TEXT, run_id TEXT, stage_id TEXT, attempt INTEGER NOT NULL DEFAULT 1, provider TEXT NOT NULL, model TEXT, state TEXT NOT NULL CHECK (state IN ('reserved','settled','released','uncertain')), reserved_usd REAL NOT NULL DEFAULT 0, actual_usd REAL, input_tokens INTEGER, output_tokens INTEGER, cached_tokens INTEGER, price_rev TEXT, latency_ms INTEGER, paid INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, settled_at INTEGER);
CREATE TABLE IF NOT EXISTS exports (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, document_id TEXT NOT NULL, revision_id TEXT NOT NULL, format TEXT NOT NULL, text_hash TEXT NOT NULL, filename TEXT, created_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS idx_passages_assign ON passages (workspace_id, assignment_id, source_version_id);
CREATE INDEX IF NOT EXISTS idx_revisions_doc ON revisions (document_id, created_at);
CREATE INDEX IF NOT EXISTS idx_proposals_doc ON proposals (document_id, decision);
CREATE INDEX IF NOT EXISTS idx_stages_status ON run_stages (status, not_before);
CREATE INDEX IF NOT EXISTS idx_events_doc ON events (document_id, created_at);
`;

export type DB = DatabaseSyncType;
let shared: DB | null = null;

export function openDb(file?: string): DB {
  const target = file ?? path.join(DATA_DIR, 'studio.db');
  if (target !== ':memory:') fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(target);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 8000; PRAGMA foreign_keys = OFF; PRAGMA synchronous = NORMAL;');
  db.exec(SCHEMA);
  // additive migrations for databases created by an earlier version (idempotent)
  const cols = (db.prepare("PRAGMA table_info('exports')").all() as { name: string }[]).map((x) => x.name);
  if (!cols.includes('confirmed')) db.exec('ALTER TABLE exports ADD COLUMN confirmed INTEGER NOT NULL DEFAULT 0');
  db.prepare("INSERT OR IGNORE INTO meta(key,value) VALUES('schema_version', ?)").run(String(SCHEMA_VERSION));
  return db;
}
export function getDb(): DB {
  return (shared ??= openDb());
}
export function closeShared() {
  shared?.close();
  shared = null;
}

/** Run `fn` inside BEGIN IMMEDIATE. Rolls back on throw. Nested calls join the outer transaction. */
const depth = new WeakMap<DB, number>();
export function tx<T>(db: DB, fn: () => T): T {
  const d = depth.get(db) ?? 0;
  if (d > 0) return fn();
  db.exec('BEGIN IMMEDIATE');
  depth.set(db, 1);
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    try {
      db.exec('ROLLBACK');
    } catch {
      /* already rolled back */
    }
    throw e;
  } finally {
    depth.set(db, 0);
  }
}

export type Row = Record<string, any>;
export const one = (db: DB, sql: string, ...p: any[]): Row | undefined => db.prepare(sql).get(...p) as Row | undefined;
export const all = (db: DB, sql: string, ...p: any[]): Row[] => db.prepare(sql).all(...p) as Row[];
export const run = (db: DB, sql: string, ...p: any[]) => db.prepare(sql).run(...p);
export const j = (v: unknown) => JSON.stringify(v ?? null);
export const unj = <T = any>(s: unknown, fallback: T): T => {
  try {
    return s ? (JSON.parse(String(s)) as T) : fallback;
  } catch {
    return fallback;
  }
};

export function nextSeq(db: DB, ws: string, name: string): number {
  run(db, 'INSERT INTO seq(workspace_id,name,n) VALUES(?,?,1) ON CONFLICT(workspace_id,name) DO UPDATE SET n=n+1', ws, name);
  return one(db, 'SELECT n FROM seq WHERE workspace_id=? AND name=?', ws, name)!.n as number;
}

/** Tenant-scoped lookup. Every read of a tenant row goes through this so a wrong workspace yields undefined. */
export function own(db: DB, table: string, id: string, ws: string): Row | undefined {
  if (!/^[a-z_]+$/.test(table)) throw new Error('bad table');
  return one(db, `SELECT * FROM ${table} WHERE id=? AND workspace_id=?`, id, ws);
}
