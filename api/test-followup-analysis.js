const { analyzeFollowupDecision, classifyCustomerStatus, getHighRiskType, parseDate } = require("../lib/followup-rules");
const { getAssignedStaffProfile } = require("../lib/staff-profile");
const { getQuietHoursState, getQuietHoursResponseFields, shouldDeferForQuietHours } = require("../lib/quiet-hours");

const FOLLOWUP_MODE = "telegram_only";
const AUTO_CUSTOMER_SEND_DISABLED = true;
const TELEGRAM_TARGET_CHAT_SOURCE = "TELEGRAM_CHAT_ID";

const PRIORITY_LABELS = {
  high: "高",
  medium: "中",
  low: "低",
};

const QUIET_TEST_OVERRIDE = {
  enabled: true,
  timezone: "Asia/Shanghai",
  start: "13:00",
  end: "19:00",
  behavior: "defer",
};

function isoHoursBefore(now, hours) {
  return new Date(new Date(now).getTime() - hours * 3600000).toISOString();
}

function sampleCustomer(now = new Date().toISOString(), lastMessage = "Can I get the price list?", staff = { name: "Omen", id: "xxx" }) {
  const first = isoHoursBefore(now, 4);
  const customer = {
    contact_id: "test_contact",
    session_id: "test_session",
    project_id: "test_project",
    ws_display_name: "Test Customer",
    customer_name: "Test Customer",
    phone: "+1 000 000 0000",
    email: "",
    channel: "WhatsApp",
    first_customer_message_at: first,
    last_customer_message_at: first,
    last_customer_message: lastMessage,
    followup_count_total: 0,
    followup_count_24h: 0,
    followup_stopped: false,
    do_not_followup: false,
    created_at: first,
  };

  if (staff?.name) {
    customer.assigned_staff_name = staff.name;
  }

  if (staff?.id) {
    customer.assigned_staff_id = staff.id;
  }

  return customer;
}

function customerMessage(customer, text = customer.last_customer_message, time = customer.last_customer_message_at) {
  return {
    contact_id: customer.contact_id,
    session_id: customer.session_id,
    direction: "customer",
    message_text: text,
    message_time: time,
  };
}

function agentMessage(customer, text, time, staff = { name: "Omen", id: "xxx" }) {
  const message = {
    contact_id: customer.contact_id,
    session_id: customer.session_id,
    direction: "ai",
    message_text: text,
    message_time: time,
  };

  if (staff?.name) {
    message.sender_name = staff.name;
  }

  if (staff?.id) {
    message.sender_id = staff.id;
    message.raw_payload = {
      sys_user_id: staff.id,
      user: {
        id: staff.id,
        name: staff.name,
      },
    };
  }

  return message;
}

function quoteScenario(now, staff = { name: "Omen", id: "xxx" }) {
  const customerAt = isoHoursBefore(now, 5);
  const quoteAt = isoHoursBefore(now, 4);
  const customer = {
    ...sampleCustomer(now, "Can you quote Retatrutide 20mg x 2 boxes?", staff),
    first_customer_message_at: customerAt,
    last_customer_message_at: customerAt,
    last_customer_message: "Can you quote Retatrutide 20mg x 2 boxes?",
  };

  return {
    customer,
    messages: [
      customerMessage(customer, customer.last_customer_message, customerAt),
      agentMessage(customer, "Here is your quote. Product total is $364, shipping is $70, total amount is $455.70.", quoteAt, staff),
    ],
    logs: [],
    tasks: [],
  };
}

function firstGreetingScenario(now, staff = { name: "Jett", id: "1203624" }) {
  const customerAt = isoHoursBefore(now, 4);
  const agentAt = isoHoursBefore(now, 3.1);
  const customer = {
    ...sampleCustomer(now, "Hi", staff),
    first_customer_message_at: customerAt,
    last_customer_message_at: customerAt,
    last_customer_message: "Hi",
  };

  return {
    customer,
    messages: [
      customerMessage(customer, "Hi", customerAt),
      agentMessage(customer, "Hello, my friend. I'm Jett. How can I help you today?", agentAt, staff),
    ],
    logs: [],
    tasks: [],
  };
}

