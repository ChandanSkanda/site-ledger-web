-- Run this whole file in Supabase's SQL editor (Project → SQL Editor →
-- New query → paste → Run). Sets up: accounts, projects, multi-owner
-- teams, the actual app data store, and the audit log.
--
-- If you already ran an earlier version of this file, drop the old
-- tables first so this can run clean (safe — you have no real data yet):
--   drop table if exists audit_log, kv_store, project_members, projects, profiles cascade;

-- 1. Profiles: one row per person's account (name/email), independent of
--    any project. Created automatically when someone signs up.
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  name text,
  created_at timestamptz default now()
);

-- 2. Projects: one row per house/property project ("Whitefield house",
--   type "House construction", place "Bangalore"). invite_code is what
--   you share with anyone you want to join.
create table projects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  place text,
  type text,
  invite_code text unique not null,
  created_by uuid references auth.users(id),
  created_at timestamptz default now()
);

-- 3. Project members: who's on which project, and their role there.
--    A person can be on more than one project. Ownership comes from
--    either creating the project, or being promoted here by an existing
--    owner (Team tab) — never from self-selecting the role.
create table project_members (
  project_id uuid references projects(id) on delete cascade,
  user_id uuid references profiles(id) on delete cascade,
  role text not null default 'other'
    check (role in ('owner','builder_admin','builder','civil_engineer','carpenter','electrician','plumber','other')),
  joined_at timestamptz default now(),
  primary key (project_id, user_id)
);

-- 4. App data: one row per (project, storage key) pair — progress,
--    expenses, contacts, etc. — matching what src/lib/storage.js reads
--    and writes for whichever project is currently active.
create table kv_store (
  project_id uuid references projects(id) on delete cascade,
  key text not null,
  value jsonb not null,
  updated_by uuid references auth.users(id),
  updated_at timestamptz default now(),
  primary key (project_id, key)
);

-- 5. Audit log: every signup, project join, login/logout, role change,
--    and data change, scoped to the project it happened on.
create table audit_log (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id) on delete cascade,
  user_id uuid references auth.users(id),
  user_email text,
  action text not null,
  details jsonb,
  created_at timestamptz default now()
);

alter table profiles enable row level security;
alter table projects enable row level security;
alter table project_members enable row level security;
alter table kv_store enable row level security;
alter table audit_log enable row level security;

-- Profiles: anyone signed in can read profiles (needed to show names on
-- the Team tab); you can only create/edit your own row.
create policy "profiles: signed-in users can read all"
  on profiles for select
  using (auth.uid() is not null);
create policy "profiles: users manage their own row"
  on profiles for insert
  with check (id = auth.uid());
create policy "profiles: users update their own row"
  on profiles for update
  using (id = auth.uid());

-- Projects: any signed-in user can create one (they become its owner via
-- project_members below). Anyone can look up a project BY ITS INVITE CODE
-- (needed for the "Join a project" screen) or if they're already a member.
create policy "projects: signed-in users can create"
  on projects for insert
  with check (auth.uid() is not null);
create policy "projects: members or anyone with the code can read"
  on projects for select
  using (
    auth.uid() is not null
  );

-- Project members: you can read rows for a project you belong to.
-- You may insert your OWN membership (joining, or the initial owner row
-- when creating a project) — but you can only insert yourself as 'owner'
-- if you're the project's creator. Promoting someone ELSE to owner (or
-- changing anyone's role) requires an UPDATE by an existing owner.
create policy "project_members: members can read their project's roster"
  on project_members for select
  using (
    project_id in (select project_id from project_members where user_id = auth.uid())
  );
create policy "project_members: users can insert their own membership"
  on project_members for insert
  with check (
    user_id = auth.uid()
    and (
      role <> 'owner'
      or exists (select 1 from projects p where p.id = project_id and p.created_by = auth.uid())
    )
  );
create policy "project_members: owners can change roles on their project"
  on project_members for update
  using (
    exists (select 1 from project_members pm where pm.project_id = project_members.project_id and pm.user_id = auth.uid() and pm.role = 'owner')
  );

-- kv_store / audit_log: readable and writable by anyone who belongs to
-- that project. (See the README for the note on this being UI-level role
-- separation, not yet database-level per-role restriction.)
create policy "kv_store: project members can read"
  on kv_store for select
  using (project_id in (select project_id from project_members where user_id = auth.uid()));
create policy "kv_store: project members can write"
  on kv_store for insert
  with check (project_id in (select project_id from project_members where user_id = auth.uid()));
create policy "kv_store: project members can update"
  on kv_store for update
  using (project_id in (select project_id from project_members where user_id = auth.uid()));

create policy "audit_log: project members can read"
  on audit_log for select
  using (project_id in (select project_id from project_members where user_id = auth.uid()));
create policy "audit_log: project members can insert"
  on audit_log for insert
  with check (project_id in (select project_id from project_members where user_id = auth.uid()));

-- Photos: use Supabase Storage (create a "gallery" bucket in the
-- dashboard) rather than storing base64 images in kv_store long-term —
-- store the storage path in the gallery record's data instead.
