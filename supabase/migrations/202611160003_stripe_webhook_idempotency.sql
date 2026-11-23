alter table public.subscriptions add column stripe_sync_revision uuid;

create table public.stripe_webhook_events (
  event_id text primary key,
  processed_at timestamptz not null default now()
);

alter table public.stripe_webhook_events enable row level security;
revoke all on public.stripe_webhook_events from public, anon, authenticated, service_role;
grant select on public.stripe_webhook_events to service_role;

create function public.apply_stripe_subscription_event(
  p_event_id text,
  p_expected_revision uuid,
  p_subscription jsonb
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  incoming public.subscriptions%rowtype;
  persisted public.subscriptions%rowtype;
begin
  incoming := jsonb_populate_record(null::public.subscriptions, p_subscription);
  if nullif(p_event_id, '') is null
    or nullif(incoming.provider_subscription_id, '') is null
    or incoming.user_id is null then
    raise exception 'Missing Stripe event or subscription identity';
  end if;

  -- Serializa inclusive a primeira gravação, quando ainda não há linha para bloquear.
  perform pg_advisory_xact_lock(hashtextextended(incoming.provider_subscription_id, 0));
  if exists (select 1 from public.stripe_webhook_events e where e.event_id = p_event_id) then
    return 'duplicate';
  end if;

  select s.* into persisted
  from public.subscriptions s
  where s.provider_subscription_id = incoming.provider_subscription_id
  for update;

  if persisted.id is not null and (
    persisted.provider <> 'stripe' or persisted.user_id <> incoming.user_id
  ) then
    raise exception 'Stripe subscription ownership mismatch';
  end if;

  -- Uma revisão diferente invalida a leitura do Stripe feita antes da gravação concorrente.
  if persisted.stripe_sync_revision is distinct from p_expected_revision then
    return 'stale';
  end if;

  insert into public.stripe_webhook_events (event_id) values (p_event_id)
  on conflict (event_id) do nothing;
  if not found then
    return 'duplicate';
  end if;

  if persisted.id is null then
    insert into public.subscriptions (
      user_id, plan_id, provider, provider_customer_id, provider_subscription_id,
      status, current_period_start, current_period_end, cancel_at_period_end, stripe_sync_revision
    ) values (
      incoming.user_id, 'pro', 'stripe', incoming.provider_customer_id, incoming.provider_subscription_id,
      incoming.status, incoming.current_period_start, incoming.current_period_end,
      incoming.cancel_at_period_end, gen_random_uuid()
    );
  else
    update public.subscriptions set
      plan_id = 'pro',
      provider_customer_id = incoming.provider_customer_id,
      status = incoming.status,
      current_period_start = incoming.current_period_start,
      current_period_end = incoming.current_period_end,
      cancel_at_period_end = incoming.cancel_at_period_end,
      updated_at = now(),
      stripe_sync_revision = gen_random_uuid()
    where id = persisted.id;
  end if;

  return 'applied';
end;
$$;

revoke all on function public.apply_stripe_subscription_event(text, uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.apply_stripe_subscription_event(text, uuid, jsonb)
  to service_role;
