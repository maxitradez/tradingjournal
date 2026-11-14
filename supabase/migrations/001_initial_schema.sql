-- ============================================================
-- MAXI TRADES JOURNAL
-- Supabase / PostgreSQL 17
-- Initial database foundation
--
-- Migration: 001_initial_schema.sql
-- Applied to the development Supabase project on 2026-11-14.
--
-- IMPORTANT:
-- This is the initial setup migration for a fresh project.
-- It creates the schema, policies, triggers and private bucket.
-- Do not blindly rerun against a populated or modified database.
-- ============================================================

create extension if not exists pgcrypto;

-- 1. USER PROFILES
create table if not exists public.profiles (
    id uuid primary key references auth.users(id) on delete cascade,
    display_name text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

-- 2. USER SETTINGS
create table if not exists public.user_settings (
    user_id uuid primary key references auth.users(id) on delete cascade,
    default_currency text not null default 'USD',
    default_starting_balance numeric(20,8),
    timezone text not null default 'UTC',
    preferences jsonb not null default '{}'::jsonb,
    is_example boolean not null default false,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

-- 3. TRADING ACCOUNTS
create table if not exists public.trading_accounts (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    account_name text not null,
    account_type text not null default 'live',
    broker text,
    platform text,
    currency text not null default 'USD',
    starting_balance numeric(20,8) not null default 0,
    is_default boolean not null default false,
    is_archived boolean not null default false,
    notes text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (user_id, id)
);

create unique index if not exists one_default_account_per_user
on public.trading_accounts (user_id)
where is_default = true;

-- 4. ASSET CLASSES
create table if not exists public.asset_classes (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    name text not null,
    description text,
    is_archived boolean not null default false,
    is_example boolean not null default false,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (user_id, id),
    unique (user_id, name)
);

-- 5. INSTRUMENT TYPES
create table if not exists public.instrument_types (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    name text not null,
    description text,
    is_archived boolean not null default false,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (user_id, id),
    unique (user_id, name)
);

-- 6. INSTRUMENTS
create table if not exists public.instruments (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    asset_class_id uuid not null,
    instrument_type_id uuid not null,
    symbol text not null,
    display_name text,
    broker_symbol text,
    base_currency text,
    quote_currency text,
    is_archived boolean not null default false,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (user_id, id),
    foreign key (user_id, asset_class_id)
        references public.asset_classes(user_id, id) on delete restrict,
    foreign key (user_id, instrument_type_id)
        references public.instrument_types(user_id, id) on delete restrict
);

create unique index if not exists instruments_unique_symbol_per_class
on public.instruments (user_id, asset_class_id, lower(symbol));

-- 7. PLAYBOOKS
create table if not exists public.playbooks (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    name text not null,
    description text,
    rules jsonb not null default '[]'::jsonb,
    is_archived boolean not null default false,
    is_example boolean not null default false,
    legacy_id text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (user_id, id)
);

create unique index if not exists playbooks_legacy_id_unique
on public.playbooks (user_id, legacy_id)
where legacy_id is not null;

-- 8. TRADES
create table if not exists public.trades (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    account_id uuid,
    asset_class_id uuid,
    instrument_id uuid,
    playbook_id uuid,

    instrument_symbol text not null default 'UNKNOWN',
    trade_date date not null,
    trade_time time without time zone,
    timezone text,
    executed_at timestamptz,

    side text not null,
    status text not null default 'closed',

    entry_price numeric(24,10),
    stop_loss numeric(24,10),
    take_profit numeric(24,10),
    exit_price numeric(24,10),
    quantity numeric(24,10),

    gross_pnl numeric(20,8),
    commission numeric(20,8),
    swap numeric(20,8),
    fees numeric(20,8),
    net_pnl numeric(20,8),

    risk_amount numeric(20,8),
    risk_percent numeric(12,6),
    r_multiple numeric(16,8),

    emotion text,
    followed_rules boolean,
    misses jsonb not null default '[]'::jsonb,
    mistakes jsonb not null default '[]'::jsonb,
    lesson text,

    screenshot_reference text,
    is_example boolean not null default false,
    legacy_id text,
    source text not null default 'manual',
    notes jsonb not null default '{}'::jsonb,

    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),

    unique (user_id, id),

    constraint trades_side_check
        check (lower(side) in ('long', 'short', 'buy', 'sell')),

    constraint trades_status_check
        check (lower(status) in ('open', 'closed', 'cancelled')),

    foreign key (user_id, account_id)
        references public.trading_accounts(user_id, id) on delete restrict,

    foreign key (user_id, asset_class_id)
        references public.asset_classes(user_id, id) on delete restrict,

    foreign key (user_id, instrument_id)
        references public.instruments(user_id, id) on delete restrict,

    foreign key (user_id, playbook_id)
        references public.playbooks(user_id, id) on delete restrict
);

create index if not exists trades_user_date_idx
on public.trades (user_id, trade_date desc);

create index if not exists trades_account_date_idx
on public.trades (user_id, account_id, trade_date desc);

create index if not exists trades_instrument_idx
on public.trades (user_id, instrument_id);

create unique index if not exists trades_legacy_id_unique
on public.trades (user_id, legacy_id)
where legacy_id is not null;

-- 9. DAILY JOURNALS
create table if not exists public.daily_journals (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    account_id uuid,
    journal_date date not null,
    plan text,
    review text,
    mood smallint,
    is_example boolean not null default false,
    legacy_id text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),

    foreign key (user_id, account_id)
        references public.trading_accounts(user_id, id) on delete restrict,

    constraint daily_journals_mood_check
        check (mood is null or mood between 1 and 5)
);

