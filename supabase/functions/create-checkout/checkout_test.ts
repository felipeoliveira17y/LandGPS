import assert from "node:assert/strict";
import Stripe from "npm:stripe@17.5.0";
import { type CheckoutReservation, type ReservationClaim, resolveCheckout } from "./checkout.ts";

const now = 1700000000;
const input = { userId: "user-1", plan: "monthly", returnUrl: "https://fixture.invalid/return" };
const sessionUrl = "https://checkout.stripe.com/test";
const reservation = (id: string, expiresAt: number, sessionId: string | null = null): CheckoutReservation => ({
  request_id: id,
  plan: input.plan,
  price_id: "price_monthly",
  customer_email: "customer@example.test",
  expires_at: expiresAt,
  stripe_session_id: sessionId,
});
const session = (id: string, status: "open" | "complete" | "expired") => ({
  id,
  status,
  mode: "subscription",
  payment_status: status === "complete" ? "paid" : "unpaid",
  subscription: status === "complete" ? "sub_paid" : null,
  client_reference_id: input.userId,
  url: status === "open" ? sessionUrl : null,
});

function fixture(
  initial: CheckoutReservation,
  handler: (request: URL, init?: RequestInit) => Response,
) {
  let current = initial;
  const saved: Array<{ id: string; url: string | null }> = [];
  const removed: string[] = [];
  const stripe = new Stripe("sk_test_local", {
    maxNetworkRetries: 0,
    httpClient: Stripe.createFetchHttpClient((url: string, init?: RequestInit) => {
      try {
        return Promise.resolve(handler(new URL(String(url)), init));
      } catch (error) {
        return Promise.reject(error);
      }
    }),
  });
  return {
    saved,
    removed,
    run: () => resolveCheckout(stripe, {
      claim: () => Promise.resolve<ReservationClaim>({ allowed: true, reservation: current }),
      save: (slot, checkout) => {
        assert.equal(slot.request_id, current.request_id);
        saved.push({ id: checkout.id, url: checkout.url });
        current = { ...current, stripe_session_id: checkout.id };
        return Promise.resolve(true);
      },
      remove: (slot) => {
        assert.equal(slot.request_id, current.request_id);
        removed.push(slot.request_id);
        current = reservation("replacement", now + 3600);
        return Promise.resolve();
      },
    }, input, () => now),
  };
}

Deno.test("recovers the original Stripe session when the first response is lost", async () => {
  const requests: Array<{ key: string | null; body: string }> = [];
  const stripeSessions = new Map<string | null, ReturnType<typeof session>>();
  const test = fixture(reservation("original", now + 3600), (url, init) => {
    if (init?.method === "POST") {
      const key = new Headers(init.headers).get("idempotency-key");
      requests.push({ key, body: String(init.body) });
      const existing = stripeSessions.get(key);
      if (existing) return Response.json(existing);
      stripeSessions.set(key, session("cs_original", "open"));
      throw new Error("Stripe response lost after creation");
    }
    assert.equal(url.pathname, "/v1/checkout/sessions/cs_original");
    return Response.json(session("cs_original", "open"));
  });

  await assert.rejects(test.run());
  assert.deepEqual(test.saved, []);
  assert.deepEqual(await test.run(), { url: sessionUrl });
  assert.equal(requests.length, 2);
  assert.deepEqual(requests[0], requests[1]);
  assert.equal(requests[0].key, "landmensure-checkout-original");
  assert.equal(new URLSearchParams(requests[0].body).has("currency"), false);
  assert.equal(stripeSessions.size, 1);
  assert.deepEqual(test.saved, [{ id: "cs_original", url: sessionUrl }]);
  assert.deepEqual(test.removed, []);
});

Deno.test("creates a BRL subscription checkout with card, Pix and three-day Boleto", async () => {
  const test = fixture({ ...reservation("br", now + 3600), brazil_checkout: true }, (_url, init) => {
    if (init?.method === "POST") {
      const payload = new URLSearchParams(String(init.body));
      const methods = [...payload].filter(([key]) => key.startsWith("payment_method_types"))
        .map(([, value]) => value);
      assert.deepEqual(methods, ["card", "pix", "boleto"]);
      assert.equal(payload.get("mode"), "subscription");
      assert.equal(payload.get("currency"), "brl");
      assert.equal(payload.get("payment_method_options[boleto][expires_after_days]"), "3");
      assert.equal(payload.get("payment_method_options[pix][mandate_options][payment_schedule]"), "monthly");
      assert.equal(new Headers(init.headers).get("stripe-version"), "2026-11-18.endive");
    }
    return Response.json(session("cs_br", "open"));
  });
  assert.deepEqual(await test.run(), { url: sessionUrl });
});

Deno.test("replaces a confirmed expired session and creates a new checkout in one request", async () => {
  const posts: string[] = [];
  const test = fixture(reservation("original", now - 5, "cs_expired"), (url, init) => {
    if (url.pathname.endsWith("/cs_expired")) return Response.json(session("cs_expired", "expired"));
    if (init?.method === "POST") {
      posts.push(new Headers(init.headers).get("idempotency-key") ?? "");
    }
    return Response.json(session("cs_new", "open"));
  });
  assert.deepEqual(await test.run(), { url: sessionUrl });
  assert.deepEqual(test.removed, ["original"]);
  assert.deepEqual(posts, ["landmensure-checkout-replacement"]);
});

Deno.test("reconciles an expired reservation without a Stripe ID before replacing it", async () => {
  const calls: string[] = [];
  const test = fixture(reservation("original", now - 5), (url, init) => {
    calls.push(`${init?.method} ${url.pathname}`);
    if (url.pathname.endsWith("/sessions") && init?.method === "GET") {
      assert.equal(url.searchParams.get("created[gte]"), String(now - 3605));
      return Response.json({ object: "list", has_more: false, data: [session("cs_expired", "expired")] });
    }
    return Response.json(session("cs_new", "open"));
  });
  assert.deepEqual(await test.run(), { url: sessionUrl });
  assert.deepEqual(test.removed, ["original"]);
  assert.deepEqual(calls, [
    "GET /v1/checkout/sessions", "POST /v1/checkout/sessions", "GET /v1/checkout/sessions/cs_new",
  ]);
});

Deno.test("keeps an expired reservation when reconciliation finds a completed payment", async () => {
  const test = fixture(reservation("original", now - 5), (url, init) => {
    assert.notEqual(init?.method, "POST");
    if (url.pathname.endsWith("/sub_paid")) return Response.json({ id: "sub_paid", status: "active" });
    return Response.json({ object: "list", has_more: false, data: [session("cs_paid", "complete")] });
  });
  const result = await test.run();
  assert("error" in result);
  assert.equal(result.status, 409);
  assert.deepEqual(test.removed, []);
  assert.deepEqual(test.saved, []);
});

Deno.test("keeps an expired reservation when Stripe reconciliation fails", async () => {
  const test = fixture(reservation("original", now - 5), () => {
    throw new Error("Stripe unavailable");
  });
  await assert.rejects(test.run());
  assert.deepEqual(test.removed, []);
});
