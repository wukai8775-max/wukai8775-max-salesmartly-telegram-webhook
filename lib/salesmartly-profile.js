const crypto = require("crypto");

const CONTACT_LIST_URL = "https://developer.salesmartly.com/api/v2/get-contact-list";
const MISSING_VALUE = "未提供";
const MISSING_SEARCH_KEYWORD = "未获取到";

const profileCache = globalThis.__salesSmartlyProfileCache || {
  byContactId: new Map(),
  bySessionId: new Map(),
  byPhone: new Map(),
  byEmail: new Map(),
};

globalThis.__salesSmartlyProfileCache = profileCache;

function valueOrFallback(value, fallback = MISSING_VALUE) {
  if (value === undefined || value === null) {
    return fallback;
  }

  const text = String(value).trim();
  return text ? text : fallback;
}

function firstNonEmpty(...values) {
  for (const value of values) {
    if (value === undefined || value === null) {
      continue;
    }

    const text = String(value).trim();
    if (text) {
      return text;
    }
  }

  return "";
}

function isPlainObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function normalizeKey(key) {
  return String(key).toLowerCase().replace(/[^a-z0-9]/g, "");
}

function findDeepValue(input, aliases, depth = 0, seen = new Set()) {
  if (!input || typeof input !== "object" || depth > 7 || seen.has(input)) {
    return "";
  }

  seen.add(input);
  const aliasSet = new Set(aliases.map(normalizeKey));

  for (const [key, value] of Object.entries(input)) {
    if (aliasSet.has(normalizeKey(key)) && value !== undefined && value !== null) {
      if (typeof value === "object") {
        const nestedText = stringifySimpleMessageValue(value);
        if (nestedText) {
          return nestedText;
        }
      } else {
        const text = String(value).trim();
        if (text) {
          return text;
        }
      }
    }
  }

  for (const value of Object.values(input)) {
    if (value && typeof value === "object") {
      const found = findDeepValue(value, aliases, depth + 1, seen);
      if (found) {
        return found;
      }
    }
  }

  return "";
}

function stringifySimpleMessageValue(value) {
  if (value === undefined || value === null) {
    return "";
  }

  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value).trim();
  }

  if (typeof value === "object") {
    return firstNonEmpty(
      value.text,
      value.content,
      value.message,
      value.last_message,
      value.body,
      value.value,
      value.title,
      value.name,
      value.id
    );
  }

  return "";
}

function getPathValue(source, path) {
  let current = source;

  for (const key of path) {
    if (!isPlainObject(current) && !Array.isArray(current)) {
      return "";
    }

    current = current?.[key];
  }

  return stringifySimpleMessageValue(current);
}

function firstPathValue(source, paths = []) {
  for (const path of paths) {
    const value = getPathValue(source, path);
    if (value) {
      return value;
    }
  }

  return "";
}

