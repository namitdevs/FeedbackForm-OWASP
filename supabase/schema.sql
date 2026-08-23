-- Supabase Schema for Society Feedback App

create table feedback (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  roll_number text not null,
  email text not null unique,
  rating smallint not null check (rating between 1 and 10),
  feedback text default '',
  created_at timestamptz not null default now()
);

-- Enable Row Level Security (RLS)
alter table feedback enable row level security;

-- No public policies are created — the table is only reachable via the
-- service-role key from the backend. The React app never talks to Supabase directly.
