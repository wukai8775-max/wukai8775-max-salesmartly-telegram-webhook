const { hasSupabaseEnv } = require("../lib/supabase-store");
const { runFollowupAnalysis, buildBaseResponse, FOLLOWUP_MODE, AUTO_CUSTOMER_SEND_DISABLED } = require("../lib/followup-analyzer");
const { getQuietHoursState } = require("../lib/quiet-hours");

function getLimit(req) {
  const raw = req.query?.limit || 50;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 200) : 50;
}

function getCronSecret(req) {
  const authHeader = req.headers.authorization || "";
  const bearer = authHeader.replace(/^Bearer\s+/i, "");
  return bearer || req.query?.secret || "";
}

function verifyCronSecret(req) {
  const expected = process.env.CRON_SECRET;

  if (!expected) {
    return false;
  }

  return getCronSecret(req) === expected;
}

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({
      ok: false,
      error: "Method Not Allowed",
    });
  }

  if (!verifyCronSecret(req)) {
    return res.status(401).json({
      ok: false,
      error: "Invalid cron secret",
    });
  }

  const now = req.query?.now;

  if (!hasSupabaseEnv()) {
    return res.status(500).json({
      ...buildBaseResponse({ quietState: getQuietHoursState(now), force: false, bypassQuiet: false, cron: true }),
      ok: false,
      success: false,
      mode: FOLLOWUP_MODE,
      cron: true,
      auto_customer_send_disabled: AUTO_CUSTOMER_SEND_DISABLED,
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
      force: false,
      bypassQuiet: false,
      cron: true,
    });

    return res.status(200).json({
      ...result,
      cron: true,
      force: false,
      bypass_quiet: false,
    });
  } catch (error) {
    return res.status(500).json({
      ...buildBaseResponse({ quietState: getQuietHoursState(now), force: false, bypassQuiet: false, cron: true }),
      ok: false,
      success: false,
      cron: true,
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
