import Stripe from "npm:stripe@17.5.0";
import { createClient } from "npm:@supabase/supabase-js@2";
import { handleStripeWebhook } from "./handler.ts";

const secretKey = () => {
  const keys = Deno.env.get("SUPABASE_SECRET_KEYS");
  return keys ? JSON.parse(keys).default : Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
};

Deno.serve((request) => {
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY");
  const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseSecretKey = secretKey();
  if (!stripeSecretKey || !webhookSecret || !supabaseUrl || !supabaseSecretKey) {
    console.error("Secrets obrigatórios não configurados.");
    return new Response("Server configuration error", { status: 500 });
  }
  const stripe = new Stripe(stripeSecretKey, { timeout: 10000, maxNetworkRetries: 0 });
  return handleStripeWebhook(request, stripe, createClient(supabaseUrl, supabaseSecretKey), webhookSecret);
});
