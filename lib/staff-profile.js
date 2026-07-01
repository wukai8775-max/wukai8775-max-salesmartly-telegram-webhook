const { firstNonEmpty, findDeepValue } = require("./salesmartly-profile");

const UNKNOWN_STAFF_NAME = "未识别";
const UNKNOWN_STAFF_ID = "未识别";

const STAFF_NAME_ALIASES = [
  "assigned_staff_name",
  "staff_name",
  "agent_name",
  "operator_name",
  "owner_name",
  "service_user_name",
  "assignee_name",
  "handler_name",
  "member_name",
  "user_name",
  "receptionist",
  "customer_service",
  "customer_service_name",
  "kefu_name",
  "ai_employee_name",
];

const STAFF_OBJECT_ALIASES = [
  "assigned_staff",
  "staff",
  "agent",
  "operator",
  "owner",
  "service_user",
  "assignee",
  "handler",
  "member",
  "user",
  "customer_service",
  "receptionist",
];

const STAFF_ID_ALIASES = [
  "assigned_staff_id",
  "staff_id",
  "agent_id",
  "operator_id",
  "owner_id",
  "service_user_id",
  "assignee_id",
  "handler_id",
  "member_id",
  "user_id",
  "sys_user_id",
  "kefu_id",
  "customer_service_id",
];

function isPlainObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function normalizeKey(key) {
  return String(key || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function parseJsonObjectString(value) {
  if (typeof value !== "string") {
    return null;
  }

  let text = value.trim();
  if (!text || !/^[{[]/.test(text)) {
    return null;
  }

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const parsed = JSON.parse(text);
      if (typeof parsed === "string") {
        text = parsed.trim();
        continue;
      }

      if (isPlainObject(parsed)) {
        return parsed;
      }

      if (Array.isArray(parsed) && isPlainObject(parsed[0])) {
        return parsed[0];
      }

      return null;
    } catch {
      return null;
    }
  }

  return null;
}

function getPayloadSources(payload = {}) {
  const sources = [];

  if (isPlainObject(payload)) {
    sources.push(payload);
  }

  const parsedData = parseJsonObjectString(payload?.data);
  if (parsedData) {
    sources.unshift({
      ...payload,
      data: parsedData,
    });
    sources.unshift(parsedData);
  }

  return sources;
}

function stringifyNameCandidate(value) {
  if (value === undefined || value === null) {
    return "";
  }

  if (typeof value === "string" || typeof value === "number") {
    return String(value).trim();
  }

  if (isPlainObject(value)) {
    return firstNonEmpty(
      value.name,
      value.display_name,
      value.staff_name,
      value.agent_name,
      value.operator_name,
      value.owner_name,
      value.service_user_name,
      value.assignee_name,
      value.handler_name,
      value.member_name,
      value.user_name,
      value.customer_service_name,
      value.kefu_name,
      value.nickname,
      value.username,
      value.title
    );
  }

  return "";
}

function stringifyIdCandidate(value) {
  if (value === undefined || value === null) {
    return "";
  }

  if (typeof value === "string" || typeof value === "number") {
    return String(value).trim();
  }

  if (isPlainObject(value)) {
    return firstNonEmpty(
      value.id,
      value.user_id,
      value.staff_id,
      value.agent_id,
      value.operator_id,
      value.owner_id,
      value.service_user_id,
      value.assignee_id,
      value.handler_id,
      value.member_id,
      value.sys_user_id,
      value.kefu_id,
      value.customer_service_id
    );
  }

  return "";
}

function findDeepObjectValue(input, aliases, formatter, depth = 0, seen = new Set()) {
  if (!input || typeof input !== "object" || depth > 7 || seen.has(input)) {
    return "";
  }

  seen.add(input);
  const aliasSet = new Set(aliases.map(normalizeKey));

  for (const [key, value] of Object.entries(input)) {
    if (aliasSet.has(normalizeKey(key))) {
      const formatted = formatter(value);
      if (formatted) {
        return formatted;
      }
    }
  }

  for (const value of Object.values(input)) {
    if (value && typeof value === "object") {
      const found = findDeepObjectValue(value, aliases, formatter, depth + 1, seen);
      if (found) {
        return found;
      }
    }
  }

  return "";
}

function getStaffNameFromPayload(payload = {}) {
  for (const source of getPayloadSources(payload)) {
    const name = firstNonEmpty(
      findDeepValue(source, STAFF_NAME_ALIASES),
      findDeepObjectValue(source, STAFF_OBJECT_ALIASES, stringifyNameCandidate)
    );

    if (name) {
      return name;
    }
  }

  return "";
}

function getStaffIdFromPayload(payload = {}) {
  for (const source of getPayloadSources(payload)) {
    const id = firstNonEmpty(
      findDeepValue(source, STAFF_ID_ALIASES),
      findDeepObjectValue(source, STAFF_OBJECT_ALIASES, stringifyIdCandidate)
    );

    if (id) {
      return id;
    }
  }

  return "";
}

function getLatestAgentSenderName(messages = []) {
  return [...messages]
    .filter((message) => ["human", "ai"].includes(String(message.direction || "").toLowerCase()))
    .sort((a, b) => {
      const aTime = new Date(a.message_time || a.created_at || 0).getTime() || 0;
      const bTime = new Date(b.message_time || b.created_at || 0).getTime() || 0;
      return bTime - aTime;
    })
    .map((message) => firstNonEmpty(message.sender_name))
    .find(Boolean) || "";
}

function getLatestAgentSenderId(messages = []) {
  return [...messages]
    .filter((message) => ["human", "ai"].includes(String(message.direction || "").toLowerCase()))
    .sort((a, b) => {
      const aTime = new Date(a.message_time || a.created_at || 0).getTime() || 0;
      const bTime = new Date(b.message_time || b.created_at || 0).getTime() || 0;
      return bTime - aTime;
    })
    .map((message) => firstNonEmpty(
      message.sender_id,
      message.staff_id,
      message.agent_id,
      message.operator_id,
      message.owner_id,
      message.service_user_id,
      message.assignee_id,
      message.assigned_staff_id,
      getStaffIdFromPayload(message.raw_payload)
    ))
    .find(Boolean) || "";
}

function getLatestAgentSenderProfile(messages = []) {
  const latest = [...messages]
    .filter((message) => ["human", "ai"].includes(String(message.direction || "").toLowerCase()))
    .sort((a, b) => {
      const aTime = new Date(a.message_time || a.created_at || 0).getTime() || 0;
      const bTime = new Date(b.message_time || b.created_at || 0).getTime() || 0;
      return bTime - aTime;
    })[0];

  if (!latest) {
    return {
      name: "",
      id: "",
      name_source: "",
      id_source: "",
    };
  }

  const rawPayloadName = getStaffNameFromPayload(latest.raw_payload);
  const rawPayloadId = getStaffIdFromPayload(latest.raw_payload);
  const name = firstNonEmpty(latest.sender_name, rawPayloadName);
  const id = firstNonEmpty(
    latest.sender_id,
    latest.staff_id,
    latest.agent_id,
    latest.operator_id,
    latest.assigned_staff_id,
    rawPayloadId
  );

  return {
    name,
    id,
    name_source: latest.sender_name ? "messages.sender_name" : rawPayloadName ? "messages.raw_payload" : "",
    id_source: latest.sender_id ? "messages.sender_id" : rawPayloadId ? "messages.raw_payload" : id ? "messages.staff_id" : "",
  };
}

function resolveCandidate(candidates = [], fallbackValue = "", fallbackSource = "unresolved") {
  for (const [source, value] of candidates) {
    const text = firstNonEmpty(value);
    if (text) {
      return {
        value: text,
        source,
      };
    }
  }

  return {
    value: fallbackValue,
    source: fallbackSource,
  };
}

function getAssignedStaffProfile(customer = {}, messages = []) {
  const latestAgent = getLatestAgentSenderProfile(messages);
  const payloadName = getStaffNameFromPayload(customer.raw_payload);
  const payloadId = getStaffIdFromPayload(customer.raw_payload);
  const directPayloadName = firstNonEmpty(
    customer.staff_name,
    customer.agent_name,
    customer.operator_name,
    customer.owner_name,
    customer.service_user_name,
    customer.assignee_name,
    customer.handler_name,
    customer.member_name,
    customer.user_name,
    customer.kefu_name,
    customer.customer_service_name
  );
  const directPayloadId = firstNonEmpty(
    customer.staff_id,
    customer.agent_id,
    customer.operator_id,
    customer.owner_id,
    customer.service_user_id,
    customer.assignee_id,
    customer.handler_id,
    customer.member_id,
    customer.user_id,
    customer.sys_user_id,
    customer.kefu_id,
    customer.customer_service_id
  );
  const resolvedName = resolveCandidate(
    [
      ["customers.assigned_staff_name", customer.assigned_staff_name],
      ["customers.assigned_ai_employee", customer.assigned_ai_employee],
      ["customers.last_agent_sender_name", customer.last_agent_sender_name],
      [latestAgent.name_source || "messages.sender_name", latestAgent.name],
      ["payload.staff_name", payloadName],
      ["payload.staff_name", directPayloadName],
    ],
    UNKNOWN_STAFF_NAME,
    "unresolved"
  );
  const resolvedId = resolveCandidate(
    [
      ["customers.assigned_staff_id", customer.assigned_staff_id],
      ["payload.staff_id", payloadId],
      ["payload.staff_id", directPayloadId],
      [latestAgent.id_source || "messages.sender_id", latestAgent.id],
    ],
    UNKNOWN_STAFF_ID,
    "unresolved"
  );

  return {
    name: resolvedName.value,
    id: resolvedId.value,
    name_source: resolvedName.source,
    id_source: resolvedId.source,
  };
}

function getAssignedStaffName(customer = {}, messages = []) {
  return getAssignedStaffProfile(customer, messages).name;
}

function getAssignedStaffId(customer = {}, messages = []) {
  return getAssignedStaffProfile(customer, messages).id;
}

module.exports = {
  UNKNOWN_STAFF_NAME,
  UNKNOWN_STAFF_ID,
  getStaffNameFromPayload,
  getStaffIdFromPayload,
  getLatestAgentSenderName,
  getLatestAgentSenderId,
  getLatestAgentSenderProfile,
  getAssignedStaffProfile,
  getAssignedStaffName,
  getAssignedStaffId,
};
