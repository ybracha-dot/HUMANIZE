-- Writing Studio, hosted edition schema (Supabase / Postgres). Mirrors the local SQLite model used by the personal edition.
-- Every tenant table carries workspace_id and has row-level security. Privileged workers use the service role, which bypasses
-- RLS, so every worker entry point below re-checks ownership explicitly (see app.commit_stage).
-- Local development target only: nothing here has been applied to a hosted project.

create schema if not exists app;

create table workspaces   (id uuid primary key default gen_random_uuid(), name text not null, owner_id uuid not null, created_at timestamptz not null default now());
create table memberships  (workspace_id uuid not null references workspaces on delete cascade, user_id uuid not null, role text not null check (role in ('owner','editor','viewer')), primary key (workspace_id, user_id));

create function app.is_member(ws uuid) returns boolean language sql stable security definer set search_path = public as
$$ select exists (select 1 from memberships m where m.workspace_id = ws and m.user_id = auth.uid()) $$;
create function app.can_write(ws uuid) returns boolean language sql stable security definer set search_path = public as
$$ select exists (select 1 from memberships m where m.workspace_id = ws and m.user_id = auth.uid() and m.role in ('owner','editor')) $$;

create table settings        (workspace_id uuid primary key references workspaces on delete cascade, voice_profile jsonb, mode text not null default 'demo', prices jsonb, monthly_limit_usd numeric, default_budget_usd numeric);
create table courses         (id uuid primary key default gen_random_uuid(), workspace_id uuid not null references workspaces on delete cascade, name text not null, instructor text, term text, created_at timestamptz not null default now());
create table assignments     (id uuid primary key default gen_random_uuid(), workspace_id uuid not null references workspaces on delete cascade, course_id uuid not null references courses on delete cascade, title text not null, genre text not null default 'academic_argument', language text not null default 'en', budget_usd numeric, state jsonb not null default '{}', created_at timestamptz not null default now());
create table sources         (id uuid primary key default gen_random_uuid(), workspace_id uuid not null references workspaces on delete cascade, course_id uuid not null references courses on delete cascade, assignment_id uuid references assignments, kind text not null, title text not null, doc_date text, ordinal int not null, current_version_id uuid, created_at timestamptz not null default now());
create table source_versions (id uuid primary key default gen_random_uuid(), workspace_id uuid not null references workspaces on delete cascade, source_id uuid not null references sources on delete cascade, file_hash text not null, parse_version text not null, filename text, mime text, size bigint, status text not null, error text, page_count int, created_at timestamptz not null default now(), superseded_at timestamptz);
create table passages        (workspace_id uuid not null references workspaces on delete cascade, id text not null, course_id uuid not null, assignment_id uuid, source_id uuid not null, source_version_id uuid not null, page_index int not null, page_label text, section text, para_index int not null, ord int not null, text text not null, page_offset int not null default 0, tsv tsvector generated always as (to_tsvector('simple', text)) stored, primary key (workspace_id, id));
create index passages_tsv on passages using gin (tsv);
create table documents       (id uuid primary key default gen_random_uuid(), workspace_id uuid not null references workspaces on delete cascade, assignment_id uuid not null references assignments, title text not null, active_branch_id uuid, created_at timestamptz not null default now());
create table branches        (id uuid primary key default gen_random_uuid(), workspace_id uuid not null references workspaces on delete cascade, document_id uuid not null references documents on delete cascade, name text not null, head_revision_id uuid, parent_branch_id uuid, created_at timestamptz not null default now());
create table revisions       (id uuid primary key default gen_random_uuid(), workspace_id uuid not null references workspaces on delete cascade, document_id uuid not null references documents on delete cascade, branch_id uuid not null, parent_id uuid, paragraphs jsonb not null, text_hash text not null, cause text not null, label text, meta jsonb, created_at timestamptz not null default now());
create table locks           (id uuid primary key default gen_random_uuid(), workspace_id uuid not null references workspaces on delete cascade, document_id uuid not null, paragraph_id text not null, kind text not null, text text not null, start_offset int not null, end_offset int not null, note text, thesis boolean not null default false, created_at timestamptz not null default now(), released_at timestamptz);
create table proposals       (id uuid primary key default gen_random_uuid(), workspace_id uuid not null references workspaces on delete cascade, document_id uuid not null, run_id uuid, base_revision uuid not null, paragraph_id text not null, original text not null, replacement text not null, issue text not null, evidence jsonb not null default '[]', requires_decision boolean not null default false, start_offset int not null, verifier text not null, findings jsonb not null default '[]', provider text not null, policy_version text, decision text not null default 'pending', created_at timestamptz not null default now(), resolved_at timestamptz);
create table decisions       (id uuid primary key default gen_random_uuid(), workspace_id uuid not null references workspaces on delete cascade, proposal_id uuid, document_id uuid not null, action text not null, revision_id uuid, idempotency_key text not null, user_id uuid, created_at timestamptz not null default now(), unique (workspace_id, idempotency_key));
create table events          (id uuid primary key default gen_random_uuid(), workspace_id uuid not null references workspaces on delete cascade, document_id uuid not null, kind text not null, data jsonb, user_id uuid, created_at timestamptz not null default now());
create table claim_audits    (id uuid primary key default gen_random_uuid(), workspace_id uuid not null references workspaces on delete cascade, document_id uuid not null, revision_id uuid not null, paragraph_id text not null, claim text not null, verdict text not null, passage_id text, stale boolean not null default false, created_at timestamptz not null default now());
create table runs            (id uuid primary key default gen_random_uuid(), workspace_id uuid not null references workspaces on delete cascade, document_id uuid not null, assignment_id uuid not null, mode text not null, status text not null, base_revision uuid not null, cancel_requested boolean not null default false, paused boolean not null default false, budget_usd numeric, idempotency_key text, created_at timestamptz not null default now(), unique (workspace_id, idempotency_key));
create table run_stages      (id uuid primary key default gen_random_uuid(), run_id uuid not null references runs on delete cascade, workspace_id uuid not null references workspaces on delete cascade, name text not null, ord int not null, depends_on jsonb not null default '[]', status text not null, attempts int not null default 0, max_attempts int not null default 3, lease_token uuid, lease_expires_at timestamptz, not_before timestamptz not null default now());
create table stage_outputs   (stage_id uuid primary key references run_stages on delete cascade, workspace_id uuid not null references workspaces on delete cascade, output jsonb not null, created_at timestamptz not null default now());
create table spend           (id uuid primary key default gen_random_uuid(), workspace_id uuid not null references workspaces on delete cascade, assignment_id uuid, run_id uuid, stage_id uuid, attempt int not null default 1, provider text not null, model text, state text not null check (state in ('reserved','settled','released','uncertain')), reserved_usd numeric not null default 0, actual_usd numeric, paid boolean not null default false, created_at timestamptz not null default now());
create table exports         (id uuid primary key default gen_random_uuid(), workspace_id uuid not null references workspaces on delete cascade, document_id uuid not null, revision_id uuid not null, format text not null, text_hash text not null, created_at timestamptz not null default now());
create table voice_samples   (id uuid primary key default gen_random_uuid(), workspace_id uuid not null references workspaces on delete cascade, user_id uuid, text text not null, genre text, language text, audience text, register text, created_at timestamptz not null default now());
create table feedback_rules  (id uuid primary key default gen_random_uuid(), workspace_id uuid not null references workspaces on delete cascade, course_id uuid not null, comment text not null, scope text not null default 'one_off', confirmed boolean not null default false, created_at timestamptz not null default now());

