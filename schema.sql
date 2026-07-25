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
  target_email   text not null,
  occasion       text not null check (occasion in ('christmas','birthday','other'))
);

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
