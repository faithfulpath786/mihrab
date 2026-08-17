-- MIHRAB — Supabase schema, indexes, trigger, RLS and self-service deletion
-- Run this entire file in Supabase Dashboard > SQL Editor before connecting the app.

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  dob date,
  mode text not null default '13solar' check (mode in ('13solar','15lunar','custom')),
  custom_puberty date,
  hayd_exclude boolean not null default false,
  cycle_days numeric not null default 29.5,
  period_days numeric not null default 7,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  lat double precision not null default 17.385,
  lng double precision not null default 78.4867,
  fajr_angle int not null default 18,
  isha_angle int not null default 18,
  asr_factor int not null default 1,
  manual_times jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.notebook_meta (
  user_id uuid primary key references auth.users(id) on delete cascade,
  started_at timestamptz
);

create table if not exists public.prayer_logs (
  user_id uuid not null references auth.users(id) on delete cascade,
  log_date date not null,
  prayer text not null check (prayer in ('fajr','dhuhr','asr','maghrib','isha')),
  status text not null check (status in ('prayed','missed','qada')),
  updated_at timestamptz not null default now(),
  primary key (user_id, log_date, prayer)
);

create index if not exists prayer_logs_user_date on public.prayer_logs (user_id, log_date desc);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id) values (new.id) on conflict do nothing;
  insert into public.settings (user_id) values (new.id) on conflict do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

alter table public.profiles enable row level security;
alter table public.settings enable row level security;
alter table public.notebook_meta enable row level security;
alter table public.prayer_logs enable row level security;

-- Re-runnable policy creation.
drop policy if exists "own profile" on public.profiles;
drop policy if exists "own settings" on public.settings;
drop policy if exists "own meta" on public.notebook_meta;
drop policy if exists "own logs" on public.prayer_logs;

create policy "own profile" on public.profiles
  for all using (auth.uid() = id) with check (auth.uid() = id);
create policy "own settings" on public.settings
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own meta" on public.notebook_meta
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own logs" on public.prayer_logs
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Allows an authenticated user to delete only their own auth row. The foreign
-- keys above cascade all profile, settings, metadata and prayer-log rows.
create or replace function public.delete_own_account()
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;
  delete from auth.users where id = auth.uid();
end;
$$;

revoke all on function public.delete_own_account() from public;
grant execute on function public.delete_own_account() to authenticated;

-- Optional but recommended for updates appearing instantly on another device.
-- Supabase may report that the table is already in the publication; that is safe.
do $$
begin
  alter publication supabase_realtime add table public.prayer_logs;
exception
  when duplicate_object then null;
end $$;
