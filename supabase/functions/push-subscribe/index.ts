// Registers/updates or removes a Web Push subscription for this device, and lets it choose
// which alert types it wants to receive. No login in this app: identity is the push endpoint.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey",
  "Content-Type": "application/json",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const sb = createClient(supabaseUrl, serviceKey);

    const body = await req.json();
    const action = body.action as "subscribe" | "unsubscribe" | "update_preferences";

    if (action === "subscribe") {
      const sub = body.subscription;
      if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) {
        return new Response(JSON.stringify({ ok: false, reason: "invalid_subscription" }), { headers: corsHeaders, status: 400 });
      }
      // SETUP_DETECTED is deliberately excluded from this fallback — prudent mode never pushes
      // for a setup that isn't yet a real, risk-validated trade (see PUSH_ALERT_TYPES in
      // signal-cycle). Still selectable/visible in the Signal History, just not push-worthy.
      const alertTypes = Array.isArray(body.alertTypes) && body.alertTypes.length > 0
        ? body.alertTypes
        : ["ENTRY_CONFIRMED", "STOP_HIT", "TP1_HIT", "TP2_HIT", "SETUP_INVALIDATED"];

      const { error } = await sb.from("push_subscriptions").upsert(
        { endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth, alert_types: alertTypes, updated_at: new Date().toISOString() },
        { onConflict: "endpoint" },
      );
      if (error) return new Response(JSON.stringify({ ok: false, error: error.message }), { headers: corsHeaders, status: 500 });
      return new Response(JSON.stringify({ ok: true, action: "subscribed" }), { headers: corsHeaders });
    }

    if (action === "unsubscribe") {
      const endpoint = body.endpoint as string;
      if (!endpoint) return new Response(JSON.stringify({ ok: false, reason: "missing_endpoint" }), { headers: corsHeaders, status: 400 });
      await sb.from("push_subscriptions").delete().eq("endpoint", endpoint);
      return new Response(JSON.stringify({ ok: true, action: "unsubscribed" }), { headers: corsHeaders });
    }

    if (action === "update_preferences") {
      const endpoint = body.endpoint as string;
      const alertTypes = body.alertTypes;
      if (!endpoint || !Array.isArray(alertTypes)) {
        return new Response(JSON.stringify({ ok: false, reason: "invalid_payload" }), { headers: corsHeaders, status: 400 });
      }
      const { error } = await sb.from("push_subscriptions").update({ alert_types: alertTypes, updated_at: new Date().toISOString() }).eq("endpoint", endpoint);
      if (error) return new Response(JSON.stringify({ ok: false, error: error.message }), { headers: corsHeaders, status: 500 });
      return new Response(JSON.stringify({ ok: true, action: "updated" }), { headers: corsHeaders });
    }

    return new Response(JSON.stringify({ ok: false, reason: "invalid_action" }), { headers: corsHeaders, status: 400 });
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: (err as Error).message }), { headers: corsHeaders, status: 500 });
  }
});
