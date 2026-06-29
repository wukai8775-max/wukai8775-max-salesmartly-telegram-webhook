const {
  valueOrFallback,
  firstNonEmpty,
  getDisplayName,
  getContactDisplayValue,
  getSearchKeyword,
} = require("../lib/salesmartly-profile");
const {
  hasSupabaseEnv,
  listCustomersForAnalysis,
  getMessagesForCustomer,
  getFollowupLogsForCustomer,
  getFollowupTasksForCustomer,
  insertFollowupTask,
  updateFollowupTask,
  insertFollowupLog,
  updateCustomerByIdentity,
  markPendingTasksSkipped,
} = require("../lib/supabase-store");
const { analyzeFollowupDecision, parseDate } = require("../lib/followup-rules");
const { sendSaleSmartlyMessage } = require("../lib/salesmartly-send");
const { sendTelegramMessage } = require("../lib/telegram");

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
  const expectedSecrets = [
    process.env.SALES_SMARTLY_WEBHOOK_SECRET,
    process.env.CRON_SECRET,
  ].filter(Boolean);

  if (expectedSecrets.length === 0) {
    return true;
  }

  return expectedSecrets.includes(getWebhookSecret(req));
}

function isAutoFollowupEnabled() {
  return String(process.env.AUTO_FOLLOWUP_ENABLED || "false").toLowerCase() === "true";
}

function getLimit(req) {
  const raw = req.body?.limit || req.query?.limit || 50;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 200) : 50;
}

function getCustomerLabel(customer = {}) {
  return firstNonEmpty(getDisplayName(customer), customer.customer_name, customer.phone, customer.email, "未提供");
}

function getWsOrSearchLine(customer = {}) {
  const displayName = getDisplayName(customer);

  if (displayName) {
    return `WS名称：${displayName}`;
  }

  return `搜索关键词：${getSearchKeyword(customer, customer.last_customer_message)}`;
}

function buildAutoSentTelegramMessage(customer = {}, decision = {}, messageText = "") {
  return [
    "【自动回访已发送】",
    "",
    `客户阶段：${valueOrFallback(decision.status)}`,
    `回访节点：${valueOrFallback(decision.followup_stage)}`,
    getWsOrSearchLine(customer),
    `联系方式：${getContactDisplayValue(customer, customer.last_customer_message)}`,
    `搜索关键词：${getSearchKeyword(customer, customer.last_customer_message)}`,
    "",
    "发送内容：",
    valueOrFallback(messageText),
  ].join("\n");
}

function buildManualTelegramMessage(customer = {}, decision = {}, reason = "") {
  return [
    "【需要人工回访】",
    "",
    `原因：${valueOrFallback(reason || decision.reason || decision.skipped_reason)}`,
    getWsOrSearchLine(customer),
    `客户：${valueOrFallback(customer.customer_name)}`,
    `联系方式：${getContactDisplayValue(customer, customer.last_customer_message)}`,
    "",
    "客户最近消息：",
    valueOrFallback(decision.last_customer_message || customer.last_customer_message),
    "",
    decision.suggested_message ? "建议回访内容：" : "",
    decision.suggested_message || "",
    "",
    "请人工接入处理。",
  ].filter((line) => line !== "").join("\n");
}

async function sendTelegramSafely(text) {
  try {
    const result = await sendTelegramMessage(text);
    return {
      success: true,
      result,
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
    };
  }
}

function countAutoSentInLast24Hours(logs = [], now = new Date()) {
  const cutoff = now.getTime() - 24 * 3600000;

  return logs.filter((log) => {
    if (log.action_type !== "auto_sent") {
      return false;
    }

    const time = parseDate(log.created_at);
    return time && time.getTime() >= cutoff;
  }).length;
}

async function createTaskIfNeeded(customer, decision) {
  if (decision.existing_pending_task) {
    return {
      task: decision.existing_pending_task,
      created: false,
    };
  }

  const task = await insertFollowupTask({
    contact_id: customer.contact_id,
    session_id: customer.session_id,
    status: "pending",
    priority: decision.priority || "medium",
    reason: decision.reason,
    suggested_message: decision.suggested_message,
    auto_send_allowed: decision.auto_send_allowed,
    followup_stage: decision.followup_stage,
    scheduled_at: decision.scheduled_at || new Date().toISOString(),
  });

  return {
    task,
    created: true,
  };
}

