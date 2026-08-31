-- Phase 2: run this in the Supabase SQL editor once you're ready to move
-- off localStorage and sync data between your phone, your brother's phone,
-- and the web. One row per record, one table per module — mirrors the
-- shape already used in src/App.jsx, so switching storage.js over to
-- Supabase calls is a mechanical change, not a rewrite.

create table records (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null,
  collection text not null,       -- 'progress' | 'expenses' | 'permissions' | ...
  data jsonb not null,            -- the record itself, same shape as today
  created_at timestamptz default now()
);

create table projects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz default now()
);

create table project_members (
  project_id uuid references projects(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  role text default 'editor',
  primary key (project_id, user_id)
);

-- Row Level Security: only members of a project can read/write its records.
alter table records enable row level security;
alter table project_members enable row level security;

create policy "members can read their project's records"
  on records for select
  using (
    project_id in (select project_id from project_members where user_id = auth.uid())
  );

create policy "members can write their project's records"
  on records for insert
  with check (
    project_id in (select project_id from project_members where user_id = auth.uid())
  );

-- Photos go in Supabase Storage (a "gallery" bucket), not this table —
-- store the storage path in data.photoPath instead of a base64 blob.
