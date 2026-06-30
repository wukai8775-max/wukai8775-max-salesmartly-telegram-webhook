const TELEGRAM_API_BASE = "https://api.telegram.org";

function resolveTelegramChatId(options = {}) {
  if (options.chatId || options.chat_id) {
    return options.chatId || options.chat_id;
  }

  if (options.purpose === "followup") {
    return process.env.TELEGRAM_FOLLOWUP_CHAT_ID || process.env.TELEGRAM_CHAT_ID;
  }

  return process.env.TELEGRAM_CHAT_ID;
}

async function sendTelegramMessage(text, options = {}) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = resolveTelegramChatId(options);

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
  resolveTelegramChatId,
  sendTelegramMessage,
};
