import type Stripe from "npm:stripe@17.5.0";

export type CheckoutReservation = {
  request_id: string;
  plan: string;
  price_id: string;
  customer_email: string | null;
  expires_at: number;
  stripe_session_id: string | null;
  brazil_checkout?: boolean | null;
};

export type ReservationClaim =
  | { allowed: true; reservation: CheckoutReservation }
  | { allowed: false; reason: "unauthenticated" | "already_pro" | "rate_limited" | "account_deleting" };

type ReservationStore = {
  claim(): Promise<ReservationClaim>;
  save(reservation: CheckoutReservation, session: Stripe.Checkout.Session): Promise<boolean>;
  remove(reservation: CheckoutReservation): Promise<void>;
};

const blocked = (error: string) => ({ error, status: 409 } as const);

const completed = "Já existe uma assinatura vinculada ao pagamento anterior.";
const pending = "Não foi possível confirmar o estado do pagamento anterior.";

const brazilCheckout = (reservation: CheckoutReservation) => ({
  currency: "brl",
  payment_method_types: ["card", "pix", "boleto"] satisfies Stripe.Checkout.SessionCreateParams.PaymentMethodType[],
  payment_method_options: {
    boleto: { expires_after_days: 3 },
    pix: {
      expires_after_seconds: 1800,
      mandate_options: { payment_schedule: reservation.plan },
    },
  },
});

async function closedSession(stripe: Stripe, session: Stripe.Checkout.Session) {
  if (session.status === "expired") return session.payment_status === "paid" ? pending : null;
  if (session.status === "open") {
    const expired = await stripe.checkout.sessions.expire(session.id);
    return expired.status === "expired" && expired.payment_status !== "paid" ? null : pending;
  }
  if (session.status !== "complete") return pending;

  const id = typeof session.subscription === "string" ? session.subscription : session.subscription?.id;
  if (!id) return "O pagamento anterior ainda está em processamento.";
  const subscription = await stripe.subscriptions.retrieve(id);
  return ["canceled", "incomplete_expired"].includes(subscription.status) ? null : completed;
}

export async function resolveCheckout(
  stripe: Stripe,
  store: ReservationStore,
  input: { userId: string; plan: string; returnUrl: string },
  now = () => Math.floor(Date.now() / 1000),
) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const claim = await store.claim();
    if (!claim.allowed) {
      return blocked(claim.reason === "already_pro"
        ? "Você já possui um plano Pro ativo."
        : claim.reason === "rate_limited"
        ? "Muitas tentativas de pagamento. Aguarde alguns minutos e tente novamente."
        : claim.reason === "account_deleting"
        ? "A conta está em processo de exclusão."
        : "Sessão inválida.");
    }
    const reservation = claim.reservation;
    const { userId, plan, returnUrl } = input;
    let session: Stripe.Checkout.Session | undefined;

    if (reservation.stripe_session_id) {
      session = await stripe.checkout.sessions.retrieve(reservation.stripe_session_id);
    } else if (reservation.expires_at > now()) {
      if (reservation.plan !== plan) {
        return blocked("Já existe uma tentativa em andamento. Abra o plano escolhido anteriormente para continuar.");
      }
      // Preserve both the key and the original request parameters across retries and deploys.
      const metadata = { plan: reservation.plan, user_id: userId };
      const created = await stripe.checkout.sessions.create({
        ...(reservation.brazil_checkout ? brazilCheckout(reservation) : {}),
        mode: "subscription",
        client_reference_id: userId,
        customer_email: reservation.customer_email ?? undefined,
        line_items: [{ price: reservation.price_id, quantity: 1 }],
        expires_at: reservation.expires_at,
        success_url: `${returnUrl}?payment=success&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${returnUrl}?payment=cancelled`,
        metadata,
        subscription_data: { metadata },
      }, {
        idempotencyKey: `landmensure-checkout-${reservation.request_id}`,
        // Keep Acacia reads and old idempotent writes on their original API version.
        apiVersion: reservation.brazil_checkout ? "2026-11-18.endive" : undefined,
      });
      // A replay can return the original response even after the session has closed.
      session = await stripe.checkout.sessions.retrieve(created.id);
      if (session.client_reference_id !== userId) return blocked(pending);
      if (!await store.save(reservation, session)) {
        return blocked("A tentativa de pagamento mudou. Tente novamente.");
      }
    } else {
      // Legacy reservations have no Stripe ID or reservation metadata. A session
      // created with this reservation must fall within its original one-hour window.
      for await (const candidate of stripe.checkout.sessions.list({
        created: { gte: reservation.expires_at - 3600, lte: reservation.expires_at },
        limit: 100,
      })) {
        if (candidate.client_reference_id !== userId || candidate.mode !== "subscription") continue;
        const reason = await closedSession(stripe, candidate);
        if (reason) return blocked(reason);
      }
    }

    if (session) {
      if (session.client_reference_id !== userId) return blocked(pending);
      if (session.status === "open" && reservation.plan === plan) {
        return session.url ? { url: session.url } : blocked(pending);
      }
      const reason = await closedSession(stripe, session);
      if (reason) return blocked(reason);
    }

    await store.remove(reservation);
  }
  return blocked("O checkout anterior foi encerrado. Toque em assinar novamente.");
}
