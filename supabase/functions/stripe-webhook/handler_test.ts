import assert from "node:assert/strict";
import Stripe from "npm:stripe@17.5.0";
import { createClient } from "npm:@supabase/supabase-js@2";
import { handleStripeWebhook } from "./handler.ts";

const secret = "whsec_local_test";
const body = JSON.stringify({
  id: "evt_fixture",
  type: "customer.subscription.updated",
  livemode: false,
  data: { object: { object: "subscription", id: "sub_fixture" } },
});

async function fixture({ duplicate = false, conflict = false, payload = body, invoicePaid = false,
  asyncFailure = false } = {}) {
  const writes: Array<Record<string, unknown>> = [];
  const deleted: URL[] = [];
  let stripeReads = 0;
  let databaseReads = 0;
  let responseRevision = "revision-before";
  const stripe = new Stripe("sk_test_local", {
    httpClient: Stripe.createFetchHttpClient((input: string, init?: RequestInit) => {
      stripeReads++;
      const path = new URL(input).pathname;
      if (asyncFailure && path.endsWith("/cs_fixture")) {
        return Promise.resolve(Response.json({
          id: "cs_fixture", payment_status: "unpaid", invoice: "in_fixture", subscription: "sub_fixture",
          client_reference_id: "8f41852a-244d-49f9-bafa-b95a00ecec11",
        }));
      }
      if (asyncFailure && path.endsWith("/void")) {
        return Promise.resolve(Response.json({ id: "in_fixture", status: "void" }));
      }
      return Promise.resolve(Response.json({
        id: "sub_fixture",
        customer: "cus_fixture",
        status: init?.method === "DELETE" || (conflict && stripeReads > 1) ? "canceled" : "active",
        metadata: { user_id: "8f41852a-244d-49f9-bafa-b95a00ecec11", plan: "monthly" },
        current_period_start: 1700000000,
        current_period_end: 1702592000,
        cancel_at_period_end: false,
        livemode: false,
        latest_invoice: {
          id: "in_fixture", billing_reason: "subscription_create",
          status: invoicePaid ? "paid" : "open", amount_paid: invoicePaid ? 2000 : 0,
        },
      }));
    }),
  });
  const supabase = createClient("https://fixture.invalid", "local-test-key", {
    global: {
      fetch: (input, init) => {
        const url = new URL(String(input));
        const pathname = url.pathname;
        if (init?.method === "DELETE") {
          deleted.push(url);
          return Promise.resolve(new Response(null, { status: 204 }));
        }
        if (pathname.endsWith("/rpc/apply_stripe_subscription_event")) {
          writes.push(JSON.parse(String(init?.body)));
          if (conflict && writes.length === 1) {
            responseRevision = "revision-after";
            return Promise.resolve(Response.json("stale"));
          }
          return Promise.resolve(Response.json("applied"));
        }
        databaseReads++;
        return Promise.resolve(Response.json(pathname.endsWith("/stripe_webhook_events")
          ? duplicate ? [{ event_id: "evt_fixture" }] : []
          : [{ stripe_sync_revision: responseRevision }]));
      },
    },
  });
  const signature = await stripe.webhooks.generateTestHeaderStringAsync({ payload, secret });
  return {
    writes,
    deleted,
    stripeReads: () => stripeReads,
    databaseReads: () => databaseReads,
    send: (requestBody = payload) => handleStripeWebhook(new Request("https://fixture.invalid", {
      method: "POST",
      body: requestBody,
      headers: { "stripe-signature": signature },
    }), stripe, supabase, secret),
  };
}

Deno.test("rejects a changed signed body before any Stripe or database request", async () => {
  const test = await fixture();
  assert.equal((await test.send(body + " ")).status, 400);
  assert.equal(test.stripeReads(), 0);
  assert.equal(test.databaseReads(), 0);
  assert.equal(test.writes.length, 0);
});

const checkoutEvent = (type: string, paymentStatus: string) => JSON.stringify({
  id: "evt_fixture", type, livemode: false,
  data: { object: {
    object: "checkout.session", id: "cs_fixture", subscription: "sub_fixture",
    invoice: "in_fixture", payment_status: paymentStatus,
  } },
});

Deno.test("unpaid Boleto Checkout and active subscription with an open invoice cannot grant Pro", async () => {
  const checkout = await fixture({ payload: checkoutEvent("checkout.session.completed", "unpaid") });
  assert.equal((await checkout.send()).status, 200);
  assert.equal(checkout.writes.length, 0);
  const update = await fixture();
  assert.equal((await update.send()).status, 200);
  assert.equal((update.writes[0].p_subscription as { status: string }).status, "incomplete");
});

Deno.test("async payment success or a paid invoice grants Pro for an active subscription", async () => {
  const paidInvoice = JSON.stringify({
    id: "evt_invoice", type: "invoice.paid", livemode: false,
    data: { object: { object: "invoice", id: "in_fixture", subscription: "sub_fixture" } },
  });
  for (const payload of [checkoutEvent("checkout.session.async_payment_succeeded", "paid"), paidInvoice]) {
    const test = await fixture({ payload, invoicePaid: payload === paidInvoice });
    assert.equal((await test.send()).status, 200);
    assert.equal((test.writes[0].p_subscription as { status: string }).status, "active");
  }
});

Deno.test("failed Boleto voids the initial invoice and cancels before removing its own reservation", async () => {
  const test = await fixture({ payload: checkoutEvent("checkout.session.async_payment_failed", "unpaid"), asyncFailure: true });
  assert.equal((await test.send()).status, 200);
  assert.equal(test.stripeReads(), 5);
  assert.equal(test.deleted.length, 1);
  assert.equal(test.deleted[0].searchParams.get("stripe_session_id"), "eq.cs_fixture");
  assert.equal((test.writes[0].p_subscription as { status: string }).status, "canceled");
});

Deno.test("acknowledges an already recorded event without fetching or applying it", async () => {
  const test = await fixture({ duplicate: true });
  assert.equal((await test.send()).status, 200);
  assert.equal(test.stripeReads(), 0);
  assert.equal(test.writes.length, 0);
});

Deno.test("refetches on a revision conflict and forwards Acacia billing dates", async () => {
  const test = await fixture({ conflict: true });
  assert.equal((await test.send()).status, 200);
  assert.equal(test.stripeReads(), 2);
  assert.deepEqual(test.writes.map((write) => write.p_expected_revision), ["revision-before", "revision-after"]);
  assert.deepEqual(test.writes[1].p_subscription, {
    user_id: "8f41852a-244d-49f9-bafa-b95a00ecec11",
    provider_customer_id: "cus_fixture",
    provider_subscription_id: "sub_fixture",
    status: "canceled",
    current_period_start: "2023-11-14T22:13:20.000Z",
    current_period_end: "2023-12-14T22:13:20.000Z",
    cancel_at_period_end: false,
  });
});
