-- allow: SIZE_OK - Initial Supabase schema/RLS/RPC migration kept together so setup is atomic and reviewable.
create extension if not exists pgcrypto;

create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  role text not null default 'user' check (role in ('user', 'admin')),
  local_progress_imported_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.invites (
  id uuid primary key default gen_random_uuid(),
  code_hash text not null unique,
  max_uses integer not null default 1 check (max_uses > 0),
  uses integer not null default 0 check (uses >= 0),
  expires_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  check (uses <= max_uses)
);

create table public.activity_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  client_event_id text not null,
  kind text not null,
  source_id text,
  xp_delta integer not null,
  occurred_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  unique (user_id, client_event_id)
);

create table public.progress_summaries (
  user_id uuid primary key references auth.users(id) on delete cascade,
  total_xp integer not null default 0 check (total_xp >= 0),
  current_streak integer not null default 0 check (current_streak >= 0),
  last_activity_date date,
  completed_count integer not null default 0 check (completed_count >= 0),
  updated_at timestamptz not null default now()
);

create table public.reward_rules (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  required_xp integer not null check (required_xp > 0),
  description text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.reward_claims (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  reward_rule_id uuid not null references public.reward_rules(id) on delete restrict,
  status text not null default 'pending' check (status in ('pending', 'approved', 'delivered', 'rejected')),
  requested_at timestamptz not null default now(),
  reviewed_at timestamptz,
  delivered_at timestamptz,
  admin_note text,
  unique (user_id, reward_rule_id)
);

create table public.ai_usage_daily (
  user_id uuid not null references auth.users(id) on delete cascade,
  usage_date date not null,
  request_count integer not null default 0 check (request_count >= 0),
  primary key (user_id, usage_date)
);

create index idx_activity_events_user_occurred_at on public.activity_events(user_id, occurred_at);
create index idx_reward_claims_status on public.reward_claims(status);
create index idx_reward_claims_user_id on public.reward_claims(user_id);
create index idx_reward_claims_reward_rule_id on public.reward_claims(reward_rule_id);
create index idx_invites_code_hash on public.invites(code_hash);
create index idx_invites_created_by on public.invites(created_by);
create index idx_ai_usage_daily_user_id on public.ai_usage_daily(user_id);

alter table public.profiles enable row level security;
alter table public.invites enable row level security;
alter table public.activity_events enable row level security;
alter table public.progress_summaries enable row level security;
alter table public.reward_rules enable row level security;
alter table public.reward_claims enable row level security;
alter table public.ai_usage_daily enable row level security;

revoke all on table public.profiles from anon, authenticated;
revoke all on table public.invites from anon, authenticated;
revoke all on table public.activity_events from anon, authenticated;
revoke all on table public.progress_summaries from anon, authenticated;
revoke all on table public.reward_rules from anon, authenticated;
revoke all on table public.reward_claims from anon, authenticated;
revoke all on table public.ai_usage_daily from anon, authenticated;

grant select on table public.profiles to authenticated;
grant select on table public.activity_events to authenticated;
grant select on table public.progress_summaries to authenticated;
grant select on table public.reward_rules to authenticated;
grant select on table public.reward_claims to authenticated;
grant select, insert, update, delete on table public.invites to authenticated;
grant update (role) on table public.profiles to authenticated;
grant update (status, reviewed_at, delivered_at, admin_note) on table public.reward_claims to authenticated;
grant select on table public.ai_usage_daily to authenticated;

create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select coalesce(
    exists (
      select 1
      from public.profiles
      where user_id = (select auth.uid())
        and role = 'admin'
    ),
    false
  );
$$;

revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;

create policy "profiles_select_own_or_admin"
on public.profiles
for select
to authenticated
using ((select auth.uid()) = user_id or public.is_admin());

create policy "profiles_admin_update_roles"
on public.profiles
for update
to authenticated
using (public.is_admin())
with check (public.is_admin());

create policy "activity_events_select_own_or_admin"
on public.activity_events
for select
to authenticated
using ((select auth.uid()) = user_id or public.is_admin());

create policy "progress_summaries_select_own_or_admin"
on public.progress_summaries
for select
to authenticated
using ((select auth.uid()) = user_id or public.is_admin());

create policy "reward_rules_select_active_or_admin"
on public.reward_rules
for select
to authenticated
using (active or public.is_admin());

create policy "reward_claims_select_own_or_admin"
on public.reward_claims
for select
to authenticated
using ((select auth.uid()) = user_id or public.is_admin());

create policy "reward_claims_admin_update"
on public.reward_claims
for update
to authenticated
using (public.is_admin())
with check (public.is_admin());

create policy "invites_admin_select"
on public.invites
for select
to authenticated
using (public.is_admin());

create policy "invites_admin_insert"
on public.invites
for insert
to authenticated
with check (public.is_admin());

create policy "invites_admin_update"
on public.invites
for update
to authenticated
using (public.is_admin())
with check (public.is_admin());

create policy "invites_admin_delete"
on public.invites
for delete
to authenticated
using (public.is_admin());

create policy "ai_usage_daily_select_own_or_admin"
on public.ai_usage_daily
for select
to authenticated
using ((select auth.uid()) = user_id or public.is_admin());

create or replace function public.record_activity(
  client_event_id text,
  kind text,
  source_id text,
  xp_delta integer,
  occurred_at timestamptz,
  metadata jsonb default '{}'::jsonb
)
returns public.progress_summaries
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := (select auth.uid());
  event_date date;
  inserted_count integer;
  updated_summary public.progress_summaries;
begin
  if current_user_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  if client_event_id is null or length(trim(client_event_id)) = 0 or length(client_event_id) > 128 then
    raise exception 'Invalid client event id' using errcode = '22023';
  end if;

  if kind is null or kind !~ '^[a-z][a-z0-9_-]{1,63}$' then
    raise exception 'Invalid activity kind' using errcode = '22023';
  end if;

  if xp_delta is null or xp_delta <= 0 or xp_delta > 100 then
    raise exception 'Invalid XP delta' using errcode = '22023';
  end if;

  if occurred_at is null or occurred_at > now() + interval '5 minutes' then
    raise exception 'Invalid occurrence time' using errcode = '22023';
  end if;

  event_date := occurred_at::date;

  insert into public.activity_events (
    user_id,
    client_event_id,
    kind,
    source_id,
    xp_delta,
    occurred_at,
    metadata
  )
  values (
    current_user_id,
    trim(client_event_id),
    kind,
    nullif(trim(source_id), ''),
    xp_delta,
    occurred_at,
    coalesce(metadata, '{}'::jsonb)
  )
  on conflict (user_id, client_event_id) do nothing;

  get diagnostics inserted_count = row_count;

  if inserted_count = 1 then
    insert into public.progress_summaries (
      user_id,
      total_xp,
      current_streak,
      last_activity_date,
      completed_count,
      updated_at
    )
    values (
      current_user_id,
      xp_delta,
      1,
      event_date,
      1,
      now()
    )
    on conflict (user_id) do update
    set
      total_xp = public.progress_summaries.total_xp + excluded.total_xp,
      -- backfill activity earns XP, but older activity must not move or reset the active streak.
      current_streak = case
        when public.progress_summaries.last_activity_date > excluded.last_activity_date then public.progress_summaries.current_streak
        when public.progress_summaries.last_activity_date = excluded.last_activity_date then public.progress_summaries.current_streak
        when public.progress_summaries.last_activity_date = excluded.last_activity_date - 1 then public.progress_summaries.current_streak + 1
        else 1
      end,
      last_activity_date = greatest(public.progress_summaries.last_activity_date, excluded.last_activity_date),
      completed_count = public.progress_summaries.completed_count + 1,
      updated_at = now();
  end if;

  select *
  into updated_summary
  from public.progress_summaries
  where user_id = current_user_id;

  return updated_summary;
end;
$$;

revoke all on function public.record_activity(text, text, text, integer, timestamptz, jsonb) from public;
grant execute on function public.record_activity(text, text, text, integer, timestamptz, jsonb) to authenticated;

create or replace function public.claim_reward(rule_id uuid)
returns public.reward_claims
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := (select auth.uid());
  selected_rule public.reward_rules;
  user_total_xp integer;
  created_claim public.reward_claims;
begin
  if current_user_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  if rule_id is null then
    raise exception 'Reward rule is required' using errcode = '22023';
  end if;

  select *
  into selected_rule
  from public.reward_rules
  where id = rule_id
    and active;

  if selected_rule.id is null then
    raise exception 'Reward is not available' using errcode = '22023';
  end if;

  select coalesce(total_xp, 0)
  into user_total_xp
  from public.progress_summaries
  where user_id = current_user_id;

  user_total_xp := coalesce(user_total_xp, 0);

  if user_total_xp < selected_rule.required_xp then
    raise exception 'Not enough XP for this reward' using errcode = '22023';
  end if;

  insert into public.reward_claims (
    user_id,
    reward_rule_id,
    status,
    requested_at
  )
  values (
    current_user_id,
    selected_rule.id,
    'pending',
    now()
  )
  on conflict (user_id, reward_rule_id) do nothing
  returning *
  into created_claim;

  if created_claim.id is null then
    raise exception 'Reward already claimed' using errcode = '23505';
  end if;

  return created_claim;
end;
$$;

revoke all on function public.claim_reward(uuid) from public;
grant execute on function public.claim_reward(uuid) to authenticated;

create or replace function public.reserve_invite(invite_code_hash text)
returns public.invites
language plpgsql
security definer
set search_path = public
as $$
declare
  updated_invite public.invites;
begin
  if invite_code_hash is null or length(invite_code_hash) <> 64 then
    raise exception 'Invite code hash is required' using errcode = '22023';
  end if;

  update public.invites
  set uses = uses + 1
  where code_hash = invite_code_hash
    and uses < max_uses
    and (expires_at is null or expires_at > now())
  returning *
  into updated_invite;

  if updated_invite.id is null then
    raise exception 'Invite is not available' using errcode = '22023';
  end if;

  return updated_invite;
end;
$$;

revoke all on function public.reserve_invite(text) from public;
grant execute on function public.reserve_invite(text) to service_role;

create or replace function public.release_invite(invite_id uuid)
returns public.invites
language plpgsql
security definer
set search_path = public
as $$
declare
  updated_invite public.invites;
begin
  if invite_id is null then
    raise exception 'Invite is required' using errcode = '22023';
  end if;

  update public.invites
  set uses = greatest(uses - 1, 0)
  where id = invite_id
  returning *
  into updated_invite;

  if updated_invite.id is null then
    raise exception 'Invite is not available' using errcode = '22023';
  end if;

  return updated_invite;
end;
$$;

revoke all on function public.release_invite(uuid) from public;
grant execute on function public.release_invite(uuid) to service_role;

create or replace function public.reserve_ai_usage(
  usage_date date,
  user_limit integer,
  global_limit integer
)
returns public.ai_usage_daily
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := (select auth.uid());
  global_count integer;
  updated_usage public.ai_usage_daily;
begin
  if current_user_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  if usage_date is null or user_limit is null or user_limit < 1 or global_limit is null or global_limit < 1 then
    raise exception 'Invalid AI usage limit' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('ai_usage:' || usage_date::text));

  select coalesce(sum(request_count), 0)
  into global_count
  from public.ai_usage_daily
  where ai_usage_daily.usage_date = reserve_ai_usage.usage_date;

  if coalesce(global_count, 0) >= global_limit then
    raise exception 'AI usage limit reached' using errcode = '22023';
  end if;

  insert into public.ai_usage_daily (user_id, usage_date, request_count)
  values (current_user_id, usage_date, 1)
  on conflict (user_id, usage_date) do update
  set request_count = public.ai_usage_daily.request_count + 1
  where public.ai_usage_daily.request_count < user_limit
    and global_count < global_limit
  returning *
  into updated_usage;

  if updated_usage.user_id is null then
    raise exception 'AI usage limit reached' using errcode = '22023';
  end if;

  return updated_usage;
end;
$$;

revoke all on function public.reserve_ai_usage(date, integer, integer) from public;
grant execute on function public.reserve_ai_usage(date, integer, integer) to authenticated;

insert into public.reward_rules (id, title, required_xp, description, active)
values
  ('11111111-1111-4111-8111-111111111111', '500 XP Coffee coupon', 500, 'Entry/manual review', true),
  ('22222222-2222-4222-8222-222222222222', '1000 XP Coffee coupon', 1000, 'Manual delivery', true),
  ('33333333-3333-4333-8333-333333333333', '2000 XP Bigger treat', 2000, 'Manual delivery', true)
on conflict (id) do update
set
  title = excluded.title,
  required_xp = excluded.required_xp,
  description = excluded.description,
  active = excluded.active;
