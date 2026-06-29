const { firstNonEmpty, extractPhoneFromText, extractEmailFromText } = require("./salesmartly-profile");
const { selectFollowupTemplate } = require("./followup-templates");

const LOW_RISK_AUTO_SEND_STATUSES = new Set([
  "price_requested",
  "quote_sent_no_reply",
  "payment_interest_no_reply",
  "shipping_question_no_reply",
  "later_followup",
]);

const FOLLOWUP_STAGES = [
  { stage: "3h", hours: 3, anchor: "last" },
  { stage: "6h", hours: 6, anchor: "last" },
  { stage: "9h", hours: 9, anchor: "last" },
  { stage: "24h", hours: 24, anchor: "first" },
  { stage: "48h", hours: 48, anchor: "first" },
  { stage: "72h", hours: 72, anchor: "first" },
];

function normalizeText(text) {
  return String(text || "")
    .replace(/\r\n/g, "\n")
    .replace(/\uFF1A/g, ":")
    .toLowerCase()
    .trim();
}

function parseDate(value) {
  if (!value) {
    return null;
  }

  if (typeof value === "number" || /^\d+$/.test(String(value))) {
    const numeric = Number(value);
    const millis = numeric < 100000000000 ? numeric * 1000 : numeric;
    const date = new Date(millis);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function hoursBetween(start, end) {
  if (!start || !end) {
    return 0;
  }

  return (end.getTime() - start.getTime()) / 3600000;
}

function getMessageLines(text) {
  return String(text || "")
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function isLikelyNameLine(line) {
  const text = String(line || "").trim();

  if (!text || text.length < 3 || text.length > 80) {
    return false;
  }

  if (/[0-9@:/\\]/.test(text)) {
    return false;
  }

  if (
    /\b(usa|united states|canada|uk|australia|address|phone|email|postal|postcode|zip|shipping|delivery|country|region)\b/i.test(
      text
    )
  ) {
    return false;
  }

  return /^[a-z][a-z\s.'-]+$/i.test(text) && text.split(/\s+/).length >= 2;
}

function isShippingInfoMessage(text) {
  const normalized = normalizeText(text);

  if (!normalized) {
    return false;
  }

  const lines = getMessageLines(text);
  const hasPhone = Boolean(extractPhoneFromText(normalized));
  const hasEmail = Boolean(extractEmailFromText(normalized));
  const hasLikelyNameLine = lines.some(isLikelyNameLine);
  const hasCountryOrRegionLine = lines.some((line) =>
    /\b(usa|united states|canada|uk|australia|germany|france|spain|italy|netherlands|country|region)\b/i.test(line)
  );
  const hasPostalCode = /\b\d{4,10}\b/.test(normalized);
  const hasStreetAddress = /\b(street|st\.|road|rd\.|avenue|ave\.|drive|dr\.|lane|ln\.|blvd|palm|apt|suite|unit)\b/i.test(
    normalized
  );
  const hasName =
    /(?:^|\n)\s*(name|full\s+name|customer\s+name)\s*:?\s*\S+/i.test(normalized) ||
    /\bmy\s+name\s+is\s+[a-z][a-z\s.'-]{1,}/i.test(normalized) ||
    hasLikelyNameLine;
  const hasContact =
    /(?:^|\n)\s*(phone|tel|telephone|mobile|whatsapp|email)\s*:?\s*\S+/i.test(normalized) ||
    hasPhone ||
    hasEmail;
  const hasAddress =
    /(?:^|\n)\s*(address|street|city|state|country|postal|postcode|zip|zip\s+code)\s*:?\s*\S+/i.test(
      normalized
    ) ||
    hasPostalCode ||
    hasStreetAddress ||
    hasCountryOrRegionLine;

  const hasStructuredBlock =
    lines.length >= 3 &&
    hasContact &&
    hasAddress &&
    (hasName || (hasPhone && hasEmail) || (hasCountryOrRegionLine && hasPostalCode));

  return (hasName && hasContact && hasAddress) || hasStructuredBlock;
}

function isCallRequestMessage(text) {
  const normalized = normalizeText(text);

  if (!normalized) {
    return false;
  }

  return [
    /\b(can|could|would|will)\s+you\s+(please\s+)?call\s+me\b/,
    /\bplease\s+call\s+me\b/,
    /\bcall\s+me\b/,
    /\bphone\s+call\b/,
    /\bvoice\s+call\b/,
    /\bvideo\s+(call|chat)\b/,
    /\bwhatsapp\s+call\b/,
    /\b(can|could)\s+we\s+(talk|speak)\b/,
    /\b(talk|speak)\s+on\s+(the\s+)?phone\b/,
    /\bfacetime\b/,
    /\bzoom\b/,
    /\bcan\s+i\s+(speak|talk)\s+to\s+someone\b/,
    /\bi\s+(want|need)\s+to\s+(speak|talk)\s+with\s+someone\b/,
    /\bhuman\s+call\b/,
    /\breal\s+person\s+call\b/,
  ].some((pattern) => pattern.test(normalized));
}

function isAiDoubtMessage(text) {
  const normalized = normalizeText(text);

  if (!normalized) {
    return false;
  }

  return [
    /\bare\s+you\s+(an?\s+)?ai\b/,
    /\bare\s+you\s+(a\s+)?bot\b/,
    /\bare\s+you\s+(a\s+)?robot\b/,
    /\bare\s+you\s+real\b/,
    /\bare\s+you\s+a\s+real\s+person\b/,
    /\bare\s+you\s+human\b/,
    /\bis\s+this\s+(an?\s+)?automated(\s+reply)?\b/,
    /\bautomated\s+reply\b/,
    /\bauto\s+reply\b/,
    /\bchat\s*bot\b/,
    /\btalking\s+to\s+(a\s+)?(bot|ai)\b/,
    /\bam\s+i\s+talking\s+to\s+(a\s+)?(bot|ai)\b/,
    /\bi\s+am\s+talking\s+to\s+(a\s+)?(bot|ai)\b/,
    /\bi\s+(want|need)\s+a\s+real\s+person\b/,
    /\bi\s+(want|need)\s+a\s+human\b/,
    /\bi\s+(want|need)\s+to\s+(talk|speak)\s+to\s+a\s+real\s+person\b/,
    /\bnot\s+a\s+bot\b/,
    /\bno\s+bots\b/,
    /\breal\s+person\b/,
    /\bhuman\s+agent\b/,
    /\blive\s+(agent|person)\b/,
    /\bcustomer\s+service\s+agent\b/,
  ].some((pattern) => pattern.test(normalized));
}

function getHighRiskType(text) {
  const normalized = normalizeText(text);

  if (!normalized) {
    return "";
  }

  if (isShippingInfoMessage(normalized)) {
    return "shipping_info";
  }

  if (isCallRequestMessage(normalized)) {
    return "call_request";
  }

  if (isAiDoubtMessage(normalized)) {
    return "ai_doubt";
  }

  if (
    /\b(complaint|not\s+received|did\s+not\s+receive|didn't\s+receive|never\s+arrived|where\s+is\s+my\s+package|lost\s+package|damaged|customs\s+problem|seized|tracking\s+problem)\b/i.test(
      normalized
    )
  ) {
    return "complaint_or_after_sales";
  }

  if (/\b(refund|chargeback|dispute|paid\s+but|payment\s+failed|wrong\s+amount|overcharged)\b/i.test(normalized)) {
    return "payment_dispute";
  }

  if (/\b(angry|mad|upset|terrible|bad\s+service|liar|cheat|scam|fuck|bullshit)\b/i.test(normalized)) {
    return "angry_customer";
  }

  return "";
}

function isOptOutMessage(text) {
  const normalized = normalizeText(text);

  if (!normalized) {
    return false;
  }

  return [
    /\bstop\b/,
    /\bstop\s+messaging\s+me\b/,
    /\bdon'?t\s+message\s+me\b/,
    /\bdo\s+not\s+message\s+me\b/,
    /\bnot\s+interested\b/,
    /\bno\s+thanks\b/,
    /\bunsubscribe\b/,
    /\bremove\s+me\b/,
    /\bleave\s+me\s+alone\b/,
    /\bdon'?t\s+contact\s+me\s+again\b/,
    /\bdo\s+not\s+contact\s+me\s+again\b/,
  ].some((pattern) => pattern.test(normalized));
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

function getRecentText(messages = [], customer = {}) {
  const sorted = sortMessagesAsc(messages);
  const parts = sorted.slice(-12).map((message) => message.message_text).filter(Boolean);

  return firstNonEmpty(parts.join("\n"), customer.last_customer_message, "");
}

function hasPattern(text, patterns) {
  const normalized = normalizeText(text);
  return patterns.some((pattern) => pattern.test(normalized));
}

function classifyCustomerStatus(messages = [], customer = {}) {
  const latestCustomer = getLatestMessageByDirection(messages, ["customer"]);
  const latestCustomerText = firstNonEmpty(latestCustomer?.message_text, customer.last_customer_message);
  const recentText = getRecentText(messages, customer);
  const latestAgent = getLatestMessageByDirection(messages, ["ai", "human"]);
  const latestCustomerAt = parseDate(latestCustomer?.message_time || customer.last_customer_message_at);
  const latestAgentAt = parseDate(latestAgent?.message_time || customer.last_agent_message_at);
  const quotedAfterCustomer =
    latestAgentAt &&
    (!latestCustomerAt || latestAgentAt.getTime() > latestCustomerAt.getTime()) &&
    hasPattern(latestAgent?.message_text || "", [
      /\bquote\b/i,
      /\btotal\b/i,
      /\bshipping\b/i,
      /\bfee\b/i,
      /\busd\b/i,
      /\$\s*\d+/i,
      /\border\s+amount\b/i,
      /\bminimum\b/i,
    ]);

  if (quotedAfterCustomer) {
    return "quote_sent_no_reply";
  }

  if (
    hasPattern(latestCustomerText || recentText, [
      /\bpayment\b/i,
      /\bpay\b/i,
      /\balibaba\b/i,
      /\bcrypto\b/i,
      /\bbtc\b/i,
      /\busdt\b/i,
      /\bpayment\s+link\b/i,
    ])
  ) {
    return "payment_interest_no_reply";
  }

  if (
    hasPattern(latestCustomerText || recentText, [
      /\bshipping\b/i,
      /\bdelivery\b/i,
      /\bhow\s+long\b/i,
      /\btracking\b/i,
      /\bshipping\s+cost\b/i,
      /\bship\s+to\b/i,
    ])
  ) {
    return "shipping_question_no_reply";
  }

  if (
    hasPattern(latestCustomerText || recentText, [
      /\bi\s+will\s+check\b/i,
      /\bi'?ll\s+think\b/i,
      /\blater\b/i,
      /\btomorrow\b/i,
      /\bi'?ll\s+get\s+back\s+to\s+you\b/i,
      /\blet\s+me\s+check\b/i,
    ])
  ) {
    return "later_followup";
  }

  if (
    hasPattern(latestCustomerText || recentText, [
      /\bi\s+want\s+to\s+order\b/i,
      /\bi\s+want\s+to\s+buy\b/i,
      /\bplace\s+order\b/i,
      /\bready\s+to\s+order\b/i,
    ])
  ) {
    return "high_intent_no_reply";
  }

  if (
    hasPattern(latestCustomerText || recentText, [
      /\bprice\b/i,
      /\bprice\s+list\b/i,
      /\bcatalog\b/i,
      /\bmenu\b/i,
      /\bhow\s+much\b/i,
      /\bquote\b/i,
      /\bmoq\b/i,
      /\bminimum\s+order\b/i,
    ])
  ) {
    return "price_requested";
  }

  return "unknown";
}

function getFirstCustomerTime(customer = {}, messages = []) {
  const explicit = parseDate(customer.first_customer_message_at);
  if (explicit) {
    return explicit;
  }

  const firstCustomer = sortMessagesAsc(messages).find((message) => message.direction === "customer");
  return parseDate(firstCustomer?.message_time || customer.created_at);
}

function getLatestCustomerTime(customer = {}, messages = []) {
  const latestCustomer = getLatestMessageByDirection(messages, ["customer"]);
  return parseDate(latestCustomer?.message_time || customer.last_customer_message_at);
}

function getLatestAgentTime(customer = {}, messages = []) {
  const latestAgent = getLatestMessageByDirection(messages, ["ai", "human"]);
  return parseDate(latestAgent?.message_time || customer.last_agent_message_at);
}

function getLatestAutoSentTime(customer = {}, logs = []) {
  const logTime = logs
    .filter((log) => log.action_type === "auto_sent")
    .map((log) => parseDate(log.created_at))
    .filter(Boolean)
    .sort((a, b) => b.getTime() - a.getTime())[0];

  return logTime || parseDate(customer.last_auto_followup_at);
}

function customerRepliedAfterLastAuto(customer = {}, messages = [], logs = []) {
  const latestCustomerAt = getLatestCustomerTime(customer, messages);
  const latestAutoAt = getLatestAutoSentTime(customer, logs);

  return Boolean(latestCustomerAt && latestAutoAt && latestCustomerAt.getTime() > latestAutoAt.getTime());
}

function stageAlreadySent(stage, logs = [], tasks = []) {
  const hasLog = logs.some((log) => log.followup_stage === stage && log.action_type === "auto_sent");
  const hasTask = tasks.some((task) => task.followup_stage === stage && task.status === "sent");

  return hasLog || hasTask;
}

function getExistingPendingTask(stage, tasks = []) {
  return tasks.find((task) => task.followup_stage === stage && task.status === "pending") || null;
}

function getNextFollowupStage({ customer = {}, messages = [], logs = [], tasks = [], now = new Date(), status = "" }) {
  const firstCustomerAt = getFirstCustomerTime(customer, messages);
  const latestCustomerAt = getLatestCustomerTime(customer, messages);
  const latestAgentAt = getLatestAgentTime(customer, messages);

  if (!firstCustomerAt || !latestCustomerAt) {
    return {
      due: false,
      skipped_reason: "missing_customer_message_time",
    };
  }

  const newCustomer = hoursBetween(firstCustomerAt, now) <= 24;
  const referenceAt =
    status === "quote_sent_no_reply" && latestAgentAt && latestAgentAt.getTime() > latestCustomerAt.getTime()
      ? latestAgentAt
      : latestCustomerAt;
  const stages = newCustomer
    ? FOLLOWUP_STAGES.filter((item) => item.anchor === "last")
    : FOLLOWUP_STAGES.filter((item) => item.anchor === "first");

  for (const item of stages) {
    const anchorTime = item.anchor === "first" ? firstCustomerAt : referenceAt;
    const dueAt = new Date(anchorTime.getTime() + item.hours * 3600000);

    if (now.getTime() >= dueAt.getTime() && !stageAlreadySent(item.stage, logs, tasks)) {
      return {
        due: true,
        stage: item.stage,
        scheduled_at: dueAt.toISOString(),
        existing_pending_task: getExistingPendingTask(item.stage, tasks),
      };
    }
  }

  const finalAutoSent = logs.some((log) => log.action_type === "auto_sent" && log.followup_stage === "72h");
  if (!newCustomer && finalAutoSent) {
    return {
      due: false,
      should_stop: true,
      stop_reason: "no_reply_after_3_days",
    };
  }

  return {
    due: false,
    skipped_reason: "no_due_stage",
  };
}

function shouldSendHighRiskTelegram(riskType, latestMessage, logs = []) {
  return !logs.some((log) => {
    const raw = typeof log.raw_result === "object" ? log.raw_result : {};
    return (
      log.action_type === "telegram_alert" &&
      raw.risk_type === riskType &&
      raw.last_customer_message === latestMessage
    );
  });
}

function analyzeFollowupDecision({ customer = {}, messages = [], logs = [], tasks = [], now = new Date() }) {
  const nowDate = parseDate(now) || new Date();
  const recentText = getRecentText(messages, customer);
  const latestCustomer = getLatestMessageByDirection(messages, ["customer"]);
  const latestCustomerText = firstNonEmpty(latestCustomer?.message_text, customer.last_customer_message, recentText);

  if (customer.do_not_followup || customer.followup_stopped) {
    return {
      status: customer.current_status || "stopped",
      risk_level: customer.risk_level || "stopped",
      auto_send_allowed: false,
      skipped_reason: customer.followup_stop_reason || "followup_stopped",
      should_send_telegram: false,
    };
  }

  if (isOptOutMessage(latestCustomerText)) {
    return {
      status: "opt_out",
      risk_level: "high",
      auto_send_allowed: false,
      should_stop: true,
      stop_reason: "customer_opt_out",
      skipped_reason: "customer_opt_out",
      should_send_telegram: false,
    };
  }

  const highRiskType = getHighRiskType(latestCustomerText);
  if (highRiskType) {
    return {
      status: highRiskType,
      risk_level: "high",
      priority: "high",
      reason: `high_risk_${highRiskType}`,
      auto_send_allowed: false,
      should_stop: true,
      stop_reason: "high_risk_handoff_required",
      skipped_reason: "high_risk_handoff_required",
      should_send_telegram: shouldSendHighRiskTelegram(highRiskType, latestCustomerText, logs),
      last_customer_message: latestCustomerText,
      raw_result: {
        risk_type: highRiskType,
        last_customer_message: latestCustomerText,
      },
    };
  }

  const status = classifyCustomerStatus(messages, customer);
  const riskLevel = LOW_RISK_AUTO_SEND_STATUSES.has(status) ? "low" : "medium";

  if (customerRepliedAfterLastAuto(customer, messages, logs)) {
    return {
      status,
      risk_level: riskLevel,
      auto_send_allowed: false,
      skipped_reason: "customer_replied_after_last_auto_followup",
      customer_replied_after_last_auto_followup: true,
    };
  }

  if (!LOW_RISK_AUTO_SEND_STATUSES.has(status)) {
    return {
      status,
      risk_level: riskLevel,
      auto_send_allowed: false,
      skipped_reason: "status_not_auto_send_allowed",
    };
  }

  const stageInfo = getNextFollowupStage({
    customer,
    messages,
    logs,
    tasks,
    now: nowDate,
    status,
  });

  if (stageInfo.should_stop) {
    return {
      status,
      risk_level: riskLevel,
      auto_send_allowed: false,
      should_stop: true,
      stop_reason: stageInfo.stop_reason,
      skipped_reason: stageInfo.stop_reason,
    };
  }

  if (!stageInfo.due) {
    return {
      status,
      risk_level: riskLevel,
      auto_send_allowed: false,
      skipped_reason: stageInfo.skipped_reason,
    };
  }

  if (stageInfo.existing_pending_task) {
    return {
      status,
      risk_level: riskLevel,
      priority: stageInfo.stage === "72h" ? "low" : "medium",
      reason: stageInfo.existing_pending_task.reason || `low_risk_${status}_${stageInfo.stage}`,
      auto_send_allowed: true,
      followup_stage: stageInfo.stage,
      scheduled_at: stageInfo.existing_pending_task.scheduled_at || stageInfo.scheduled_at,
      suggested_message: stageInfo.existing_pending_task.suggested_message,
      template_id: "existing_pending_task",
      existing_pending_task: stageInfo.existing_pending_task,
      raw_result: {
        template_id: "existing_pending_task",
        status,
        stage: stageInfo.stage,
      },
    };
  }

  const template = selectFollowupTemplate({
    status,
    stage: stageInfo.stage,
    recentText,
    logs,
    tasks,
  });

  if (!template) {
    return {
      status,
      risk_level: riskLevel,
      followup_stage: stageInfo.stage,
      auto_send_allowed: false,
      skipped_reason: "no_unused_template_available",
    };
  }

  return {
    status,
    risk_level: riskLevel,
    priority: stageInfo.stage === "72h" ? "low" : "medium",
    reason: `low_risk_${status}_${stageInfo.stage}`,
    auto_send_allowed: true,
    followup_stage: stageInfo.stage,
    scheduled_at: stageInfo.scheduled_at,
    suggested_message: template.text,
    template_id: template.id,
    existing_pending_task: stageInfo.existing_pending_task,
    search_contact: {
      phone: firstNonEmpty(customer.phone, extractPhoneFromText(latestCustomerText)),
      email: firstNonEmpty(customer.email, extractEmailFromText(latestCustomerText)),
    },
    raw_result: {
      template_id: template.id,
      status,
      stage: stageInfo.stage,
    },
  };
}

module.exports = {
  LOW_RISK_AUTO_SEND_STATUSES,
  FOLLOWUP_STAGES,
  normalizeText,
  parseDate,
  isShippingInfoMessage,
  isCallRequestMessage,
  isAiDoubtMessage,
  isOptOutMessage,
  getHighRiskType,
  classifyCustomerStatus,
  customerRepliedAfterLastAuto,
  analyzeFollowupDecision,
};
