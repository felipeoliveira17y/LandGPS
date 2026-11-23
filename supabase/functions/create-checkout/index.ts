import Stripe from "npm:stripe@17.5.0";
import { createClient } from "npm:@supabase/supabase-js@2";

import { type ReservationClaim, resolveCheckout } from "./checkout.ts";

const corsHeaders = {
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const publishableKey = () => {
  const keys = Deno.env.get("SUPABASE_PUBLISHABLE_KEYS");
  return keys ? JSON.parse(keys).default : Deno.env.get("SUPABASE_ANON_KEY");
};

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Método não permitido." }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabasePublishableKey = publishableKey();
  const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY");
  const configuredSecrets = Deno.env.get("SUPABASE_SECRET_KEYS");
  const serviceKey = configuredSecrets ? JSON.parse(configuredSecrets).default : Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !supabasePublishableKey || !stripeSecretKey || !serviceKey) {
    console.error("Secrets obrigatórios não configurados.");
    return json({ error: "Serviço de pagamento indisponível." }, 500);
  }

  const authorization = request.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) return json({ error: "Sessão inválida." }, 401);

  const supabase = createClient(supabaseUrl, supabasePublishableKey, {
    global: { headers: { Authorization: authorization } },
  });
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) return json({ error: "Sessão inválida." }, 401);

  const payload = await request.json().catch(() => null) as { plan?: string } | null;
  const prices: Record<string, string | undefined> = {
    weekly: Deno.env.get("STRIPE_PRICE_WEEKLY"),
    monthly: Deno.env.get("STRIPE_PRICE_MONTHLY"),
    yearly: Deno.env.get("STRIPE_PRICE_YEARLY"),
  };
  const plan = payload?.plan;
  if (typeof plan !== "string" || !Object.hasOwn(prices, plan)) {
    return json({ error: "Plano inválido." }, 400);
  }
  const priceId = prices[plan];
  if (!priceId) return json({ error: "Plano indisponível." }, 503);

  const admin = createClient(supabaseUrl, serviceKey);
  const reservations = () => admin.from("checkout_reservations");
  const stripe = new Stripe(stripeSecretKey, { timeout: 10000, maxNetworkRetries: 0 });
  try {
    const result = await resolveCheckout(stripe, {
      async claim() {
        const { data, error } = await admin.rpc("claim_checkout_reservation", {
          p_user_id: user.id,
          p_plan: plan,
          p_price_id: priceId,
          p_customer_email: user.email ?? null,
          p_brazil_checkout: true,
        });
        if (error) throw error;
        return data as ReservationClaim;
      },
      async save(reservation, session) {
        const saved = await reservations().update({
          stripe_session_id: session.id,
          stripe_session_url: session.url,
        }).eq("user_id", user.id).eq("request_id", reservation.request_id)
          .select("request_id").maybeSingle();
        if (saved.error) throw saved.error;
        return !!saved.data;
      },
      async remove(reservation) {
        const removed = await reservations().delete()
          .eq("user_id", user.id).eq("request_id", reservation.request_id);
        if (removed.error) throw removed.error;
      },
    }, { userId: user.id, plan, returnUrl: `${supabaseUrl}/functions/v1/checkout-return` });
    return "url" in result ? json({ url: result.url }) : json({ error: result.error }, result.status);
  } catch {
    return json({ error: "Não foi possível confirmar o checkout. Tente novamente." }, 503);
  }
});