function qualityTrustScenario(now, staff = { name: "Jett", id: "1203624" }) {
  const customerAt = isoHoursBefore(now, 4);
  const agentAt = isoHoursBefore(now, 3.1);
  const customer = {
    ...sampleCustomer(now, "And where is this testing facility located?", staff),
    first_customer_message_at: customerAt,
    last_customer_message_at: customerAt,
    last_customer_message: "And where is this testing facility located?",
  };

  return {
    customer,
    messages: [
      customerMessage(customer, "And where is this testing facility located?", customerAt),
      agentMessage(customer, "Janoshik lab location explanation: Janoshik is an independent third-party testing laboratory, and the report details can be checked from the report information.", agentAt, staff),
    ],
    logs: [],
    tasks: [],
  };
}

function b2bWholesaleScenario(now, staff = { name: "Jett", id: "1203624" }) {
  const customerAt = isoHoursBefore(now, 4);
  const agentAt = isoHoursBefore(now, 3.1);
  const customerText = "I have a wellness business and a few China vendors. I'm looking to compare prices and place an order soon.";
  const customer = {
    ...sampleCustomer(now, customerText, staff),
    first_customer_message_at: customerAt,
    last_customer_message_at: customerAt,
    last_customer_message: customerText,
  };

  return {
    customer,
    messages: [
      customerMessage(customer, customerText, customerAt),
      agentMessage(customer, "B2B follow-up reply: I can help compare product options, quantities, and volume direction once I know your main products and expected amount.", agentAt, staff),
    ],
    logs: [],
    tasks: [],
  };
}

function generalNoReplyScenario(now, staff = { name: "Omen", id: "1199741" }) {
  const customerAt = isoHoursBefore(now, 4);
  const agentAt = isoHoursBefore(now, 3.1);
  const customerText = "I am not sure yet.";
  const customer = {
    ...sampleCustomer(now, customerText, staff),
    first_customer_message_at: customerAt,
    last_customer_message_at: customerAt,
    last_customer_message: customerText,
  };

  return {
    customer,
    messages: [
      customerMessage(customer, customerText, customerAt),
      agentMessage(customer, "No problem. I can help whenever you are ready.", agentAt, staff),
    ],
    logs: [],
    tasks: [],
  };
}

function shippingAddressRequestScenario(now, staff = { name: "Jett", id: "1203624" }) {
  const customerAt = isoHoursBefore(now, 4);
  const agentAt = isoHoursBefore(now, 3.1);
  const customer = {
    ...sampleCustomer(now, "Thank you", staff),
    first_customer_message_at: customerAt,
    last_customer_message_at: customerAt,
    last_customer_message: "Thank you",
  };

  return {
    customer,
    messages: [
      customerMessage(customer, "Thank you", customerAt),
      agentMessage(customer, "Do you have a shipping address in the United States?", agentAt, staff),
    ],
    logs: [],
    tasks: [],
  };
}

function staffNextStepScenario(now, staff = { name: "Omen", id: "1199741" }) {
  const customerAt = isoHoursBefore(now, 4);
  const agentAt = isoHoursBefore(now, 3.1);
  const customer = {
    ...sampleCustomer(now, "Thanks, I will check", staff),
    first_customer_message_at: customerAt,
    last_customer_message_at: customerAt,
    last_customer_message: "Thanks, I will check",
  };

  return {
    customer,
    messages: [
      customerMessage(customer, "Thanks, I will check", customerAt),
      agentMessage(customer, "Would you like to proceed with the next step? Please confirm when you are ready.", agentAt, staff),
    ],
    logs: [],
    tasks: [],
  };
}

function customerRepliedAfterAgentScenario(now, staff = { name: "Omen", id: "1199741" }) {
  const customerAt = isoHoursBefore(now, 5);
  const agentAt = isoHoursBefore(now, 4);
  const secondCustomerAt = isoHoursBefore(now, 3.1);
  const customer = {
    ...sampleCustomer(now, "Thanks", staff),
    first_customer_message_at: customerAt,
    last_customer_message_at: secondCustomerAt,
    last_customer_message: "Thanks",
  };

  return {
    customer,
    messages: [
      customerMessage(customer, "Can you send more information?", customerAt),
      agentMessage(customer, "Sure, I sent the details above. Let me know if you need anything else.", agentAt, staff),
      customerMessage(customer, "Thanks", secondCustomerAt),
    ],
    logs: [],
    tasks: [],
  };
}

