const { hasSupabaseEnv } = require("../lib/supabase-store");
const { runFollowupAnalysis, buildBaseResponse, FOLLOWUP_MODE, AUTO_CUSTOMER_SEND_DISABLED } = require("../lib/followup-analyzer");
const { getQuietHoursState } = require("../lib/quiet-hours");

function getLimit(req) {
  const raw = req.query?.limit || 50;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(Math.floor(parsed), 100) : 50;
}

function getNonNegativeInteger(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : fallback;
}

function getOffset(req, limit) {
  if (req.query?.cursor !== undefined && req.query?.cursor !== "") {
    return getNonNegativeInteger(req.query.cursor, 0);
  }

  if (req.query?.offset !== undefined && req.query?.offset !== "") {
    return getNonNegativeInteger(req.query.offset, 0);
  }

  if (req.query?.page !== undefined && req.query?.page !== "") {
    const page = getNonNegativeInteger(req.query.page, 1);
    return Math.max(page - 1, 0) * limit;
  }

  return 0;
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
  const limit = getLimit(req);
  const offset = getOffset(req, limit);

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
      partial: false,
      limit,
      offset,
      next_offset: offset,
      next_cursor: offset,
      processed_count: 0,
      elapsed_ms: 0,
      stopped_reason: "missing_supabase_env",
      error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY",
    });
  }

  try {
    const result = await runFollowupAnalysis({
      limit,
      offset,
      maxLimit: 100,
      maxExecutionMs: 20000,
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
    return res.status(200).json({
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
      partial: false,
      limit,
      offset,
      next_offset: offset,
      next_cursor: offset,
      processed_count: 0,
      elapsed_ms: 0,
      stopped_reason: "cron_runner_error",
      error: error.message,
    });
  }
};