create unique index if not exists daily_journals_unique_day
on public.daily_journals (
    user_id,
    journal_date,
    (coalesce(account_id, '00000000-0000-0000-0000-000000000000'::uuid))
);

-- 10. ATTACHMENTS
create table if not exists public.attachments (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    trade_id uuid,
    storage_bucket text not null default 'trade-screenshots',
    storage_path text not null,
    file_name text,
    mime_type text,
    file_size bigint,
    created_at timestamptz not null default now(),

    unique (storage_bucket, storage_path),

    foreign key (user_id, trade_id)
        references public.trades(user_id, id) on delete restrict,

    constraint attachment_file_size_check
        check (file_size is null or file_size >= 0)
);

create index if not exists attachments_trade_idx
on public.attachments (user_id, trade_id);

-- 11. ACCOUNT SNAPSHOTS
create table if not exists public.account_snapshots (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    account_id uuid not null,
    snapshot_at timestamptz not null default now(),
    balance numeric(20,8),
    equity numeric(20,8),
    drawdown_amount numeric(20,8),
    drawdown_percent numeric(12,6),
    notes text,
    created_at timestamptz not null default now(),

    foreign key (user_id, account_id)
        references public.trading_accounts(user_id, id) on delete restrict
);

create index if not exists account_snapshots_history_idx
on public.account_snapshots (user_id, account_id, snapshot_at desc);

-- 12. IMPORT BATCHES
create table if not exists public.import_batches (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    source text not null default 'manual',
    file_name text,
    status text not null default 'pending',
    records_seen integer not null default 0,
    records_imported integer not null default 0,
    records_skipped integer not null default 0,
    error_details jsonb not null default '[]'::jsonb,
    created_at timestamptz not null default now(),
    completed_at timestamptz,

    constraint import_status_check
        check (status in ('pending', 'processing', 'completed', 'failed'))
);

-- Keep trade asset class consistent with its selected instrument.
create or replace function public.validate_trade_instrument()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
    instrument_class_id uuid;
begin
    if new.instrument_id is not null then
        select i.asset_class_id
        into instrument_class_id
        from public.instruments i
        where i.id = new.instrument_id
          and i.user_id = new.user_id;

        if instrument_class_id is null then
            raise exception 'Instrument not found for this user.';
        end if;

        if new.asset_class_id is null then
            new.asset_class_id := instrument_class_id;
        elsif new.asset_class_id <> instrument_class_id then
            raise exception 'Trade asset class must match the instrument asset class.';
        end if;
    end if;

    return new;
end;
$$;

drop trigger if exists trades_validate_instrument on public.trades;

create trigger trades_validate_instrument
before insert or update of instrument_id, asset_class_id, user_id
on public.trades
for each row execute function public.validate_trade_instrument();

-- Automatically maintain updated_at.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
    new.updated_at = now();
    return new;
end;
$$;

do $$
declare
    table_name text;
begin
    foreach table_name in array array[
        'profiles',
        'user_settings',
        'trading_accounts',
        'asset_classes',
        'instrument_types',
        'instruments',
        'playbooks',
        'trades',
        'daily_journals'
    ]
    loop
        execute format(
            'drop trigger if exists set_updated_at on public.%I',
            table_name
        );
        execute format(
            'create trigger set_updated_at before update on public.%I
             for each row execute function public.set_updated_at()',
            table_name
        );
    end loop;
end;
$$;

