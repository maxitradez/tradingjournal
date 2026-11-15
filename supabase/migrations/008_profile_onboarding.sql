-- Maxi Trades Journal: user profile and onboarding fields
-- Apply once in the Supabase SQL Editor.
alter table public.profiles
  add column if not exists username text,
  add column if not exists country text,
  add column if not exists experience_level text,
  add column if not exists trading_style text,
  add column if not exists preferred_markets text[] not null default '{}',
  add column if not exists timezone text not null default 'UTC',
  add column if not exists onboarding_completed boolean not null default false;

create unique index if not exists profiles_username_unique
  on public.profiles (lower(username))
  where username is not null and username <> '';

alter table public.profiles
  drop constraint if exists profiles_experience_level_check;
alter table public.profiles
  add constraint profiles_experience_level_check
  check (experience_level is null or experience_level in ('beginner','intermediate','advanced','professional'));

alter table public.profiles
  drop constraint if exists profiles_trading_style_check;
alter table public.profiles
  add constraint profiles_trading_style_check
  check (trading_style is null or trading_style in ('scalping','day_trading','swing','position','investing','other'));