function priceRequestedAfterStaffScenario(now, extra = {}) {
  const customerAt = isoHoursBefore(now, 5);
  const agentAt = isoHoursBefore(now, 4);
  const customer = {
    ...sampleCustomer(now, "How much is Retatrutide?", { name: "Omen", id: "xxx" }),
    first_customer_message_at: customerAt,
    last_customer_message_at: customerAt,
    last_customer_message: "How much is Retatrutide?",
  };

  return {
    customer,
    messages: [
      customerMessage(customer, customer.last_customer_message, customerAt),
      agentMessage(customer, "I shared the product details above. I can help narrow this down if you tell me your goal.", agentAt),
    ],
    logs: extra.logs || [],
    tasks: extra.tasks || [],
    quiet_overrides: QUIET_TEST_OVERRIDE,
  };
}

function singleCustomerScenario(now, text, staff = { name: "Omen", id: "xxx" }) {
  const customer = sampleCustomer(now, text, staff);
  return {
    customer,
    messages: [customerMessage(customer)],
    logs: [],
    tasks: [],
  };
}

function buildScenario(name = "price_inquiry", now = new Date().toISOString()) {
  if (name === "first_greeting_no_reply") {
    return firstGreetingScenario(now);
  }

  if (name === "quality_trust_question_no_reply") {
    return qualityTrustScenario(now);
  }

  if (name === "b2b_wholesale_interest_no_reply") {
    return b2bWholesaleScenario(now);
  }

  if (name === "general_no_reply_after_staff_message") {
    return generalNoReplyScenario(now);
  }

  if (name === "shipping_address_request_no_reply") {
    return shippingAddressRequestScenario(now);
  }

  if (name === "staff_next_step_question_no_reply") {
    return staffNextStepScenario(now);
  }

  if (name === "customer_replied_after_agent") {
    return customerRepliedAfterAgentScenario(now);
  }

  if (name === "staff_omen") {
    return quoteScenario(now, { name: "Omen", id: "xxx" });
  }

  if (name === "staff_jett") {
    return quoteScenario(now, { name: "Jett", id: "yyy" });
  }

  if (name === "staff_map_yinping") {
    return quoteScenario(now, { id: "1201819" });
  }

  if (name === "staff_map_jett_agent") {
    return quoteScenario(now, { id: "1203624" });
  }

  if (name === "staff_map_unknown") {
    return quoteScenario(now, { id: "0000000" });
  }

  if (name === "quiet_price_deferred" || name === "quiet_force_deferred" || name === "quiet_force_bypass") {
    return priceRequestedAfterStaffScenario(now);
  }

  if (name === "quiet_ai_doubt") {
    const scenario = singleCustomerScenario(now, "Are you a bot? I want to talk to a real person.");
    return { ...scenario, quiet_overrides: QUIET_TEST_OVERRIDE };
  }

  if (name === "quiet_after_end_deferred_task") {
    return priceRequestedAfterStaffScenario(now, {
      tasks: [
        {
          id: "deferred_task_3h",
          contact_id: "test_contact",
          session_id: "test_session",
          status: "deferred",
          followup_stage: "3h",
          reason: "low_risk_price_requested_3h",
          suggested_message: "I can help narrow this down if you tell me your goal.",
          scheduled_at: "2026-07-01T11:00:00.000Z",
          skipped_reason: "quiet_hours_deferred",
        },
      ],
    });
  }

  if (name === "quiet_deferred_log_not_duplicate") {
    return priceRequestedAfterStaffScenario(now, {
      logs: [
        {
          action_type: "skipped",
          followup_stage: "3h",
          status: "price_requested",
          reason: "quiet_hours_deferred",
          created_at: isoHoursBefore(now, 1),
          raw_result: {
            status: "price_requested",
            stage: "3h",
            quiet_hours_deferred: true,
          },
        },
      ],
    });
  }

  if (name === "no_staff") {
    return quoteScenario(now, null);
  }

  if (name === "handoff_jett") {
    return singleCustomerScenario(now, "Are you a bot? I want to talk to a real person.", { name: "Jett", id: "yyy" });
  }

  if (name === "price_quote") {
    return singleCustomerScenario(now, "Can I get a price quote?");
  }

  if (name === "catalog_request") {
    return singleCustomerScenario(now, "Can I see your catalog");
  }

  if (name === "pricing_delivery") {
    return singleCustomerScenario(now, "Pricing, delivery");
  }

  if (name === "price_objection") {
    return singleCustomerScenario(now, "Your prices are very high compared to the other supplier.");
  }

  if (name === "product_question") {
    return singleCustomerScenario(now, "Do you carry pills and oils also?");
  }

  if (name === "quote_no_reply") {
    return quoteScenario(now, { name: "Omen", id: "xxx" });
  }

  if (name === "ai_doubt") {
    return singleCustomerScenario(now, "Are you a bot? I want to talk to a real person.");
  }

  if (name === "call_request") {
    return singleCustomerScenario(now, "Can you call me? I want to talk to a real person.");
  }

  if (name === "opt_out") {
    return singleCustomerScenario(now, "No thanks, not interested. Please stop messaging me.");
  }

  if (name === "duplicate_stage") {
    const scenario = quoteScenario(now, { name: "Omen", id: "xxx" });
    return {
      ...scenario,
      logs: [
        {
          action_type: "telegram_alert",
          followup_stage: "3h",
          status: "quote_sent_no_reply",
          created_at: isoHoursBefore(now, 1),
          raw_result: {
            mode: FOLLOWUP_MODE,
            template_id: "quote_no_reply_basic_test_order",
          },
        },
      ],
      tasks: [],
    };
  }

  return singleCustomerScenario(now, "Can I get the price list?");
}

