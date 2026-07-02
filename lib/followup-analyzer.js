const {
  valueOrFallback,
  firstNonEmpty,
  getDisplayName,
  getContactDisplayValue,
  getSearchKeyword,
} = require("./salesmartly-profile");
const { getAssignedStaffName, getAssignedStaffId } = require("./staff-profile");
const {
  listCustomersForAnalysis,
  getMessagesForCustomer,
  getFollowupLogsForCustomer,
  getFollowupTasksForCustomer,
  insertFollowupTask,
  updateFollowupTask,
  insertFollowupLog,
  updateCustomerByIdentity,
  markPendingTasksSkipped,
} = require("./supabase-store");
const { analyzeFollowupDecision, parseDate } = require("./followup-rules");
const { sendTelegramMessage } = require("./telegram");
const { getQuietHoursState, getQuietHoursResponseFields, shouldDeferForQuietHours } = require("./quiet-hours");

const FOLLOWUP_MODE = "telegram_only";
const AUTO_CUSTOMER_SEND_DISABLED = true;
const QUIET_DEFER_REASON = "quiet_hours_deferred";

const PRIORITY_LABELS = {
  high: "高",
  medium: "中",
  low: "低",
};

const HIGH_RISK_REASONS = {
  ai_doubt: "客户质疑是否为 AI / 机器人，需要人工关注",
  call_request: "客户要求电话联系或视频通话，需要人工跟进",
  shipping_info: "客户已提交收货信息，需要人工核对并推进订单",
  complaint_or_after_sales: "客户可能在投诉或反馈售后/物流异常，需要人工接入",
  payment_dispute: "客户提到付款异常、退款或争议，需要人工处理",
  angry_customer: "客户情绪明显不满，需要人工安抚",
};

const ANALYSIS_BY_STATUS = {
  first_greeting_no_reply:
    "客户只发送了初始问候，AI/业务员已回复开场白，但客户没有继续说明需求，需要人工轻量回访，重新引导客户说明想了解的产品或目标。",
  quality_trust_question_no_reply:
    "客户正在核实检测报告、实验室位置或产品真实性，可能对质量证明仍有顾虑，需要人工跟进确认客户主要担心的是 COA、批次、实验室信息还是首次合作风险。",
  b2b_wholesale_interest_no_reply:
    "客户表现出 B2B / 批发 / 大货采购意向，可能正在比较价格、供应稳定性、产品范围或长期合作条件，需要人工及时跟进确认采购需求和报价方向。",
  shipping_address_request_no_reply:
    "我们已经向客户追问收货地址或配送信息，但客户暂时没有继续回复，需要人工轻量跟进，确认客户是否还准备继续推进付款或下单流程。",
  staff_next_step_question_no_reply:
    "我们已经向客户追问下一步确认信息，但客户暂时没有继续回复，需要人工轻量回访，确认客户是否还需要产品、数量、价格、物流或订单方面的帮助。",
  general_no_reply_after_staff_message:
    "客户在我们回复后暂时没有继续回复，当前没有明确拒绝或结束意向，需要人工轻量回访，确认客户是否还需要产品、价格、物流或订单方面的帮助。",
  price_requested: "客户在看价格、目录或报价信息，可能还没确定目标产品和预算。",
  price_list_requested: "客户在索要价格表、目录或产品清单，需要人工根据目标和预算引导客户缩小选择范围。",
  quote_sent_no_reply: "客户已收到报价但没有继续回复，可能卡在总价、MOQ、运费或首次测试成本。",
  payment_interest_no_reply: "客户问过付款方式后没有继续，可能在评估付款安全性或流程。",
  shipping_question_no_reply: "客户问过物流后没有继续，可能在担心运费、时效、追踪或清关。",
  later_followup: "客户表示稍后再看或需要考虑，需要人工轻量跟进客户当前卡点。",
  high_intent_no_reply: "客户表达过下单意向但没有继续确认，可能卡在付款、收货信息、总价或信任问题。",
  price_objection: "客户认为价格偏高或正在比较其他报价，需要人工解释订单组成并判断是否适合小单测试。",
  product_question_no_reply: "客户在询问是否有某类产品或剂型，需要人工确认具体需求后再给出产品方向。",
};

