-- Após aplicar as migrations em um banco local, execute com psql -X -v ON_ERROR_STOP=1 -f.
begin;

insert into auth.users (id) values
  ('8f41852a-244d-49f9-bafa-b95a00ecec11'),
  ('8f41852a-244d-49f9-bafa-b95a00ecec12');

insert into public.subscriptions (user_id, plan_id, status, current_period_end)
values ('8f41852a-244d-49f9-bafa-b95a00ecec12', 'pro', 'active', now() + interval '1 day');

insert into public.checkout_reservations (user_id, plan, price_id)
values ('8f41852a-244d-49f9-bafa-b95a00ecec12', 'weekly', 'price_weekly');

do $$
declare
  signature text := 'public.claim_checkout_reservation(uuid,text,text,text)';
begin
  if has_function_privilege('anon', signature, 'execute')
    or has_function_privilege('authenticated', signature, 'execute')
    or not has_function_privilege('service_role', signature, 'execute') then
    raise exception 'Only the service role should have API access to the reservation RPC';
  end if;

  if not has_function_privilege('authenticated', 'public.claim_checkout_attempt()', 'execute') then
    raise exception 'Existing authenticated callers must retain access to the original RPC';
  end if;

  if has_table_privilege('anon', 'public.checkout_reservations', 'select, insert, update, delete')
    or has_table_privilege('authenticated', 'public.checkout_reservations', 'select, insert, update, delete') then
    raise exception 'Clients must not have direct access to checkout reservations';
  end if;
end
$$;

set local role service_role;

do $$
declare
  free_user uuid := '8f41852a-244d-49f9-bafa-b95a00ecec11';
  pro_user uuid := '8f41852a-244d-49f9-bafa-b95a00ecec12';
  first_claim jsonb;
  live_claim jsonb;
  result jsonb;
begin
  result := public.claim_checkout_reservation(null, 'weekly', 'price_weekly', null);
  if result is distinct from '{"allowed":false,"reason":"unauthenticated"}'::jsonb then
    raise exception 'A missing user should be rejected, got %', result;
  end if;

  result := public.claim_checkout_reservation(pro_user, 'weekly', 'price_weekly', null);
  if result is distinct from '{"allowed":false,"reason":"already_pro"}'::jsonb then
    raise exception 'An active Pro subscription should supersede any existing reservation, got %', result;
  end if;

  begin
    perform public.claim_checkout_reservation(free_user, 'invalid', 'price_weekly', null);
    raise exception 'An invalid plan should fail the reservation constraint';
  exception
    when check_violation then null;
  end;

  first_claim := public.claim_checkout_reservation(free_user, 'weekly', 'price_weekly', 'first@example.test');
  if first_claim->'allowed' is distinct from 'true'::jsonb
    or first_claim#>>'{reservation,request_id}' is null
    or first_claim#>>'{reservation,plan}' is distinct from 'weekly'
    or first_claim#>>'{reservation,price_id}' is distinct from 'price_weekly'
    or first_claim#>>'{reservation,customer_email}' is distinct from 'first@example.test' then
    raise exception 'The first checkout should reserve the requested parameters, got %', first_claim;
  end if;

  result := public.claim_checkout_reservation(free_user, 'yearly', 'price_yearly', 'second@example.test');
  if result is distinct from first_claim then
    raise exception 'A retry should keep the original checkout parameters, got %', result;
  end if;

  -- Simulate completed or expired sessions by removing their reservations.
  for attempt in 2..3 loop
    delete from public.checkout_reservations where user_id = free_user;
    live_claim := public.claim_checkout_reservation(free_user, 'monthly', 'price_monthly', null);
    if live_claim->'allowed' is distinct from 'true'::jsonb
      or live_claim#>>'{reservation,request_id}' is null
      or live_claim#>>'{reservation,request_id}' = first_claim#>>'{reservation,request_id}' then
      raise exception 'Attempt % should create a new reservation, got %', attempt, live_claim;
    end if;
  end loop;

  result := public.claim_checkout_reservation(free_user, 'yearly', 'price_yearly', null);
  if result is distinct from live_claim then
    raise exception 'A live reservation should stay available at the rate limit, got %', result;
  end if;

  delete from public.checkout_reservations where user_id = free_user;
  result := public.claim_checkout_reservation(free_user, 'weekly', 'price_weekly', null);
  if result is distinct from '{"allowed":false,"reason":"rate_limited"}'::jsonb then
    raise exception 'A fourth new reservation within ten minutes should be limited, got %', result;
  end if;
end
$$;

reset role;

do $$
begin
  if (select count(*) from public.checkout_attempts where user_id = '8f41852a-244d-49f9-bafa-b95a00ecec11') <> 3
    or exists (select from public.checkout_attempts where user_id = '8f41852a-244d-49f9-bafa-b95a00ecec12') then
    raise exception 'Only successful new reservations should count against the limit';
  end if;
end
$$;

rollback;
