begin;

-- Reproduce Supabase grants when run in a vanilla PostgreSQL test database.
grant usage on schema auth to authenticated;
grant select on public.subscriptions to authenticated;

insert into auth.users (id) values
  ('31000000-0000-4000-8000-000000000001'),
  ('31000000-0000-4000-8000-000000000002');

insert into public.survey_revisions (owner_id, survey_id, revision_id, snapshot)
select id, gen_random_uuid(), gen_random_uuid(), '{}'::jsonb
from auth.users
where id in ('31000000-0000-4000-8000-000000000001', '31000000-0000-4000-8000-000000000002');

set local role service_role;
do $$
declare
  legacy_owner uuid := '31000000-0000-4000-8000-000000000001';
  new_owner uuid := '31000000-0000-4000-8000-000000000002';
  legacy jsonb;
  current_claim jsonb;
begin
  legacy := public.claim_checkout_reservation(legacy_owner, 'monthly', 'price_legacy', null);
  if legacy->'reservation'->>'brazil_checkout' is distinct from 'false'
    or public.claim_checkout_reservation(legacy_owner, 'monthly', 'price_legacy', null, true) is distinct from legacy then
    raise exception 'A new worker must replay an unchanged legacy reservation';
  end if;

  current_claim := public.claim_checkout_reservation(new_owner, 'monthly', 'price_brl', null, true);
  if current_claim->'reservation'->>'brazil_checkout' is distinct from 'true'
    or public.claim_checkout_reservation(new_owner, 'monthly', 'price_brl', null)->>'allowed' is distinct from 'false'
    or public.claim_checkout_reservation(new_owner, 'monthly', 'price_brl', null, true) is distinct from current_claim then
    raise exception 'Only a new worker may replay the new Stripe payment parameters';
  end if;
end;
$$;
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '31000000-0000-4000-8000-000000000001', true);
do $$
begin
  if exists (select from public.survey_revisions) then
    raise exception 'A free account must not read synced revisions';
  end if;
end;
$$;
reset role;

insert into public.subscriptions (user_id, plan_id, status, current_period_end)
values ('31000000-0000-4000-8000-000000000001', 'pro', 'active', now() + interval '1 day');

set local role authenticated;
do $$
begin
  if (select count(*) from public.survey_revisions) <> 1 then
    raise exception 'Pro must see only its own synced revisions';
  end if;
end;
$$;

rollback;
