-- Estrutura para autenticação e assinaturas do Landmensure Pro.
-- Pode ser aplicada pelo Supabase SQL Editor ou pela CLI como migration.

create table if not exists public.plans (
  id text primary key,
  name text not null,
  description text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

insert into public.plans (id, name, description)
values
  ('free', 'Landmensure Free', 'Recursos básicos para levantamentos simples'),
  ('pro', 'Landmensure Pro', 'Recursos profissionais e avançados')
on conflict (id) do nothing;

create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  plan_id text not null references public.plans(id),
  provider text not null default 'stripe'
    check (provider in ('stripe', 'manual', 'google_play')),
  provider_customer_id text,
  provider_subscription_id text unique,
  status text not null default 'inactive'
    check (status in ('trialing', 'active', 'past_due', 'canceled', 'unpaid', 'incomplete', 'incomplete_expired', 'paused', 'inactive')),
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists subscriptions_user_id_idx on public.subscriptions (user_id);
create index if not exists subscriptions_status_period_idx
  on public.subscriptions (status, current_period_end);

-- Atualiza a regra também se a tabela já foi criada por uma versão anterior do SQL.
alter table public.subscriptions drop constraint if exists subscriptions_status_check;
alter table public.subscriptions add constraint subscriptions_status_check
  check (status in ('trialing', 'active', 'past_due', 'canceled', 'unpaid', 'incomplete', 'incomplete_expired', 'paused', 'inactive'));

alter table public.plans enable row level security;
alter table public.subscriptions enable row level security;

drop policy if exists "Anyone can read active plans" on public.plans;
create policy "Anyone can read active plans"
  on public.plans for select
  using (active = true);

drop policy if exists "Users can read their own subscriptions" on public.subscriptions;
create policy "Users can read their own subscriptions"
  on public.subscriptions for select to authenticated
  using (auth.uid() = user_id);

revoke insert, update, delete on public.subscriptions from anon, authenticated;

create or replace function public.has_active_pro()
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select exists (
    select 1
    from public.subscriptions s
    where s.user_id = (select auth.uid())
      and s.plan_id = 'pro'
      and s.status in ('active', 'trialing')
      and (s.current_period_end is null or s.current_period_end > now())
  );
$$;

revoke all on function public.has_active_pro() from public;
grant execute on function public.has_active_pro() to authenticated;
