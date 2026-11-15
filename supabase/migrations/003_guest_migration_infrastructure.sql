-- Phase 3 Stage 4: guest migration ledger and atomic preview staging.
-- This migration creates infrastructure only. It does NOT import or modify journal records.
-- Apply once in the Supabase SQL Editor after 002_atomic_playbook_delete.sql.

create table if not exists public.guest_migration_batches (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    migration_key text not null,
    source_version text not null,
    status text not null default 'draft',
    manifest jsonb not null default '{}'::jsonb,
    summary jsonb not null default '{}'::jsonb,
    records_seen integer not null default 0,
    records_new integer not null default 0,
    records_duplicate integer not null default 0,
    records_conflict integer not null default 0,
    records_invalid integer not null default 0,
    last_error text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    previewed_at timestamptz,
    completed_at timestamptz,

    constraint guest_migration_key_check
        check (length(migration_key) between 1 and 200),
    constraint guest_migration_source_version_check
        check (length(source_version) between 1 and 80),
    constraint guest_migration_status_check
        check (status in ('draft', 'previewed', 'importing', 'paused', 'completed', 'failed', 'cancelled')),
    constraint guest_migration_counts_check
        check (
            records_seen >= 0 and records_new >= 0 and records_duplicate >= 0
            and records_conflict >= 0 and records_invalid >= 0
        ),
    constraint guest_migration_manifest_object_check
        check (jsonb_typeof(manifest) = 'object'),
    constraint guest_migration_summary_object_check
        check (jsonb_typeof(summary) = 'object'),
    constraint guest_migration_user_key_unique
        unique (user_id, migration_key),
    constraint guest_migration_user_id_unique
        unique (user_id, id)
);

create table if not exists public.guest_migration_items (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    batch_id uuid not null,
    entity_type text not null,
    source_record_key text not null,
    fingerprint text not null,
    classification text not null,
    payload jsonb not null,
    created_at timestamptz not null default now(),

    constraint guest_migration_item_entity_check
        check (entity_type in ('trade', 'playbook', 'daily_journal', 'settings', 'trading_account', 'instrument', 'attachment')),
    constraint guest_migration_item_classification_check
        check (classification in ('new', 'duplicate', 'conflict', 'invalid')),
    constraint guest_migration_item_payload_check
        check (jsonb_typeof(payload) = 'object'),
    constraint guest_migration_item_key_check
        check (length(source_record_key) between 1 and 240),
    constraint guest_migration_item_fingerprint_check
        check (length(fingerprint) between 1 and 160),
    constraint guest_migration_item_batch_fk
        foreign key (user_id, batch_id)
        references public.guest_migration_batches(user_id, id) on delete cascade,
    constraint guest_migration_item_source_unique
        unique (batch_id, entity_type, source_record_key),
    constraint guest_migration_item_user_id_unique
        unique (user_id, id)
);

create index if not exists guest_migration_batches_user_created_idx
    on public.guest_migration_batches(user_id, created_at desc);

create index if not exists guest_migration_items_batch_classification_idx
    on public.guest_migration_items(user_id, batch_id, classification);

alter table public.guest_migration_batches enable row level security;
alter table public.guest_migration_items enable row level security;

drop policy if exists "Users read own guest migration batches" on public.guest_migration_batches;
create policy "Users read own guest migration batches"
    on public.guest_migration_batches for select to authenticated
    using (user_id = (select auth.uid()));

drop policy if exists "Users read own guest migration items" on public.guest_migration_items;
create policy "Users read own guest migration items"
    on public.guest_migration_items for select to authenticated
    using (user_id = (select auth.uid()));

-- Clients can inspect their own migration preview, but all writes go through
-- narrowly scoped RPCs that derive ownership from auth.uid().
revoke all on table public.guest_migration_batches from anon, authenticated;
revoke all on table public.guest_migration_items from anon, authenticated;
grant select on table public.guest_migration_batches to authenticated;
grant select on table public.guest_migration_items to authenticated;