-- Row-level security: members read, owners/editors write; everything is scoped by workspace_id.
do $$
declare t text;
begin
  foreach t in array array['settings','courses','assignments','sources','source_versions','passages','documents','branches','revisions','locks','proposals','decisions','events','claim_audits','runs','run_stages','stage_outputs','spend','exports','voice_samples','feedback_rules'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('create policy %I on %I for select to authenticated using (app.is_member(workspace_id))', t || '_read', t);
    execute format('create policy %I on %I for insert to authenticated with check (app.can_write(workspace_id))', t || '_ins', t);
    execute format('create policy %I on %I for update to authenticated using (app.can_write(workspace_id)) with check (app.can_write(workspace_id))', t || '_upd', t);
    execute format('create policy %I on %I for delete to authenticated using (app.can_write(workspace_id))', t || '_del', t);
  end loop;
end $$;

alter table workspaces  enable row level security; alter table workspaces  force row level security;
alter table memberships enable row level security; alter table memberships force row level security;
create policy workspaces_read on workspaces for select to authenticated using (owner_id = auth.uid() or app.is_member(id));
create policy workspaces_ins  on workspaces for insert to authenticated with check (owner_id = auth.uid());
create policy workspaces_upd  on workspaces for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy workspaces_del  on workspaces for delete to authenticated using (owner_id = auth.uid());
create policy memberships_read on memberships for select to authenticated using (user_id = auth.uid() or app.is_member(workspace_id));
create policy memberships_ins  on memberships for insert to authenticated with check (exists (select 1 from workspaces w where w.id = workspace_id and w.owner_id = auth.uid()));
create policy memberships_del  on memberships for delete to authenticated using (exists (select 1 from workspaces w where w.id = workspace_id and w.owner_id = auth.uid()));

grant usage on schema public, app to authenticated, service_role;
grant select, insert, update, delete on all tables in schema public to authenticated, service_role;

-- Retrieval is scoped by the caller's RLS (security invoker) AND by the authorised assignment/course before any passage is returned.
create function app.search_passages(p_assignment uuid, q text, k int default 8)
returns table (id text, page_index int, page_label text, text text, rank real) language sql stable security invoker as $$
  select p.id, p.page_index, p.page_label, p.text, ts_rank(p.tsv, plainto_tsquery('simple', q)) as rank
  from passages p
  join assignments a on a.id = p_assignment and a.course_id = p.course_id and a.workspace_id = p.workspace_id
  join sources s on s.id = p.source_id and s.current_version_id = p.source_version_id and s.kind = 'reading'
  where p.tsv @@ plainto_tsquery('simple', q) and (p.assignment_id is null or p.assignment_id = p_assignment)
  order by rank desc limit k $$;
grant execute on function app.search_passages(uuid, text, int) to authenticated;

-- Durable-queue entry points for the privileged worker (service role only). Leasing skips locked rows, and commit re-checks
-- tenancy and lease ownership; a duplicate or late commit changes nothing.
create function app.lease_stage(lease_seconds int default 60) returns run_stages language plpgsql security definer set search_path = public as $$
declare s run_stages;
begin
  select st.* into s from run_stages st join runs r on r.id = st.run_id
   where r.status in ('queued','running') and not r.paused and not r.cancel_requested
     and ((st.status = 'ready' and st.not_before <= now()) or (st.status = 'leased' and st.lease_expires_at < now()))
   order by r.created_at, st.ord limit 1 for update of st skip locked;
  if not found then return null; end if;
  update run_stages set status = 'leased', attempts = attempts + 1, lease_token = gen_random_uuid(), lease_expires_at = now() + make_interval(secs => lease_seconds) where id = s.id returning * into s;
  update runs set status = 'running' where id = s.run_id and status = 'queued';
  return s;
end $$;
create function app.commit_stage(p_stage uuid, p_lease uuid, p_workspace uuid, p_output jsonb) returns boolean language plpgsql security definer set search_path = public as $$
declare st run_stages; n int;
begin
  select * into st from run_stages where id = p_stage for update;
  if not found then return false; end if;
  if st.workspace_id <> p_workspace then raise exception 'tenant ownership check failed' using errcode = '42501'; end if;
  if st.status <> 'leased' or st.lease_token is distinct from p_lease then return false; end if;
  insert into stage_outputs(stage_id, workspace_id, output) values (p_stage, p_workspace, p_output) on conflict (stage_id) do nothing;
  get diagnostics n = row_count;
  update run_stages set status = 'done', lease_token = null where id = p_stage;
  return n = 1;
end $$;
revoke all on function app.lease_stage(int), app.commit_stage(uuid, uuid, uuid, jsonb) from public, authenticated, anon;
grant execute on function app.lease_stage(int), app.commit_stage(uuid, uuid, uuid, jsonb) to service_role;
