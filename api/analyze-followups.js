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
const { sendTelegramMessage } = require("../lib/telegram");

const FOLLOWUP_MODE = "telegram_only";
const AUTO_CUSTOMER_SEND_DISABLED = true;

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

function getLimit(req) {
  const raw = req.body?.limit || req.query?.limit || 50;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 200) : 50;
}

function isForceEnabled(req) {
  const raw = firstNonEmpty(req.body?.force, req.query?.force);
  return ["1", "true", "yes", "y"].includes(String(raw).toLowerCase());
}

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

function inferAnalysisReason(status = "", recentText = "") {
  const text = String(recentText || "").toLowerCase();

  if (/\b(coa|quality|authentic|real|factory|batch|lab|test)\b/.test(text)) {
    return "客户可能卡在质量、COA、真实性或工厂信息，需要人工先帮客户确认可核对的信息。";
  }

  if (/\b(shipping|delivery|tracking|customs|freight|ship|how long)\b/.test(text)) {
    return "客户可能卡在运费、物流时效、追踪或海关顾虑，需要人工结合当前订单上下文确认。";
  }

  if (/\b(payment|pay|alibaba|card|crypto|btc|usdt|payment link)\b/.test(text)) {
    return "客户可能卡在付款方式、安全性或付款流程，需要人工把费用和付款路径解释清楚。";
  }

  if (/\b(one box|1 box|small order|test order|minimum|moq)\b/.test(text)) {
    return "客户可能想先小单测试，同时担心 MOQ 或总价，需要人工帮客户确认最低成本测试方案。";
  }

  if (/\b(bulk|resale|reseller|wholesale|long[-\s]?term|label|private label)\b/.test(text)) {
    return "客户可能有 B 端批发或定制标签意向，需要人工先确认测试产品、数量和长期需求。";
  }

  const byStatus = {
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

  return byStatus[status] || "客户进入可回访阶段，但需要人工先查看上下文再决定是否发送。";
}

function buildFollowupReminderTelegramMessage(customer = {}, decision = {}) {
  const wsName = getDisplayName(customer);
  const customerName = firstNonEmpty(customer.customer_name);
  const contactLine = getContactLine(customer);
  const lastMessage = valueOrFallback(decision.last_customer_message || customer.last_customer_message);
  const searchKeyword = getReminderSearchKeyword(customer);

  return [
    "【客户回访提醒】",
    "",
    `客户阶段：${valueOrFallback(decision.status)}`,
    `回访节点：${valueOrFallback(decision.followup_stage)}`,
    `优先级：${getPriorityLabel(decision.priority)}`,
    "",
    optionalLine("WS名称", wsName),
    optionalLine("客户名称", customerName),
    contactLine,
    `搜索关键词：${searchKeyword}`,
    "",
    "客户最近消息：",
    lastMessage,
    "",
    "AI分析：",
    inferAnalysisReason(decision.status, `${lastMessage}\n${decision.suggested_message || ""}`),
    "",
    "建议人工回访话术：",
    valueOrFallback(decision.suggested_message),
    "",
    "操作建议：",
    "请人工进入 SaleSmartly，使用“搜索关键词”找到该客户，确认上下文后再手动发送，不要盲目复制。",
  ].filter((line) => line !== "").join("\n");
}

function buildHumanHandoffTelegramMessage(customer = {}, decision = {}) {
  const wsName = getDisplayName(customer);
  const customerName = firstNonEmpty(customer.customer_name);
  const contactLine = getContactLine(customer);
  const lastMessage = valueOrFallback(decision.last_customer_message || customer.last_customer_message);
  const riskType = decision.raw_result?.risk_type || decision.status;

  return [
    "【需要人工接入】",
    "",
    `原因：${valueOrFallback(HIGH_RISK_REASONS[riskType] || decision.reason || decision.skipped_reason)}`,
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
    auto_send_allowed: false,
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
  const telegramResult = await sendTelegramSafely(buildHumanHandoffTelegramMessage(customer, decision));

  await insertFollowupLog({
    contact_id: customer.contact_id,
    session_id: customer.session_id,
    action_type: telegramResult.success ? "telegram_alert" : "skipped",
    status: decision.status,
    followup_stage: decision.followup_stage || "",
    message_sent: "",
    reason: telegramResult.success ? decision.reason : "telegram_alert_failed",
    raw_result: {
      ...(decision.raw_result || {}),
      task_id: task?.id,
      mode: FOLLOWUP_MODE,
      telegram_result: telegramResult,
    },
  });

  return {
    action: telegramResult.success ? "telegram_alert" : "skipped",
    telegram_sent: telegramResult.success,
    task_created: Boolean(task),
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
    raw_result: {
      ...(decision.raw_result || {}),
      mode: FOLLOWUP_MODE,
    },
  });

  return {
    action: "skipped",
    reason: decision.stop_reason || decision.skipped_reason,
    decision,
  };
}

async function processTelegramReminderDecision(customer, logs, decision, now) {
  const { task, created } = await createTaskIfNeeded(customer, decision);
  const messageText = firstNonEmpty(task?.suggested_message, decision.suggested_message);

  await updateCustomerByIdentity(customer, {
    current_status: decision.status,
    risk_level: decision.risk_level,
    followup_stage: decision.followup_stage,
  });

  const telegramResult = await sendTelegramSafely(
    buildFollowupReminderTelegramMessage(customer, {
      ...decision,
      suggested_message: messageText,
    })
  );
  const nowIso = new Date().toISOString();

  if (telegramResult.success) {
    await updateFollowupTask(task?.id, {
      status: "sent",
      sent_at: nowIso,
    });
  } else {
    await updateFollowupTask(task?.id, {
      status: "skipped",
      skipped_reason: "telegram_alert_failed",
    });
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
    tasks,
    now,
    force: options.force,
  });

  if (decision.customer_replied_after_last_followup_reminder || decision.customer_replied_after_last_auto_followup) {
    await markPendingTasksSkipped(customer, "customer_replied_after_last_followup_reminder");
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

  if (!decision.telegram_alert_allowed) {
    return {
      action: "skipped",
      reason: decision.skipped_reason,
      decision,
    };
  }

  return processTelegramReminderDecision(customer, logs, decision, now);
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
  const force = isForceEnabled(req);

  try {
    const customers = await listCustomersForAnalysis(limit);
    const results = [];
    const summary = {
      telegram_alerts_created: 0,
      tasks_created: 0,
      skipped: 0,
      errors: 0,
    };

    for (const customer of customers) {
      if (!customer.contact_id && !customer.session_id) {
        summary.skipped += 1;
        continue;
      }

      try {
        const result = await processCustomer(customer, {
          now: req.body?.now || req.query?.now,
          force,
        });

        if (result.telegram_sent) {
          summary.telegram_alerts_created += 1;
        }

        if (result.task_created) {
          summary.tasks_created += 1;
        }

        if (result.action === "skipped") {
          summary.skipped += 1;
        }

        results.push({
          contact_id: customer.contact_id,
          session_id: customer.session_id,
          customer: getCustomerLabel(customer),
          ...result,
        });
      } catch (error) {
        summary.errors += 1;
        results.push({
          contact_id: customer.contact_id,
          session_id: customer.session_id,
          customer: getCustomerLabel(customer),
          action: "error",
          error: error.message,
        });
      }
    }

    return res.status(200).json({
      ok: true,
      success: true,
      mode: FOLLOWUP_MODE,
      auto_customer_send_disabled: AUTO_CUSTOMER_SEND_DISABLED,
      force,
      scanned: customers.length,
      telegram_alerts_created: summary.telegram_alerts_created,
      tasks_created: summary.tasks_created,
      skipped: summary.skipped,
      errors: summary.errors,
      results,
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      success: false,
      mode: FOLLOWUP_MODE,
      auto_customer_send_disabled: AUTO_CUSTOMER_SEND_DISABLED,
      force: isForceEnabled(req),
      scanned: 0,
      telegram_alerts_created: 0,
      tasks_created: 0,
      skipped: 0,
      errors: 1,
      error: error.message,
    });
  }
};