function normalizePhone(value) {
  const text = String(value || "").trim();
  if (!text) {
    return "";
  }

  const digits = text.replace(/\D/g, "");
  return digits.length >= 7 ? digits : "";
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function extractPhoneFromText(text) {
  const matches = String(text || "").match(/\+?\d[\d\s().-]{6,}\d/g) || [];

  for (const match of matches) {
    if (normalizePhone(match)) {
      return match.trim();
    }
  }

  return "";
}

function extractEmailFromText(text) {
  const match = String(text || "").match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return match ? match[0].replace(/^mailto:/i, "").trim() : "";
}

function getDisplayName(source) {
  return firstNonEmpty(
    source.ws_display_name,
    source.whatsapp_display_name,
    source.whatsapp_name,
    source.contact_name,
    source.profile_name,
    source.salesmartly_contact_name,
    source.customer_display_name,
    source.remark_name,
    source.nick_name,
    source.nickname,
    source.chat_user_name,
    source.name
  );
}

function getDisplayNameFromPayload(payload) {
  return firstNonEmpty(
    firstPathValue(payload, [
      ["data", "contact", "ws_display_name"],
      ["data", "contact", "whatsapp_display_name"],
      ["data", "contact", "whatsapp_name"],
      ["data", "contact", "contact_name"],
      ["data", "contact", "profile_name"],
      ["data", "contact", "name"],
      ["data", "customer", "ws_display_name"],
      ["data", "customer", "whatsapp_display_name"],
      ["data", "customer", "whatsapp_name"],
      ["data", "customer", "profile_name"],
      ["data", "customer", "name"],
    ]),
    findDeepValue(payload, [
      "ws_display_name",
      "whatsapp_display_name",
      "whatsapp_name",
      "contact_name",
      "profile_name",
      "salesmartly_contact_name",
      "customer_display_name",
      "remark_name",
      "name",
      "nick_name",
      "nickname",
      "chat_user_name",
    ])
  );
}

function normalizeOfficialPayload(payload = {}) {
  const lastMessage = firstNonEmpty(
    firstPathValue(payload, [
      ["data", "message", "content"],
      ["data", "message", "text"],
      ["data", "message", "message"],
      ["data", "message", "last_message"],
      ["data", "message", "body"],
      ["data", "message"],
      ["data", "content"],
      ["data", "text"],
      ["data", "last_message"],
      ["message", "content"],
      ["message", "text"],
      ["message", "message"],
      ["message", "last_message"],
      ["message", "body"],
      ["message"],
      ["content"],
      ["text"],
      ["last_message"],
      ["event", "message"],
      ["event", "content"],
      ["event", "text"],
    ]),
    findDeepValue(payload, ["last_message", "message_content", "content", "text", "body"]),
    stringifySimpleMessageValue(findDeepValue(payload, ["message", "msg"]))
  );
  const data = payload.data && typeof payload.data === "object" ? payload.data : {};
  const messageTime = firstNonEmpty(
    firstPathValue(payload, [
      ["data", "message", "message_time"],
      ["data", "message", "send_time"],
      ["data", "message", "created_at"],
      ["data", "message_time"],
      ["data", "send_time"],
      ["data", "created_at"],
      ["data", "timestamp"],
      ["message_time"],
      ["send_time"],
      ["created_time"],
      ["timestamp"],
      ["time"],
    ]),
    findDeepValue(payload, ["message_time", "send_time", "created_time", "timestamp", "time"]),
    data.send_time
  );
  const senderType = firstNonEmpty(
    firstPathValue(payload, [
      ["data", "message", "sender_type"],
      ["data", "sender_type"],
      ["data", "from_type"],
    ]),
    findDeepValue(payload, ["sender_type", "from_type"]),
    data.sender_type
  );
  const sysUserId = firstNonEmpty(
    firstPathValue(payload, [
      ["data", "message", "sys_user_id"],
      ["data", "sys_user_id"],
    ]),
    findDeepValue(payload, ["sys_user_id"]),
    data.sys_user_id
  );

  const normalized = {
    event_type: firstNonEmpty(
      firstPathValue(payload, [["event"], ["event_type"], ["data", "event"], ["data", "event_type"], ["data", "type"]]),
      findDeepValue(payload, ["event", "event_type", "eventName", "type", "action"])
    ),
    ws_display_name: getDisplayNameFromPayload(payload),
    customer_name: firstNonEmpty(
      firstPathValue(payload, [
        ["data", "customer", "customer_name"],
        ["data", "customer", "name"],
        ["data", "contact", "customer_name"],
        ["data", "contact", "name"],
      ]),
      findDeepValue(payload, ["customer_name", "name", "remark_name"])
    ),
    phone: firstNonEmpty(
      firstPathValue(payload, [
        ["data", "contact", "phone"],
        ["data", "contact", "phone_number"],
        ["data", "contact", "mobile"],
        ["data", "customer", "phone"],
        ["data", "customer", "phone_number"],
        ["data", "customer", "mobile"],
        ["data", "phone"],
        ["data", "phone_number"],
      ]),
      findDeepValue(payload, ["phone", "phone_number", "customer_phone", "mobile", "tel"])
    ),
    email: firstNonEmpty(
      firstPathValue(payload, [["data", "contact", "email"], ["data", "customer", "email"], ["data", "email"]]),
      findDeepValue(payload, ["email", "customer_email"])
    ),
    channel: firstNonEmpty(
      firstPathValue(payload, [
        ["data", "channel"],
        ["data", "channel_name"],
        ["data", "platform"],
        ["data", "source"],
        ["data", "session", "channel"],
        ["data", "session", "channel_name"],
      ]),
      findDeepValue(payload, ["channel", "channel_name", "platform", "source"])
    ),
    channel_id: firstNonEmpty(findDeepValue(payload, ["channel_id"])),
    channel_uid: firstNonEmpty(findDeepValue(payload, ["channel_uid"])),
    contact_id: firstNonEmpty(
      firstPathValue(payload, [
        ["data", "contact_id"],
        ["data", "chat_user_id"],
        ["data", "customer_id"],
        ["data", "user_id"],
        ["data", "contact", "contact_id"],
        ["data", "contact", "chat_user_id"],
        ["data", "contact", "customer_id"],
        ["data", "contact", "user_id"],
        ["data", "contact", "id"],
        ["data", "customer", "contact_id"],
        ["data", "customer", "chat_user_id"],
        ["data", "customer", "customer_id"],
        ["data", "customer", "user_id"],
        ["data", "customer", "id"],
        ["contact_id"],
        ["chat_user_id"],
        ["customer_id"],
        ["user_id"],
      ]),
      findDeepValue(payload, ["contact_id", "chat_user_id", "customer_id", "user_id"])
    ),
    session_id: firstNonEmpty(
      firstPathValue(payload, [
        ["data", "session_id"],
        ["data", "chat_session_id"],
        ["data", "conversation_id"],
        ["data", "session", "session_id"],
        ["data", "session", "chat_session_id"],
        ["data", "session", "conversation_id"],
        ["data", "session", "id"],
        ["data", "message", "session_id"],
        ["data", "message", "chat_session_id"],
        ["session_id"],
        ["chat_session_id"],
        ["conversation_id"],
      ]),
      findDeepValue(payload, ["session_id", "chat_session_id", "conversation_id"])
    ),
    project_id: firstNonEmpty(
      firstPathValue(payload, [["data", "project_id"], ["data", "project", "project_id"], ["data", "project", "id"], ["project_id"]]),
      findDeepValue(payload, ["project_id"])
    ),
    conversation_url: firstNonEmpty(
      firstPathValue(payload, [
        ["data", "conversation_url"],
        ["data", "chat_url"],
        ["data", "session_url"],
        ["data", "session", "conversation_url"],
        ["data", "session", "url"],
      ]),
      findDeepValue(payload, ["conversation_url", "chat_url", "session_url", "url"])
    ),
    last_message: lastMessage,
    message_time: messageTime,
    sender_name: firstNonEmpty(
      firstPathValue(payload, [["data", "message", "sender_name"], ["data", "sender_name"], ["data", "sender", "name"]]),
      findDeepValue(payload, ["sender_name", "sender", "sys_user_name", "staff_name"])
    ),
    sender_type: senderType,
    sys_user_id: sysUserId,
    direction: firstNonEmpty(
      firstPathValue(payload, [["data", "message", "direction"], ["data", "direction"], ["data", "from_type"]]),
      findDeepValue(payload, ["direction", "message_direction", "from_type", "sender_role"])
    ),
  };

  normalized.phone = normalized.phone || extractPhoneFromText(normalized.last_message);
  normalized.email = normalized.email || extractEmailFromText(normalized.last_message);

  return normalized;
}

function cacheSalesmartlyProfile(profile = {}) {
  const normalized = {
    ws_display_name: getDisplayName(profile),
    customer_name: firstNonEmpty(profile.customer_name, profile.name, profile.remark_name),
    phone: firstNonEmpty(profile.phone, profile.phone_number, profile.customer_phone),
    email: firstNonEmpty(profile.email, profile.customer_email),
    channel: firstNonEmpty(profile.channel, profile.channel_name, profile.platform),
    channel_id: firstNonEmpty(profile.channel_id),
    channel_uid: firstNonEmpty(profile.channel_uid),
    contact_id: firstNonEmpty(profile.contact_id, profile.chat_user_id, profile.customer_id),
    session_id: firstNonEmpty(profile.session_id, profile.chat_session_id, profile.conversation_id),
    project_id: firstNonEmpty(profile.project_id),
    conversation_url: firstNonEmpty(profile.conversation_url, profile.chat_url, profile.session_url),
    last_message: firstNonEmpty(profile.last_message, profile.message, profile.content, profile.text),
    updated_at: Date.now(),
  };

  const hasUsefulValue = Object.entries(normalized).some(([key, value]) => key !== "updated_at" && value);
  if (!hasUsefulValue) {
    return normalized;
  }

  const contactId = normalized.contact_id;
  const sessionId = normalized.session_id;
  const phoneKey = normalizePhone(normalized.phone);
  const emailKey = normalizeEmail(normalized.email);

  if (contactId) {
    profileCache.byContactId.set(contactId, normalized);
  }

  if (sessionId) {
    profileCache.bySessionId.set(sessionId, normalized);
  }

  if (phoneKey) {
    profileCache.byPhone.set(phoneKey, normalized);
  }

  if (emailKey) {
    profileCache.byEmail.set(emailKey, normalized);
  }

  return normalized;
}

function findCachedSalesmartlyProfile(payload = {}, lastMessage = "") {
  const contactId = firstNonEmpty(payload.contact_id, payload.chat_user_id, payload.customer_id);
  const sessionId = firstNonEmpty(payload.session_id, payload.chat_session_id, payload.conversation_id);
  const phone = firstNonEmpty(payload.phone, payload.phone_number, extractPhoneFromText(lastMessage));
  const email = firstNonEmpty(payload.email, extractEmailFromText(lastMessage));

  return (
    (contactId && profileCache.byContactId.get(contactId)) ||
    (sessionId && profileCache.bySessionId.get(sessionId)) ||
    (normalizePhone(phone) && profileCache.byPhone.get(normalizePhone(phone))) ||
    (normalizeEmail(email) && profileCache.byEmail.get(normalizeEmail(email))) ||
    null
  );
}

function createExternalSign(params, token) {
  const sorted = Object.keys(params)
    .sort()
    .map((key) => `${key}=${params[key]}`);

  return crypto.createHash("md5").update([token, ...sorted].join("&")).digest("hex");
}

function getProjectId(payload = {}) {
  return firstNonEmpty(payload.project_id, process.env.SALES_SMARTLY_PROJECT_ID);
}

async function querySalesmartlyContactList(payload = {}, lastMessage = "") {
  const token = process.env.SALES_SMARTLY_API_TOKEN;
  const projectId = getProjectId(payload);

  if (!token || !projectId) {
    return null;
  }

  const phone = firstNonEmpty(payload.phone, extractPhoneFromText(lastMessage));
  const email = firstNonEmpty(payload.email, extractEmailFromText(lastMessage));
  const contactId = firstNonEmpty(payload.contact_id, payload.chat_user_id, payload.customer_id);
  const customerName = firstNonEmpty(payload.customer_name);

  const queryAttempts = [
    contactId ? { chat_user_id: contactId } : null,
    phone ? { phone } : null,
    email ? { email } : null,
    customerName ? { name: customerName } : null,
  ].filter(Boolean);

  for (const query of queryAttempts) {
    const params = {
      project_id: projectId,
      page: "1",
      page_size: "20",
      ...query,
    };
    const sign = createExternalSign(params, token);
    const url = new URL(CONTACT_LIST_URL);

    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }

    const response = await fetch(url, {
      method: "GET",
      headers: {
        "external-sign": sign,
      },
    });

    const data = await response.json().catch(() => null);
    const list = Array.isArray(data?.data?.list) ? data.data.list : [];

    if (response.ok && list.length > 0) {
      return cacheSalesmartlyProfile({
        ...list[0],
        project_id: firstNonEmpty(list[0].project_id, projectId),
      });
    }
  }

  return null;
}

