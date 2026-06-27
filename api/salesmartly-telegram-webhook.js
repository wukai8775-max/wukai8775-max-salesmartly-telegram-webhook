const TELEGRAM_API_BASE = "https://api.telegram.org";

function valueOrFallback(value, fallback = "未提供") {
  if (value === undefined || value === null) {
    return fallback;
  }

  const text = String(value).trim();
  return text ? text : fallback;
}

function getLastMessage(body) {
  return valueOrFallback(body.last_message || body.message || body.content, "");
}

function getAiEmployeeName(body) {
  return valueOrFallback(
    body.ai_employee_name || body.agent_name || body.employee_name || body.staff_name || body.bot_name
  );
}

function getWsDisplayName(body) {
  return valueOrFallback(
    body.ws_display_name ||
      body.whatsapp_name ||
      body.whatsapp_display_name ||
      body.contact_name ||
      body.profile_name ||
      body.salesmartly_contact_name ||
      body.customer_display_name ||
      body.customer_name
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
    const match = line.match(/^\s*name\s*:?\s*(.+?)\s*$/i);
    if (match?.[1]?.trim()) {
      submittedName = match[1].trim();
      break;
    }
  }

  if (!submittedName) {
    const inlineMatch = normalized.match(/(?:^|[\n,;])\s*name\s*:?\s*([^\n,;]+)/i);
    submittedName = inlineMatch?.[1]?.trim() || "";
  }

  submittedName = submittedName
    .replace(/\s+(phone|postal|postcode|zip\s*code|address|email)\s*:.*$/i, "")
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
  if (text === undefined || text === null) {
    return false;
  }

  const normalized = String(text)
    .replace(/\r\n/g, "\n")
    .replace(/：/g, ":")
    .toLowerCase()
    .trim();

  if (!normalized) {
    return false;
  }

  const hasName = /(?:^|[\s\n,;])name\s*:?\s*\S+/i.test(normalized);
  const hasPhone = /(?:^|[\s\n,;])phone\s*:?\s*(?:\+?\d[\d\s().-]{5,}|\S+@\S+)/i.test(normalized);
  const hasPostalOrAddress =
    /(?:^|[\s\n,;])(?:postal|postcode|zip(?:\s*code)?|address)\s*:?\s*\S+/i.test(normalized);

  return hasName && hasPhone && hasPostalOrAddress;
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
    /\bcall\b/,
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
    /\bnot\s+a\s+bot\b/,
    /\bno\s+bots\b/,
    /\breal\s+person\b/,
    /\bhuman\s+agent\b/,
    /\blive\s+(agent|person)\b/,
    /\bcustomer\s+service\s+agent\b/,
  ].some((pattern) => pattern.test(normalized));
}

function buildShippingInfoTelegramMessage(body, lastMessage) {
  const contact = valueOrFallback(body.phone || body.email);
  const aiEmployeeName = getAiEmployeeName(body);
  const wsDisplayName = getWsDisplayName(body);
  const submittedCustomerName = getSubmittedCustomerName(lastMessage, body.customer_name);

  return [
    "【客户已提交收货信息】",
    "",
    `AI员工：${aiEmployeeName}`,
    `WS名称：${wsDisplayName}`,
    `客户填写姓名：${submittedCustomerName}`,
    `渠道：${valueOrFallback(body.channel)}`,
    `联系方式：${contact}`,
    "",
    "客户提交内容：",
    valueOrFallback(lastMessage),
    "",
    "会话链接：",
    valueOrFallback(body.conversation_url),
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
  const contact = valueOrFallback(body.phone || body.email);
  const aiEmployeeName = getAiEmployeeName(body);
  const wsDisplayName = getWsDisplayName(body);

  return [
    "【客户要求电话/视频联系】",
    "",
    `AI员工：${aiEmployeeName}`,
    `WS名称：${wsDisplayName}`,
    `客户：${valueOrFallback(body.customer_name)}`,
    `渠道：${valueOrFallback(body.channel)}`,
    `联系方式：${contact}`,
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
  const contact = valueOrFallback(body.phone || body.email);
  const aiEmployeeName = getAiEmployeeName(body);
  const wsDisplayName = getWsDisplayName(body);

  return [
    "【客户质疑AI/机器人】",
    "",
    `AI员工：${aiEmployeeName}`,
    `WS名称：${wsDisplayName}`,
    `客户：${valueOrFallback(body.customer_name)}`,
    `渠道：${valueOrFallback(body.channel)}`,
    `联系方式：${contact}`,
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
  const contact = valueOrFallback(body.phone || body.email);
  const aiEmployeeName = getAiEmployeeName(body);
  const wsDisplayName = getWsDisplayName(body);

  return [
    "【SaleSmartly 转人工提醒】",
    "",
    `AI员工：${aiEmployeeName}`,
    `WS名称：${wsDisplayName}`,
    `客户：${valueOrFallback(body.customer_name)}`,
    `渠道：${valueOrFallback(body.channel)}`,
    `联系方式：${contact}`,
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
  const lastMessage = getLastMessage(body);
  let alertType = "human_handoff";
  let telegramText = buildHumanHandoffTelegramMessage(body, lastMessage);

  if (isShippingInfoMessage(lastMessage)) {
    alertType = "shipping_info";
    telegramText = buildShippingInfoTelegramMessage(body, lastMessage);
  } else if (isCallRequestMessage(lastMessage)) {
    alertType = "call_request";
    telegramText = buildCallRequestTelegramMessage(body, lastMessage);
  } else if (isAiDoubtMessage(lastMessage)) {
    alertType = "ai_doubt";
    telegramText = buildAiDoubtTelegramMessage(body, lastMessage);
  }

  try {
    const telegramResult = await sendTelegramMessage(telegramText);

    return res.status(200).json({
      ok: true,
      type: alertType,
      telegram_message_id: telegramResult.result?.message_id,
    });
  } catch (error) {
    return res.status(502).json({
      ok: false,
      error: error.message,
    });
  }
};

module.exports.isShippingInfoMessage = isShippingInfoMessage;
module.exports.isCallRequestMessage = isCallRequestMessage;
module.exports.isAiDoubtMessage = isAiDoubtMessage;
