import Stripe from "npm:stripe@17.5.0";
import { createClient } from "npm:@supabase/supabase-js@2";
import { handleDeleteAccount } from "./handler.ts";

const url = Deno.env.get("SUPABASE_URL");
const keys = Deno.env.get("SUPABASE_SECRET_KEYS");
const serviceKey = keys ? JSON.parse(keys).default : Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
if (!url || !serviceKey || !stripeKey) throw new Error("Configure Supabase e Stripe para excluir contas.");

const supabase = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
const stripe = new Stripe(stripeKey, { timeout: 10000, maxNetworkRetries: 0 });
const origins = new Set((Deno.env.get("DELETE_ACCOUNT_ALLOWED_ORIGINS") ?? "").split(",")
  .map(origin => origin.trim()).filter(Boolean));

Deno.serve(request => handleDeleteAccount(request, supabase, stripe, origins));
