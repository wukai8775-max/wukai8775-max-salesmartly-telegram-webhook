const { analyzeFollowupDecision, classifyCustomerStatus, getHighRiskType } = require("../lib/followup-rules");
const { getAssignedStaffProfile } = require("../lib/staff-profile");

const FOLLOWUP_MODE = "telegram_only";
const AUTO_CUSTOMER_SEND_DISABLED = true;
const TELEGRAM_TARGET_CHAT_SOURCE = "TELEGRAM_CHAT_ID";

const PRIORITY_LABELS = {
  high: "高",
  medium: "中",
  low: "低",
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

function quoteScenario(now, staff = { name: "Omen", id: "xxx" }) {
  const customerAt = isoHoursBefore(now, 5);
  const quoteAt = isoHoursBefore(now, 4);
  const customer = {
    ...sampleCustomer(now, "Can you quote Retatrutide 20mg x 2 boxes?", staff),
    first_customer_message_at: customerAt,
    last_customer_message_at: customerAt,
    last_customer_message: "Can you quote Retatrutide 20mg x 2 boxes?",
  };
  const agentMessage = {
    contact_id: customer.contact_id,
    session_id: customer.session_id,
    direction: "ai",
    message_text: "Here is your quote. Product total is $364, shipping is $70, total amount is $455.70.",
    message_time: quoteAt,
  };

  if (staff?.name) {
    agentMessage.sender_name = staff.name;
  }

  if (staff?.id) {
    agentMessage.sender_id = staff.id;
    agentMessage.raw_payload = {
      sys_user_id: staff.id,
      user: {
        id: staff.id,
        name: staff.name,
      },
    };
  }

  return {
    customer,
    messages: [customerMessage(customer, customer.last_customer_message, customerAt), agentMessage],
    logs: [],
    tasks: [],
  };
}

function buildScenario(name = "price_inquiry", now = new Date().toISOString()) {
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

  if (name === "no_staff") {
    return quoteScenario(now, null);
  }

  if (name === "handoff_jett") {
    const customer = sampleCustomer(now, "Are you a bot? I want to talk to a real person.", { name: "Jett", id: "yyy" });
    return {
      customer,
      messages: [customerMessage(customer)],
      logs: [],
      tasks: [],
    };
  }

  if (name === "price_quote") {
    const customer = sampleCustomer(now, "Can I get a price quote?");
    return {
      customer,
      messages: [customerMessage(customer)],
      logs: [],
      tasks: [],
    };
  }

  if (name === "catalog_request") {
    const customer = sampleCustomer(now, "Can I see your catalog");
    return {
      customer,
      messages: [customerMessage(customer)],
      logs: [],
      tasks: [],
    };
  }

  if (name === "pricing_delivery") {
    const customer = sampleCustomer(now, "Pricing, delivery");
    return {
      customer,
      messages: [customerMessage(customer)],
      logs: [],
      tasks: [],
    };
  }

  if (name === "price_objection") {
    const customer = sampleCustomer(now, "Your prices are very high compared to the other supplier.");
    return {
      customer,
      messages: [customerMessage(customer)],
      logs: [],
      tasks: [],
    };
  }

  if (name === "product_question") {
    const customer = sampleCustomer(now, "Do you carry pills and oils also?");
    return {
      customer,
      messages: [customerMessage(customer)],
      logs: [],
      tasks: [],
    };
  }

  if (name === "quote_no_reply") {
    return quoteScenario(now, { name: "Omen", id: "xxx" });
  }

  if (name === "ai_doubt") {
    const customer = sampleCustomer(now, "Are you a bot? I want to talk to a real person.");
    return {
      customer,
      messages: [customerMessage(customer)],
      logs: [],
      tasks: [],
    };
  }

  if (name === "call_request") {
    const customer = sampleCustomer(now, "Can you call me? I want to talk to a real person.");
    return {
      customer,
      messages: [customerMessage(customer)],
      logs: [],
      tasks: [],
    };
  }

  if (name === "opt_out") {
    const customer = sampleCustomer(now, "No thanks, not interested. Please stop messaging me.");
    return {
      customer,
      messages: [customerMessage(customer)],
      logs: [],
      tasks: [],
    };
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

  const customer = sampleCustomer(now, "Can I get the price list?");
  return {
    customer,
    messages: [customerMessage(customer)],
    logs: [],
    tasks: [],
  };
}

function getLatestCustomerText(messages = [], customer = {}) {
  return (
    messages
      .filter((message) => message.direction === "customer")
      .slice(-1)[0]?.message_text ||
    customer.last_customer_message ||
    ""
  );
}

function getPriorityLabel(priority) {
  return PRIORITY_LABELS[priority] || PRIORITY_LABELS.medium;
}

function buildTelegramPreview(decision = {}, staffProfile = {}, customer = {}) {
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
    "建议人工回访话术：",
    decision.suggested_message || "未提供",
  ].join("\n");
}

function buildResponse({ customer, messages, logs, tasks, now, force = false }) {
  const latestText = getLatestCustomerText(messages, customer);
  const decision = analyzeFollowupDecision({
    customer,
    messages,
    logs,
    tasks,
    now,
    force,
  });
  const staffProfile = getAssignedStaffProfile(customer, messages);

  return {
    ok: true,
    success: true,
    mode: FOLLOWUP_MODE,
    auto_customer_send_disabled: AUTO_CUSTOMER_SEND_DISABLED,
    would_send_customer: false,
    telegram_target_chat_source: TELEGRAM_TARGET_CHAT_SOURCE,
    force: Boolean(force),
    status_detected: classifyCustomerStatus(messages, customer),
    high_risk_type: getHighRiskType(latestText) || null,
    manual_handoff_required: decision.skipped_reason === "high_risk_handoff_required",
    telegram_alert_allowed: Boolean(decision.telegram_alert_allowed || decision.should_send_telegram),
    duplicate_blocked: decision.skipped_reason === "no_due_stage" || Boolean(decision.existing_pending_task),
    opt_out_stopped: decision.stop_reason === "customer_opt_out",
    auto_send_allowed: false,
    staff_name: staffProfile.name,
    staff_id: staffProfile.id,
    staff_source: staffProfile.name_source,
    staff_id_source: staffProfile.id_source,
    followup_stage: decision.followup_stage || null,
    suggested_message: decision.suggested_message || "",
    skipped_reason: decision.skipped_reason || "",
    telegram_preview: buildTelegramPreview(decision, staffProfile, customer),
    decision,
  };
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
    "staff_omen",
    "staff_jett",
    "staff_map_yinping",
    "staff_map_jett_agent",
    "staff_map_unknown",
    "no_staff",
    "handoff_jett",
    "ai_doubt",
    "call_request",
    "opt_out",
    "duplicate_stage",
  ];

  if (req.method === "GET") {
    const now = req.query?.now || new Date().toISOString();
    const scenario = req.query?.scenario || "price_inquiry";
    const force = ["1", "true", "yes", "y"].includes(String(req.query?.force || "").toLowerCase());
    const sample = buildScenario(scenario, now);

    return res.status(200).json({
      message: "POST a simulated customer/messages/logs/tasks payload, or pass ?scenario=price_inquiry.",
      available_scenarios: availableScenarios,
      ...buildResponse({
        ...sample,
        now,
        force,
      }),
    });
  }

  if (req.method !== "POST") {
    return res.status(405).json({
      ok: false,
      error: "Method Not Allowed",
    });
  }

  const body = req.body || {};
  const now = body.now || new Date().toISOString();
  const scenario = body.scenario;
  const force = ["1", "true", "yes", "y"].includes(String(body.force || req.query?.force || "").toLowerCase());
  const sample = scenario ? buildScenario(scenario, now) : buildScenario("price_inquiry", now);
  const customer = body.customer || sample.customer;
  const messages = Array.isArray(body.messages) ? body.messages : sample.messages;
  const logs = Array.isArray(body.logs) ? body.logs : sample.logs;
  const tasks = Array.isArray(body.tasks) ? body.tasks : sample.tasks;

  return res.status(200).json(
    buildResponse({
      customer,
      messages,
      logs,
      tasks,
      now,
      force,
    })
  );
};