begin;

insert into auth.users (id) values ('53000000-0000-4000-8000-000000000001');
insert into public.survey_revisions (owner_id, survey_id, revision_id, snapshot)
values ('53000000-0000-4000-8000-000000000001', gen_random_uuid(), gen_random_uuid(), '{}');

set local role service_role;
do $$
declare
  account_id uuid := '53000000-0000-4000-8000-000000000001';
  result jsonb;
begin
  result := public.claim_checkout_reservation(account_id, 'weekly', 'price_brl', null, true);
  if result->>'allowed' is distinct from 'true' then
    raise exception 'The original reservation must remain available for reconciliation';
  end if;
  perform public.begin_account_deletion(account_id);
  perform public.begin_account_deletion(account_id);
  if public.claim_checkout_reservation(account_id, 'weekly', 'price_brl', null, true)->>'reason'
       is distinct from 'account_deleting'
    or public.claim_checkout_reservation(account_id, 'weekly', 'price_brl', null)->>'reason'
       is distinct from 'account_deleting' then
    raise exception 'Both checkout API variants must respect the deletion fence';
  end if;
end;
$$;
reset role;

insert into public.subscriptions (user_id, plan_id, provider_subscription_id, status)
values ('53000000-0000-4000-8000-000000000001', 'pro', 'sub_to_delete', 'canceled');
delete from auth.users where id = '53000000-0000-4000-8000-000000000001';

do $$
declare
  account_id uuid := '53000000-0000-4000-8000-000000000001';
begin
  if exists (select from public.survey_revisions where owner_id = account_id)
    or exists (select from public.subscriptions where user_id = account_id)
    or exists (select from public.checkout_reservations where user_id = account_id)
    or exists (select from public.checkout_attempts where user_id = account_id)
    or exists (select from public.account_deletion_requests where user_id = account_id) then
    raise exception 'Hard deletion must remove all linked Landmensure rows';
  end if;
end;
$$;

rollback;
