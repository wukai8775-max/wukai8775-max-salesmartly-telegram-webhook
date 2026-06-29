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

const TELEGRAM_API_BASE = "https://api.telegram.org";

function getLastMessage(body) {
  return valueOrFallback(body.last_message || body.message || body.content, "");
}

function getAiEmployeeName(body) {
  return valueOrFallback(
    body.ai_employee_name || body.agent_name || body.employee_name || body.staff_name || body.bot_name
  );
}

function getSubmittedCustomerName(text, fallbackName) {
  if (text === undefined || text === null) {
    return valueOrFallback(fallbackName);
  }

  const normalized = String(text).replace(/\r\n/g, "\n").replace(/：/g, ":").trim();

  if (!normalized) {
    return valueOrFallback(fallbackName);
  }

  const lines = normalized.split("\n");
  let submittedName = "";

  for (const line of lines) {
    const match = line.match(/^\s*(name|full name|customer name)\s*:?\s*(.+?)\s*$/i);
    if (match?.[2]?.trim()) {
      submittedName = match[2].trim();
      break;
    }
  }

  if (!submittedName) {
    const inlineMatch = normalized.match(/\bmy\s+name\s+is\s+([^\n,;]+)/i);
    submittedName = inlineMatch?.[1]?.trim() || "";
  }

  submittedName = submittedName
    .replace(/\s+(phone|tel|mobile|whatsapp|postal|postcode|zip\s*code|address|email)\s*:.*$/i, "")
    .trim();

  return valueOrFallback(submittedName || fallbackName);
}

function normalizeCustomerMessage(text) {
  if (text === undefined || text === null) {
    return "";
  }

  return String(text).replace(/\r\n/g, "\n").replace(/：/g, ":").toLowerCase().trim();
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

function isShippingInfoMessage(text) {
  const normalized = normalizeCustomerMessage(text);

  if (!normalized) {
    return false;
  }

  const hasName =
    /(?:^|\n)\s*(name|full\s+name|customer\s+name)\s*:?\s*\S+/i.test(normalized) ||
    /\bmy\s+name\s+is\s+[a-z][a-z\s.'-]{1,}/i.test(normalized);

  const hasContact =
    /(?:^|\n)\s*(phone|tel|telephone|mobile|whatsapp|email)\s*:?\s*\S+/i.test(normalized) ||
    Boolean(extractPhoneFromText(normalized)) ||
    Boolean(extractEmailFromText(normalized));

  const hasAddress =
    /(?:^|\n)\s*(address|street|city|state|country|postal|postcode|zip|zip\s+code)\s*:?\s*\S+/i.test(
      normalized
    ) ||
    /\b\d{4,10}\b/.test(normalized) ||
    /\b(street|st\.|road|rd\.|avenue|ave\.|drive|dr\.|lane|ln\.|blvd|usa|united states)\b/i.test(normalized);

  return [hasName, hasContact, hasAddress].filter(Boolean).length >= 2;
}

function isCallRequestMessage(text) {
  const normalized = normalizeCustomerMessage(text);

  if (!normalized) {
    return false;
  }

  return [
    /\b(can|could|would|will)\s+you\s+(please\s+)?call\s+me\b/,
    /\bplease\s+call\s+me\b/,
    /\bcall\s+me\b/,
    /\bphone\s+call\b/,
    /\bvoice\s+call\b/,
    /\bvideo\s+(call|chat)\b/,
    /\bwhatsapp\s+call\b/,
    /\b(can|could)\s+we\s+(talk|speak)\b/,
    /\b(talk|speak)\s+on\s+(the\s+)?phone\b/,
    /\bfacetime\b/,
    /\bzoom\b/,
    /\bcan\s+i\s+(speak|talk)\s+to\s+someone\b/,
    /\bi\s+(want|need)\s+to\s+(speak|talk)\s+with\s+someone\b/,
    /\bhuman\s+call\b/,
    /\breal\s+person\s+call\b/,
  ].some((pattern) => pattern.test(normalized));
}

function isAiDoubtMessage(text) {
  const normalized = normalizeCustomerMessage(text);

  if (!normalized) {
    return false;
  }

  return [
    /\bare\s+you\s+(an?\s+)?ai\b/,
    /\bare\s+you\s+(a\s+)?bot\b/,
    /\bare\s+you\s+(a\s+)?robot\b/,
    /\bare\s+you\s+real\b/,
    /\bare\s+you\s+a\s+real\s+person\b/,
    /\bare\s+you\s+human\b/,
    /\bis\s+this\s+(an?\s+)?automated(\s+reply)?\b/,
    /\bautomated\s+reply\b/,
    /\bauto\s+reply\b/,
    /\bchat\s*bot\b/,
    /\btalking\s+to\s+(a\s+)?(bot|ai)\b/,
    /\bam\s+i\s+talking\s+to\s+(a\s+)?(bot|ai)\b/,
    /\bi\s+am\s+talking\s+to\s+(a\s+)?(bot|ai)\b/,
    /\bi\s+(want|need)\s+a\s+real\s+person\b/,
    /\bi\s+(want|need)\s+a\s+human\b/,
    /\bi\s+(want|need)\s+to\s+(talk|speak)\s+to\s+a\s+real\s+person\b/,
    /\bnot\s+a\s+bot\b/,
    /\bno\s+bots\b/,
    /\breal\s+person\b/,
    /\bhuman\s+agent\b/,
    /\blive\s+(agent|person)\b/,
    /\bcustomer\s+service\s+agent\b/,
  ].some((pattern) => pattern.test(normalized));
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

function buildWsLine(body) {
  const wsDisplayName = getDisplayName(body);
  return wsDisplayName ? [`WS名称：${wsDisplayName}`] : [];
}

function buildCommonTopLines(body, lastMessage, options = {}) {
  const lines = [
    `AI员工：${getAiEmployeeName(body)}`,
    ...buildWsLine(body),
  ];

  if (options.submittedCustomerName) {
    lines.push(`客户填写姓名：${getSubmittedCustomerName(lastMessage, body.customer_name)}`);
  } else {
    lines.push(`客户：${valueOrFallback(body.customer_name)}`);
  }

  lines.push(
    `渠道：${valueOrFallback(body.channel)}`,
    `联系方式：${getContactDisplayValue(body, lastMessage)}`,
    `搜索关键词：${getSearchKeyword(body, lastMessage)}`
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
    "请同事尽快进入 SaleSmartly 后台处理：",
    "",
    "1. 用搜索关键词搜索客户",
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
    "1. 用搜索关键词搜索客户",
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
    "请同事尽快接入，该场景 AI 不应继续自动回复客户。",
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

async function sendTelegramMessage(text) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!botToken) {
    throw new Error("Missing TELEGRAM_BOT_TOKEN");
  }

  if (!chatId) {
    throw new Error("Missing TELEGRAM_CHAT_ID");
  }

  const response = await fetch(`${TELEGRAM_API_BASE}/bot${botToken}/sendMessage`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      disable_web_page_preview: true,
    }),
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok || data.ok === false) {
    throw new Error(data.description || response.statusText || "Telegram request failed");
  }

  return data;
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