function getCustomerLabel(customer = {}) {
  return firstNonEmpty(getDisplayName(customer), customer.customer_name, customer.phone, customer.email, "未提供");
}

function getPriorityLabel(priority) {
  return PRIORITY_LABELS[priority] || PRIORITY_LABELS.medium;
}

function optionalLine(label, value) {
  const text = firstNonEmpty(value);
  return text ? `${label}：${text}` : "";
}

function getContactLine(customer = {}) {
  const contactValue = getContactDisplayValue(customer, customer.last_customer_message);
  return contactValue && contactValue !== "未提供" ? `联系方式：${contactValue}` : "";
}

function getReminderSearchKeyword(customer = {}) {
  const keyword = getSearchKeyword(customer, customer.last_customer_message);
  return keyword && keyword !== "未获取到" ? keyword : firstNonEmpty(customer.contact_id, customer.session_id, "未获取到");
}

function sortMessagesAsc(messages = []) {
  return [...messages].sort((a, b) => {
    const aTime = parseDate(a.message_time)?.getTime() || 0;
    const bTime = parseDate(b.message_time)?.getTime() || 0;
    return aTime - bTime;
  });
}

function getLatestMessageByDirection(messages = [], directions = []) {
  const directionSet = new Set(directions);
  return sortMessagesAsc(messages)
    .reverse()
    .find((message) => directionSet.has(message.direction));
}

function getLatestAgentMessageText(messages = []) {
  return firstNonEmpty(getLatestMessageByDirection(messages, ["ai", "human"])?.message_text);
}

function getDecisionSummary(decision = {}) {
  return {
    latest_customer_message_time: decision.latest_customer_message_time || "",
    latest_agent_message_time: decision.latest_agent_message_time || "",
    last_message_direction: decision.last_message_direction || "unknown",
    detected_status: decision.detected_status || decision.status || "unknown",
    skipped_reason: decision.skipped_reason || "",
    next_due_stage: decision.next_due_stage || decision.followup_stage || "",
    next_due_at: decision.next_due_at || decision.scheduled_at || "",
    duplicate_stage: decision.duplicate_stage || "",
  };
}

function inferAnalysisReason(status = "", recentText = "") {
  if (ANALYSIS_BY_STATUS[status]) {
    return ANALYSIS_BY_STATUS[status];
  }

  const text = String(recentText || "").toLowerCase();

  if (/\b(coa|quality|authentic|real|factory|batch|lab|test)\b/.test(text)) {
    return "客户可能卡在质量、COA、真实性或工厂信息，需要人工先帮客户确认可核对的信息。";
  }

  if (/\b(shipping|delivery|tracking|customs|freight|ship|how long|address)\b/.test(text)) {
    return "客户可能卡在运费、物流时效、地址信息、追踪或海关顾虑，需要人工结合当前订单上下文确认。";
  }

  if (/\b(payment|pay|alibaba|card|crypto|btc|usdt|payment link)\b/.test(text)) {
    return "客户可能卡在付款方式、安全性或付款流程，需要人工把费用和付款路径解释清楚。";
  }

  if (/\b(one box|1 box|small order|test order|minimum|moq)\b/.test(text)) {
    return "客户可能想先小单测试，同时担心 MOQ 或总价，需要人工帮客户确认最低成本测试方案。";
  }

  if (/\b(bulk|resale|reseller|wholesale|long[-\s]?term|label|private label|b2b|business)\b/.test(text)) {
    return "客户可能有 B 端批发或定制标签意向，需要人工先确认测试产品、数量和长期需求。";
  }

  return ANALYSIS_BY_STATUS.general_no_reply_after_staff_message;
}