create or replace function public.create_guest_migration_batch(
    p_migration_key text,
    p_source_version text,
    p_manifest jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_user_id uuid := auth.uid();
    v_batch_id uuid;
    v_existing public.guest_migration_batches%rowtype;
begin
    if v_user_id is null then
        raise exception 'Authentication is required.';
    end if;
    if p_migration_key is null or length(p_migration_key) not between 1 and 200 then
        raise exception 'A migration key between 1 and 200 characters is required.';
    end if;
    if p_source_version is null or length(p_source_version) not between 1 and 80 then
        raise exception 'A source version between 1 and 80 characters is required.';
    end if;
    if p_manifest is null or jsonb_typeof(p_manifest) <> 'object' then
        raise exception 'Migration manifest must be a JSON object.';
    end if;

    insert into public.guest_migration_batches(user_id, migration_key, source_version, manifest)
    values (v_user_id, p_migration_key, p_source_version, p_manifest)
    on conflict (user_id, migration_key) do nothing
    returning id into v_batch_id;

    if v_batch_id is not null then
        return v_batch_id;
    end if;

    select *
      into v_existing
      from public.guest_migration_batches
     where user_id = v_user_id
       and migration_key = p_migration_key
     for update;

    if v_existing.source_version <> p_source_version
       or v_existing.manifest <> p_manifest then
        raise exception 'This migration key already exists with a different source snapshot.';
    end if;

    return v_existing.id;
end;
$$;

create or replace function public.stage_guest_migration_items(
    p_batch_id uuid,
    p_items jsonb
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_user_id uuid := auth.uid();
    v_batch public.guest_migration_batches%rowtype;
    v_item jsonb;
    v_inserted integer := 0;
    v_entity_type text;
    v_record_key text;
    v_fingerprint text;
    v_classification text;
    v_payload jsonb;
    v_existing public.guest_migration_items%rowtype;
begin
    if v_user_id is null then
        raise exception 'Authentication is required.';
    end if;
    if p_items is null or jsonb_typeof(p_items) <> 'array' then
        raise exception 'Migration items must be a JSON array.';
    end if;
    if jsonb_array_length(p_items) > 250 then
        raise exception 'A staging batch cannot contain more than 250 items.';
    end if;

    select *
      into v_batch
      from public.guest_migration_batches
     where id = p_batch_id and user_id = v_user_id
     for update;

    if not found then
        raise exception 'Migration batch not found for this account.';
    end if;
    if v_batch.status <> 'draft' then
        raise exception 'Only a draft migration batch can accept staged items.';
    end if;

    for v_item in select value from jsonb_array_elements(p_items)
    loop
        if jsonb_typeof(v_item) <> 'object' then
            raise exception 'Each migration item must be a JSON object.';
        end if;

        v_entity_type := v_item->>'entity_type';
        v_record_key := v_item->>'source_record_key';
        v_fingerprint := v_item->>'fingerprint';
        v_classification := v_item->>'classification';
        v_payload := v_item->'payload';

        if v_entity_type not in ('trade', 'playbook', 'daily_journal', 'settings', 'trading_account', 'instrument', 'attachment') then
            raise exception 'Unsupported migration entity type.';
        end if;
        if v_record_key is null or length(v_record_key) not between 1 and 240 then
            raise exception 'Each migration item needs a source record key.';
        end if;
        if v_fingerprint is null or length(v_fingerprint) not between 1 and 160 then
            raise exception 'Each migration item needs a fingerprint.';
        end if;
        if v_classification not in ('new', 'duplicate', 'conflict', 'invalid') then
            raise exception 'Unsupported migration classification.';
        end if;
        if v_payload is null or jsonb_typeof(v_payload) <> 'object' then
            raise exception 'Each migration item payload must be a JSON object.';
        end if;

        insert into public.guest_migration_items(
            user_id, batch_id, entity_type, source_record_key,
            fingerprint, classification, payload
        )
        values (
            v_user_id, p_batch_id, v_entity_type, v_record_key,
            v_fingerprint, v_classification, v_payload
        )
        on conflict (batch_id, entity_type, source_record_key) do nothing;

        if found then
            v_inserted := v_inserted + 1;
        else
            select *
              into v_existing
              from public.guest_migration_items
             where user_id = v_user_id
               and batch_id = p_batch_id
               and entity_type = v_entity_type
               and source_record_key = v_record_key;

            if v_existing.fingerprint <> v_fingerprint
               or v_existing.classification <> v_classification
               or v_existing.payload <> v_payload then
                raise exception 'A staged source record changed after its first submission.';
            end if;
        end if;
    end loop;

    update public.guest_migration_batches
       set records_seen = (
               select count(*)::integer
                 from public.guest_migration_items
                where user_id = v_user_id and batch_id = p_batch_id
           ),
           records_new = (
               select count(*)::integer from public.guest_migration_items
                where user_id = v_user_id and batch_id = p_batch_id and classification = 'new'
           ),
           records_duplicate = (
               select count(*)::integer from public.guest_migration_items
                where user_id = v_user_id and batch_id = p_batch_id and classification = 'duplicate'
           ),
           records_conflict = (
               select count(*)::integer from public.guest_migration_items
                where user_id = v_user_id and batch_id = p_batch_id and classification = 'conflict'
           ),
           records_invalid = (
               select count(*)::integer from public.guest_migration_items
                where user_id = v_user_id and batch_id = p_batch_id and classification = 'invalid'
           ),
           updated_at = now()
     where id = p_batch_id and user_id = v_user_id;

    return v_inserted;
end;
$$;

create or replace function public.finalize_guest_migration_preview(
    p_batch_id uuid,
    p_preview_notes jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_user_id uuid := auth.uid();
    v_batch public.guest_migration_batches%rowtype;
    v_summary jsonb;
begin
    if v_user_id is null then
        raise exception 'Authentication is required.';
    end if;
    if p_preview_notes is null or jsonb_typeof(p_preview_notes) <> 'object' then
        raise exception 'Preview notes must be a JSON object.';
    end if;

    select *
      into v_batch
      from public.guest_migration_batches
     where id = p_batch_id and user_id = v_user_id
     for update;

    if not found then
        raise exception 'Migration batch not found for this account.';
    end if;

    if v_batch.status = 'previewed' then
        return v_batch.summary;
    end if;
    if v_batch.status <> 'draft' then
        raise exception 'Only a draft migration batch can be previewed.';
    end if;

    v_summary := p_preview_notes || jsonb_build_object(
        'records_seen', v_batch.records_seen,
        'records_new', v_batch.records_new,
        'records_duplicate', v_batch.records_duplicate,
        'records_conflict', v_batch.records_conflict,
        'records_invalid', v_batch.records_invalid
    );

    update public.guest_migration_batches
       set status = 'previewed',
           summary = v_summary,
           previewed_at = now(),
           updated_at = now()
     where id = p_batch_id and user_id = v_user_id;

    return v_summary;
end;
$$;

create or replace function public.transition_guest_migration_batch(
    p_batch_id uuid,
    p_next_status text,
    p_error text default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_user_id uuid := auth.uid();
    v_current_status text;
begin
    if v_user_id is null then
        raise exception 'Authentication is required.';
    end if;
    if p_next_status not in ('importing', 'paused', 'failed', 'cancelled') then
        raise exception 'Unsupported migration status transition.';
    end if;

    select status
      into v_current_status
      from public.guest_migration_batches
     where id = p_batch_id and user_id = v_user_id
     for update;

    if not found then
        raise exception 'Migration batch not found for this account.';
    end if;

    if not (
        (v_current_status = 'previewed' and p_next_status in ('importing', 'cancelled'))
        or (v_current_status = 'importing' and p_next_status in ('paused', 'failed'))
        or (v_current_status = 'paused' and p_next_status in ('importing', 'cancelled'))
    ) then
        raise exception 'Invalid migration status transition from % to %.', v_current_status, p_next_status;
    end if;

    update public.guest_migration_batches
       set status = p_next_status,
           last_error = case when p_next_status = 'failed' then left(coalesce(p_error, 'Migration failed.'), 2000) else null end,
           updated_at = now()
     where id = p_batch_id and user_id = v_user_id;

    return p_next_status;
end;
$$;

revoke all on function public.create_guest_migration_batch(text, text, jsonb) from public, anon;
revoke all on function public.stage_guest_migration_items(uuid, jsonb) from public, anon;
revoke all on function public.finalize_guest_migration_preview(uuid, jsonb) from public, anon;
revoke all on function public.transition_guest_migration_batch(uuid, text, text) from public, anon;

grant execute on function public.create_guest_migration_batch(text, text, jsonb) to authenticated;
grant execute on function public.stage_guest_migration_items(uuid, jsonb) to authenticated;
grant execute on function public.finalize_guest_migration_preview(uuid, jsonb) to authenticated;
grant execute on function public.transition_guest_migration_batch(uuid, text, text) to authenticated;
