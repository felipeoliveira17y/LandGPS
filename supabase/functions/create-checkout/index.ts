import Stripe from "npm:stripe@17.5.0";
import { createClient } from "npm:@supabase/supabase-js@2";

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
  if (!supabaseUrl || !supabasePublishableKey || !stripeSecretKey) {
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
  const priceId = plan ? prices[plan] : undefined;
  if (!plan || !priceId) return json({ error: "Plano inválido." }, 400);

  const stripe = new Stripe(stripeSecretKey);
  const checkoutReturnUrl = `${supabaseUrl}/functions/v1/checkout-return`;
  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    client_reference_id: user.id,
    customer_email: user.email ?? undefined,
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${checkoutReturnUrl}?payment=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${checkoutReturnUrl}?payment=cancelled`,
    metadata: { plan, user_id: user.id },
    subscription_data: { metadata: { plan, user_id: user.id } },
  });

  if (!session.url) return json({ error: "Não foi possível criar o checkout." }, 502);
  return json({ url: session.url });
});
