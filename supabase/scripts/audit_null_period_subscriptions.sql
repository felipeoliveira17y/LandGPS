-- Auditoria somente leitura. Confirme o estado no provedor antes de corrigir.
select id, user_id, provider, provider_subscription_id, status, updated_at
from public.subscriptions
where status in ('active', 'trialing')
  and current_period_end is null
order by provider, updated_at, id;