-- Create a profile, settings and starter catalog for each new signup.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    insert into public.profiles (id, display_name)
    values (
        new.id,
        coalesce(new.raw_user_meta_data ->> 'full_name', new.email)
    )
    on conflict (id) do nothing;

    insert into public.user_settings (user_id)
    values (new.id)
    on conflict (user_id) do nothing;

    insert into public.asset_classes (user_id, name)
    values
        (new.id, 'Forex'),
        (new.id, 'Commodities'),
        (new.id, 'Indices'),
        (new.id, 'Stocks'),
        (new.id, 'ETFs'),
        (new.id, 'Cryptocurrency'),
        (new.id, 'Futures'),
        (new.id, 'Options'),
        (new.id, 'Bonds'),
        (new.id, 'Other')
    on conflict (user_id, name) do nothing;

    insert into public.instrument_types (user_id, name)
    values
        (new.id, 'Currency Pair'),
        (new.id, 'Spot'),
        (new.id, 'CFD'),
        (new.id, 'Futures Contract'),
        (new.id, 'Option'),
        (new.id, 'Share'),
        (new.id, 'ETF'),
        (new.id, 'Perpetual Contract'),
        (new.id, 'Other')
    on conflict (user_id, name) do nothing;

    return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- Enable Row Level Security on every user-owned table.
alter table public.profiles enable row level security;
alter table public.user_settings enable row level security;
alter table public.trading_accounts enable row level security;
alter table public.asset_classes enable row level security;
alter table public.instrument_types enable row level security;
alter table public.instruments enable row level security;
alter table public.playbooks enable row level security;
alter table public.trades enable row level security;
alter table public.daily_journals enable row level security;
alter table public.attachments enable row level security;
alter table public.account_snapshots enable row level security;
alter table public.import_batches enable row level security;

-- Policies: profiles
drop policy if exists "Profiles select own" on public.profiles;
create policy "Profiles select own" on public.profiles
for select to authenticated
using (id = (select auth.uid()));

drop policy if exists "Profiles update own" on public.profiles;
create policy "Profiles update own" on public.profiles
for update to authenticated
using (id = (select auth.uid()))
with check (id = (select auth.uid()));

-- Policies: user_settings
drop policy if exists "Settings own access" on public.user_settings;
create policy "Settings own access" on public.user_settings
for all to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

-- Policies: all other user-owned tables
do $$
declare
    table_name text;
begin
    foreach table_name in array array[
        'trading_accounts',
        'asset_classes',
        'instrument_types',
        'instruments',
        'playbooks',
        'trades',
        'daily_journals',
        'attachments',
        'account_snapshots',
        'import_batches'
    ]
    loop
        execute format(
            'drop policy if exists %I on public.%I',
            'Owner access',
            table_name
        );
        execute format(
            'create policy %I on public.%I
             for all to authenticated
             using (user_id = (select auth.uid()))
             with check (user_id = (select auth.uid()))',
            'Owner access',
            table_name
        );
    end loop;
end;
$$;

-- Private screenshot storage bucket.
insert into storage.buckets (
    id,
    name,
    public,
    file_size_limit,
    allowed_mime_types
)
values (
    'trade-screenshots',
    'trade-screenshots',
    false,
    10485760,
    array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set
    public = false,
    file_size_limit = 10485760,
    allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];

-- Storage access: users can only access files in their own first-level folder.
drop policy if exists "Users read own trade screenshots" on storage.objects;
create policy "Users read own trade screenshots"
on storage.objects for select to authenticated
using (
    bucket_id = 'trade-screenshots'
    and (storage.foldername(name))[1] = (select auth.uid())::text
);

drop policy if exists "Users upload own trade screenshots" on storage.objects;
create policy "Users upload own trade screenshots"
on storage.objects for insert to authenticated
with check (
    bucket_id = 'trade-screenshots'
    and (storage.foldername(name))[1] = (select auth.uid())::text
);

drop policy if exists "Users update own trade screenshots" on storage.objects;
create policy "Users update own trade screenshots"
on storage.objects for update to authenticated
using (
    bucket_id = 'trade-screenshots'
    and (storage.foldername(name))[1] = (select auth.uid())::text
)
with check (
    bucket_id = 'trade-screenshots'
    and (storage.foldername(name))[1] = (select auth.uid())::text
);

drop policy if exists "Users delete own trade screenshots" on storage.objects;
create policy "Users delete own trade screenshots"
on storage.objects for delete to authenticated
using (
    bucket_id = 'trade-screenshots'
    and (storage.foldername(name))[1] = (select auth.uid())::text
);

-- ============================================================
-- END OF INITIAL DATABASE FOUNDATION
-- ============================================================
