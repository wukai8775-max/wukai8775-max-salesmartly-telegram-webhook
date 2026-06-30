const {
  normalizeOfficialPayload,
  cacheSalesmartlyProfile,
  findDeepValue,
  firstNonEmpty,
  valueOrFallback,
  getDisplayName,
  getContactDisplayValue,
  getSearchKeyword,
  extractPhoneFromText,
  extractEmailFromText,
} = require("../lib/salesmartly-profile");
const {
  saveOfficialWebhookEvent,
  getMessagesForCustomer,
  updateCustomerByIdentity,
  markPendingTasksSkipped,
  insertFollowupLog,
} = require("../lib/supabase-store");
const { sendTelegramMessage } = require("../lib/telegram");
const { isOptOutMessage } = require("../lib/followup-rules");
const { getAssignedStaffName, getAssignedStaffId } = require("../lib/staff-profile");

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

function normalizeMessageText(text) {
  return String(text || "")
    .replace(/\r\n/g, "\n")
    .replace(/\uFF1A/g, ":")
    .toLowerCase()
    .trim();
}

function getMessageLines(text) {
  return String(text || "")
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function isLikelyNameLine(line) {
  const text = String(line || "").trim();

  if (!text || text.length < 3 || text.length > 80 || /[0-9@:/\\]/.test(text)) {
    return false;
  }

  if (
    /\b(usa|united states|canada|uk|australia|address|phone|email|postal|postcode|zip|shipping|delivery|country|region)\b/i.test(
      text
    )
  ) {
    return false;
  }

  return /^[a-z][a-z\s.'-]+$/i.test(text) && text.split(/\s+/).length >= 2;
}

function isOfficialShippingInfoMessage(text) {
  const normalized = normalizeMessageText(text);

  if (!normalized) {
    return false;
  }

  const lines = getMessageLines(text);
  const hasPhone = Boolean(extractPhoneFromText(normalized));
  const hasEmail = Boolean(extractEmailFromText(normalized));
  const hasLikelyNameLine = lines.some(isLikelyNameLine);
  const hasCountryOrRegionLine = lines.some((line) =>
    /\b(usa|united states|canada|uk|australia|germany|france|spain|italy|netherlands|country|region)\b/i.test(line)
  );
  const hasPostalCode = /\b\d{4,10}\b/.test(normalized);
  const hasStreetAddress = /\b(street|st\.|road|rd\.|avenue|ave\.|drive|dr\.|lane|ln\.|blvd|apt|suite|unit)\b/i.test(
    normalized
  );
  const hasName =
    /(?:^|\n)\s*(name|full\s+name|customer\s+name)\s*:?\s*\S+/i.test(normalized) ||
    /\bmy\s+name\s+is\s+[a-z][a-z\s.'-]{1,}/i.test(normalized) ||
    hasLikelyNameLine;
  const hasContact =
    /(?:^|\n)\s*(phone|tel|telephone|mobile|whatsapp|email)\s*:?\s*\S+/i.test(normalized) ||
    hasPhone ||
    hasEmail;
  const hasAddress =
    /(?:^|\n)\s*(address|street|city|state|country|postal|postcode|zip|zip\s+code)\s*:?\s*\S+/i.test(
      normalized
    ) ||
    hasPostalCode ||
    hasStreetAddress ||
    hasCountryOrRegionLine;
  const hasStructuredBlock =
    lines.length >= 3 &&
    hasContact &&
    hasAddress &&
    (hasName || (hasPhone && hasEmail) || (hasCountryOrRegionLine && hasPostalCode));

  return (hasName && hasContact && hasAddress) || hasStructuredBlock;
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

function buildOfficialShippingInfoTelegramMessage(profile = {}, lastMessage = "", messages = []) {
  return [
    "【客户已提交收货信息】",
    "",
    `接待客服：${getAssignedStaffName(profile, messages)}`,
    `接待客服ID：${getAssignedStaffId(profile, messages)}`,
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

async function sendOfficialTelegramAlertIfNeeded(profile = {}, direction = "system", messages = []) {
  const lastMessage = valueOrFallback(profile.last_message, "");

  if (direction !== "customer" || !isOfficialShippingInfoMessage(lastMessage)) {
    return {
      sent: false,
      reason: "not_shipping_info",
    };
  }

  try {
    const result = await sendTelegramMessage(buildOfficialShippingInfoTelegramMessage(profile, lastMessage, messages));

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

async function stopFollowupIfCustomerOptedOut(profile = {}, direction = "system") {
  const lastMessage = valueOrFallback(profile.last_message, "");

  if (direction !== "customer" || !isOptOutMessage(lastMessage)) {
    return {
      stopped: false,
      reason: "not_opt_out",
    };
  }

  if (!profile.contact_id && !profile.session_id) {
    return {
      stopped: false,
      reason: "missing_customer_identity",
    };
  }

  try {
    await updateCustomerByIdentity(profile, {
      current_status: "opt_out",
      risk_level: "high",
      followup_stopped: true,
      followup_stop_reason: "customer_opt_out",
      do_not_followup: true,
    });
    await markPendingTasksSkipped(profile, "customer_opt_out");
    await insertFollowupLog({
      contact_id: profile.contact_id,
      session_id: profile.session_id,
      action_type: "skipped",
      status: "opt_out",
      reason: "customer_opt_out",
      raw_result: {
        source: "salesmartly_official_webhook",
        last_customer_message: lastMessage,
      },
    });

    return {
      stopped: true,
      reason: "customer_opt_out",
    };
  } catch (error) {
    console.warn("SaleSmartly official webhook opt-out handling failed", {
      error: error.message,
    });

    return {
      stopped: false,
      reason: "customer_opt_out_update_failed",
      error: error.message,
    };
  }
}

async function handleOfficialWebhookBusiness(req, res) {
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
  const alertProfile = {
    ...storedProfile,
    ...(storeResult.customer || {}),
  };
  const recentMessages = await getMessagesForCustomer(alertProfile, 30).catch((error) => {
    console.warn("SaleSmartly official webhook staff lookup failed", {
      error: error.message,
    });
    return [];
  });
  const staffName = getAssignedStaffName(alertProfile, recentMessages);
  const staffId = getAssignedStaffId(alertProfile, recentMessages);
  const followupStop = await stopFollowupIfCustomerOptedOut(alertProfile, direction);
  const telegramAlert = await sendOfficialTelegramAlertIfNeeded(alertProfile, direction, recentMessages);

  return res.status(200).json({
    success: true,
    ok: true,
    cached: true,
    saved: Boolean(storeResult.saved),
    save_reason: storeResult.saved ? undefined : storeResult.reason,
    followup_stop: followupStop,
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
      staff_name: staffName,
      staff_id: staffId,
    },
  });
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

  return handleOfficialWebhookBusiness(req, res);
};

module.exports.handleOfficialWebhookBusiness = handleOfficialWebhookBusiness;
