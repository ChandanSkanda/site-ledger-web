-- Fixes "infinite recursion detected in policy for relation project_members".
-- The original policy checked project_members by querying project_members
-- itself, which Postgres can refuse to evaluate. This replaces that
-- self-check with a small helper function instead — same security intent,
-- no recursion. Safe to run on top of your existing data.

create or replace function public.is_member_of(p_project_id uuid, p_user_id uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1 from project_members
    where project_id = p_project_id and user_id = p_user_id
  );
$$;

create or replace function public.is_owner_of(p_project_id uuid, p_user_id uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1 from project_members
    where project_id = p_project_id and user_id = p_user_id and role = 'owner'
  );
$$;

drop policy if exists "project_members: members can read their project's roster" on project_members;
create policy "project_members: members can read their project's roster"
  on project_members for select
  using (is_member_of(project_id, auth.uid()));

drop policy if exists "project_members: owners can change roles on their project" on project_members;
create policy "project_members: owners can change roles on their project"
  on project_members for update
  using (is_owner_of(project_id, auth.uid()));

drop policy if exists "kv_store: project members can read" on kv_store;
create policy "kv_store: project members can read"
  on kv_store for select
  using (is_member_of(project_id, auth.uid()));

drop policy if exists "kv_store: project members can write" on kv_store;
create policy "kv_store: project members can write"
  on kv_store for insert
  with check (is_member_of(project_id, auth.uid()));

drop policy if exists "kv_store: project members can update" on kv_store;
create policy "kv_store: project members can update"
  on kv_store for update
  using (is_member_of(project_id, auth.uid()));

drop policy if exists "audit_log: project members can read" on audit_log;
create policy "audit_log: project members can read"
  on audit_log for select
  using (is_member_of(project_id, auth.uid()));

drop policy if exists "audit_log: project members can insert" on audit_log;
create policy "audit_log: project members can insert"
  on audit_log for insert
  with check (is_member_of(project_id, auth.uid()));
