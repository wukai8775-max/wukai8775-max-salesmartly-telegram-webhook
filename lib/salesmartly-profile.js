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
      value.message_text,
      value.last_message,
      value.message,
      value.msg,
      value.body,
      value.value,
      value.title,
      value.name,
      value.id
    );
  }

  return "";
}

function parseJsonObjectString(value) {
  if (typeof value !== "string") {
    return {
      ok: false,
      value: null,
    };
  }

  let text = value.trim();
  if (!text || !/^[{[]/.test(text)) {
    return {
      ok: false,
      value: null,
    };
  }

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const parsed = JSON.parse(text);
      if (typeof parsed === "string") {
        text = parsed.trim();
        continue;
      }

      if (isPlainObject(parsed)) {
        return {
          ok: true,
          value: parsed,
        };
      }

      if (Array.isArray(parsed) && isPlainObject(parsed[0])) {
        return {
          ok: true,
          value: parsed[0],
        };
      }

      return {
        ok: true,
        value: parsed,
      };
    } catch (error) {
      return {
        ok: false,
        value: null,
      };
    }
  }

  return {
    ok: false,
    value: null,
  };
}

function getPayloadParsingContext(payload = {}) {
  const dataIsString = typeof payload?.data === "string";
  const parsedData = dataIsString ? parseJsonObjectString(payload.data) : { ok: false, value: null };
  const dataObject = isPlainObject(payload?.data)
    ? payload.data
    : parsedData.ok && isPlainObject(parsedData.value)
      ? parsedData.value
      : {};

  return {
    data_is_string: dataIsString,
    data_json_parse_success: Boolean(dataIsString && parsedData.ok && isPlainObject(parsedData.value)),
    data_object: dataObject,
    payload_for_extraction: dataIsString && isPlainObject(dataObject) ? { ...payload, data: dataObject } : payload,
  };
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
    source.username,
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
      ["data", "contact", "nickname"],
      ["data", "contact", "username"],
      ["data", "contact", "name"],
      ["data", "customer", "ws_display_name"],
      ["data", "customer", "whatsapp_display_name"],
      ["data", "customer", "whatsapp_name"],
      ["data", "customer", "profile_name"],
      ["data", "customer", "nickname"],
      ["data", "customer", "username"],
      ["data", "customer", "name"],
      ["data", "whatsapp_name"],
      ["data", "whatsapp_display_name"],
      ["data", "profile_name"],
      ["data", "contact_name"],
      ["data", "customer_name"],
      ["data", "nickname"],
      ["data", "username"],
      ["data", "name"],
    ]),
    findDeepValue(payload, [
      "ws_display_name",
      "whatsapp_display_name",
      "whatsapp_name",
      "contact_name",
      "profile_name",
      "salesmartly_contact_name",
      "customer_display_name",
      "customer_name",
      "remark_name",
      "name",
      "nick_name",
      "nickname",
      "username",
      "chat_user_name",
    ])
  );
}

function normalizeOfficialDirectionValue(value) {
  const text = String(value || "").trim().toLowerCase();

  if (!text) {
    return "";
  }

  if (["customer", "visitor", "contact", "user", "client", "guest", "in", "inbound", "incoming", "receive", "received"].includes(text)) {
    return "customer";
  }

  if (["human", "staff", "agent", "admin", "seller", "service", "out", "outbound", "outgoing", "send", "sent"].includes(text)) {
    return "human";
  }

  if (text.includes("bot") || text.includes("ai")) {
    return "ai";
  }

  if (text.includes("system")) {
    return "system";
  }

  return "";
}

function isTruthyFlag(value) {
  return ["true", "1", "yes", "y"].includes(String(value || "").trim().toLowerCase());
}

function getOfficialDirectionFromPayload(payload, lastMessage) {
  const fromCustomer = firstPathValue(payload, [
    ["data", "from_customer"],
    ["data", "is_from_customer"],
    ["data", "message", "from_customer"],
    ["data", "message", "is_from_customer"],
    ["from_customer"],
    ["is_from_customer"],
  ]);

  if (isTruthyFlag(fromCustomer)) {
    return "customer";
  }

  const explicit = firstNonEmpty(
    firstPathValue(payload, [
      ["data", "message", "direction"],
      ["data", "message", "sender_type"],
      ["data", "message", "send_type"],
      ["data", "message", "role"],
      ["data", "direction"],
      ["data", "sender_type"],
      ["data", "send_type"],
      ["data", "role"],
      ["direction"],
      ["sender_type"],
      ["send_type"],
      ["role"],
    ]),
    findDeepValue(payload, ["direction", "message_direction", "from_type", "sender_role", "sender_type", "send_type", "role"])
  );
  const normalized = normalizeOfficialDirectionValue(explicit);

  if (normalized) {
    return normalized;
  }

  return lastMessage ? "customer" : "";
}

