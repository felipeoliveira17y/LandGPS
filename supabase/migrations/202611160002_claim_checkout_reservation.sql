-- Serializa a reserva e o consumo do limite na mesma transação, com a
-- mesma chave de lock usada pela função de checkout anterior.
create function public.claim_checkout_reservation(
  p_user_id uuid,
  p_plan text,
  p_price_id text,
  p_customer_email text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  reservation public.checkout_reservations%rowtype;
  attempts_in_window integer;
begin
  if p_user_id is null then
    return jsonb_build_object('allowed', false, 'reason', 'unauthenticated');
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));

  if exists (
    select 1
    from public.subscriptions s
    where s.user_id = p_user_id
      and s.plan_id = 'pro'
      and s.status in ('active', 'trialing')
      and (s.current_period_end is null or s.current_period_end > now())
  ) then
    return jsonb_build_object('allowed', false, 'reason', 'already_pro');
  end if;

  select r.* into reservation
  from public.checkout_reservations r
  where r.user_id = p_user_id;
  if found then
    return jsonb_build_object('allowed', true, 'reservation', to_jsonb(reservation));
  end if;

  select count(*) into attempts_in_window
  from public.checkout_attempts a
  where a.user_id = p_user_id
    and a.created_at > now() - interval '10 minutes';
  if attempts_in_window >= 3 then
    return jsonb_build_object('allowed', false, 'reason', 'rate_limited');
  end if;

  insert into public.checkout_attempts (user_id) values (p_user_id);
  insert into public.checkout_reservations (user_id, plan, price_id, customer_email)
  values (p_user_id, p_plan, p_price_id, p_customer_email)
  returning * into reservation;

  return jsonb_build_object('allowed', true, 'reservation', to_jsonb(reservation));
end;
$$;

revoke all on function public.claim_checkout_reservation(uuid, text, text, text)
  from public, anon, authenticated;
grant execute on function public.claim_checkout_reservation(uuid, text, text, text)
  to service_role;
