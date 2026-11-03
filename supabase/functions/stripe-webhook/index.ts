import Stripe from "npm:stripe@17.5.0";
import { createClient } from "npm:@supabase/supabase-js@2";

const toIso = (unixSeconds: number | null | undefined) =>
  unixSeconds ? new Date(unixSeconds * 1000).toISOString() : null;

const secretKey = () => {
  const keys = Deno.env.get("SUPABASE_SECRET_KEYS");
  return keys ? JSON.parse(keys).default : Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
};

Deno.serve(async (request) => {
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY");
  const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseSecretKey = secretKey();
  if (!stripeSecretKey || !webhookSecret || !supabaseUrl || !supabaseSecretKey) {
    console.error("Secrets obrigatórios não configurados.");
    return new Response("Server configuration error", { status: 500 });
  }

  const signature = request.headers.get("stripe-signature");
  if (!signature) return new Response("Missing signature", { status: 400 });

  const stripe = new Stripe(stripeSecretKey);
  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(await request.text(), signature, webhookSecret);
  } catch (error) {
    console.error("Assinatura de webhook inválida", error);
    return new Response("Invalid signature", { status: 400 });
  }

  const handledEvents = new Set([
    "checkout.session.completed",
    "customer.subscription.created",
    "customer.subscription.updated",
    "customer.subscription.deleted",
    "invoice.paid",
    "invoice.payment_failed",
  ]);
  if (!handledEvents.has(event.type)) return new Response("ok", { status: 200 });

  const subscriptionId = (() => {
    const object = event.data.object as Stripe.Checkout.Session | Stripe.Subscription | Stripe.Invoice;
    if (object.object === "checkout.session") return typeof object.subscription === "string" ? object.subscription : object.subscription?.id;
    if (object.object === "subscription") return object.id;
    const invoice = object as Stripe.Invoice & {
      subscription?: string | Stripe.Subscription | null;
      parent?: { subscription_details?: { subscription?: string | Stripe.Subscription | null } | null } | null;
    };
    const invoiceSubscription = invoice.subscription ?? invoice.parent?.subscription_details?.subscription;
    return typeof invoiceSubscription === "string" ? invoiceSubscription : invoiceSubscription?.id;
  })();

  if (!subscriptionId) return new Response("ok", { status: 200 });

  const subscription = await stripe.subscriptions.retrieve(subscriptionId);
  const userId = subscription.metadata.user_id;
  const plan = subscription.metadata.plan;
  if (!userId || !plan) {
    console.error("Assinatura Stripe sem metadata de usuário/plano", subscription.id);
    return new Response("Missing subscription metadata", { status: 400 });
  }

  const supabase = createClient(supabaseUrl, supabaseSecretKey);
  const customerId = typeof subscription.customer === "string" ? subscription.customer : subscription.customer.id;
  const billingPeriod = subscription.items.data[0];
  const { error } = await supabase.from("subscriptions").upsert({
    user_id: userId,
    plan_id: "pro",
    provider: "stripe",
    provider_customer_id: customerId,
    provider_subscription_id: subscription.id,
    status: subscription.status,
    current_period_start: toIso(billingPeriod?.current_period_start),
    current_period_end: toIso(billingPeriod?.current_period_end),
    cancel_at_period_end: subscription.cancel_at_period_end,
    updated_at: new Date().toISOString(),
  }, { onConflict: "provider_subscription_id" });

  if (error) {
    console.error("Não foi possível atualizar assinatura", error);
    return new Response("Database update failed", { status: 500 });
  }
  return new Response("ok", { status: 200 });
});
