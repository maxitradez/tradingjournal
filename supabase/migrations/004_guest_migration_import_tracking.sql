-- Phase 3 Stage 5A: item-level import tracking for safe, resumable guest migration.
-- This migration is additive. It does NOT import, update, or delete journal records.
-- Apply once after 003_guest_migration_infrastructure.sql.

alter table public.guest_migration_batches
    add column if not exists records_imported integer not null default 0,
    add column if not exists records_failed integer not null default 0,
    add column if not exists records_skipped integer not null default 0,
    add column if not exists import_started_at timestamptz,
    add column if not exists import_completed_at timestamptz;

alter table public.guest_migration_items
    add column if not exists import_status text not null default 'pending',
    add column if not exists target_record_id uuid,
    add column if not exists imported_at timestamptz,
    add column if not exists import_error text,
    add column if not exists import_attempts integer not null default 0;

-- Existing preview classifications determine their safe initial import state.
-- Conflicts remain unresolved; they are never silently treated as duplicates.
update public.guest_migration_items
   set import_status = case
       when classification in ('duplicate', 'invalid') then 'skipped'
       when classification = 'conflict' then 'needs_review'
       else 'pending'
   end
 where import_status = 'pending';

do $$
begin
    if not exists (
        select 1 from pg_constraint
         where conname = 'guest_migration_batch_import_counts_check'
           and conrelid = 'public.guest_migration_batches'::regclass
    ) then
        alter table public.guest_migration_batches
            add constraint guest_migration_batch_import_counts_check
            check (records_imported >= 0 and records_failed >= 0 and records_skipped >= 0);
    end if;

    if not exists (
        select 1 from pg_constraint
         where conname = 'guest_migration_item_import_status_check'
           and conrelid = 'public.guest_migration_items'::regclass
    ) then
        alter table public.guest_migration_items
            add constraint guest_migration_item_import_status_check
            check (import_status in ('pending', 'imported', 'skipped', 'needs_review', 'failed'));
    end if;

    if not exists (
        select 1 from pg_constraint
         where conname = 'guest_migration_item_import_attempts_check'
           and conrelid = 'public.guest_migration_items'::regclass
    ) then
        alter table public.guest_migration_items
            add constraint guest_migration_item_import_attempts_check
            check (import_attempts >= 0);
    end if;

    if not exists (
        select 1 from pg_constraint
         where conname = 'guest_migration_item_imported_at_check'
           and conrelid = 'public.guest_migration_items'::regclass
    ) then
        alter table public.guest_migration_items
            add constraint guest_migration_item_imported_at_check
            check (
                (import_status = 'imported' and imported_at is not null)
                or (import_status <> 'imported' and imported_at is null)
            );
    end if;
end;
$$;

create index if not exists guest_migration_items_resume_idx
    on public.guest_migration_items(user_id, batch_id, import_status, entity_type, created_at);

comment on column public.guest_migration_items.import_status is
    'Per-record import progress: pending, imported, skipped, needs_review, or failed.';
comment on column public.guest_migration_items.target_record_id is
    'UUID of the imported target row; polymorphic across supported destination tables.';
comment on column public.guest_migration_items.import_error is
    'Sanitized last import error for this item; never stores credentials or tokens.';
comment on column public.guest_migration_batches.records_imported is
    'Count of migration items confirmed imported into destination tables.';
comment on column public.guest_migration_batches.records_failed is
    'Count of migration items whose latest import attempt failed.';
comment on column public.guest_migration_batches.records_skipped is
    'Count of duplicate or otherwise intentionally skipped migration items.';

-- Existing direct table-write restrictions and RLS remain unchanged.
-- Import progress will be changed only by the authenticated, ownership-checked
-- import RPCs introduced in the next implementation step.