async function enrichPayloadWithSalesmartlyProfile(payload = {}, lastMessage = "") {
  const directProfile = cacheSalesmartlyProfile({
    ws_display_name: getDisplayName(payload),
    customer_name: payload.customer_name,
    phone: firstNonEmpty(payload.phone, extractPhoneFromText(lastMessage)),
    email: firstNonEmpty(payload.email, extractEmailFromText(lastMessage)),
    channel: payload.channel,
    contact_id: payload.contact_id,
    session_id: payload.session_id,
    project_id: payload.project_id,
    last_message: lastMessage,
  });

  const hasDisplayName = Boolean(directProfile.ws_display_name);
  if (hasDisplayName) {
    return {
      ...payload,
      ...directProfile,
    };
  }

  const cachedProfile = findCachedSalesmartlyProfile(payload, lastMessage);
  if (cachedProfile?.ws_display_name) {
    return {
      ...payload,
      ...cachedProfile,
    };
  }

  const apiProfile = await querySalesmartlyContactList(payload, lastMessage).catch(() => null);
  if (apiProfile?.ws_display_name) {
    return {
      ...payload,
      ...apiProfile,
    };
  }

  return {
    ...payload,
    phone: firstNonEmpty(payload.phone, extractPhoneFromText(lastMessage)),
    email: firstNonEmpty(payload.email, extractEmailFromText(lastMessage)),
  };
}

