import type Stripe from "npm:stripe@17.5.0";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

type Reservation = { stripe_session_id: string | null; expires_at: number };
const stripeId = (value: string | { id: string } | null) =>
  typeof value === "string" ? value : value?.id;

async function cancelBilling(
  stripe: Stripe,
  userId: string,
  reservation: Reservation | null,
  linkedIds: string[],
) {
  const subscriptions = new Map<string, Stripe.Subscription>();
  const subscriptionIds = new Set(linkedIds);

  async function closeSession(session: Stripe.Checkout.Session) {
    if (session.client_reference_id !== userId) throw new Error("Checkout ownership mismatch");
    if (session.status === "open") session = await stripe.checkout.sessions.expire(session.id);
    if (session.status !== "complete" && session.status !== "expired") {
      throw new Error("Checkout still open");
    }
    const subscriptionId = stripeId(session.subscription);
    if (subscriptionId) subscriptionIds.add(subscriptionId);
  }

  if (reservation?.stripe_session_id) {
    await closeSession(await stripe.checkout.sessions.retrieve(reservation.stripe_session_id));
  } else if (reservation) {
    for await (const session of stripe.checkout.sessions.list({
      created: { gte: reservation.expires_at - 3600, lte: reservation.expires_at },
      limit: 100,
    })) {
      if (session.client_reference_id === userId && session.mode === "subscription") {
        await closeSession(session);
      }
    }
  }

  // Direct reads cover recent reservations and persisted subscriptions. Search
  // also catches older Stripe subscriptions whose webhooks never reached Supabase.
  for (const id of subscriptionIds) subscriptions.set(id, await stripe.subscriptions.retrieve(id));
  for await (const subscription of stripe.subscriptions.search({
    query: `metadata['user_id']:'${userId}'`,
    limit: 100,
  })) {
    if (!subscriptions.has(subscription.id)) {
      subscriptions.set(subscription.id, await stripe.subscriptions.retrieve(subscription.id));
    }
  }

  for (const subscription of subscriptions.values()) {
    if (subscription.metadata.user_id !== userId) throw new Error("Subscription ownership mismatch");
    if (!["canceled", "incomplete_expired"].includes(subscription.status)) {
      const canceled = await stripe.subscriptions.cancel(subscription.id, { invoice_now: false, prorate: false });
      if (canceled.status !== "canceled") throw new Error("Stripe cancellation not confirmed");
    }
    for await (const invoice of stripe.invoices.list({ subscription: subscription.id, status: "open", limit: 100 })) {
      const closed = await stripe.invoices.voidInvoice(invoice.id);
      if (closed.status !== "void") throw new Error("Stripe invoice cancellation not confirmed");
    }
  }
}

export async function handleDeleteAccount(
  request: Request,
  supabase: SupabaseClient,
  stripe: Stripe,
  allowedOrigins: ReadonlySet<string>,
): Promise<Response> {
  const origin = request.headers.get("Origin");
  const headers = new Headers({
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Vary": "Origin",
  });
  const json = (status: number, body: Record<string, unknown>) =>
    new Response(JSON.stringify(body), { status, headers });
  if (origin) {
    if (!allowedOrigins.has(origin)) return json(403, { error: "Origem não autorizada." });
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Access-Control-Allow-Headers", "authorization, apikey, content-type, x-client-info");
    headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  }
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (request.method !== "POST") return json(405, { error: "Método não permitido." });
  const token = request.headers.get("Authorization")?.match(/^Bearer (\S+)$/i)?.[1];
  if (!token) return json(401, { error: "Entre na sua conta novamente." });

  try {
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError && authError.status !== 401 && authError.status !== 403 && authError.status !== 404) {
      throw authError;
    }
    if (!user || authError) return json(401, { error: "Entre na sua conta novamente." });
    const body = await request.json().catch(() => null);
    if (body?.confirmation !== "EXCLUIR") return json(400, { error: "Digite EXCLUIR para confirmar." });
    const userId = user.id;
    if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(userId)) {
      return json(401, { error: "Sessão inválida." });
    }

    const fence = await supabase.rpc("begin_account_deletion", { p_user_id: userId });
    if (fence.error) throw fence.error;
    const [reservation, linked] = await Promise.all([
      supabase.from("checkout_reservations").select("stripe_session_id,expires_at")
        .eq("user_id", userId).maybeSingle(),
      supabase.from("subscriptions").select("provider_subscription_id")
        .eq("user_id", userId).eq("provider", "stripe"),
    ]);
    if (reservation.error || linked.error) throw reservation.error ?? linked.error;
    if (reservation.data && !reservation.data.stripe_session_id &&
      reservation.data.expires_at > Math.floor(Date.now() / 1000)) {
      return json(409, {
        error: "Há uma tentativa de pagamento em verificação. Aguarde o prazo da sessão de checkout e tente excluir novamente.",
      });
    }
    const ids = linked.data.flatMap(row => row.provider_subscription_id ? [row.provider_subscription_id] : []);
    await cancelBilling(stripe, userId, reservation.data, ids);

    // Foreign keys cascade to surveys, subscriptions, checkout attempts and reservations.
    const { error } = await supabase.auth.admin.deleteUser(userId, false);
    if (error && error.code !== "user_not_found") throw error;
    return json(200, { deleted: true });
  } catch (error) {
    console.error("Falha na exclusão de conta", error instanceof Error ? error.name : "Database error");
    return json(503, { error: "A exclusão não foi concluída. Entre na sua conta e tente novamente." });
  }
}
