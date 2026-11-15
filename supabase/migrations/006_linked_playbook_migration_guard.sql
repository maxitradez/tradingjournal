-- Phase 3 Stage 5C hardening: never attach a guest trade to an unresolved or conflicting cloud playbook.
-- Apply once after 005_guest_migration_importer.sql. Replaces only the importer RPC.
create or replace function public.import_guest_migration_item(
    p_batch_id uuid,
    p_item_id uuid,
    p_account_id uuid default null,
    p_confirm_unassigned_account boolean default false,
    p_confirm_settings boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
    v_user_id uuid := auth.uid();
    v_batch public.guest_migration_batches%rowtype;
    v_item public.guest_migration_items%rowtype;
    v_payload jsonb;
    v_target_id uuid;
    v_existing_id uuid;
    v_playbook_id uuid;
    v_playbook_legacy text;
    v_playbook_item public.guest_migration_items%rowtype;
    v_trade_date date;
    v_error text;
begin
    if v_user_id is null then
        raise exception 'Authentication is required.';
    end if;

    select * into v_batch
      from public.guest_migration_batches
     where id = p_batch_id and user_id = v_user_id
     for update;
    if not found then
        raise exception 'Migration batch not found for this account.';
    end if;
    if v_batch.status <> 'importing' then
        raise exception 'The migration batch must be in importing state.';
    end if;

    select * into v_item
      from public.guest_migration_items
     where id = p_item_id and batch_id = p_batch_id and user_id = v_user_id
     for update;
    if not found then
        raise exception 'Migration item not found for this account.';
    end if;

    if v_item.import_status = 'imported' then
        return jsonb_build_object('status', 'imported', 'target_record_id', v_item.target_record_id, 'already_done', true);
    end if;
    if v_item.classification <> 'new' then
        raise exception 'Only records classified as new can be imported.';
    end if;
    if v_item.import_status not in ('pending', 'failed') then
        raise exception 'This migration item is not eligible for import.';
    end if;

    v_payload := v_item.payload;

    -- Import playbooks first so trades can retain their foreign-key relationship.
    if v_item.entity_type = 'trade' and exists (
        select 1 from public.guest_migration_items i
         where i.user_id = v_user_id and i.batch_id = p_batch_id
           and i.entity_type = 'playbook' and i.classification = 'new'
           and i.import_status in ('pending', 'failed')
    ) then
        raise exception 'Import all eligible playbooks before importing trades.';
    end if;

    if v_item.entity_type = 'trade' then
        if p_account_id is null and not coalesce(p_confirm_unassigned_account, false) then
            raise exception 'Choose a trading account or explicitly confirm that these trades should remain unassigned.';
        end if;
        if p_account_id is not null and not exists (
            select 1 from public.trading_accounts a
             where a.id = p_account_id and a.user_id = v_user_id
        ) then
            raise exception 'The selected trading account does not belong to this account.';
        end if;
    end if;

    if v_item.entity_type = 'settings' and not coalesce(p_confirm_settings, false) then
        raise exception 'Explicit confirmation is required before importing guest settings.';
    end if;

    update public.guest_migration_items
       set import_attempts = import_attempts + 1,
           import_error = null
     where id = p_item_id and user_id = v_user_id;

    begin
        if v_item.entity_type = 'playbook' then
            if exists (
                select 1 from public.playbooks p
                 where p.user_id = v_user_id
                   and (p.legacy_id = coalesce(nullif(v_payload->>'id', ''), v_item.source_record_key)
                        or p.id::text = coalesce(nullif(v_payload->>'id', ''), v_item.source_record_key))
            ) then
                update public.guest_migration_items
                   set import_status = 'needs_review',
                       import_error = 'A cloud playbook with this legacy ID now exists. Refresh the preview before deciding what to do.'
                 where id = p_item_id and user_id = v_user_id;
                return jsonb_build_object('status', 'needs_review');
            end if;

            insert into public.playbooks (
                user_id, legacy_id, name, description, rules, is_example
            ) values (
                v_user_id,
                coalesce(nullif(v_payload->>'id', ''), v_item.source_record_key),
                coalesce(nullif(v_payload->>'name', ''), 'Untitled'),
                coalesce(v_payload->>'description', ''),
                case when jsonb_typeof(v_payload->'rules') = 'array' then v_payload->'rules' else '[]'::jsonb end,
                coalesce((v_payload->>'example')::boolean, false)
            ) returning id into v_target_id;

        elsif v_item.entity_type = 'trade' then
            v_playbook_legacy := nullif(v_payload->>'playbook', '');
            v_playbook_id := null;
            if v_playbook_legacy is not null then
                -- A linked guest playbook must itself be safely accounted for:
                -- imported in this batch, or an identical cloud duplicate.
                select * into v_playbook_item
                  from public.guest_migration_items i
                 where i.user_id = v_user_id
                   and i.batch_id = p_batch_id
                   and i.entity_type = 'playbook'
                   and i.source_record_key = v_playbook_legacy
                 for update;

                if not found or not (
                    (v_playbook_item.classification = 'new' and v_playbook_item.import_status = 'imported')
                    or v_playbook_item.classification = 'duplicate'
                ) then
                    update public.guest_migration_items
                       set import_status = 'needs_review',
                           target_record_id = null,
                           imported_at = null,
                           import_error = 'The linked guest playbook is unresolved or differs from the cloud version. Resolve the playbook first, or skip this trade.'
                     where id = p_item_id and user_id = v_user_id;
                    return jsonb_build_object('status', 'needs_review');
                end if;

                if v_playbook_item.classification = 'new' then
                    -- Link to the exact row imported by this batch, not merely a matching legacy label.
                    select p.id into v_playbook_id
                      from public.playbooks p
                     where p.id = v_playbook_item.target_record_id
                       and p.user_id = v_user_id;
                else
                    -- A duplicate is safe only while its cloud content still matches the reviewed snapshot.
                    select p.id into v_playbook_id
                      from public.playbooks p
                     where p.user_id = v_user_id
                       and (p.legacy_id = v_playbook_legacy or p.id::text = v_playbook_legacy)
                       and p.name = coalesce(nullif(v_playbook_item.payload->>'name', ''), 'Untitled')
                       and coalesce(p.description, '') = coalesce(v_playbook_item.payload->>'description', '')
                       and p.rules = case
                           when jsonb_typeof(v_playbook_item.payload->'rules') = 'array' then v_playbook_item.payload->'rules'
                           else '[]'::jsonb
                       end
                     order by (p.legacy_id = v_playbook_legacy) desc
                     limit 1;
                end if;
                if v_playbook_id is null then
                    update public.guest_migration_items
                       set import_status = 'needs_review',
                           import_error = 'The linked playbook is not available in the cloud account. Import or resolve that playbook first.'
                     where id = p_item_id and user_id = v_user_id;
                    return jsonb_build_object('status', 'needs_review');
                end if;
            end if;

            if exists (
                select 1 from public.trades t
                 where t.user_id = v_user_id
                   and (t.legacy_id = coalesce(nullif(v_payload->>'id', ''), v_item.source_record_key)
                        or t.id::text = coalesce(nullif(v_payload->>'id', ''), v_item.source_record_key))
            ) then
                update public.guest_migration_items
                   set import_status = 'needs_review',
                       import_error = 'A cloud trade with this legacy ID now exists. Refresh the preview before deciding what to do.'
                 where id = p_item_id and user_id = v_user_id;
                return jsonb_build_object('status', 'needs_review');
            end if;

            if lower(coalesce(v_payload->>'side', '')) not in ('buy', 'long', 'sell', 'short') then
                raise exception 'Trade side must be buy, sell, long, or short.';
            end if;

            insert into public.trades (
                user_id, account_id, playbook_id, legacy_id,
                instrument_symbol, trade_date, trade_time, side, status,
                entry_price, stop_loss, take_profit, exit_price, net_pnl,
                risk_amount, r_multiple, emotion, followed_rules,
                misses, mistakes, lesson, is_example, notes
            ) values (
                v_user_id, p_account_id, v_playbook_id,
                coalesce(nullif(v_payload->>'id', ''), v_item.source_record_key),
                coalesce(nullif(v_payload->>'asset', ''), 'UNKNOWN'),
                (v_payload->>'date')::date,
                nullif(v_payload->>'time', '')::time,
                case when lower(v_payload->>'side') in ('sell', 'short') then 'sell' else 'buy' end,
                'closed',
                nullif(v_payload->>'entry', '')::numeric,
                nullif(v_payload->>'sl', '')::numeric,
                nullif(v_payload->>'tp', '')::numeric,
                nullif(v_payload->>'exit', '')::numeric,
                coalesce(nullif(v_payload->>'pnl', '')::numeric, 0),
                nullif(v_payload->>'risk', '')::numeric,
                nullif(v_payload->>'r', '')::numeric,
                nullif(v_payload->>'emotion', ''),
                coalesce((v_payload->>'followed')::boolean, true),
                case when jsonb_typeof(v_payload->'misses') = 'array' then v_payload->'misses' else '[]'::jsonb end,
                case when jsonb_typeof(v_payload->'mistakes') = 'array' then v_payload->'mistakes' else '[]'::jsonb end,
                nullif(v_payload->>'lesson', ''),
                coalesce((v_payload->>'example')::boolean, false),
                jsonb_build_object(
                    'legacy_shot', coalesce(v_payload->>'shot', ''),
                    'legacy_shot_id', coalesce(v_payload->>'shotId', ''),
                    'playbook_legacy_id', coalesce(v_playbook_legacy, '')
                )
            ) returning id into v_target_id;

        elsif v_item.entity_type = 'daily_journal' then
            v_trade_date := coalesce(nullif(v_payload->>'date', '')::date, nullif(v_payload->>'id', '')::date);
            if exists (
                select 1 from public.daily_journals d
                 where d.user_id = v_user_id and d.journal_date = v_trade_date
                   and d.account_id is null
            ) then
                update public.guest_migration_items
                   set import_status = 'needs_review',
                       import_error = 'A cloud journal entry already exists for this date. It was not overwritten.'
                 where id = p_item_id and user_id = v_user_id;
                return jsonb_build_object('status', 'needs_review');
            end if;

            insert into public.daily_journals (
                user_id, journal_date, plan, review, mood, is_example, legacy_id
            ) values (
                v_user_id, v_trade_date,
                coalesce(v_payload->>'plan', ''),
                coalesce(v_payload->>'review', ''),
                case when nullif(v_payload->>'mood', '') is null then null else (v_payload->>'mood')::smallint end,
                coalesce((v_payload->>'example')::boolean, false),
                coalesce(nullif(v_payload->>'id', ''), v_item.source_record_key)
            ) returning id into v_target_id;

        elsif v_item.entity_type = 'settings' then
            update public.user_settings s
               set default_currency = coalesce(nullif(v_payload->>'currency', ''), s.default_currency),
                   default_starting_balance = coalesce(nullif(v_payload->>'balance', '')::numeric, s.default_starting_balance),
                   preferences = coalesce(s.preferences, '{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object(
                       'riskPct', nullif(v_payload->>'riskPct', '')::numeric,
                       'monthlyTarget', nullif(v_payload->>'monthlyTarget', '')::numeric,
                       'maxTradesDay', nullif(v_payload->>'maxTradesDay', '')::numeric,
                       'dailyLoss', nullif(v_payload->>'dailyLoss', '')::numeric,
                       'example', case when v_payload ? 'example' then to_jsonb(coalesce((v_payload->>'example')::boolean, false)) else null end
                   )),
                   updated_at = now()
             where s.user_id = v_user_id;
            if not found then
                raise exception 'Account settings row was not found.';
            end if;
            v_target_id := v_user_id;

        else
            update public.guest_migration_items
               set import_status = 'needs_review',
                   import_error = 'This record type requires a separate migration workflow and was not imported.'
             where id = p_item_id and user_id = v_user_id;
            return jsonb_build_object('status', 'needs_review');
        end if;

        update public.guest_migration_items
           set import_status = 'imported',
               target_record_id = v_target_id,
               imported_at = now(),
               import_error = null
         where id = p_item_id and user_id = v_user_id;

    exception when others then
        v_error := 'Import failed validation or a destination constraint. Review the record and retry after resolving the issue.';
        update public.guest_migration_items
           set import_status = 'failed',
               target_record_id = null,
               imported_at = null,
               import_error = v_error
         where id = p_item_id and user_id = v_user_id;
    end;

    update public.guest_migration_batches b
       set records_imported = (
               select count(*)::integer from public.guest_migration_items i
                where i.user_id = v_user_id and i.batch_id = p_batch_id and i.import_status = 'imported'
           ),
           records_failed = (
               select count(*)::integer from public.guest_migration_items i
                where i.user_id = v_user_id and i.batch_id = p_batch_id and i.import_status = 'failed'
           ),
           records_skipped = (
               select count(*)::integer from public.guest_migration_items i
                where i.user_id = v_user_id and i.batch_id = p_batch_id and i.import_status = 'skipped'
           ),
           updated_at = now()
     where b.id = p_batch_id and b.user_id = v_user_id;

    select * into v_item
      from public.guest_migration_items
     where id = p_item_id and user_id = v_user_id;

    return jsonb_build_object(
        'status', v_item.import_status,
        'target_record_id', v_item.target_record_id,
        'import_attempts', v_item.import_attempts
    );
end;
$function$;

revoke all on function public.import_guest_migration_item(uuid, uuid, uuid, boolean, boolean) from public, anon;
grant execute on function public.import_guest_migration_item(uuid, uuid, uuid, boolean, boolean) to authenticated;
