const { createExternalSign, firstNonEmpty } = require("./salesmartly-profile");

const SALESMARTLY_WEBHOOK_BASE = "https://webhook.salesmartly.com";

function normalizeChannel(channel) {
  const text = String(channel || "whatsapp").trim().toLowerCase();

  if (text.includes("whatsapp")) {
    return "whatsapp";
  }

  if (text.includes("instagram")) {
    return "instagram";
  }

  if (text.includes("messenger") || text.includes("facebook")) {
    return "messenger";
  }

  if (text.includes("telegram")) {
    return "telegram";
  }

  if (text.includes("mail") || text.includes("email")) {
    return "mail";
  }

  if (text.includes("line")) {
    return "line";
  }

  return text.replace(/[^a-z0-9_-]/g, "") || "whatsapp";
}

function buildMissingFields(fields) {
  return Object.entries(fields)
    .filter(([, value]) => !value)
    .map(([key]) => key);
}

async function sendSaleSmartlyMessage({ contact_id, session_id, project_id, channel, message_text }) {
  const apiToken = process.env.SALES_SMARTLY_API_TOKEN;
  const webhookToken = process.env.SALES_SMARTLY_WEBHOOK_TOKEN;
  const sendTime = Math.floor(Date.now() / 1000);
  const msgText = String(message_text || "").trim();
  const missing = buildMissingFields({
    SALES_SMARTLY_API_TOKEN: apiToken,
    SALES_SMARTLY_WEBHOOK_TOKEN: webhookToken,
    contact_id,
    session_id,
    project_id,
    message_text: msgText,
  });

  if (missing.length > 0) {
    return {
      success: false,
      skipped: true,
      skipped_reason: "missing_required_params",
      missing,
    };
  }

  const normalizedChannel = normalizeChannel(channel);
  const endpoint =
    process.env.SALESMARTLY_SEND_MESSAGE_URL ||
    `${SALESMARTLY_WEBHOOK_BASE}/${encodeURIComponent(normalizedChannel)}/send`;
  const url = new URL(endpoint);
  url.searchParams.set("signature", webhookToken);

  const body = {
    chat_user_id: contact_id,
    chat_session_id: session_id,
    msg_type: "text",
    msg: {
      text: msgText,
    },
    send_time: sendTime,
  };
  const signParams = {
    chat_session_id: session_id,
    chat_user_id: contact_id,
    project_id,
    send_time: String(sendTime),
  };
  const externalSign = createExternalSign(signParams, apiToken);

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "external-sign": externalSign,
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let data = null;

  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = {
      raw: text,
    };
  }

  const responseCode = data?.code === undefined || data?.code === null ? "" : String(data.code);
  const success = response.ok && !["400", "500"].includes(responseCode) && data?.success !== false;
  if (!success) {
    return {
      success: false,
      skipped: false,
      status: response.status,
      error: firstNonEmpty(data?.message, data?.msg, response.statusText, "SaleSmartly send failed"),
      raw_result: data,
    };
  }

  return {
    success: true,
    status: response.status,
    raw_result: data,
  };
}

module.exports = {
  sendSaleSmartlyMessage,
  normalizeChannel,
};