function buildFollowupReminderTelegramMessage(customer = {}, decision = {}, messages = []) {
  const wsName = getDisplayName(customer);
  const customerName = firstNonEmpty(customer.customer_name);
  const contactLine = getContactLine(customer);
  const lastMessage = valueOrFallback(decision.last_customer_message || customer.last_customer_message);
  const lastAgentMessage = valueOrFallback(getLatestAgentMessageText(messages));
  const searchKeyword = getReminderSearchKeyword(customer);
  const staffName = getAssignedStaffName(customer, messages);
  const staffId = getAssignedStaffId(customer, messages);

  return [
    "【客户回访提醒】",
    "",
    `客户阶段：${valueOrFallback(decision.status)}`,
    `回访节点：${valueOrFallback(decision.followup_stage)}`,
    `优先级：${getPriorityLabel(decision.priority)}`,
    `接待客服：${staffName}`,
    `接待客服ID：${staffId}`,
    "",
    optionalLine("WS名称", wsName),
    optionalLine("客户名称", customerName),
    contactLine,
    `搜索关键词：${searchKeyword}`,
    "",
    "客户最近消息：",
    lastMessage,
    "",
    "我们最后回复：",
    lastAgentMessage,
    "",
    "AI分析：",
    inferAnalysisReason(decision.status, `${lastMessage}\n${lastAgentMessage}\n${decision.suggested_message || ""}`),
    "",
    "建议人工回访话术：",
    valueOrFallback(decision.suggested_message),
    "",
    "操作建议：",
    "请人工进入 SaleSmartly，使用“搜索关键词”找到该客户，确认上下文后再手动发送，不要盲目复制。",
  ].filter((line) => line !== "").join("\n");
}

function buildHumanHandoffTelegramMessage(customer = {}, decision = {}, messages = []) {
  const wsName = getDisplayName(customer);
  const customerName = firstNonEmpty(customer.customer_name);
  const contactLine = getContactLine(customer);
  const lastMessage = valueOrFallback(decision.last_customer_message || customer.last_customer_message);
  const riskType = decision.raw_result?.risk_type || decision.status;
  const staffName = getAssignedStaffName(customer, messages);
  const staffId = getAssignedStaffId(customer, messages);

  return [
    "【需要人工接入】",
    "",
    `原因：${valueOrFallback(HIGH_RISK_REASONS[riskType] || decision.reason || decision.skipped_reason)}`,
    `接待客服：${staffName}`,
    `接待客服ID：${staffId}`,
    optionalLine("WS名称", wsName),
    optionalLine("客户名称", customerName),
    contactLine,
    `搜索关键词：${getReminderSearchKeyword(customer)}`,
    "",
    "客户最近消息：",
    lastMessage,
    "",
    "操作建议：",
    "请人工进入 SaleSmartly 后台查看上下文后处理。",
  ].filter((line) => line !== "").join("\n");
}

