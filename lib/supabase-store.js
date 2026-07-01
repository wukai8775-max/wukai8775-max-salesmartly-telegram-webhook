const {
  firstNonEmpty,
  getDisplayName,
  extractPhoneFromText,
  extractEmailFromText,
} = require("./salesmartly-profile");
const { getStaffNameFromPayload, getStaffIdFromPayload, getAssignedStaffProfile } = require("./staff-profile");

const OPTIONAL_CUSTOMER_COLUMNS = ["assigned_staff_name", "assigned_staff_id", "last_agent_sender_name"];
const OPTIONAL_MESSAGE_COLUMNS = ["sender_id"];

function hasSupabaseEnv() {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

function getSupabaseKeyRole() {
  const key = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();

  if (!key) {
    return "missing";
  }

  if (key.startsWith("sb_secret_")) {
    return "secret_key";
  }

  if (key.startsWith("sb_publishable_") || key.startsWith("sb_anon_")) {
    return "publishable_or_anon_key";
  }

  const parts = key.split(".");
  if (parts.length < 2) {
    return "unrecognized_key_format";
  }

  try {
    const payload = JSON.parse(Buffer.from(parts[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"));
    return payload.role || "jwt_without_role";
  } catch (error) {
    return "unreadable_jwt";
  }
}

function getSupabaseBaseUrl() {
  return String(process.env.SUPABASE_URL || "").replace(/\/+$/, "");
}

function getSupabaseHeaders(extra = {}) {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  return {
    apikey: key,
    authorization: `Bearer ${key}`,
    "content-type": "application/json",
    ...extra,
  };
}

function encodeFilter(value) {
  return encodeURIComponent(String(value));
}

function hasRawPayload(value) {
  if (value === undefined || value === null) {
    return false;
  }

  if (Array.isArray(value)) {
    return value.length > 0;
  }

  if (typeof value === "object") {
    return Object.keys(value).length > 0;
  }

  return String(value).trim() !== "";
}

function getPayloadTopLevelKeys(payload = {}) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return [];
  }

  return Object.keys(payload);
}

function logOfficialWebhookStorage(payload = {}, profile = {}, direction = "system", result = {}) {
  const messageText = firstNonEmpty(profile.last_message, profile.message_text);
  const staffProfile = getAssignedStaffProfile(
    {
      ...profile,
      raw_payload: payload,
      assigned_staff_name: firstNonEmpty(profile.assigned_staff_name, getStaffNameFromPayload(payload)),
      assigned_staff_id: firstNonEmpty(profile.assigned_staff_id, getStaffIdFromPayload(payload)),
    },
    []
  );

  console.info("SaleSmartly official webhook Supabase storage", {
    received_body_top_level_keys: getPayloadTopLevelKeys(payload),
    data_is_string: Boolean(profile.data_is_string),
    data_json_parse_success: Boolean(profile.data_json_parse_success),
    extracted_contact_id_exists: Boolean(profile.contact_id),
    extracted_session_id_exists: Boolean(profile.session_id),
    extracted_message_text_exists: Boolean(messageText),
    extracted_direction: direction,
    extracted_staff_name_exists: staffProfile.name !== "未识别",
    extracted_staff_id_exists: staffProfile.id !== "未识别",
    staff_source: staffProfile.name_source,
    staff_id_source: staffProfile.id_source,
    telegram_target_chat_source: "TELEGRAM_CHAT_ID",
    will_insert_message: Boolean(result.will_insert_message),
    supabase_insert_message_success: Boolean(result.message_success),
    supabase_upsert_customer_success: Boolean(result.customer_success),
    supabase_insert_message_error: result.message_error || "",
    supabase_upsert_customer_error: result.customer_error || "",
    supabase_save_reason: result.reason || "",
    supabase_key_role: result.supabase_key_role || getSupabaseKeyRole(),
  });
}

async function supabaseRequest(path, options = {}) {
  if (!hasSupabaseEnv()) {
    return {
      skipped: true,
      reason: "missing_supabase_env",
      data: null,
    };
  }

  const response = await fetch(`${getSupabaseBaseUrl()}/rest/v1/${path}`, {
    method: options.method || "GET",
    headers: getSupabaseHeaders(options.headers),
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;

  if (!response.ok) {
    const message = data?.message || data?.hint || response.statusText || "Supabase request failed";
    throw new Error(message);
  }

  return {
    skipped: false,
    data,
  };
}

async function selectRows(table, query = "") {
  const result = await supabaseRequest(`${table}${query ? `?${query}` : ""}`);
  return Array.isArray(result.data) ? result.data : [];
}

async function insertRow(table, row) {
  const result = await supabaseRequest(table, {
    method: "POST",
    headers: {
      Prefer: "return=representation",
    },
    body: row,
  });

  return Array.isArray(result.data) ? result.data[0] : result.data;
}

async function upsertRow(table, row, onConflict) {
  const result = await supabaseRequest(`${table}?on_conflict=${encodeURIComponent(onConflict)}`, {
    method: "POST",
    headers: {
      Prefer: "resolution=merge-duplicates,return=representation",
    },
    body: row,
  });

  return Array.isArray(result.data) ? result.data[0] : result.data;
}

async function patchRows(table, query, patch) {
  const result = await supabaseRequest(`${table}?${query}`, {
    method: "PATCH",
    headers: {
      Prefer: "return=representation",
    },
    body: patch,
  });

  return Array.isArray(result.data) ? result.data : [];
}

function omitKeys(row = {}, keys = []) {
  return Object.fromEntries(Object.entries(row).filter(([key]) => !keys.includes(key)));
}

function isMissingOptionalColumnError(error, columns = []) {
  const message = String(error?.message || "");
  return /column|schema cache|does not exist|could not find/i.test(message) && columns.some((column) => message.includes(column));
}

function isMissingOptionalCustomerColumnError(error) {
  return isMissingOptionalColumnError(error, OPTIONAL_CUSTOMER_COLUMNS);
}

function isMissingOptionalMessageColumnError(error) {
  return isMissingOptionalColumnError(error, OPTIONAL_MESSAGE_COLUMNS);
}

async function findCustomer(profile = {}) {
  const contactId = firstNonEmpty(profile.contact_id);
  const sessionId = firstNonEmpty(profile.session_id);

  if (contactId) {
    const rows = await selectRows("customers", `select=*&contact_id=eq.${encodeFilter(contactId)}&limit=1`);
    if (rows[0]) {
      return rows[0];
    }
  }

  if (sessionId) {
    const rows = await selectRows("customers", `select=*&session_id=eq.${encodeFilter(sessionId)}&limit=1`);
    if (rows[0]) {
      return rows[0];
    }
  }

  return null;
}

function normalizeMessageTime(value) {
  if (!value) {
    return new Date().toISOString();
  }

  if (typeof value === "number" || /^\d+$/.test(String(value))) {
    const numeric = Number(value);
    const millis = numeric < 100000000000 ? numeric * 1000 : numeric;
    const date = new Date(millis);
    return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function buildCustomerRow(profile = {}, options = {}) {
  const now = new Date().toISOString();
  const existingCustomer = options.existingCustomer || {};
  const messageText = firstNonEmpty(options.messageText, profile.last_message);
  const messageTime = normalizeMessageTime(options.messageTime || profile.message_time);
  const direction = firstNonEmpty(options.direction, "system");
  const phone = firstNonEmpty(profile.phone, extractPhoneFromText(messageText));
  const email = firstNonEmpty(profile.email, extractEmailFromText(messageText));
  const rawPayload = options.rawPayload || profile.raw_payload || {};
  const payloadStaffName = getStaffNameFromPayload(rawPayload);
  const payloadStaffId = getStaffIdFromPayload(rawPayload);
  const assignedAiEmployee = firstNonEmpty(
    existingCustomer.assigned_ai_employee,
    profile.assigned_ai_employee,
    profile.ai_employee_name,
    profile.agent_name,
    profile.employee_name,
    profile.staff_name,
    profile.bot_name
  );
  const agentSenderName =
    direction === "ai" || direction === "human"
      ? firstNonEmpty(profile.sender_name, payloadStaffName, assignedAiEmployee)
      : "";
  const agentSenderId =
    direction === "ai" || direction === "human"
      ? firstNonEmpty(
          profile.sender_id,
          profile.staff_id,
          profile.agent_id,
          profile.operator_id,
          profile.owner_id,
          profile.service_user_id,
          profile.assignee_id,
          profile.handler_id,
          profile.member_id,
          profile.user_id,
          profile.sys_user_id,
          payloadStaffId
        )
      : "";
  const assignedStaffName = firstNonEmpty(
    existingCustomer.assigned_staff_name,
    profile.assigned_staff_name,
    payloadStaffName,
    agentSenderName
  );
  const assignedStaffId = firstNonEmpty(
    existingCustomer.assigned_staff_id,
    profile.assigned_staff_id,
    payloadStaffId,
    agentSenderId
  );
  const row = {
    contact_id: firstNonEmpty(profile.contact_id),
    session_id: firstNonEmpty(profile.session_id),
    project_id: firstNonEmpty(profile.project_id),
    ws_display_name: getDisplayName(profile),
    customer_name: firstNonEmpty(profile.customer_name, profile.name),
    phone,
    email,
    channel: firstNonEmpty(profile.channel),
    conversation_url: firstNonEmpty(profile.conversation_url),
    assigned_ai_employee: assignedAiEmployee,
    assigned_staff_name: assignedStaffName,
    assigned_staff_id: assignedStaffId,
    last_customer_message: direction === "customer" ? messageText : undefined,
    last_customer_message_at: direction === "customer" ? messageTime : undefined,
    last_agent_message_at: direction === "ai" || direction === "human" ? messageTime : undefined,
    last_agent_sender_name:
      direction === "ai" || direction === "human"
        ? firstNonEmpty(profile.last_agent_sender_name, agentSenderName)
        : firstNonEmpty(profile.last_agent_sender_name),
    current_status: firstNonEmpty(profile.current_status),
    risk_level: firstNonEmpty(profile.risk_level),
    followup_stage: firstNonEmpty(profile.followup_stage),
    updated_at: now,
  };

  return Object.fromEntries(Object.entries(row).filter(([, value]) => value !== undefined && value !== ""));
}

async function upsertCustomer(profile = {}, options = {}) {
  const existing = await findCustomer(profile);
  const row = buildCustomerRow(profile, {
    ...options,
    existingCustomer: existing || {},
  });
  const direction = firstNonEmpty(options.direction, "system");
  const messageTime = normalizeMessageTime(options.messageTime || profile.message_time);

  if (direction === "customer" && !existing?.first_customer_message_at) {
    row.first_customer_message_at = messageTime;
  }

  if (!existing && !row.created_at) {
    row.created_at = new Date().toISOString();
  }

  if (!row.contact_id && !row.session_id) {
    return null;
  }

  const conflictKey = row.contact_id ? "contact_id" : "session_id";

  try {
    return await upsertRow("customers", row, conflictKey);
  } catch (error) {
    if (isMissingOptionalCustomerColumnError(error)) {
      return upsertRow("customers", omitKeys(row, OPTIONAL_CUSTOMER_COLUMNS), conflictKey);
    }

    throw error;
  }
}

async function insertMessage(message = {}) {
  const messageText = firstNonEmpty(message.message_text, message.last_message);
  const rawPayload = hasRawPayload(message.raw_payload) ? message.raw_payload : {};
  const direction = firstNonEmpty(message.direction, "system");
  const senderName =
    direction === "ai" || direction === "human"
      ? firstNonEmpty(
          message.sender_name,
          getStaffNameFromPayload(rawPayload),
          message.assigned_staff_name,
          message.assigned_ai_employee
        )
      : firstNonEmpty(message.sender_name);
  const senderId =
    direction === "ai" || direction === "human"
      ? firstNonEmpty(
          message.sender_id,
          getStaffIdFromPayload(rawPayload),
          message.assigned_staff_id,
          message.staff_id,
          message.agent_id,
          message.operator_id,
          message.owner_id,
          message.service_user_id,
          message.assignee_id,
          message.handler_id,
          message.member_id,
          message.user_id,
          message.sys_user_id
        )
      : firstNonEmpty(message.sender_id);
  const row = {
    contact_id: firstNonEmpty(message.contact_id),
    session_id: firstNonEmpty(message.session_id),
    project_id: firstNonEmpty(message.project_id),
    direction,
    sender_name: senderName,
    sender_id: senderId,
    message_text: messageText,
    message_time: normalizeMessageTime(message.message_time),
    raw_payload: rawPayload,
  };

  if (!row.sender_id) {
    delete row.sender_id;
  }

  if (!row.contact_id && !row.session_id && !row.message_text && !hasRawPayload(rawPayload)) {
    return null;
  }

  try {
    return await insertRow("messages", row);
  } catch (error) {
    if (isMissingOptionalMessageColumnError(error)) {
      return insertRow("messages", omitKeys(row, OPTIONAL_MESSAGE_COLUMNS));
    }

    throw error;
  }
}

async function saveOfficialWebhookEvent(profile = {}, payload = {}, direction = "system") {
  const messageTime = normalizeMessageTime(profile.message_time);
  const messageText = firstNonEmpty(profile.last_message, profile.message_text);
  const willUpsertCustomer = Boolean(firstNonEmpty(profile.contact_id, profile.session_id));
  const willInsertMessage = Boolean(firstNonEmpty(profile.contact_id, profile.session_id, messageText) || hasRawPayload(payload));
  const supabaseKeyRole = getSupabaseKeyRole();
  let customer = null;
  let message = null;
  let customerError = "";
  let messageError = "";

  if (!hasSupabaseEnv()) {
    const result = {
      saved: false,
      reason: "missing_supabase_env",
      will_upsert_customer: willUpsertCustomer,
      will_insert_message: willInsertMessage,
      customer_success: false,
      message_success: false,
      customer_error: "",
      message_error: "",
      supabase_key_role: supabaseKeyRole,
      customer,
      message,
    };
    logOfficialWebhookStorage(payload, profile, direction, result);
    return result;
  }

  if (willUpsertCustomer) {
    try {
      customer = await upsertCustomer(profile, { direction, messageText, messageTime, rawPayload: payload });
    } catch (error) {
      customerError = error.message;
    }
  }

  if (willInsertMessage) {
    try {
      message = await insertMessage({
        ...profile,
        direction,
        message_text: messageText,
        message_time: messageTime,
        raw_payload: payload,
      });
    } catch (error) {
      messageError = error.message;
    }
  }

  const saved = Boolean(customer || message);
  const reason = saved
    ? ""
    : firstNonEmpty(
        messageError,
        customerError,
        !willUpsertCustomer && !willInsertMessage ? "nothing_to_write" : "no_rows_written"
      );
  const result = {
    saved,
    reason,
    will_upsert_customer: willUpsertCustomer,
    will_insert_message: willInsertMessage,
    customer_success: Boolean(customer),
    message_success: Boolean(message),
    customer_error: customerError,
    message_error: messageError,
    supabase_key_role: supabaseKeyRole,
    customer,
    message,
  };
  logOfficialWebhookStorage(payload, profile, direction, result);
  return result;
}

async function listCustomersForAnalysis(limit = 50) {
  return selectRows(
    "customers",
    ["select=*", "order=updated_at.asc", `limit=${encodeURIComponent(String(limit))}`].join("&")
  );
}

async function getMessagesForCustomer(customer = {}, limit = 80) {
  if (customer.contact_id) {
    return selectRows(
      "messages",
      [
        "select=*",
        `contact_id=eq.${encodeFilter(customer.contact_id)}`,
        "order=message_time.desc",
        `limit=${encodeURIComponent(String(limit))}`,
      ].join("&")
    );
  }

  if (customer.session_id) {
    return selectRows(
      "messages",
      [
        "select=*",
        `session_id=eq.${encodeFilter(customer.session_id)}`,
        "order=message_time.desc",
        `limit=${encodeURIComponent(String(limit))}`,
      ].join("&")
    );
  }

  return [];
}

async function getFollowupLogsForCustomer(customer = {}, limit = 80) {
  if (customer.contact_id) {
    return selectRows(
      "followup_logs",
      [
        "select=*",
        `contact_id=eq.${encodeFilter(customer.contact_id)}`,
        "order=created_at.desc",
        `limit=${encodeURIComponent(String(limit))}`,
      ].join("&")
    );
  }

  if (customer.session_id) {
    return selectRows(
      "followup_logs",
      [
        "select=*",
        `session_id=eq.${encodeFilter(customer.session_id)}`,
        "order=created_at.desc",
        `limit=${encodeURIComponent(String(limit))}`,
      ].join("&")
    );
  }

  return [];
}

async function getFollowupTasksForCustomer(customer = {}, limit = 80) {
  if (customer.contact_id) {
    return selectRows(
      "followup_tasks",
      [
        "select=*",
        `contact_id=eq.${encodeFilter(customer.contact_id)}`,
        "order=created_at.desc",
        `limit=${encodeURIComponent(String(limit))}`,
      ].join("&")
    );
  }

  if (customer.session_id) {
    return selectRows(
      "followup_tasks",
      [
        "select=*",
        `session_id=eq.${encodeFilter(customer.session_id)}`,
        "order=created_at.desc",
        `limit=${encodeURIComponent(String(limit))}`,
      ].join("&")
    );
  }

  return [];
}

async function insertFollowupTask(task = {}) {
  return insertRow("followup_tasks", {
    contact_id: firstNonEmpty(task.contact_id),
    session_id: firstNonEmpty(task.session_id),
    status: firstNonEmpty(task.status, "pending"),
    priority: firstNonEmpty(task.priority, "medium"),
    reason: firstNonEmpty(task.reason),
    suggested_message: firstNonEmpty(task.suggested_message),
    auto_send_allowed: Boolean(task.auto_send_allowed),
    followup_stage: firstNonEmpty(task.followup_stage),
    scheduled_at: normalizeMessageTime(task.scheduled_at),
    sent_at: task.sent_at || null,
    skipped_reason: firstNonEmpty(task.skipped_reason) || null,
  });
}

async function updateFollowupTask(taskId, patch = {}) {
  if (!taskId) {
    return [];
  }

  return patchRows("followup_tasks", `id=eq.${encodeFilter(taskId)}`, {
    ...patch,
    updated_at: new Date().toISOString(),
  });
}

async function insertFollowupLog(log = {}) {
  return insertRow("followup_logs", {
    contact_id: firstNonEmpty(log.contact_id),
    session_id: firstNonEmpty(log.session_id),
    action_type: firstNonEmpty(log.action_type, "skipped"),
    status: firstNonEmpty(log.status),
    followup_stage: firstNonEmpty(log.followup_stage),
    message_sent: firstNonEmpty(log.message_sent),
    reason: firstNonEmpty(log.reason),
    raw_result: log.raw_result || {},
  });
}

async function updateCustomerByIdentity(customer = {}, patch = {}) {
  const body = {
    ...patch,
    updated_at: new Date().toISOString(),
  };

  if (customer.contact_id) {
    return patchRows("customers", `contact_id=eq.${encodeFilter(customer.contact_id)}`, body);
  }

  if (customer.session_id) {
    return patchRows("customers", `session_id=eq.${encodeFilter(customer.session_id)}`, body);
  }

  return [];
}

async function markPendingTasksSkipped(customer = {}, reason = "customer_replied") {
  const patch = {
    status: "skipped",
    skipped_reason: reason,
  };

  if (customer.contact_id) {
    return patchRows(
      "followup_tasks",
      `contact_id=eq.${encodeFilter(customer.contact_id)}&status=eq.pending`,
      patch
    );
  }

  if (customer.session_id) {
    return patchRows(
      "followup_tasks",
      `session_id=eq.${encodeFilter(customer.session_id)}&status=eq.pending`,
      patch
    );
  }

  return [];
}

module.exports = {
  hasSupabaseEnv,
  normalizeMessageTime,
  saveOfficialWebhookEvent,
  listCustomersForAnalysis,
  getMessagesForCustomer,
  getFollowupLogsForCustomer,
  getFollowupTasksForCustomer,
  insertFollowupTask,
  updateFollowupTask,
  insertFollowupLog,
  updateCustomerByIdentity,
  markPendingTasksSkipped,
};
