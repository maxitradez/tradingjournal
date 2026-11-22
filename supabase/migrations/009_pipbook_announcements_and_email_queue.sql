create table if not exists public.announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(btrim(title)) between 4 and 120),
  message text not null check (char_length(btrim(message)) between 10 and 5000),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  published_at timestamptz not null default now(),
  archived_at timestamptz,
  email_status text not null default 'pending' check (email_status in ('pending','sending','completed','completed_with_errors')),
  email_total integer not null default 0 check (email_total >= 0),
  email_sent integer not null default 0 check (email_sent >= 0),
  email_failed integer not null default 0 check (email_failed >= 0)
);
create index if not exists announcements_published_idx on public.announcements (published_at desc) where archived_at is null;
create table if not exists public.announcement_reads (
  announcement_id uuid not null references public.announcements(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  read_at timestamptz not null default now(),
  primary key (announcement_id, user_id)
);
create index if not exists announcement_reads_user_idx on public.announcement_reads (user_id, read_at desc);
create table if not exists public.announcement_email_queue (
  id uuid primary key default gen_random_uuid(),
  announcement_id uuid not null references public.announcements(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  recipient_email text not null,
  status text not null default 'queued' check (status in ('queued','sending','sent','failed')),
  attempts integer not null default 0 check (attempts >= 0),
  last_error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  unique (announcement_id, user_id)
);
create index if not exists announcement_email_queue_batch_idx on public.announcement_email_queue (announcement_id, status, created_at);
alter table public.announcements enable row level security;
alter table public.announcement_reads enable row level security;
alter table public.announcement_email_queue enable row level security;
revoke all on public.announcements from anon, authenticated;
revoke all on public.announcement_reads from anon, authenticated;
revoke all on public.announcement_email_queue from anon, authenticated;
grant all on public.announcements to service_role;
grant all on public.announcement_reads to service_role;
grant all on public.announcement_email_queue to service_role;