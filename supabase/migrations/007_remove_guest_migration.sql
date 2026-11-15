-- Remove the retired guest-migration subsystem.
-- This intentionally deletes its staging/audit rows and all guest-migration RPCs.
-- It does not touch authenticated journal tables, user profiles, or trade data.

-- Remove every non-internal trigger that references either trigger function.
-- Discover dependencies from PostgreSQL's catalog rather than assuming trigger names.
do $$
declare
  v_trigger record;
begin
  for v_trigger in
    select
      ns.nspname as schema_name,
      cls.relname as table_name,
      trg.tgname as trigger_name
    from pg_trigger trg
    join pg_class cls on cls.oid = trg.tgrelid
    join pg_namespace ns on ns.oid = cls.relnamespace
    where not trg.tgisinternal
      and trg.tgfoid in (
        'public.set_guest_migration_item_initial_status()'::regprocedure,
        'public.set_guest_migration_batch_updated_at()'::regprocedure
      )
  loop
    execute format(
      'drop trigger if exists %I on %I.%I',
      v_trigger.trigger_name,
      v_trigger.schema_name,
      v_trigger.table_name
    );
  end loop;
end
$$;

drop function if exists public.create_guest_migration_batch(text, text, jsonb);
drop function if exists public.stage_guest_migration_items(uuid, jsonb);
drop function if exists public.finalize_guest_migration_preview(uuid, jsonb);
drop function if exists public.transition_guest_migration_batch(uuid, text, text);
drop function if exists public.import_guest_migration_item(uuid, uuid, uuid, boolean, boolean);
drop function if exists public.skip_guest_migration_item(uuid, uuid, text);
drop function if exists public.finalize_guest_migration_import(uuid);
drop function if exists public.set_guest_migration_item_initial_status();
drop function if exists public.set_guest_migration_batch_updated_at();

drop table if exists public.guest_migration_items cascade;
drop table if exists public.guest_migration_batches cascade;
