const { saveOfficialWebhookEvent } = require("../lib/supabase-store");
const { firstNonEmpty } = require("../lib/salesmartly-profile");

function getWebhookSecret(req) {
  return String(req.headers["x-salesmartly-webhook-secret"] || "").trim();
}

function verifyWebhookSecret(req) {
  const expectedSecret = process.env.SALES_SMARTLY_WEBHOOK_SECRET;

  if (!expectedSecret) {
    return false;
  }

  return getWebhookSecret(req) === expectedSecret;
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      ok: false,
      error: "Method Not Allowed",
    });
  }

  if (!verifyWebhookSecret(req)) {
    return res.status(401).json({
      ok: false,
      error: "Invalid webhook secret",
    });
  }

  const body = req.body || {};
  const suffix = String(Date.now());
  const profile = {
    contact_id: firstNonEmpty(body.contact_id, `debug_contact_${suffix}`),
    session_id: firstNonEmpty(body.session_id, `debug_session_${suffix}`),
    project_id: firstNonEmpty(body.project_id, "debug_project"),
    ws_display_name: firstNonEmpty(body.ws_display_name, "Debug Customer"),
    customer_name: firstNonEmpty(body.customer_name, "Debug Customer"),
    phone: firstNonEmpty(body.phone),
    email: firstNonEmpty(body.email),
    channel: firstNonEmpty(body.channel, "debug"),
    last_message: firstNonEmpty(body.last_message, "Debug Supabase insert test message"),
    message_time: new Date().toISOString(),
  };
  const payload = {
    event: "debug_supabase_insert",
    data: {
      contact_id: profile.contact_id,
      session_id: profile.session_id,
      project_id: profile.project_id,
      content: profile.last_message,
      channel: profile.channel,
    },
  };
  const result = await saveOfficialWebhookEvent(profile, payload, "customer");
  const ok = Boolean(result.saved && result.customer_success && result.message_success);

  return res.status(ok ? 200 : 500).json({
    ok,
    success: ok,
    saved: Boolean(result.saved),
    will_upsert_customer: Boolean(result.will_upsert_customer),
    will_insert_message: Boolean(result.will_insert_message),
    customer_success: Boolean(result.customer_success),
    message_success: Boolean(result.message_success),
    customer_error: result.customer_error || "",
    message_error: result.message_error || "",
    reason: result.reason || "",
    supabase_key_role: result.supabase_key_role || "",
    debug_contact_id: profile.contact_id,
    debug_session_id: profile.session_id,
  });
};
