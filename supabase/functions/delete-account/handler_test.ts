import assert from "node:assert/strict";
import Stripe from "npm:stripe@17.5.0";
import { createClient } from "npm:@supabase/supabase-js@2";
import { handleDeleteAccount } from "./handler.ts";

const userId = "53000000-0000-4000-8000-000000000001";
const origin = "https://landmensure.example";

function fixture({ pending = false, billingFails = false, wrongOwner = false } = {}) {
  const calls: string[] = [];
  const supabase = createClient("https://supabase.example", "service-fixture-key", {
    global: {
      fetch: (input, init) => {
        const url = new URL(String(input));
        const { pathname } = url;
        const method = init?.method ?? "GET";
        calls.push(method + " " + pathname);
        if (pathname === "/auth/v1/user") {
          if (new Headers(init?.headers).get("Authorization") !== "Bearer verified-user-token") {
            return Promise.resolve(Response.json({ msg: "Invalid JWT" }, { status: 401 }));
          }
          return Promise.resolve(Response.json({ id: userId }));
        }
        if (pathname === "/rest/v1/rpc/begin_account_deletion") {
          assert.deepEqual(JSON.parse(String(init?.body)), { p_user_id: userId });
          return Promise.resolve(Response.json(null));
        }
        if (pathname === "/rest/v1/checkout_reservations") {
          assert.equal(url.searchParams.get("user_id"), "eq." + userId);
          return Promise.resolve(Response.json(pending
            ? [{ stripe_session_id: null, expires_at: Math.floor(Date.now() / 1000) + 3600 }]
            : [{ stripe_session_id: "cs_1", expires_at: 1 }]));
        }
        if (pathname === "/rest/v1/subscriptions") {
          assert.equal(url.searchParams.get("user_id"), "eq." + userId);
          return Promise.resolve(Response.json([{ provider_subscription_id: "sub_1" }]));
        }
        assert.equal(pathname, "/auth/v1/admin/users/" + userId);
        if (method === "GET") return Promise.resolve(Response.json({ id: userId }));
        assert.equal(method, "DELETE");
        assert.deepEqual(JSON.parse(String(init?.body)), { should_soft_delete: false });
        return Promise.resolve(Response.json({}));
      },
    },
  });
  const stripe = new Stripe("sk_test_local", {
    maxNetworkRetries: 0,
    httpClient: Stripe.createFetchHttpClient((input: string, init?: RequestInit) => {
      const { pathname } = new URL(input);
      const method = init?.method ?? "GET";
      calls.push(method + " " + pathname);
      if (pathname === "/v1/checkout/sessions/cs_1") {
        return Promise.resolve(Response.json({ id: "cs_1", status: "open", client_reference_id: userId }));
      }
      if (pathname === "/v1/checkout/sessions/cs_1/expire") {
        return Promise.resolve(Response.json({ id: "cs_1", status: "expired" }));
      }
      if (pathname === "/v1/subscriptions/search") {
        return Promise.resolve(Response.json({ object: "search_result", data: [], has_more: false }));
      }
      if (pathname === "/v1/subscriptions/sub_1") {
        if (method === "DELETE" && billingFails) {
          return Promise.resolve(Response.json({ error: { type: "api_error" } }, { status: 500 }));
        }
        return Promise.resolve(Response.json({
          id: "sub_1",
          status: method === "DELETE" ? "canceled" : "active",
          metadata: { user_id: wrongOwner ? "53000000-0000-4000-8000-000000000002" : userId },
        }));
      }
      if (pathname === "/v1/invoices") {
        return Promise.resolve(Response.json({ object: "list", data: [{ id: "in_1" }], has_more: false }));
      }
      assert.equal(pathname, "/v1/invoices/in_1/void");
      return Promise.resolve(Response.json({ status: "void" }));
    }),
  });
  return {
    calls,
    send({ token = "verified-user-token", confirmation = "EXCLUIR", requestOrigin = origin } = {}) {
      return handleDeleteAccount(new Request("https://supabase.example/delete-account", {
        method: "POST",
        headers: { Authorization: "Bearer " + token, Origin: requestOrigin },
        body: JSON.stringify({ confirmation, userId: "other-user" }),
      }), supabase, stripe, new Set([origin]));
    },
  };
}

Deno.test("deletion trusts the bearer identity and closes billing before hard deletion", async () => {
  const test = fixture();
  const result = await test.send();
  assert.equal(result.status, 200);
  assert.equal(result.headers.get("Access-Control-Allow-Origin"), origin);
  assert.deepEqual(await result.json(), { deleted: true });
  assert.equal(test.calls[0], "GET /auth/v1/user");
  assert.equal(test.calls[1], "POST /rest/v1/rpc/begin_account_deletion");
  assert(test.calls.includes("POST /v1/checkout/sessions/cs_1/expire"));
  assert(test.calls.includes("DELETE /v1/subscriptions/sub_1"));
  assert.deepEqual(test.calls.slice(-3), [
    "POST /v1/invoices/in_1/void", "GET /auth/v1/admin/users/" + userId,
    "DELETE /auth/v1/admin/users/" + userId,
  ]);
});

Deno.test("deletion rejects invalid authentication, confirmation and browser origins", async () => {
  const test = fixture();
  assert.equal((await test.send({ requestOrigin: "https://other.example" })).status, 403);
  assert.equal(test.calls.length, 0);
  assert.equal((await test.send({ token: "invalid" })).status, 401);
  assert.equal((await test.send({ confirmation: "excluir" })).status, 400);
  assert.deepEqual(test.calls, ["GET /auth/v1/user", "GET /auth/v1/user"]);
});

Deno.test("an unresolved checkout leaves the account available for a retry", async () => {
  const test = fixture({ pending: true });
  assert.equal((await test.send()).status, 409);
  assert(test.calls.includes("POST /rest/v1/rpc/begin_account_deletion"));
  assert(!test.calls.some(call => call.includes("/v1/subscriptions/") || call.startsWith("DELETE")));
});

Deno.test("payment cancellation failure or ownership mismatch prevents account deletion", async () => {
  for (const test of [fixture({ billingFails: true }), fixture({ wrongOwner: true })]) {
    assert.equal((await test.send()).status, 503);
    assert(!test.calls.some(call => call.startsWith("DELETE /auth/")));
  }
});
