const {
  valueOrFallback,
  firstNonEmpty,
  getDisplayName,
  getContactDisplayValue,
  getSearchKeyword,
  extractPhoneFromText,
  extractEmailFromText,
  enrichPayloadWithSalesmartlyProfile,
} = require("../lib/salesmartly-profile");
const {
  isShippingInfoMessage,
  isCallRequestMessage,
  isAiDoubtMessage,
} = require("../lib/followup-rules");
const { sendTelegramMessage } = require("../lib/telegram");

function getLastMessage(body) {
  return valueOrFallback(body.last_message || body.message || body.content, "");
}

function getAiEmployeeName(body) {
  return valueOrFallback(
    body.ai_employee_name || body.agent_name || body.employee_name || body.staff_name || body.bot_name
  );
}

function getSubmittedCustomerName(text, fallbackName) {
  const normalized = String(text || "").replace(/\r\n/g, "\n").replace(/\uFF1A/g, ":").trim();

  if (!normalized) {
    return valueOrFallback(fallbackName);
  }

  for (const line of normalized.split("\n")) {
    const match = line.match(/^\s*(name|full name|customer name)\s*:?\s*(.+?)\s*$/i);
    if (match?.[2]?.trim()) {
      return valueOrFallback(
        match[2]
          .replace(/\s+(phone|tel|mobile|whatsapp|postal|postcode|zip\s*code|address|email)\s*:.*$/i, "")
          .trim()
      );
    }
  }

  const inlineMatch = normalized.match(/\bmy\s+name\s+is\s+([^\n,;]+)/i);
  return valueOrFallback(inlineMatch?.[1]?.trim() || fallbackName);
}

function getWebhookSecret(req) {
  const authHeader = req.headers.authorization || "";

  return (
    req.headers["x-salesmartly-webhook-secret"] ||
    req.headers["x-webhook-secret"] ||
    authHeader.replace(/^Bearer\s+/i, "") ||
    req.query?.secret
  );
}

function verifyWebhookSecret(req) {
  const expectedSecret = process.env.SALES_SMARTLY_WEBHOOK_SECRET;

  if (!expectedSecret) {
    return true;
  }

  return getWebhookSecret(req) === expectedSecret;
}

function detectAlertType(payload) {
  const text = getLastMessage(payload);

  if (isShippingInfoMessage(text)) {
    return "shipping_info";
  }

  if (isCallRequestMessage(text)) {
    return "call_request";
  }

  if (isAiDoubtMessage(text)) {
    return "ai_doubt";
  }

  return null;
}

function buildWsOrSearchLine(body, lastMessage) {
  const wsDisplayName = getDisplayName(body);

  if (wsDisplayName) {
    return `WS名称：${wsDisplayName}`;
  }

  return `搜索关键词：${getSearchKeyword(body, lastMessage)}`;
}

function buildCommonTopLines(body, lastMessage, options = {}) {
  const lines = [
    `AI员工：${getAiEmployeeName(body)}`,
    buildWsOrSearchLine(body, lastMessage),
  ];

  if (options.submittedCustomerName) {
    lines.push(`客户填写姓名：${getSubmittedCustomerName(lastMessage, body.customer_name)}`);
  } else {
    lines.push(`客户：${valueOrFallback(body.customer_name)}`);
  }

  lines.push(
    `渠道：${valueOrFallback(body.channel)}`,
    `联系方式：${getContactDisplayValue(body, lastMessage)}`
  );

  return lines;
}

function buildShippingInfoTelegramMessage(body, lastMessage) {
  return [
    "【客户已提交收货信息】",
    "",
    ...buildCommonTopLines(body, lastMessage, { submittedCustomerName: true }),
    "",
    "客户提交内容：",
    valueOrFallback(lastMessage),
    "",
    "会话链接：",
    valueOrFallback(body.conversation_url),
    "",
    "项目ID：" + valueOrFallback(body.project_id),
    "客户ID：" + valueOrFallback(body.contact_id),
    "会话ID：" + valueOrFallback(body.session_id),
    "",
    "请同事尽快进入 SaleSmartly 后台处理：",
    "",
    "1. 用 WS名称 或手机号搜索客户",
    "2. 核对客户收货信息",
    "3. 确认产品和数量",
    "4. 推进报价 / 付款 / 下单流程",
  ].join("\n");
}