function getDefaultNowForScenario(scenario, providedNow) {
  if (providedNow) {
    return providedNow;
  }

  if (scenario === "quiet_after_end_deferred_task") {
    return "2026-07-01T12:05:00.000Z";
  }

  if (String(scenario || "").startsWith("quiet_")) {
    return "2026-07-01T06:05:00.000Z";
  }

  return new Date().toISOString();
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

function getLatestCustomerText(messages = [], customer = {}) {
  return getLatestMessageByDirection(messages, ["customer"])?.message_text || customer.last_customer_message || "";
}

function getLatestAgentText(messages = []) {
  return getLatestMessageByDirection(messages, ["ai", "human"])?.message_text || "未提供";
}

function getPriorityLabel(priority) {
  return PRIORITY_LABELS[priority] || PRIORITY_LABELS.medium;
}

function getAnalysisPreview(decision = {}, customer = {}) {
  if (decision.status === "first_greeting_no_reply") {
    return "客户只发送了初始问候，AI/业务员已回复开场白，但客户没有继续说明需求，需要人工轻量回访，重新引导客户说明想了解的产品或目标。";
  }

  if (decision.status === "quality_trust_question_no_reply") {
    return "客户正在核实检测报告、实验室位置或产品真实性，可能对质量证明仍有顾虑，需要人工跟进确认客户主要担心的是 COA、批次、实验室信息还是首次合作风险。";
  }

  if (decision.status === "b2b_wholesale_interest_no_reply") {
    return "客户表现出 B2B / 批发 / 大货采购意向，可能正在比较价格、供应稳定性、产品范围或长期合作条件，需要人工及时跟进确认采购需求和报价方向。";
  }

  if (decision.status === "shipping_address_request_no_reply") {
    return "我们已经向客户追问收货地址或配送信息，但客户暂时没有继续回复，需要人工轻量跟进，确认客户是否还准备继续推进付款或下单流程。";
  }

  if (decision.status === "staff_next_step_question_no_reply") {
    return "我们已经向客户追问下一步确认信息，但客户暂时没有继续回复，需要人工轻量回访，确认客户是否还需要产品、数量、价格、物流或订单方面的帮助。";
  }

  if (decision.status === "general_no_reply_after_staff_message") {
    return "客户在我们回复后暂时没有继续回复，当前没有明确拒绝或结束意向，需要人工轻量回访，确认客户是否还需要产品、价格、物流或订单方面的帮助。";
  }

  if (decision.status === "quote_sent_no_reply") {
    return "客户已收到报价但没有继续回复，可能卡在总价、MOQ、运费或首次测试成本。";
  }

  if (decision.status === "shipping_question_no_reply") {
    return "客户问过物流后没有继续，可能在担心运费、时效、追踪或清关。";
  }

  if (decision.status === "price_objection") {
    return "客户认为价格偏高或正在比较其他报价，需要人工解释订单组成并判断是否适合小单测试。";
  }

  if (decision.status === "product_question_no_reply") {
    return "客户在询问是否有某类产品或剂型，需要人工确认具体需求后再给出产品方向。";
  }

  const text = String(decision.last_customer_message || customer.last_customer_message || "").toLowerCase();

  if (/\b(coa|quality|authentic|real|batch|janoshik|lab|test)\b/.test(text)) {
    return "客户可能卡在质量、COA、真实性或检测报告信息，需要人工先帮客户确认可核对的信息。";
  }

  if (/\b(bulk|resale|reseller|wholesale|b2b|business|china vendors|compare prices)\b/.test(text)) {
    return "客户可能有 B2B / 批发采购意向，需要人工确认采购量、产品方向和报价需求。";
  }

  return "客户进入可回访阶段，但需要人工先查看上下文再决定是否发送。";
}

function normalizeOpenTasksForDecision(tasks = []) {
  return tasks.map((task) => (task.status === "deferred" ? { ...task, status: "pending" } : task));
}

function buildTelegramPreview(decision = {}, staffProfile = {}, customer = {}, messages = []) {
  if (decision.skipped_reason === "high_risk_handoff_required") {
    return [
      "【需要人工接入】",
      "",
      `原因：${decision.reason || decision.skipped_reason}`,
      `接待客服：${staffProfile.name}`,
      `接待客服ID：${staffProfile.id}`,
      `搜索关键词：${customer.ws_display_name || customer.customer_name || customer.phone || customer.email || customer.contact_id || "未获取到"}`,
      "",
      "客户最近消息：",
      decision.last_customer_message || customer.last_customer_message || "未提供",
    ].join("\n");
  }

  return [
    "【客户回访提醒】",
    "",
    `客户阶段：${decision.status || "未提供"}`,
    `回访节点：${decision.followup_stage || "未提供"}`,
    `优先级：${getPriorityLabel(decision.priority)}`,
    `接待客服：${staffProfile.name}`,
    `接待客服ID：${staffProfile.id}`,
    "",
    `WS名称：${customer.ws_display_name || "未提供"}`,
    `客户名称：${customer.customer_name || "未提供"}`,
    `联系方式：${customer.phone || customer.email || "未提供"}`,
    `搜索关键词：${customer.ws_display_name || customer.customer_name || customer.phone || customer.email || customer.contact_id || "未获取到"}`,
    "",
    "客户最近消息：",
    decision.last_customer_message || customer.last_customer_message || "未提供",
    "",
    "我们最后回复：",
    getLatestAgentText(messages),
    "",
    "AI分析：",
    getAnalysisPreview(decision, customer),
    "",
    "建议人工回访话术：",
    decision.suggested_message || "未提供",
  ].join("\n");
}

function buildResponse({ customer, messages, logs, tasks, now, force = false, bypassQuiet = false, quietOverrides = {} }) {
  const latestText = getLatestCustomerText(messages, customer);
  const decision = analyzeFollowupDecision({
    customer,
    messages,
    logs,
    tasks: normalizeOpenTasksForDecision(tasks),
    now,
    force,
  });
  const staffProfile = getAssignedStaffProfile(customer, messages);
  const quietState = getQuietHoursState(now, quietOverrides);
  const quietDeferred = shouldDeferForQuietHours(decision, quietState, Boolean(force && bypassQuiet));
  const highRiskTelegramAllowed = Boolean(decision.should_send_telegram && decision.skipped_reason === "high_risk_handoff_required");
  const lowRiskTelegramAllowed = Boolean(decision.telegram_alert_allowed && !quietDeferred);

  return {
    ok: true,
    success: true,
    mode: FOLLOWUP_MODE,
    auto_customer_send_disabled: AUTO_CUSTOMER_SEND_DISABLED,
    would_send_customer: false,
    telegram_target_chat_source: TELEGRAM_TARGET_CHAT_SOURCE,
    force: Boolean(force),
    bypass_quiet: Boolean(bypassQuiet),
    ...getQuietHoursResponseFields(quietState),
    latest_customer_message_time: decision.latest_customer_message_time || "",
    latest_agent_message_time: decision.latest_agent_message_time || "",
    last_message_direction: decision.last_message_direction || "unknown",
    detected_status: decision.detected_status || decision.status || "unknown",
    status_detected: classifyCustomerStatus(messages, customer),
    high_risk_type: getHighRiskType(latestText) || null,
    manual_handoff_required: decision.skipped_reason === "high_risk_handoff_required",
    telegram_alert_allowed: highRiskTelegramAllowed || lowRiskTelegramAllowed,
    duplicate_blocked: decision.skipped_reason === "no_due_stage" && Boolean(decision.duplicate_stage),
    duplicate_stage: decision.duplicate_stage || "",
    opt_out_stopped: decision.stop_reason === "customer_opt_out",
    auto_send_allowed: false,
    staff_name: staffProfile.name,
    staff_id: staffProfile.id,
    staff_source: staffProfile.name_source,
    staff_id_source: staffProfile.id_source,
    followup_stage: decision.followup_stage || null,
    next_due_stage: decision.next_due_stage || decision.followup_stage || "",
    next_due_at: decision.next_due_at || decision.scheduled_at || "",
    suggested_message: decision.suggested_message || "",
    skipped_reason: quietDeferred ? "quiet_hours_deferred" : decision.skipped_reason || "",
    deferred_by_quiet_hours: quietDeferred ? 1 : 0,
    task_preview_status: quietDeferred ? "deferred" : decision.telegram_alert_allowed ? "pending_or_sent" : "none",
    task_preview_scheduled_at: quietDeferred ? quietState.defer_until : decision.scheduled_at || "",
    telegram_preview: buildTelegramPreview(decision, staffProfile, customer, messages),
    decision,
  };
}

function isTruthy(value) {
  return ["1", "true", "yes", "y", "on"].includes(String(value || "").toLowerCase());
}

module.exports = async function handler(req, res) {
  const availableScenarios = [
    "price_inquiry",
    "price_quote",
    "catalog_request",
    "pricing_delivery",
    "price_objection",
    "product_question",
    "quote_no_reply",
    "first_greeting_no_reply",
    "quality_trust_question_no_reply",
    "b2b_wholesale_interest_no_reply",
    "staff_next_step_question_no_reply",
    "shipping_address_request_no_reply",
    "general_no_reply_after_staff_message",
    "customer_replied_after_agent",
    "staff_omen",
    "staff_jett",
    "staff_map_yinping",
    "staff_map_jett_agent",
    "staff_map_unknown",
    "quiet_price_deferred",
    "quiet_ai_doubt",
    "quiet_force_deferred",
    "quiet_force_bypass",
    "quiet_after_end_deferred_task",
    "quiet_deferred_log_not_duplicate",
    "no_staff",
    "handoff_jett",
    "ai_doubt",
    "call_request",
    "opt_out",
    "duplicate_stage",
  ];

  if (req.method === "GET") {
    const scenario = req.query?.scenario || "price_inquiry";
    const now = getDefaultNowForScenario(scenario, req.query?.now);
    const force = isTruthy(req.query?.force) || scenario === "quiet_force_deferred" || scenario === "quiet_force_bypass";
    const bypassQuiet = isTruthy(req.query?.bypass_quiet) || scenario === "quiet_force_bypass";
    const sample = buildScenario(scenario, now);

    return res.status(200).json({
      message: "POST a simulated customer/messages/logs/tasks payload, or pass ?scenario=price_inquiry.",
      available_scenarios: availableScenarios,
      ...buildResponse({
        ...sample,
        now,
        force,
        bypassQuiet,
        quietOverrides: sample.quiet_overrides,
      }),
    });
  }

  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method Not Allowed" });
  }

  const body = req.body || {};
  const scenario = body.scenario;
  const now = body.now || getDefaultNowForScenario(scenario, "");
  const force = isTruthy(body.force || req.query?.force) || scenario === "quiet_force_deferred" || scenario === "quiet_force_bypass";
  const bypassQuiet = isTruthy(body.bypass_quiet || req.query?.bypass_quiet) || scenario === "quiet_force_bypass";
  const sample = scenario ? buildScenario(scenario, now) : buildScenario("price_inquiry", now);
  const customer = body.customer || sample.customer;
  const messages = Array.isArray(body.messages) ? body.messages : sample.messages;
  const logs = Array.isArray(body.logs) ? body.logs : sample.logs;
  const tasks = Array.isArray(body.tasks) ? body.tasks : sample.tasks;
  const quietOverrides = body.quiet_overrides || sample.quiet_overrides;

  return res.status(200).json(buildResponse({ customer, messages, logs, tasks, now, force, bypassQuiet, quietOverrides }));
};
