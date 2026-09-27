-- schema.sql — run this in Supabase (SQL Editor) once.
-- Stores submissions (pending until the sender confirms), pull requests,
-- and the blocklist of people who opted out.

create table if not exists hint_submissions (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  sender_name   text not null,
  sender_email  text not null,
  occasion      text not null check (occasion in ('christmas','birthday','other')),
  recipients    jsonb not null,          -- ["ana@example.com", ...] (blocklist already filtered out)
  raw_sections  jsonb not null,          -- {needs, wants, likes} — private!
  masked_hints  jsonb not null,          -- what recipients receive (after sender's edits)
  special_notes text,
  token         text not null unique,    -- one-time confirmation token
  status        text not null default 'pending' check (status in ('pending','sent','failed')),
  expires_at    timestamptz not null,    -- confirmation link validity (48 h)
  sent_count    int not null default 0
);

create index if not exists idx_submissions_token on hint_submissions (token);

create table if not exists hint_requests (
  id             uuid primary key default gen_random_uuid(),
  created_at     timestamptz not null default now(),
  requester_name text not null,
  requester_email text,
  target_email   text not null,
  occasion       text not null check (occasion in ('christmas','birthday','other'))
);

-- Already created the table with an older schema.sql? This adds the new column.
alter table hint_requests add column if not exists requester_email text;

-- People who never want to receive Hint & Seek emails again.
-- Checked before EVERY send (hints, invites).
create table if not exists blocklist (
  email      text primary key,
  created_at timestamptz not null default now()
);

-- Keep these tables private: the site talks to them only through the
-- service key on the server. Row Level Security stays ON with no public policies.
alter table hint_submissions enable row level security;
alter table hint_requests    enable row level security;
alter table blocklist        enable row level security;

-- ---------------------------------------------------------------------------
-- Rate limiting (per IP, used by lib/ratelimit.js).
-- Only an HMAC hash of the IP is stored, never the IP itself.
-- ---------------------------------------------------------------------------
create table if not exists rate_limits (
  key          text primary key,          -- "<bucket>:<hashed ip>"
  window_start timestamptz not null default now(),
  hits         int not null default 0
);
alter table rate_limits enable row level security;

-- Counts one hit and returns true if the caller is still under the limit.
-- Atomic (single upsert), so parallel requests can't sneak past the limit.
create or replace function hit_rate_limit(p_key text, p_window_seconds int, p_max int)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hits int;
begin
  insert into rate_limits as r (key, window_start, hits)
  values (p_key, now(), 1)
  on conflict (key) do update
    set hits = case when r.window_start < now() - make_interval(secs => p_window_seconds)
                    then 1 else r.hits + 1 end,
        window_start = case when r.window_start < now() - make_interval(secs => p_window_seconds)
                    then now() else r.window_start end
  returning hits into v_hits;
  return v_hits <= p_max;
end;
$$;

-- Only the server (service key) may call it.
revoke all on function hit_rate_limit(text, int, int) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Analytics (privacy-friendly, written by lib/analytics.js).
-- No cookies, IPs, emails, names, wishes or hints — only an event name and
-- a few counts/labels in props. Kept for 13 months (see cleanup below).
-- Events: page_view {view, source}, mask_ok, mask_failed, give_submitted
-- {recipients, hints, exact, generated, kept, edited, deleted, added},
-- hints_sent {sent}, get_submitted, feedback_sent {type}.
-- ---------------------------------------------------------------------------
create table if not exists analytics_events (
  id         bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  event      text not null,
  props      jsonb not null default '{}'::jsonb
);
create index if not exists idx_analytics_created on analytics_events (created_at);
alter table analytics_events enable row level security;

-- Ready-made summaries — open them in Supabase → Table Editor (or SQL: select * from ...).
-- security_invoker keeps them private like the tables underneath.

-- How many of each event per day.
create or replace view analytics_daily with (security_invoker = true) as
select date_trunc('day', created_at)::date as day, event, count(*) as total
from analytics_events
group by 1, 2
order by 1 desc, 2;

-- Page views per day and view (landing, give, preview, get, success).
create or replace view analytics_page_views with (security_invoker = true) as
select date_trunc('day', created_at)::date as day,
       props->>'view'   as view,
       props->>'source' as source,
       count(*) as views
from analytics_events
where event = 'page_view'
group by 1, 2, 3
order by 1 desc, 2, 3;

-- How much senders change the AI hints, per week.
-- edit_rate = share of AI hints that were edited or deleted before sending.
create or replace view analytics_ai_edits with (security_invoker = true) as
select date_trunc('week', created_at)::date as week,
       count(*)                                  as submissions,
       sum((props->>'generated')::int)           as ai_hints,
       sum((props->>'kept')::int)                as kept,
       sum((props->>'edited')::int)              as edited,
       sum((props->>'deleted')::int)             as deleted,
       sum((props->>'added')::int)               as added_by_hand,
       round(100.0 * sum((props->>'edited')::int + (props->>'deleted')::int)
             / nullif(sum((props->>'generated')::int), 0), 1) as edit_rate_pct
from analytics_events
where event = 'give_submitted'
group by 1
order by 1 desc;

-- ---------------------------------------------------------------------------
-- Cleanup job: runs every night at 03:17 UTC.
--   * pending submissions whose 48 h link expired → deleted (they hold private wishes)
--   * failed submissions older than 7 days        → deleted
--   * raw wishes of sent/failed submissions       → erased (only needed until sending)
--   * sent submissions + invite requests > 90 days → deleted
--   * rate-limit rows older than 1 day            → deleted
--   * analytics events older than 13 months       → deleted
-- These periods are promised in privacy.html — change both together.
-- Requires the pg_cron extension (free on Supabase; enabled by the line below,
-- or via Dashboard → Database → Extensions → pg_cron).
-- ---------------------------------------------------------------------------
create extension if not exists pg_cron;

create or replace function cleanup_old_rows()
returns void
language sql
security definer
set search_path = public
as $$
  delete from hint_submissions where status = 'pending' and expires_at < now();
  delete from hint_submissions where status = 'failed'  and created_at < now() - interval '7 days';
  update hint_submissions set raw_sections = '{}'::jsonb
    where status in ('sent','failed') and raw_sections <> '{}'::jsonb;
  delete from hint_submissions where status = 'sent'    and created_at < now() - interval '90 days';
  delete from hint_requests    where created_at < now() - interval '90 days';
  delete from rate_limits      where window_start < now() - interval '1 day';
  delete from analytics_events where created_at   < now() - interval '13 months';
$$;

revoke all on function cleanup_old_rows() from public, anon, authenticated;

-- (Re)schedule — safe to run this file again, the job is replaced, not duplicated.
select cron.schedule('hint-seek-cleanup', '17 3 * * *', $$select public.cleanup_old_rows()$$);
