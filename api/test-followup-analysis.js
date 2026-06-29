const { analyzeFollowupDecision, classifyCustomerStatus, getHighRiskType } = require("../lib/followup-rules");

function sampleCustomer() {
  const first = new Date(Date.now() - 4 * 3600000).toISOString();

  return {
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
    last_customer_message: "Can I get the price list?",
    followup_count_total: 0,
    followup_count_24h: 0,
    followup_stopped: false,
    do_not_followup: false,
    created_at: first,
  };
}

function sampleMessages(customer) {
  return [
    {
      contact_id: customer.contact_id,
      session_id: customer.session_id,
      direction: "customer",
      message_text: customer.last_customer_message,
      message_time: customer.last_customer_message_at,
    },
  ];
}

module.exports = async function handler(req, res) {
  if (req.method === "GET") {
    const customer = sampleCustomer();
    const messages = sampleMessages(customer);
    const decision = analyzeFollowupDecision({
      customer,
      messages,
      logs: [],
      tasks: [],
      now: new Date().toISOString(),
    });

    return res.status(200).json({
      ok: true,
      message: "POST a simulated customer/messages/logs/tasks payload to test follow-up analysis.",
      sample_decision: decision,
    });
  }

  if (req.method !== "POST") {
    return res.status(405).json({
      ok: false,
      error: "Method Not Allowed",
    });
  }

  const body = req.body || {};
  const customer = body.customer || sampleCustomer();
  const messages = Array.isArray(body.messages) ? body.messages : sampleMessages(customer);
  const logs = Array.isArray(body.logs) ? body.logs : [];
  const tasks = Array.isArray(body.tasks) ? body.tasks : [];
  const now = body.now || new Date().toISOString();
  const latestText =
    body.last_message ||
    messages
      .filter((message) => message.direction === "customer")
      .slice(-1)[0]?.message_text ||
    customer.last_customer_message ||
    "";
  const decision = analyzeFollowupDecision({
    customer,
    messages,
    logs,
    tasks,
    now,
  });

  return res.status(200).json({
    ok: true,
    success: true,
    status_detected: classifyCustomerStatus(messages, customer),
    high_risk_type: getHighRiskType(latestText) || null,
    duplicate_blocked: decision.skipped_reason === "no_due_stage" || Boolean(decision.existing_pending_task),
    auto_send_allowed: decision.auto_send_allowed,
    followup_stage: decision.followup_stage || null,
    suggested_message: decision.suggested_message || "",
    skipped_reason: decision.skipped_reason || "",
    decision,
  });
};
