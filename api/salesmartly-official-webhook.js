const {
  normalizeOfficialPayload,
  cacheSalesmartlyProfile,
  findDeepValue,
  firstNonEmpty,
} = require("../lib/salesmartly-profile");
const { saveOfficialWebhookEvent } = require("../lib/supabase-store");

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

function normalizeDirection(value) {
  const text = String(value || "").trim().toLowerCase();

  if (["customer", "ai", "human", "system"].includes(text)) {
    return text;
  }

  if (["visitor", "contact", "user", "client", "guest"].includes(text)) {
    return "customer";
  }

  if (text.includes("bot") || text.includes("ai")) {
    return "ai";
  }

  if (text.includes("staff") || text.includes("agent") || text.includes("admin") || text.includes("seller")) {
    return "human";
  }

  if (text.includes("system")) {
    return "system";
  }

  return "";
}

function detectMessageDirection(payload = {}, normalized = {}) {
  const explicit = normalizeDirection(
    firstNonEmpty(
      findDeepValue(payload, ["direction", "message_direction", "from_type", "sender_role"]),
      normalized.direction
    )
  );

  if (explicit) {
    return explicit;
  }

  const senderType = normalizeDirection(
    firstNonEmpty(normalized.sender_type, findDeepValue(payload, ["sender_type", "senderType"]))
  );

  if (senderType) {
    return senderType;
  }

  const sysUserId = firstNonEmpty(normalized.sys_user_id, findDeepValue(payload, ["sys_user_id"]));
  if (sysUserId) {
    return "human";
  }

  return normalized.last_message ? "customer" : "system";
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
  const direction = detectMessageDirection(payload, normalized);
  const storedProfile = {
    ...normalized,
    ...cachedProfile,
  };
  const storeResult = await saveOfficialWebhookEvent(storedProfile, payload, direction).catch((error) => ({
    saved: false,
    reason: error.message,
  }));

  return res.status(200).json({
    success: true,
    ok: true,
    cached: true,
    saved: Boolean(storeResult.saved),
    save_reason: storeResult.saved ? undefined : storeResult.reason,
    event_type: normalized.event_type || "unknown",
    direction,
    profile: {
      ws_display_name: cachedProfile.ws_display_name || "",
      customer_name: cachedProfile.customer_name || "",
      phone: cachedProfile.phone || "",
      email: cachedProfile.email || "",
      channel: cachedProfile.channel || "",
      contact_id: cachedProfile.contact_id || "",
      session_id: cachedProfile.session_id || "",
      project_id: cachedProfile.project_id || "",
      conversation_url: cachedProfile.conversation_url || "",
      last_message: cachedProfile.last_message || "",
      message_time: normalized.message_time || "",
    },
  });
};
