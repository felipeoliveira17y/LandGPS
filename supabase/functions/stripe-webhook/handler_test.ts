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

async function fixture({ duplicate = false, conflict = false } = {}) {
  const writes: Array<Record<string, unknown>> = [];
  let stripeReads = 0;
  let databaseReads = 0;
  let responseRevision = "revision-before";
  const stripe = new Stripe("sk_test_local", {
    httpClient: Stripe.createFetchHttpClient(() => {
      stripeReads++;
      return Promise.resolve(Response.json({
        id: "sub_fixture",
        customer: "cus_fixture",
        status: stripeReads === 1 ? "active" : "canceled",
        metadata: { user_id: "8f41852a-244d-49f9-bafa-b95a00ecec11", plan: "monthly" },
        current_period_start: 1700000000,
        current_period_end: 1702592000,
        cancel_at_period_end: false,
        livemode: false,
      }));
    }),
  });
  const supabase = createClient("https://fixture.invalid", "local-test-key", {
    global: {
      fetch: (input, init) => {
        const pathname = new URL(String(input)).pathname;
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
  const signature = await stripe.webhooks.generateTestHeaderStringAsync({ payload: body, secret });
  return {
    writes,
    stripeReads: () => stripeReads,
    databaseReads: () => databaseReads,
    send: (payload = body) => handleStripeWebhook(new Request("https://fixture.invalid", {
      method: "POST",
      body: payload,
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
