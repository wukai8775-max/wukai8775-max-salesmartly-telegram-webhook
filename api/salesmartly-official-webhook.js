const {
  normalizeOfficialPayload,
  cacheSalesmartlyProfile,
} = require("../lib/salesmartly-profile");

function getOfficialWebhookToken(req) {
  const authHeader = req.headers.authorization || "";

  return (
    req.headers["x-salesmartly-webhook-token"] ||
    req.headers["x-webhook-token"] ||
    req.headers["x-salesmartly-token"] ||
    req.headers["x-salesmartly-webhook-secret"] ||
    req.headers.token ||
    authHeader.replace(/^Bearer\s+/i, "") ||
    req.query?.token ||
    req.query?.secret
  );
}

function verifyOfficialWebhookToken(req) {
  const expectedToken = process.env.SALES_SMARTLY_WEBHOOK_TOKEN;

  if (!expectedToken) {
    return {
      ok: false,
      status: 500,
      error: "Missing SALES_SMARTLY_WEBHOOK_TOKEN",
    };
  }

  if (getOfficialWebhookToken(req) !== expectedToken) {
    return {
      ok: false,
      status: 401,
      error: "Invalid SaleSmartly webhook token",
    };
  }

  return {
    ok: true,
  };
}

module.exports = async function handler(req, res) {
  if (req.method === "GET") {
    return res.status(200).json({
      ok: true,
      message: "SaleSmartly official webhook receiver is running",
    });
  }

  if (req.method !== "POST") {
    return res.status(405).json({
      ok: false,
      error: "Method Not Allowed",
    });
  }

  const tokenCheck = verifyOfficialWebhookToken(req);
  if (!tokenCheck.ok) {
    return res.status(tokenCheck.status).json({
      ok: false,
      error: tokenCheck.error,
    });
  }

  const payload = req.body || {};
  const normalized = normalizeOfficialPayload(payload);
  const cachedProfile = cacheSalesmartlyProfile(normalized);

  return res.status(200).json({
    success: true,
    ok: true,
    cached: true,
    event_type: normalized.event_type || "unknown",
    profile: {
      ws_display_name: cachedProfile.ws_display_name || "",
      customer_name: cachedProfile.customer_name || "",
      phone: cachedProfile.phone || "",
      email: cachedProfile.email || "",
      channel: cachedProfile.channel || "",
      contact_id: cachedProfile.contact_id || "",
      session_id: cachedProfile.session_id || "",
      project_id: cachedProfile.project_id || "",
      last_message: cachedProfile.last_message || "",
    },
  });
};
