-- Phase 3: atomic playbook deletion that preserves linked trade history.
-- Apply this migration in the Supabase SQL Editor before enabling cloud CRUD.
-- This is a new migration; do not rerun 001_initial_schema.sql.

create or replace function public.delete_playbook_preserve_trades(p_playbook_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
    v_user_id uuid := auth.uid();
    v_legacy_id text;
begin
    if v_user_id is null then
        raise exception 'Authentication is required.';
    end if;

    select p.legacy_id
      into v_legacy_id
      from public.playbooks p
     where p.id = p_playbook_id
       and p.user_id = v_user_id
     for update;

    if not found then
        return;
    end if;

    update public.trades t
       set playbook_id = null,
           notes = (
               case
                   when jsonb_typeof(t.notes) = 'object' then t.notes
                   else '{}'::jsonb
               end
           ) || jsonb_build_object(
               'playbook_legacy_id',
               coalesce(v_legacy_id, p_playbook_id::text)
           )
     where t.user_id = v_user_id
       and t.playbook_id = p_playbook_id;

    delete from public.playbooks p
     where p.id = p_playbook_id
       and p.user_id = v_user_id;
end;
$$;

revoke all on function public.delete_playbook_preserve_trades(uuid) from public, anon;
grant execute on function public.delete_playbook_preserve_trades(uuid) to authenticated;