async function sendTelegramSafely(text) {
  try {
    const result = await sendTelegramMessage(text, { purpose: "followup" });
    return { success: true, result };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

function countTelegramAlertsInLast24Hours(logs = [], now = new Date()) {
  const cutoff = now.getTime() - 24 * 3600000;

  return logs.filter((log) => {
    if (log.action_type !== "telegram_alert") {
      return false;
    }

    const time = parseDate(log.created_at);
    return time && time.getTime() >= cutoff;
  }).length;
}

function normalizeOpenTasksForDecision(tasks = []) {
  return tasks.map((task) => (task.status === "deferred" ? { ...task, status: "pending" } : task));
}

async function markOpenTasksSkipped(customer = {}, tasks = [], reason = "customer_replied") {
  await markPendingTasksSkipped(customer, reason);
  const deferredTasks = tasks.filter((task) => task.status === "deferred" && task.id);

  for (const task of deferredTasks) {
    await updateFollowupTask(task.id, { status: "skipped", skipped_reason: reason });
  }
}

async function createTaskIfNeeded(customer, decision) {
  if (decision.existing_pending_task) {
    return { task: decision.existing_pending_task, created: false };
  }

  const task = await insertFollowupTask({
    contact_id: customer.contact_id,
    session_id: customer.session_id,
    status: "pending",
    priority: decision.priority || "medium",
    reason: decision.reason,
    suggested_message: decision.suggested_message,
    auto_send_allowed: false,
    followup_stage: decision.followup_stage,
    scheduled_at: decision.scheduled_at || new Date().toISOString(),
  });

  return { task, created: Boolean(task) };
}

function hasQuietDeferredLog(logs = [], decision = {}) {
  return logs.some((log) => {
    const raw = typeof log.raw_result === "object" && log.raw_result ? log.raw_result : {};
    return log.action_type === "skipped" && log.reason === QUIET_DEFER_REASON && log.followup_stage === decision.followup_stage && raw.status === decision.status;
  });
}

async function processQuietDeferredDecision(customer, logs, decision, quietState) {
  const scheduledAt = quietState.defer_until || decision.scheduled_at || new Date().toISOString();
  const existingTask = decision.existing_pending_task;
  let task = existingTask || null;
  let created = false;

  await updateCustomerByIdentity(customer, {
    current_status: decision.status,
    risk_level: decision.risk_level,
    followup_stage: decision.followup_stage,
  });

  if (task?.id) {
    await updateFollowupTask(task.id, {
      status: "deferred",
      priority: task.priority || decision.priority || "medium",
      reason: task.reason || decision.reason,
      suggested_message: firstNonEmpty(task.suggested_message, decision.suggested_message),
      scheduled_at: scheduledAt,
      skipped_reason: QUIET_DEFER_REASON,
    });
    task = { ...task, status: "deferred", scheduled_at: scheduledAt, skipped_reason: QUIET_DEFER_REASON };
  } else {
    task = await insertFollowupTask({
      contact_id: customer.contact_id,
      session_id: customer.session_id,
      status: "deferred",
      priority: decision.priority || "medium",
      reason: decision.reason,
      suggested_message: decision.suggested_message,
      auto_send_allowed: false,
      followup_stage: decision.followup_stage,
      scheduled_at: scheduledAt,
      skipped_reason: QUIET_DEFER_REASON,
    });
    created = Boolean(task);
  }

  if (!hasQuietDeferredLog(logs, decision)) {
    await insertFollowupLog({
      contact_id: customer.contact_id,
      session_id: customer.session_id,
      action_type: "skipped",
      status: decision.status,
      followup_stage: decision.followup_stage,
      message_sent: "",
      reason: QUIET_DEFER_REASON,
      raw_result: {
        ...(decision.raw_result || {}),
        task_id: task?.id,
        mode: FOLLOWUP_MODE,
        customer_send_disabled: AUTO_CUSTOMER_SEND_DISABLED,
        quiet_hours_deferred: true,
        scheduled_at: scheduledAt,
      },
    });
  }

  return { action: "deferred", deferred_by_quiet_hours: true, task_created: created, task_deferred: true, decision };
}

async function processHighRiskDecision(customer, decision, messages = [], tasks = []) {
  await updateCustomerByIdentity(customer, {
    current_status: decision.status,
    risk_level: decision.risk_level,
    followup_stopped: true,
    followup_stop_reason: decision.stop_reason || "high_risk_handoff_required",
  });
  await markOpenTasksSkipped(customer, tasks, "high_risk_handoff_required");

  if (!decision.should_send_telegram) {
    return { action: "skipped", reason: "high_risk_telegram_already_sent", decision };
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
  const telegramResult = await sendTelegramSafely(buildHumanHandoffTelegramMessage(customer, decision, messages));

  await insertFollowupLog({
    contact_id: customer.contact_id,
    session_id: customer.session_id,
    action_type: telegramResult.success ? "telegram_alert" : "skipped",
    status: decision.status,
    followup_stage: decision.followup_stage || "",
    message_sent: "",
    reason: telegramResult.success ? decision.reason : "telegram_alert_failed",
    raw_result: { ...(decision.raw_result || {}), task_id: task?.id, mode: FOLLOWUP_MODE, telegram_result: telegramResult },
  });

  return { action: telegramResult.success ? "telegram_alert" : "skipped", telegram_sent: telegramResult.success, task_created: Boolean(task), decision };
}

async function processStopDecision(customer, decision, tasks = []) {
  await updateCustomerByIdentity(customer, {
    current_status: decision.status,
    risk_level: decision.risk_level,
    followup_stopped: true,
    followup_stop_reason: decision.stop_reason,
    do_not_followup: decision.stop_reason === "customer_opt_out" ? true : customer.do_not_followup,
  });
  await markOpenTasksSkipped(customer, tasks, decision.stop_reason || "followup_stopped");
  await insertFollowupLog({
    contact_id: customer.contact_id,
    session_id: customer.session_id,
    action_type: "skipped",
    status: decision.status,
    followup_stage: decision.followup_stage || "",
    reason: decision.stop_reason || decision.skipped_reason,
    raw_result: { ...(decision.raw_result || {}), mode: FOLLOWUP_MODE },
  });

  return { action: "skipped", reason: decision.stop_reason || decision.skipped_reason, decision };
}

async function processTelegramReminderDecision(customer, logs, decision, now, messages = []) {
  const { task, created } = await createTaskIfNeeded(customer, decision);
  const messageText = firstNonEmpty(task?.suggested_message, decision.suggested_message);

  await updateCustomerByIdentity(customer, {
    current_status: decision.status,
    risk_level: decision.risk_level,
    followup_stage: decision.followup_stage,
  });

  const telegramResult = await sendTelegramSafely(
    buildFollowupReminderTelegramMessage(customer, { ...decision, suggested_message: messageText }, messages)
  );
  const nowIso = new Date().toISOString();

  if (telegramResult.success) {
    await updateFollowupTask(task?.id, { status: "sent", sent_at: nowIso });
  } else {
    await updateFollowupTask(task?.id, { status: "skipped", skipped_reason: "telegram_alert_failed" });
  }

  await insertFollowupLog({
    contact_id: customer.contact_id,
    session_id: customer.session_id,
    action_type: telegramResult.success ? "telegram_alert" : "skipped",
    status: decision.status,
    followup_stage: decision.followup_stage,
    message_sent: messageText,
    reason: telegramResult.success ? decision.reason : "telegram_alert_failed",
    raw_result: {
      ...(decision.raw_result || {}),
      task_id: task?.id,
      template_id: decision.template_id,
      mode: FOLLOWUP_MODE,
      customer_send_disabled: AUTO_CUSTOMER_SEND_DISABLED,
      telegram_result: telegramResult,
    },
  });

  if (telegramResult.success) {
    const customerPatch = {
      last_auto_followup_at: nowIso,
      followup_count_total: Number(customer.followup_count_total || 0) + 1,
      followup_count_24h: countTelegramAlertsInLast24Hours(logs, now) + 1,
      current_status: decision.status,
      risk_level: decision.risk_level,
      followup_stage: decision.followup_stage,
    };

    if (decision.followup_stage === "72h") {
      customerPatch.followup_stopped = true;
      customerPatch.followup_stop_reason = "no_reply_after_3_days";
    }

    await updateCustomerByIdentity(customer, customerPatch);
  }

  return {
    action: telegramResult.success ? "telegram_alert" : "skipped",
    telegram_sent: telegramResult.success,
    task_created: created,
    auto_customer_send_disabled: AUTO_CUSTOMER_SEND_DISABLED,
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
    tasks: normalizeOpenTasksForDecision(tasks),
    now,
    force: options.force,
  });

  if (decision.customer_replied_after_last_followup_reminder || decision.customer_replied_after_last_auto_followup) {
    await markOpenTasksSkipped(customer, tasks, "customer_replied_after_last_followup_reminder");
  }

  if (decision.risk_level === "high" && decision.skipped_reason === "high_risk_handoff_required") {
    return processHighRiskDecision(customer, decision, messages, tasks);
  }

  if (decision.should_stop) {
    return processStopDecision(customer, decision, tasks);
  }

  await updateCustomerByIdentity(customer, {
    current_status: decision.status,
    risk_level: decision.risk_level,
    followup_stage: decision.followup_stage || customer.followup_stage,
  });

  if (!decision.telegram_alert_allowed) {
    return { action: "skipped", reason: decision.skipped_reason, decision };
  }

  if (shouldDeferForQuietHours(decision, options.quietState, options.bypassQuiet)) {
    return processQuietDeferredDecision(customer, logs, decision, options.quietState);
  }

  return processTelegramReminderDecision(customer, logs, decision, now, messages);
}

function buildBaseResponse({ quietState, force = false, bypassQuiet = false, cron = false }) {
  return {
    ok: true,
    success: true,
    mode: FOLLOWUP_MODE,
    cron: Boolean(cron),
    auto_customer_send_disabled: AUTO_CUSTOMER_SEND_DISABLED,
    force: Boolean(force),
    bypass_quiet: Boolean(bypassQuiet),
    ...getQuietHoursResponseFields(quietState),
  };
}

async function runFollowupAnalysis(options = {}) {
  const now = parseDate(options.now) || new Date();
  const force = Boolean(options.force);
  const bypassQuiet = Boolean(force && options.bypassQuiet);
  const quietState = getQuietHoursState(now, options.quietHoursOverrides || {});
  const limit = Number.isFinite(Number(options.limit)) && Number(options.limit) > 0 ? Math.min(Number(options.limit), 200) : 50;
  const customers = await listCustomersForAnalysis(limit);
  const results = [];
  const summary = { telegram_alerts_created: 0, tasks_created: 0, skipped: 0, errors: 0, deferred_by_quiet_hours: 0 };

  console.info(options.cron ? "cron analyze started" : "followup analyze started", {
    mode: FOLLOWUP_MODE,
    cron: Boolean(options.cron),
    quiet_hours_enabled: quietState.enabled,
    quiet_hours_active: quietState.active,
    quiet_timezone: quietState.timezone,
  });

  for (const customer of customers) {
    if (!customer.contact_id && !customer.session_id) {
      summary.skipped += 1;
      continue;
    }

    try {
      const result = await processCustomer(customer, { now, force, bypassQuiet, quietState, messageLimit: options.messageLimit });
      const decisionSummary = getDecisionSummary(result.decision);

      if (result.telegram_sent) {
        summary.telegram_alerts_created += 1;
      }

      if (result.task_created) {
        summary.tasks_created += 1;
      }

      if (result.action === "deferred") {
        summary.deferred_by_quiet_hours += 1;
      } else if (result.action === "skipped") {
        summary.skipped += 1;
      }

      results.push({ contact_id: customer.contact_id, session_id: customer.session_id, customer: getCustomerLabel(customer), ...decisionSummary, ...result });
    } catch (error) {
      summary.errors += 1;
      results.push({ contact_id: customer.contact_id, session_id: customer.session_id, customer: getCustomerLabel(customer), action: "error", error: error.message });
    }
  }

  const response = {
    ...buildBaseResponse({ quietState, force, bypassQuiet, cron: options.cron }),
    scanned: customers.length,
    telegram_alerts_created: summary.telegram_alerts_created,
    tasks_created: summary.tasks_created,
    skipped: summary.skipped,
    errors: summary.errors,
    deferred_by_quiet_hours: summary.deferred_by_quiet_hours,
    results,
  };

  console.info("followup analysis completed", {
    mode: FOLLOWUP_MODE,
    cron: Boolean(options.cron),
    quiet_hours_enabled: response.quiet_hours_enabled,
    quiet_hours_active: response.quiet_hours_active,
    quiet_timezone: response.quiet_timezone,
    deferred_by_quiet_hours: response.deferred_by_quiet_hours,
    telegram_alerts_created: response.telegram_alerts_created,
    tasks_created: response.tasks_created,
    skipped: response.skipped,
    errors: response.errors,
  });

  return response;
}

module.exports = {
  FOLLOWUP_MODE,
  AUTO_CUSTOMER_SEND_DISABLED,
  QUIET_DEFER_REASON,
  buildBaseResponse,
  buildFollowupReminderTelegramMessage,
  buildHumanHandoffTelegramMessage,
  normalizeOpenTasksForDecision,
  runFollowupAnalysis,
};
