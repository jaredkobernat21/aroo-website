-- aroo. service request form (aroodog.com). Lives in the shared Supabase project
-- next to the ROQ / Groundbreakable intake tables, prefixed aroo_.
-- All three tables have RLS on with zero policies: only the service-role key
-- inside the aroo-service-request Edge Function can read or write them.

create table aroo_service_requests (
  id uuid primary key default gen_random_uuid(),
  first_name text not null check (char_length(first_name) between 1 and 60),
  zip text not null check (zip ~ '^[0-9]{5}$'),
  dogs text not null check (dogs in ('1', '2', '3+')),
  service_type text not null check (service_type in ('weekly', 'one_time')),
  phone text check (phone is null or char_length(phone) <= 20),
  email text check (email is null or char_length(email) <= 254),
  notes text check (notes is null or char_length(notes) <= 1000),
  -- 'pending' until the notification email is attempted, then 'sent' or 'failed'
  email_status text not null default 'pending',
  created_at timestamptz not null default now(),
  constraint aroo_service_requests_contact check (phone is not null or email is not null)
);
alter table aroo_service_requests enable row level security;

-- Conversion counts with no personal info: one row per successful request
-- and per tap on a "text us" link.
create table aroo_events (
  id bigint generated always as identity primary key,
  event text not null check (event in ('request_submitted', 'sms_click')),
  placement text check (placement is null or char_length(placement) <= 40),
  created_at timestamptz not null default now()
);
alter table aroo_events enable row level security;

-- Short-lived rate-limit log. key_hash is an HMAC of the visitor's IP (never the
-- raw IP); rows older than a day are deleted by the function.
create table aroo_rate_limits (
  id bigint generated always as identity primary key,
  bucket text not null,
  key_hash text not null,
  created_at timestamptz not null default now()
);
create index aroo_rate_limits_lookup on aroo_rate_limits (bucket, key_hash, created_at);
alter table aroo_rate_limits enable row level security;
