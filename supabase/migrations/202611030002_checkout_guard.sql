-- Evita múltiplos checkouts Stripe para a mesma conta e limita abuso do endpoint.
create table if not exists public.checkout_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create index if not exists checkout_attempts_user_created_idx
  on public.checkout_attempts (user_id, created_at desc);

alter table public.checkout_attempts enable row level security;
revoke all on public.checkout_attempts from anon, authenticated;

-- A Edge Function chama esta rotina com o JWT do usuário. A tabela permanece
-- inacessível ao cliente e a decisão ocorre no banco, não na interface do APK.
create or replace function public.claim_checkout_attempt()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  attempts_in_window integer;
  has_pro boolean;
begin
  if current_user_id is null then
    return jsonb_build_object('allowed', false, 'reason', 'unauthenticated');
  end if;

  select exists (
    select 1
    from public.subscriptions s
    where s.user_id = current_user_id
      and s.plan_id = 'pro'
      and s.status in ('active', 'trialing')
      and (s.current_period_end is null or s.current_period_end > now())
  ) into has_pro;
  if has_pro then
    return jsonb_build_object('allowed', false, 'reason', 'already_pro');
  end if;

  select count(*)
    into attempts_in_window
    from public.checkout_attempts a
   where a.user_id = current_user_id
     and a.created_at > now() - interval '10 minutes';
  if attempts_in_window >= 3 then
    return jsonb_build_object('allowed', false, 'reason', 'rate_limited');
  end if;

  insert into public.checkout_attempts (user_id) values (current_user_id);
  return jsonb_build_object('allowed', true);
end;
$$;

revoke all on function public.claim_checkout_attempt() from public;
grant execute on function public.claim_checkout_attempt() to authenticated;