function buildCallRequestTelegramMessage(body, lastMessage) {
  return [
    "【客户要求电话/视频联系】",
    "",
    ...buildCommonTopLines(body, lastMessage),
    "",
    "触发原因：客户要求电话联系或视频通话，需要人工跟进",
    "",
    "客户最后消息：",
    valueOrFallback(lastMessage),
    "",
    "会话链接：",
    valueOrFallback(body.conversation_url),
    "",
    "请同事尽快进入 SaleSmartly 后台处理：",
    "",
    "1. 用 WS名称 或手机号搜索客户",
    "2. 判断是否需要人工接入",
    "3. 如适合电话/视频沟通，请人工跟进",
    "4. 如不方便通话，请在聊天中安抚并继续推进下单流程",
  ].join("\n");
}

function buildAiDoubtTelegramMessage(body, lastMessage) {
  return [
    "【客户质疑AI/机器人】",
    "",
    ...buildCommonTopLines(body, lastMessage),
    "",
    "触发原因：客户质疑是否为AI/机器人，需要人工关注",
    "",
    "客户最后消息：",
    valueOrFallback(lastMessage),
    "",
    "会话链接：",
    valueOrFallback(body.conversation_url),
    "",
    "请同事尽快进入 SaleSmartly 后台处理：",
    "",
    "1. 用 WS名称 或手机号搜索客户",
    "2. 判断客户是否已经产生不信任",
    "3. 必要时人工接入安抚客户",
    "4. 回复时避免继续强调 AI 身份，保持自然、专业、真人化沟通",
  ].join("\n");
}

function buildHumanHandoffTelegramMessage(body, lastMessage) {
  return [
    "【SaleSmartly 转人工提醒】",
    "",
    ...buildCommonTopLines(body, lastMessage),
    "",
    `触发原因：${valueOrFallback(body.trigger_reason)}`,
    "",
    "客户最后消息：",
    valueOrFallback(lastMessage),
    "",
    `项目ID：${valueOrFallback(body.project_id)}`,
    `客户ID：${valueOrFallback(body.contact_id)}`,
    `会话ID：${valueOrFallback(body.session_id)}`,
    "",
    "会话链接：",
    valueOrFallback(body.conversation_url),
    "",
    "请同事尽快进入 SaleSmartly 后台处理。",
  ].join("\n");
}

function buildTelegramMessage(alertType, body, lastMessage) {
  if (alertType === "shipping_info") {
    return buildShippingInfoTelegramMessage(body, lastMessage);
  }

  if (alertType === "call_request") {
    return buildCallRequestTelegramMessage(body, lastMessage);
  }

  if (alertType === "ai_doubt") {
    return buildAiDoubtTelegramMessage(body, lastMessage);
  }

  return buildHumanHandoffTelegramMessage(body, lastMessage);
}

function buildSuccessResponse(alertType, telegramResult) {
  const base = {
    success: true,
    ok: true,
    alert_type: alertType,
    type: alertType,
    handoff_required: true,
    telegram_message_id: telegramResult.result?.message_id,
  };

  if (alertType === "ai_doubt") {
    return {
      ...base,
      should_reply_customer: false,
      message: "AI doubt alert sent. Do not auto-reply to customer.",
    };
  }

  return base;
}

module.exports = async function handler(req, res) {
  if (req.method === "GET") {
    return res.status(200).json({
      ok: true,
      message: "SaleSmartly to Telegram webhook is running",
    });
  }

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
  const alertType = detectAlertType(body);

  if (!alertType) {
    return res.status(200).json({
      success: true,
      skipped: true,
      reason: "not_a_handoff_trigger",
    });
  }

  const lastMessage = getLastMessage(body);
  const enrichedBody = await enrichPayloadWithSalesmartlyProfile(
    {
      ...body,
      phone: firstNonEmpty(body.phone, extractPhoneFromText(lastMessage)),
      email: firstNonEmpty(body.email, extractEmailFromText(lastMessage)),
    },
    lastMessage
  );
  const telegramText = buildTelegramMessage(alertType, enrichedBody, lastMessage);

  try {
    const telegramResult = await sendTelegramMessage(telegramText);
    return res.status(200).json(buildSuccessResponse(alertType, telegramResult));
  } catch (error) {
    return res.status(502).json({
      success: false,
      ok: false,
      error: error.message,
    });
  }
};

module.exports.detectAlertType = detectAlertType;
module.exports.isShippingInfoMessage = isShippingInfoMessage;
module.exports.isCallRequestMessage = isCallRequestMessage;
module.exports.isAiDoubtMessage = isAiDoubtMessage;
