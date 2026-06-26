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

function buildShippingInfoTelegramMessage(body, lastMessage) {
  const contact = valueOrFallback(body.phone || body.email);

  return [
    "【客户已提交收货信息】",
    "",
    `客户：${valueOrFallback(body.customer_name)}`,
    `渠道：${valueOrFallback(body.channel)}`,
    `联系方式：${contact}`,
    "",
    "客户提交内容：",
    valueOrFallback(lastMessage),
    "",
    `项目ID：${valueOrFallback(body.project_id)}`,
    `客户ID：${valueOrFallback(body.contact_id)}`,
    `会话ID：${valueOrFallback(body.session_id)}`,
    "",
    "会话链接：",
    valueOrFallback(body.conversation_url),
    "",
    "请同事尽快进入 SaleSmartly 后台处理：",
    "",
    "1. 核对客户收货信息",
    "2. 确认产品和数量",
    "3. 推进报价 / 付款 / 下单流程",
  ].join("\n");
}

function buildHumanHandoffTelegramMessage(body, lastMessage) {
  const contact = valueOrFallback(body.phone || body.email);

  return [
    "【SaleSmartly 转人工提醒】",
    "",
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
  const shippingInfoMessage = isShippingInfoMessage(lastMessage);
  const telegramText = shippingInfoMessage
    ? buildShippingInfoTelegramMessage(body, lastMessage)
    : buildHumanHandoffTelegramMessage(body, lastMessage);

  try {
    const telegramResult = await sendTelegramMessage(telegramText);

    return res.status(200).json({
      ok: true,
      type: shippingInfoMessage ? "shipping_info" : "human_handoff",
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