function normalizeOfficialPayload(payload = {}) {
  const parseContext = getPayloadParsingContext(payload);
  const source = parseContext.payload_for_extraction;
  const data = parseContext.data_object;
  const lastMessage = firstNonEmpty(
    firstPathValue(source, [
      ["data", "message", "content"],
      ["data", "message", "text"],
      ["data", "message", "message_text"],
      ["data", "message", "last_message"],
      ["data", "message", "message"],
      ["data", "message", "msg"],
      ["data", "message", "body"],
      ["data", "message"],
      ["data", "content", "text"],
      ["data", "content"],
      ["data", "text"],
      ["data", "msg"],
      ["data", "message_text"],
      ["data", "last_message"],
      ["message", "content"],
      ["message", "text"],
      ["message", "message_text"],
      ["message", "last_message"],
      ["message", "message"],
      ["message", "msg"],
      ["message", "body"],
      ["message"],
      ["content", "text"],
      ["content"],
      ["text"],
      ["msg"],
      ["message_text"],
      ["last_message"],
      ["event", "message"],
      ["event", "content"],
      ["event", "text"],
    ]),
    findDeepValue(source, ["last_message", "message_text", "message_content", "content", "text", "msg", "body"]),
    stringifySimpleMessageValue(findDeepValue(source, ["message", "msg"]))
  );
  const messageTime = firstNonEmpty(
    firstPathValue(source, [
      ["data", "message", "message_time"],
      ["data", "message", "send_time"],
      ["data", "message", "created_at"],
      ["data", "message_time"],
      ["data", "created_at"],
      ["data", "create_time"],
      ["data", "send_time"],
      ["data", "timestamp"],
      ["data", "time"],
      ["message_time"],
      ["created_at"],
      ["create_time"],
      ["send_time"],
      ["created_time"],
      ["timestamp"],
      ["time"],
    ]),
    findDeepValue(source, ["message_time", "created_at", "create_time", "send_time", "created_time", "timestamp", "time"]),
    data.send_time
  );
  const senderType = firstNonEmpty(
    firstPathValue(source, [
      ["data", "message", "sender_type"],
      ["data", "message", "send_type"],
      ["data", "message", "role"],
      ["data", "sender_type"],
      ["data", "send_type"],
      ["data", "role"],
    ]),
    findDeepValue(source, ["sender_type", "send_type", "role", "from_type"]),
    data.sender_type
  );
  const sysUserId = firstNonEmpty(
    firstPathValue(source, [
      ["data", "message", "sys_user_id"],
      ["data", "sys_user_id"],
    ]),
    findDeepValue(source, ["sys_user_id"]),
    data.sys_user_id
  );

  const normalized = {
    event_type: firstNonEmpty(
      firstPathValue(source, [["event"], ["event_type"], ["data", "event"], ["data", "event_type"], ["data", "type"]]),
      findDeepValue(source, ["event", "event_type", "eventName", "type", "action"])
    ),
    ws_display_name: getDisplayNameFromPayload(source),
    customer_name: firstNonEmpty(
      firstPathValue(source, [
        ["data", "customer_name"],
        ["data", "name"],
        ["data", "nickname"],
        ["data", "username"],
        ["data", "customer", "customer_name"],
        ["data", "customer", "name"],
        ["data", "contact", "customer_name"],
        ["data", "contact", "name"],
      ]),
      findDeepValue(source, ["customer_name", "name", "remark_name", "nickname", "username"])
    ),
    phone: firstNonEmpty(
      firstPathValue(source, [
        ["data", "phone"],
        ["data", "mobile"],
        ["data", "whatsapp"],
        ["data", "phone_number"],
        ["data", "contact", "phone"],
        ["data", "contact", "mobile"],
        ["data", "contact", "whatsapp"],
        ["data", "contact", "phone_number"],
        ["data", "customer", "phone"],
        ["data", "customer", "mobile"],
        ["data", "customer", "whatsapp"],
        ["data", "customer", "phone_number"],
      ]),
      findDeepValue(source, ["phone", "phone_number", "customer_phone", "mobile", "tel", "whatsapp"])
    ),
    email: firstNonEmpty(
      firstPathValue(source, [["data", "email"], ["data", "contact", "email"], ["data", "customer", "email"]]),
      findDeepValue(source, ["email", "customer_email"])
    ),
    channel: firstNonEmpty(
      firstPathValue(source, [
        ["data", "channel"],
        ["data", "platform"],
        ["data", "source"],
        ["data", "channel_name"],
        ["data", "session", "channel"],
        ["data", "session", "channel_name"],
      ]),
      findDeepValue(source, ["channel", "channel_name", "platform", "source"])
    ),
    channel_id: firstNonEmpty(findDeepValue(source, ["channel_id"])),
    channel_uid: firstNonEmpty(findDeepValue(source, ["channel_uid"])),
    contact_id: firstNonEmpty(
      firstPathValue(source, [
        ["data", "contact_id"],
        ["data", "chat_user_id"],
        ["data", "customer_id"],
        ["data", "user_id"],
        ["data", "visitor_id"],
        ["data", "contact", "contact_id"],
        ["data", "contact", "chat_user_id"],
        ["data", "contact", "customer_id"],
        ["data", "contact", "user_id"],
        ["data", "contact", "visitor_id"],
        ["data", "contact", "id"],
        ["data", "customer", "contact_id"],
        ["data", "customer", "chat_user_id"],
        ["data", "customer", "customer_id"],
        ["data", "customer", "user_id"],
        ["data", "customer", "visitor_id"],
        ["data", "customer", "id"],
        ["contact_id"],
        ["chat_user_id"],
        ["customer_id"],
        ["user_id"],
        ["visitor_id"],
      ]),
      findDeepValue(source, ["contact_id", "chat_user_id", "customer_id", "user_id", "visitor_id"])
    ),
    session_id: firstNonEmpty(
      firstPathValue(source, [
        ["data", "session_id"],
        ["data", "chat_session_id"],
        ["data", "chat_id"],
        ["data", "conversation_id"],
        ["data", "conversation", "id"],
        ["data", "session", "session_id"],
        ["data", "session", "chat_session_id"],
        ["data", "session", "chat_id"],
        ["data", "session", "conversation_id"],
        ["data", "session", "id"],
        ["data", "message", "session_id"],
        ["data", "message", "chat_session_id"],
        ["data", "message", "chat_id"],
        ["session_id"],
        ["chat_session_id"],
        ["chat_id"],
        ["conversation_id"],
      ]),
      findDeepValue(source, ["session_id", "chat_session_id", "chat_id", "conversation_id"])
    ),
    project_id: firstNonEmpty(
      firstPathValue(source, [["data", "project_id"], ["data", "projectId"], ["data", "project", "project_id"], ["data", "project", "id"], ["project_id"], ["projectId"]]),
      findDeepValue(source, ["project_id", "projectId"])
    ),
    conversation_url: firstNonEmpty(
      firstPathValue(source, [
        ["data", "conversation_url"],
        ["data", "chat_url"],
        ["data", "session_url"],
        ["data", "session", "conversation_url"],
        ["data", "session", "url"],
      ]),
      findDeepValue(source, ["conversation_url", "chat_url", "session_url", "url"])
    ),
    last_message: lastMessage,
    message_time: messageTime,
    sender_name: firstNonEmpty(
      firstPathValue(source, [["data", "message", "sender_name"], ["data", "sender_name"], ["data", "sender", "name"]]),
      findDeepValue(source, ["sender_name", "sender", "sys_user_name", "staff_name"])
    ),
    sender_type: senderType,
    sys_user_id: sysUserId,
    direction: getOfficialDirectionFromPayload(source, lastMessage),
    data_is_string: parseContext.data_is_string,
    data_json_parse_success: parseContext.data_json_parse_success,
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
    contact_id: firstNonEmpty(profile.contact_id, profile.chat_user_id, profile.customer_id, profile.user_id, profile.visitor_id),
    session_id: firstNonEmpty(profile.session_id, profile.chat_session_id, profile.chat_id, profile.conversation_id),
    project_id: firstNonEmpty(profile.project_id, profile.projectId),
    conversation_url: firstNonEmpty(profile.conversation_url, profile.chat_url, profile.session_url),
    last_message: firstNonEmpty(profile.last_message, profile.message_text, profile.message, profile.content, profile.text, profile.msg),
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
