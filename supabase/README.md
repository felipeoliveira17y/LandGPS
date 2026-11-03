# Supabase e Stripe — Landmensure Pro

Esta pasta contém a estrutura de banco e as Edge Functions do plano Pro. Ela não guarda chaves, senhas ou dados de clientes.

## Ordem de configuração

1. Confirme no Supabase que `plans` e `subscriptions` existem. Se não existirem, aplique a migration em `migrations/` pelo SQL Editor ou pela Supabase CLI.
2. Cadastre os secrets no projeto Supabase:
   - `STRIPE_SECRET_KEY`
   - `STRIPE_WEBHOOK_SECRET`
   - `STRIPE_PRICE_WEEKLY=price_1UVxbXPQRaLPLjFe25qf3aaT`
   - `STRIPE_PRICE_MONTHLY=price_1UVxbXPQRaLPLjFeSMYJg5sB`
   - `STRIPE_PRICE_YEARLY=price_1UVxbXPQRaLPLjFeCaJeWz0T`
   As variáveis `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEYS` e `SUPABASE_SECRET_KEYS` já são fornecidas pela plataforma; não as recrie como secrets personalizados.
3. Faça deploy das funções `create-checkout`, `stripe-webhook` e `checkout-return`.
4. No Stripe, crie um endpoint apontando para `https://tfuiwogiwbvqxfqktnwe.supabase.co/functions/v1/stripe-webhook`.
5. Selecione pelo menos estes eventos no Stripe: `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid` e `invoice.payment_failed`.
6. Copie o signing secret desse endpoint para `STRIPE_WEBHOOK_SECRET` no Supabase.
7. Teste com chaves e cartões de teste do Stripe antes de trocar para o ambiente Live.

## Segurança

- Os Price IDs são selecionados pelo backend a partir de `weekly`, `monthly` ou `yearly`; o APK não escolhe um valor ou preço arbitrário.
- A Edge Function do webhook confere a assinatura do Stripe antes de atualizar `subscriptions`.
- A `service_role` é usada apenas dentro do webhook. Ela nunca deve aparecer no app Android.
- O retorno ao aplicativo apenas informa que o checkout terminou. O acesso Pro deve ser liberado depois de consultar a assinatura registrada pelo webhook.