async function processHighRiskDecision(customer, decision) {
  await updateCustomerByIdentity(customer, {
    current_status: decision.status,
    risk_level: decision.risk_level,
    followup_stopped: true,
    followup_stop_reason: decision.stop_reason || "high_risk_handoff_required",
  });
  await markPendingTasksSkipped(customer, "high_risk_handoff_required");

  if (!decision.should_send_telegram) {
    return {
      action: "skipped",
      reason: "high_risk_telegram_already_sent",
      decision,
    };
  }

  const task = await insertFollowupTask({
    contact_id: customer.contact_id,
    session_id: customer.session_id,
    status: "skipped",
    priority: "high",
    reason: decision.reason,
    suggested_message: "",
    auto_send_allowed: false,
    followup_stage: decision.followup_stage || "",
    scheduled_at: new Date().toISOString(),
    skipped_reason: "high_risk_handoff_required",
  });
  const telegramText = buildManualTelegramMessage(customer, decision, "高风险场景，需要人工接入");
  const telegramResult = await sendTelegramSafely(telegramText);

  await insertFollowupLog({
    contact_id: customer.contact_id,
    session_id: customer.session_id,
    action_type: telegramResult.success ? "telegram_alert" : "failed",
    status: decision.status,
    followup_stage: decision.followup_stage || "",
    message_sent: "",
    reason: decision.reason,
    raw_result: {
      ...(decision.raw_result || {}),
      task_id: task?.id,
      telegram_result: telegramResult,
    },
  });

  return {
    action: "telegram_alert",
    telegram_sent: telegramResult.success,
    decision,
  };
}

async function processStopDecision(customer, decision) {
  await updateCustomerByIdentity(customer, {
    current_status: decision.status,
    risk_level: decision.risk_level,
    followup_stopped: true,
    followup_stop_reason: decision.stop_reason,
    do_not_followup: decision.stop_reason === "customer_opt_out" ? true : customer.do_not_followup,
  });
  await markPendingTasksSkipped(customer, decision.stop_reason || "followup_stopped");
  await insertFollowupLog({
    contact_id: customer.contact_id,
    session_id: customer.session_id,
    action_type: "skipped",
    status: decision.status,
    followup_stage: decision.followup_stage || "",
    reason: decision.stop_reason || decision.skipped_reason,
    raw_result: decision.raw_result || {},
  });

  return {
    action: "stopped",
    decision,
  };
}

