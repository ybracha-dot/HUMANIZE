-- Private object storage for original uploads. Applies only where Supabase's storage schema exists.
-- NOT exercised by the local test suite (the Postgres test harness has no storage schema).
do $$
begin
  if exists (select 1 from information_schema.schemata where schema_name = 'storage') then
    insert into storage.buckets (id, name, public) values ('sources', 'sources', false) on conflict (id) do update set public = false;
    -- object names are "<workspace_id>/<file_hash>"; only members of that workspace may read, only editors/owners may write
    create policy sources_read  on storage.objects for select to authenticated using (bucket_id = 'sources' and app.is_member(((storage.foldername(name))[1])::uuid));
    create policy sources_write on storage.objects for insert to authenticated with check (bucket_id = 'sources' and app.can_write(((storage.foldername(name))[1])::uuid));
    create policy sources_del   on storage.objects for delete to authenticated using (bucket_id = 'sources' and app.can_write(((storage.foldername(name))[1])::uuid));
  end if;
end $$;
