const {
  normalizeOfficialPayload,
  cacheSalesmartlyProfile,
  findDeepValue,
  firstNonEmpty,
  valueOrFallback,
  getDisplayName,
  getContactDisplayValue,
  getSearchKeyword,
} = require("../lib/salesmartly-profile");
const { saveOfficialWebhookEvent } = require("../lib/supabase-store");
const { isShippingInfoMessage } = require("../lib/followup-rules");
const { sendTelegramMessage } = require("../lib/telegram");

function normalizeTokenValue(value) {
  if (Array.isArray(value)) {
    return normalizeTokenValue(value[0]);
  }

  if (value === undefined || value === null) {
    return "";
  }

  return String(value).trim();
}

function getBodyKeyNames(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return [];
  }

  return Object.keys(body);
}

function getOfficialWebhookTokenCandidates(req) {
  const authHeader = normalizeTokenValue(req.headers.authorization);
  const body = req.body && typeof req.body === "object" ? req.body : {};

  return [
    req.headers["x-salesmartly-webhook-token"],
    req.headers["x-salesmartly-signature"],
    req.headers.signature,
    req.headers["external-sign"],
    req.headers["x-webhook-token"],
    req.headers["x-salesmartly-token"],
    req.headers["x-salesmartly-webhook-secret"],
    req.headers.token,
    authHeader.replace(/^Bearer\s+/i, ""),
    req.query?.secret,
    req.query?.token,
    body.token,
    body.signature,
    body.webhook_token,
  ]
    .map(normalizeTokenValue)
    .filter(Boolean);
}

function logOfficialWebhookAuthFailure(req) {
  console.warn("SaleSmartly official webhook auth failed", {
    received_header_names: Object.keys(req.headers || {}),
    query_key_names: Object.keys(req.query || {}),
    body_top_level_key_names: getBodyKeyNames(req.body),
    SALES_SMARTLY_WEBHOOK_TOKEN_exists: Boolean(process.env.SALES_SMARTLY_WEBHOOK_TOKEN),
    SALES_SMARTLY_WEBHOOK_SECRET_exists: Boolean(process.env.SALES_SMARTLY_WEBHOOK_SECRET),
  });
}

function verifyOfficialWebhookToken(req) {
  const expectedToken = process.env.SALES_SMARTLY_WEBHOOK_TOKEN;
  const expectedSecret = process.env.SALES_SMARTLY_WEBHOOK_SECRET;
  const tokenCandidates = getOfficialWebhookTokenCandidates(req);
  const querySecret = normalizeTokenValue(req.query?.secret);

  if (!expectedToken && !expectedSecret) {
    return {
      ok: false,
      status: 500,
      error: "Missing SALES_SMARTLY_WEBHOOK_TOKEN or SALES_SMARTLY_WEBHOOK_SECRET",
    };
  }

  if (expectedToken && tokenCandidates.includes(expectedToken)) {
    return {
      ok: true,
    };
  }

  if (expectedSecret && querySecret === expectedSecret) {
    return {
      ok: true,
    };
  }

  logOfficialWebhookAuthFailure(req);

  return {
    ok: false,
    status: 401,
    error: "Invalid SaleSmartly webhook token",
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

function getAiEmployeeName(profile = {}) {
  return valueOrFallback(
    profile.ai_employee_name || profile.agent_name || profile.employee_name || profile.staff_name || profile.bot_name
  );
}

function getSubmittedCustomerName(text, fallbackName) {
  const normalized = String(text || "").replace(/\r\n/g, "\n").replace(/\uFF1A/g, ":").trim();

  if (!normalized) {
    return valueOrFallback(fallbackName);
  }

  for (const line of normalized.split("\n")) {
    const labelled = line.match(/^\s*(name|full name|customer name)\s*:?\s*(.+?)\s*$/i);
    if (labelled?.[2]?.trim()) {
      return valueOrFallback(labelled[2].trim());
    }

    const textLine = line.trim();
    if (
      /^[a-z][a-z\s.'-]+$/i.test(textLine) &&
      textLine.split(/\s+/).length >= 2 &&
      !/\b(usa|united states|canada|uk|address|phone|email|postal|zip|country|region)\b/i.test(textLine)
    ) {
      return valueOrFallback(textLine);
    }
  }

  return valueOrFallback(fallbackName);
}

function buildWsOrSearchLine(profile = {}, lastMessage = "") {
  const wsDisplayName = getDisplayName(profile);

  if (wsDisplayName) {
    return `WS名称：${wsDisplayName}`;
  }

  return `搜索关键词：${getSearchKeyword(profile, lastMessage)}`;
}

function buildOfficialShippingInfoTelegramMessage(profile = {}, lastMessage = "") {
  return [
    "【客户已提交收货信息】",
    "",
    `AI员工：${getAiEmployeeName(profile)}`,
    buildWsOrSearchLine(profile, lastMessage),
    `客户填写姓名：${getSubmittedCustomerName(lastMessage, profile.customer_name)}`,
    `渠道：${valueOrFallback(profile.channel)}`,
    `联系方式：${getContactDisplayValue(profile, lastMessage)}`,
    "",
    "客户提交内容：",
    valueOrFallback(lastMessage),
    "",
    "会话链接：",
    valueOrFallback(profile.conversation_url),
    "",
    `项目ID：${valueOrFallback(profile.project_id)}`,
    `客户ID：${valueOrFallback(profile.contact_id)}`,
    `会话ID：${valueOrFallback(profile.session_id)}`,
    "",
    "请同事尽快进入 SaleSmartly 后台处理：",
    "",
    "1. 用 WS名称 或手机号搜索客户",
    "2. 核对客户收货信息",
    "3. 确认产品和数量",
    "4. 推进报价 / 付款 / 下单流程",
  ].join("\n");
}

async function sendOfficialTelegramAlertIfNeeded(profile = {}, direction = "system") {
  const lastMessage = valueOrFallback(profile.last_message, "");

  if (direction !== "customer" || !isShippingInfoMessage(lastMessage)) {
    return {
      sent: false,
      reason: "not_shipping_info",
    };
  }

  try {
    const result = await sendTelegramMessage(buildOfficialShippingInfoTelegramMessage(profile, lastMessage));

    return {
      sent: true,
      alert_type: "shipping_info",
      telegram_message_id: result.result?.message_id,
    };
  } catch (error) {
    console.warn("SaleSmartly official webhook Telegram alert failed", {
      alert_type: "shipping_info",
      error: error.message,
    });

    return {
      sent: false,
      alert_type: "shipping_info",
      error: error.message,
    };
  }
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
  const telegramAlert = await sendOfficialTelegramAlertIfNeeded(storedProfile, direction);

  return res.status(200).json({
    success: true,
    ok: true,
    cached: true,
    saved: Boolean(storeResult.saved),
    save_reason: storeResult.saved ? undefined : storeResult.reason,
    telegram_alert: telegramAlert,
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
