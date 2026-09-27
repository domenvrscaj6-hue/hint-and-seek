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
-- Cleanup job: runs every night at 03:17 UTC.
--   * pending submissions whose 48 h link expired → deleted (they hold private wishes)
--   * failed submissions older than 7 days        → deleted
--   * rate-limit rows older than 1 day            → deleted
-- Sent submissions are kept (they are the record of what was sent).
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
  delete from rate_limits      where window_start < now() - interval '1 day';
$$;

revoke all on function cleanup_old_rows() from public, anon, authenticated;

-- (Re)schedule — safe to run this file again, the job is replaced, not duplicated.
select cron.schedule('hint-seek-cleanup', '17 3 * * *', $$select public.cleanup_old_rows()$$);
