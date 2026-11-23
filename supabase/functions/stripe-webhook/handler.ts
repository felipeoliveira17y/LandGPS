import { Buffer } from "node:buffer";
import type Stripe from "npm:stripe@17.5.0";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

const toIso = (unixSeconds: number) => new Date(unixSeconds * 1000).toISOString();
const userIdPattern = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const plans = new Set(["weekly", "monthly", "yearly"]);

export async function handleStripeWebhook(
  request: Request,
  stripe: Stripe,
  supabase: SupabaseClient,
  webhookSecret: string,
): Promise<Response> {
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const signature = request.headers.get("stripe-signature");
  if (!signature) return new Response("Missing signature", { status: 400 });

  let event: Stripe.Event;
  try {
    const body = Buffer.from(await request.arrayBuffer());
    event = await stripe.webhooks.constructEventAsync(body, signature, webhookSecret);
  } catch {
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

  try {
    const processed = await supabase.from("stripe_webhook_events").select("event_id")
      .eq("event_id", event.id).maybeSingle();
    if (processed.error) throw processed.error;
    if (processed.data) return new Response("ok");

    for (let attempt = 0; attempt < 3; attempt++) {
      const current = await supabase.from("subscriptions").select("stripe_sync_revision")
        .eq("provider_subscription_id", subscriptionId).maybeSingle();
      if (current.error) throw current.error;

      // Refresh the Stripe snapshot after every concurrent database update.
      const subscription = await stripe.subscriptions.retrieve(subscriptionId);
      const { user_id: userId, plan } = subscription.metadata;
      if (!userId || !userIdPattern.test(userId) || !plans.has(plan) || subscription.livemode !== event.livemode) {
        console.error("Assinatura Stripe com metadados ou modo inválidos", subscription.id);
        return new Response("Invalid subscription metadata or mode", { status: 400 });
      }

      const customerId = typeof subscription.customer === "string" ? subscription.customer : subscription.customer.id;
      const { data, error } = await supabase.rpc("apply_stripe_subscription_event", {
        p_event_id: event.id,
        p_expected_revision: current.data?.stripe_sync_revision ?? null,
        p_subscription: {
          user_id: userId,
          provider_customer_id: customerId,
          provider_subscription_id: subscription.id,
          status: subscription.status,
          current_period_start: toIso(subscription.current_period_start),
          current_period_end: toIso(subscription.current_period_end),
          cancel_at_period_end: subscription.cancel_at_period_end,
        },
      });
      if (error) throw error;
      if (data === "applied" || data === "duplicate") return new Response("ok");
      if (data !== "stale") throw new Error("Unexpected subscription synchronization result");
    }
  } catch (error) {
    console.error("Não foi possível sincronizar assinatura Stripe", event.id, error);
  }
  return new Response("Subscription synchronization failed", { status: 500 });
}
