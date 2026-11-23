-- Após aplicar as migrations em um banco local, execute com psql -X -v ON_ERROR_STOP=1 -f.
begin;

insert into auth.users (id) values
  ('8f41852a-244d-49f9-bafa-b95a00ecec21'),
  ('8f41852a-244d-49f9-bafa-b95a00ecec22');

insert into public.subscriptions (user_id, plan_id, provider, provider_subscription_id, status)
values
  ('8f41852a-244d-49f9-bafa-b95a00ecec21', 'pro', 'manual', 'landgps_qa_manual', 'active'),
  ('8f41852a-244d-49f9-bafa-b95a00ecec21', 'pro', 'stripe', 'sub_landgps_qa_legacy', 'inactive');

do $$
declare
  signature text := 'public.apply_stripe_subscription_event(text,uuid,jsonb)';
  ledger text := 'public.stripe_webhook_events';
begin
  if has_function_privilege('anon', signature, 'execute')
    or has_function_privilege('authenticated', signature, 'execute')
    or not has_function_privilege('service_role', signature, 'execute') then
    raise exception 'The webhook RPC must be restricted to the service role';
  end if;

  if has_table_privilege('anon', ledger, 'select, insert, update, delete')
    or has_table_privilege('authenticated', ledger, 'select, insert, update, delete')
    or has_table_privilege('service_role', ledger, 'insert, update, delete')
    or not has_table_privilege('service_role', ledger, 'select') then
    raise exception 'Ledger read access must be restricted to the service role and writes must go through the RPC';
  end if;
end
$$;

do $$
declare
  owner_id uuid := '8f41852a-244d-49f9-bafa-b95a00ecec21';
  other_user_id uuid := '8f41852a-244d-49f9-bafa-b95a00ecec22';
  subscription_id text := 'sub_landgps_qa';
  original jsonb := jsonb_build_object(
    'user_id', owner_id,
    'plan_id', 'pro',
    'provider', 'stripe',
    'provider_customer_id', 'cus_landgps_qa',
    'provider_subscription_id', subscription_id,
    'status', 'active',
    'current_period_start', now(),
    'current_period_end', now() + interval '1 month',
    'cancel_at_period_end', false,
    'updated_at', now()
  );
  current_revision uuid;
  new_revision uuid;
  result text;
begin
  set local role service_role;
  result := public.apply_stripe_subscription_event('evt_landgps_qa_create', null, original);
  reset role;
  select stripe_sync_revision into current_revision
  from public.subscriptions where provider_subscription_id = subscription_id and status = 'active';
  if result is distinct from 'applied' or current_revision is null then
    raise exception 'The first event should apply and assign a revision, got %', result;
  end if;

  result := public.apply_stripe_subscription_event(
    'evt_landgps_qa_legacy', null, original || '{"provider_subscription_id":"sub_landgps_qa_legacy"}'::jsonb
  );
  if result is distinct from 'applied' or not exists (
    select from public.subscriptions where provider_subscription_id = 'sub_landgps_qa_legacy'
      and status = 'active' and stripe_sync_revision is not null
  ) then
    raise exception 'An existing Stripe subscription without a revision should accept its first event, got %', result;
  end if;

  result := public.apply_stripe_subscription_event(
    'evt_landgps_qa_create', null, original || '{"status":"canceled"}'::jsonb
  );
  if result is distinct from 'duplicate' or not exists (
    select from public.subscriptions
    where provider_subscription_id = subscription_id and status = 'active' and stripe_sync_revision = current_revision
  ) then
    raise exception 'A duplicate event must preserve the original write, got %', result;
  end if;

  result := public.apply_stripe_subscription_event('evt_landgps_qa_update', null, original);
  if result is distinct from 'stale' or exists (
    select from public.stripe_webhook_events where event_id = 'evt_landgps_qa_update'
  ) then
    raise exception 'A stale revision must leave the event available for retry, got %', result;
  end if;

  result := public.apply_stripe_subscription_event(
    'evt_landgps_qa_update', current_revision, original || '{"status":"past_due"}'::jsonb
  );
  select stripe_sync_revision into new_revision
  from public.subscriptions where provider_subscription_id = subscription_id and status = 'past_due';
  if result is distinct from 'applied' or new_revision is null or new_revision = current_revision then
    raise exception 'Retry with the matching revision should apply and advance it, got %', result;
  end if;

  begin
    perform public.apply_stripe_subscription_event(
      'evt_landgps_qa_rollback', new_revision, original || '{"status":"invalid"}'::jsonb
    );
    raise exception 'An invalid subscription status should raise a constraint error';
  exception when check_violation then
    null;
  end;
  if exists (select from public.stripe_webhook_events where event_id = 'evt_landgps_qa_rollback') or not exists (
    select from public.subscriptions
    where provider_subscription_id = subscription_id and status = 'past_due' and stripe_sync_revision = new_revision
  ) then
    raise exception 'A failed subscription write must roll back both the event and its update';
  end if;

  result := public.apply_stripe_subscription_event('evt_landgps_qa_rollback', new_revision, original);
  if result is distinct from 'applied' then
    raise exception 'An event from a failed transaction should be retryable, got %', result;
  end if;

  select stripe_sync_revision into current_revision
  from public.subscriptions where provider_subscription_id = subscription_id;
  begin
    perform public.apply_stripe_subscription_event(
      'evt_landgps_qa_owner', current_revision, original || jsonb_build_object('user_id', other_user_id)
    );
    raise exception 'A webhook should never transfer an existing Stripe subscription to another account' using errcode = 'P0004';
  exception when raise_exception then
    null;
  end;
  begin
    perform public.apply_stripe_subscription_event(
      'evt_landgps_qa_provider', null, original || '{"provider_subscription_id":"landgps_qa_manual"}'::jsonb
    );
    raise exception 'A webhook should never overwrite a subscription from another provider' using errcode = 'P0004';
  exception when raise_exception then
    null;
  end;
  if exists (select from public.stripe_webhook_events where event_id in ('evt_landgps_qa_owner', 'evt_landgps_qa_provider'))
    or not exists (
      select from public.subscriptions where provider_subscription_id = subscription_id
        and user_id = owner_id and provider = 'stripe' and stripe_sync_revision = current_revision
    ) or not exists (
      select from public.subscriptions where provider_subscription_id = 'landgps_qa_manual'
        and user_id = owner_id and provider = 'manual' and stripe_sync_revision is null
    ) then
    raise exception 'Ownership and provider conflicts must preserve both existing subscriptions and the event ledger';
  end if;
end
$$;

rollback;