function getContactDisplayValue(payload = {}, lastMessage = "") {
  const phone = firstNonEmpty(payload.phone, extractPhoneFromText(lastMessage));
  const email = firstNonEmpty(payload.email, extractEmailFromText(lastMessage));

  if (phone && email) {
    return `${phone} / ${email}`;
  }

  return valueOrFallback(phone || email);
}

function getSearchKeyword(payload = {}, lastMessage = "") {
  return firstNonEmpty(
    getDisplayName(payload),
    payload.customer_name,
    payload.phone,
    extractPhoneFromText(lastMessage),
    payload.email,
    extractEmailFromText(lastMessage),
    MISSING_SEARCH_KEYWORD
  );
}

module.exports = {
  CONTACT_LIST_URL,
  MISSING_VALUE,
  MISSING_SEARCH_KEYWORD,
  valueOrFallback,
  firstNonEmpty,
  getDisplayName,
  getContactDisplayValue,
  getSearchKeyword,
  extractPhoneFromText,
  extractEmailFromText,
  normalizeOfficialPayload,
  cacheSalesmartlyProfile,
  enrichPayloadWithSalesmartlyProfile,
  createExternalSign,
  querySalesmartlyContactList,
  findDeepValue,
  normalizePhone,
  normalizeEmail,
  getProjectId,
};
