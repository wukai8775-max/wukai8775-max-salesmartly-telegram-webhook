const TELEGRAM_API_BASE = "https://api.telegram.org";

function resolveTelegramTarget(options = {}) {
  if (options.chatId || options.chat_id) {
    return {
      chatId: options.chatId || options.chat_id,
      source: "explicit_option",
    };
  }

  return {
    chatId: process.env.TELEGRAM_CHAT_ID,
    source: "TELEGRAM_CHAT_ID",
  };
}

function resolveTelegramChatId(options = {}) {
  return resolveTelegramTarget(options).chatId;
}

async function sendTelegramMessage(text, options = {}) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const target = resolveTelegramTarget(options);
  const chatId = target.chatId;

  console.info("Telegram target resolved", {
    telegram_target_chat_source: target.source,
    purpose: options.purpose || "default",
    has_chat_id: Boolean(chatId),
  });

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

module.exports = {
  resolveTelegramTarget,
  resolveTelegramChatId,
  sendTelegramMessage,
};