async function processAutoAllowedDecision(customer, messages, logs, decision, autoEnabled, now) {
  const { task, created } = await createTaskIfNeeded(customer, decision);
  const messageText = firstNonEmpty(task?.suggested_message, decision.suggested_message);

  await updateCustomerByIdentity(customer, {
    current_status: decision.status,
    risk_level: decision.risk_level,
    followup_stage: decision.followup_stage,
  });

  if (!autoEnabled) {
    if (created) {
      const telegramResult = await sendTelegramSafely(
        buildManualTelegramMessage(customer, decision, "AUTO_FOLLOWUP_ENABLED=false，已生成回访任务但未自动发送客户")
      );
      await insertFollowupLog({
        contact_id: customer.contact_id,
        session_id: customer.session_id,
        action_type: telegramResult.success ? "telegram_alert" : "failed",
        status: decision.status,
        followup_stage: decision.followup_stage,
        message_sent: "",
        reason: "auto_followup_disabled",
        raw_result: {
          task_id: task?.id,
          template_id: decision.template_id,
          telegram_result: telegramResult,
        },
      });
    }

    return {
      action: "task_created",
      auto_send_enabled: false,
      task_created: created,
      decision,
    };
  }

  const sendResult = await sendSaleSmartlyMessage({
    contact_id: customer.contact_id,
    session_id: customer.session_id,
    project_id: customer.project_id,
    channel: customer.channel,
    message_text: messageText,
  });

  if (!sendResult.success) {
    await updateFollowupTask(task?.id, {
      status: sendResult.skipped ? "skipped" : "failed",
      skipped_reason: sendResult.skipped_reason || sendResult.error || "send_failed",
    });
    await insertFollowupLog({
      contact_id: customer.contact_id,
      session_id: customer.session_id,
      action_type: sendResult.skipped ? "skipped" : "failed",
      status: decision.status,
      followup_stage: decision.followup_stage,
      message_sent: messageText,
      reason: sendResult.skipped_reason || sendResult.error || "send_failed",
      raw_result: sendResult,
    });
    const telegramResult = await sendTelegramSafely(
      buildManualTelegramMessage(customer, decision, `自动回访发送失败：${sendResult.error || sendResult.skipped_reason}`)
    );

    return {
      action: "send_failed",
      telegram_sent: telegramResult.success,
      send_result: sendResult,
      decision,
    };
  }

  const sentAt = new Date().toISOString();
  await updateFollowupTask(task?.id, {
    status: "sent",
    sent_at: sentAt,
  });
  await insertFollowupLog({
    contact_id: customer.contact_id,
    session_id: customer.session_id,
    action_type: "auto_sent",
    status: decision.status,
    followup_stage: decision.followup_stage,
    message_sent: messageText,
    reason: decision.reason,
    raw_result: {
      template_id: decision.template_id,
      salesmartly_result: sendResult.raw_result,
    },
  });
  const totalCount = Number(customer.followup_count_total || 0) + 1;
  const count24h = countAutoSentInLast24Hours(logs, now) + 1;
  const customerPatch = {
    last_auto_followup_at: sentAt,
    followup_count_total: totalCount,
    followup_count_24h: count24h,
    current_status: decision.status,
    risk_level: decision.risk_level,
    followup_stage: decision.followup_stage,
  };

  if (decision.followup_stage === "72h") {
    customerPatch.followup_stopped = true;
    customerPatch.followup_stop_reason = "no_reply_after_3_days";
  }

  await updateCustomerByIdentity(customer, customerPatch);
  const telegramResult = await sendTelegramSafely(buildAutoSentTelegramMessage(customer, decision, messageText));

  return {
    action: "auto_sent",
    telegram_sent: telegramResult.success,
    decision,
  };
}

async function processCustomer(customer, options = {}) {
  const now = parseDate(options.now) || new Date();
  const messages = await getMessagesForCustomer(customer, options.messageLimit || 80);
  const logs = await getFollowupLogsForCustomer(customer, 120);
  const tasks = await getFollowupTasksForCustomer(customer, 120);
  const decision = analyzeFollowupDecision({
    customer,
    messages,
    logs,
    tasks,
    now,
  });

  if (decision.customer_replied_after_last_auto_followup) {
    await markPendingTasksSkipped(customer, "customer_replied_after_last_auto_followup");
  }

  if (decision.risk_level === "high" && decision.skipped_reason === "high_risk_handoff_required") {
    return processHighRiskDecision(customer, decision);
  }

  if (decision.should_stop) {
    return processStopDecision(customer, decision);
  }

  await updateCustomerByIdentity(customer, {
    current_status: decision.status,
    risk_level: decision.risk_level,
    followup_stage: decision.followup_stage || customer.followup_stage,
  });

  if (!decision.auto_send_allowed) {
    return {
      action: "skipped",
      reason: decision.skipped_reason,
      decision,
    };
  }

  return processAutoAllowedDecision(customer, messages, logs, decision, options.autoEnabled, now);
}

module.exports = async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
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

  if (!hasSupabaseEnv()) {
    return res.status(500).json({
      ok: false,
      error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY",
    });
  }

  const limit = getLimit(req);
  const autoEnabled = isAutoFollowupEnabled();

  try {
    const customers = await listCustomersForAnalysis(limit);
    const results = [];

    for (const customer of customers) {
      if (!customer.contact_id && !customer.session_id) {
        continue;
      }

      const result = await processCustomer(customer, {
        autoEnabled,
        now: req.body?.now || req.query?.now,
      });
      results.push({
        contact_id: customer.contact_id,
        session_id: customer.session_id,
        customer: getCustomerLabel(customer),
        ...result,
      });
    }

    return res.status(200).json({
      ok: true,
      success: true,
      auto_followup_enabled: autoEnabled,
      scanned: customers.length,
      results,
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      success: false,
      error: error.message,
    });
  }
};
