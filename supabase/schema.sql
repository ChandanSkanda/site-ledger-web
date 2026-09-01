-- Run this whole file in Supabase's SQL editor once (Project → SQL Editor
-- → New query → paste → Run). Sets up: accounts/roles, the actual app
-- data store, and the audit log.

-- 1. Profiles: one row per person you invite, with their role.
--    Rows here are created manually by you (the owner), not by signup —
--    see the README for the exact steps.
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  name text,
  role text not null default 'member' check (role in ('owner','member')),
  created_at timestamptz default now()
);

-- 2. App data: one row per storage key (progress, expenses, contacts...),
--    matching exactly what src/lib/storage.js reads and writes.
create table kv_store (
  key text primary key,
  value jsonb not null,
  updated_by uuid references auth.users(id),
  updated_at timestamptz default now()
);

-- 3. Audit log: every login, logout, and data change.
create table audit_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id),
  user_email text,
  action text not null,
  details jsonb,
  created_at timestamptz default now()
);

alter table profiles enable row level security;
alter table kv_store enable row level security;
alter table audit_log enable row level security;

-- Anyone who has a profiles row (i.e. anyone you've invited) can read
-- and write the shared app data and audit log. This is deliberately
-- simple for a two-person household project — no per-record ownership.
create policy "profiles: invited users can read all profiles"
  on profiles for select
  using (exists (select 1 from profiles p where p.id = auth.uid()));

create policy "kv_store: invited users can read"
  on kv_store for select
  using (exists (select 1 from profiles where id = auth.uid()));

create policy "kv_store: invited users can write"
  on kv_store for insert
  with check (exists (select 1 from profiles where id = auth.uid()));

create policy "kv_store: invited users can update"
  on kv_store for update
  using (exists (select 1 from profiles where id = auth.uid()));

create policy "audit_log: invited users can read"
  on audit_log for select
  using (exists (select 1 from profiles where id = auth.uid()));

create policy "audit_log: invited users can insert"
  on audit_log for insert
  with check (exists (select 1 from profiles where id = auth.uid()));

-- Photos: use Supabase Storage (create a "gallery" bucket in the
-- dashboard) rather than storing base64 images in kv_store long-term —
-- store the storage path in the gallery record's data instead.
