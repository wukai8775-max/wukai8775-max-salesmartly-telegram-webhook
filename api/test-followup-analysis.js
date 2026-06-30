const { analyzeFollowupDecision, classifyCustomerStatus, getHighRiskType } = require("../lib/followup-rules");
const { getAssignedStaffName, getAssignedStaffId } = require("../lib/staff-profile");

const FOLLOWUP_MODE = "telegram_only";
const AUTO_CUSTOMER_SEND_DISABLED = true;

function isoHoursBefore(now, hours) {
  return new Date(new Date(now).getTime() - hours * 3600000).toISOString();
}

function sampleCustomer(now = new Date().toISOString(), lastMessage = "Can I get the price list?") {
  const first = isoHoursBefore(now, 4);

  return {
    contact_id: "test_contact",
    session_id: "test_session",
    project_id: "test_project",
    ws_display_name: "Test Customer",
    customer_name: "Test Customer",
    phone: "+1 000 000 0000",
    email: "",
    channel: "WhatsApp",
    assigned_staff_name: "Omen",
    assigned_staff_id: "test_staff_id",
    first_customer_message_at: first,
    last_customer_message_at: first,
    last_customer_message: lastMessage,
    followup_count_total: 0,
    followup_count_24h: 0,
    followup_stopped: false,
    do_not_followup: false,
    created_at: first,
  };
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

function buildScenario(name = "price_inquiry", now = new Date().toISOString()) {
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
    const customerAt = isoHoursBefore(now, 5);
    const quoteAt = isoHoursBefore(now, 4);
    const customer = {
      ...sampleCustomer(now, "Can you quote Retatrutide 20mg x 2 boxes?"),
      first_customer_message_at: customerAt,
      last_customer_message_at: customerAt,
      last_customer_message: "Can you quote Retatrutide 20mg x 2 boxes?",
    };

    return {
      customer,
      messages: [
        customerMessage(customer, customer.last_customer_message, customerAt),
        {
          contact_id: customer.contact_id,
          session_id: customer.session_id,
          direction: "ai",
          sender_name: "Omen",
          raw_payload: {
            sys_user_id: "test_staff_id",
          },
          message_text: "Here is your quote. Product total is $364, shipping is $70, total amount is $455.70.",
          message_time: quoteAt,
        },
      ],
      logs: [],
      tasks: [],
    };
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
    const customer = sampleCustomer(now, "Can I get the price list?");
    return {
      customer,
      messages: [customerMessage(customer)],
      logs: [
        {
          action_type: "telegram_alert",
          followup_stage: "3h",
          status: "price_requested",
          created_at: isoHoursBefore(now, 1),
          raw_result: {
            mode: FOLLOWUP_MODE,
            template_id: "price_list_no_reply",
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

  return {
    ok: true,
    success: true,
    mode: FOLLOWUP_MODE,
    auto_customer_send_disabled: AUTO_CUSTOMER_SEND_DISABLED,
    would_send_customer: false,
    force: Boolean(force),
    status_detected: classifyCustomerStatus(messages, customer),
    high_risk_type: getHighRiskType(latestText) || null,
    manual_handoff_required: decision.skipped_reason === "high_risk_handoff_required",
    telegram_alert_allowed: Boolean(decision.telegram_alert_allowed || decision.should_send_telegram),
    duplicate_blocked: decision.skipped_reason === "no_due_stage" || Boolean(decision.existing_pending_task),
    opt_out_stopped: decision.stop_reason === "customer_opt_out",
    auto_send_allowed: false,
    staff_name: getAssignedStaffName(customer, messages),
    staff_id: getAssignedStaffId(customer, messages),
    followup_stage: decision.followup_stage || null,
    suggested_message: decision.suggested_message || "",
    skipped_reason: decision.skipped_reason || "",
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
