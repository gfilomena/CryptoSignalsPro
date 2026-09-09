// Sends one test Web Push notification to the calling device's subscription (used by the
// "Test Notification" button in the Setup panel).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

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

    const vapidPublic = Deno.env.get("VAPID_PUBLIC_KEY");
    const vapidPrivate = Deno.env.get("VAPID_PRIVATE_KEY");
    const vapidSubject = Deno.env.get("VAPID_SUBJECT") || "mailto:alerts@cryptosignalspro.app";
    if (!vapidPublic || !vapidPrivate) {
      return new Response(JSON.stringify({ ok: false, reason: "vapid_not_configured" }), { headers: corsHeaders, status: 200 });
    }

    const body = await req.json();
    const endpoint = body.endpoint as string;
    if (!endpoint) return new Response(JSON.stringify({ ok: false, reason: "missing_endpoint" }), { headers: corsHeaders, status: 400 });

    const { data: row } = await sb.from("push_subscriptions").select("*").eq("endpoint", endpoint).maybeSingle();
    if (!row) return new Response(JSON.stringify({ ok: false, reason: "not_subscribed" }), { headers: corsHeaders, status: 404 });

    webpush.setVapidDetails(vapidSubject, vapidPublic, vapidPrivate);
    const subscription = { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } };
    const payload = JSON.stringify({ title: "CryptoSignals Pro", body: "Notifiche attive — riceverai gli alert BTC/USDT qui.", type: "TEST" });

    await webpush.sendNotification(subscription, payload);
    return new Response(JSON.stringify({ ok: true }), { headers: corsHeaders });
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: (err as Error).message }), { headers: corsHeaders, status: 500 });
  }
});
