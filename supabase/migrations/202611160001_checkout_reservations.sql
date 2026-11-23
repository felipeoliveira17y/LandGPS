create table public.checkout_reservations (
  user_id uuid primary key references auth.users(id) on delete cascade,
  request_id uuid not null unique default gen_random_uuid(),
  plan text not null check (plan in ('weekly', 'monthly', 'yearly')),
  price_id text not null,
  customer_email text,
  expires_at bigint not null default floor(extract(epoch from now() + interval '1 hour'))::bigint,
  stripe_session_id text
);

alter table public.checkout_reservations enable row level security;
revoke all on public.checkout_reservations from public, anon, authenticated;
grant select, insert, update, delete on public.checkout_reservations to service_role;
