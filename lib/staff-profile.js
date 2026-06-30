const { firstNonEmpty, findDeepValue } = require("./salesmartly-profile");

const UNKNOWN_STAFF_NAME = "未识别";

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
  "sys_user_id",
  "user_id",
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
    return firstNonEmpty(value.id, value.user_id, value.staff_id, value.agent_id, value.sys_user_id);
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

function getAssignedStaffName(customer = {}, messages = []) {
  return firstNonEmpty(
    customer.assigned_staff_name,
    customer.assigned_ai_employee,
    customer.last_agent_sender_name,
    getLatestAgentSenderName(messages),
    UNKNOWN_STAFF_NAME
  );
}

module.exports = {
  UNKNOWN_STAFF_NAME,
  getStaffNameFromPayload,
  getStaffIdFromPayload,
  getLatestAgentSenderName,
  getAssignedStaffName,
};
