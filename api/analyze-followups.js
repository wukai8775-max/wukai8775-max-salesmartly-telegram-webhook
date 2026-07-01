const { firstNonEmpty } = require("../lib/salesmartly-profile");
const { hasSupabaseEnv } = require("../lib/supabase-store");
const { runFollowupAnalysis, buildBaseResponse, FOLLOWUP_MODE, AUTO_CUSTOMER_SEND_DISABLED } = require("../lib/followup-analyzer");
const { getQuietHoursState } = require("../lib/quiet-hours");

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

function isTruthy(value) {
  return ["1", "true", "yes", "y", "on"].includes(String(value || "").toLowerCase());
}

function isForceEnabled(req) {
  return isTruthy(firstNonEmpty(req.body?.force, req.query?.force));
}

function isBypassQuietEnabled(req, force) {
  return Boolean(force && isTruthy(firstNonEmpty(req.body?.bypass_quiet, req.query?.bypass_quiet)));
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

  const force = isForceEnabled(req);
  const bypassQuiet = isBypassQuietEnabled(req, force);
  const now = req.body?.now || req.query?.now;

  if (!hasSupabaseEnv()) {
    return res.status(500).json({
      ok: false,
      success: false,
      mode: FOLLOWUP_MODE,
      auto_customer_send_disabled: AUTO_CUSTOMER_SEND_DISABLED,
      force,
      bypass_quiet: bypassQuiet,
      ...buildBaseResponse({ quietState: getQuietHoursState(now), force, bypassQuiet, cron: false }),
      scanned: 0,
      telegram_alerts_created: 0,
      tasks_created: 0,
      skipped: 0,
      errors: 1,
      deferred_by_quiet_hours: 0,
      error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY",
    });
  }

  try {
    const result = await runFollowupAnalysis({
      limit: getLimit(req),
      now,
      force,
      bypassQuiet,
      cron: false,
    });

    return res.status(200).json(result);
  } catch (error) {
    const quietState = getQuietHoursState(now);
    return res.status(500).json({
      ...buildBaseResponse({ quietState, force, bypassQuiet, cron: false }),
      ok: false,
      success: false,
      scanned: 0,
      telegram_alerts_created: 0,
      tasks_created: 0,
      skipped: 0,
      errors: 1,
      deferred_by_quiet_hours: 0,
      error: error.message,
    });
  }
};
