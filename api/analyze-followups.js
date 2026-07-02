const { firstNonEmpty } = require("../lib/salesmartly-profile");
const { hasSupabaseEnv } = require("../lib/supabase-store");
const { runFollowupAnalysis, buildBaseResponse } = require("../lib/followup-analyzer");
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
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(Math.floor(parsed), 100) : 50;
}

function getNonNegativeInteger(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : fallback;
}

function getOffset(req, limit) {
  const cursor = firstNonEmpty(req.body?.cursor, req.query?.cursor);
  const offset = firstNonEmpty(req.body?.offset, req.query?.offset);
  const page = firstNonEmpty(req.body?.page, req.query?.page);

  if (cursor !== "") {
    return getNonNegativeInteger(cursor, 0);
  }

  if (offset !== "") {
    return getNonNegativeInteger(offset, 0);
  }

  if (page !== "") {
    return Math.max(getNonNegativeInteger(page, 1) - 1, 0) * limit;
  }

  return 0;
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

function buildErrorResponse({ now, force, bypassQuiet, limit = 50, offset = 0, message }) {
  return {
    ...buildBaseResponse({ quietState: getQuietHoursState(now), force, bypassQuiet, cron: false }),
    ok: false,
    success: false,
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
    stopped_reason: "analyze_runner_error",
    error: message,
  };
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
  const limit = getLimit(req);
  const offset = getOffset(req, limit);

  if (!hasSupabaseEnv()) {
    return res.status(500).json(
      buildErrorResponse({
        now,
        force,
        bypassQuiet,
        limit,
        offset,
        message: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY",
      })
    );
  }

  try {
    const result = await runFollowupAnalysis({
      limit,
      offset,
      maxLimit: 100,
      now,
      force,
      bypassQuiet,
      cron: false,
    });

    return res.status(200).json(result);
  } catch (error) {
    return res.status(500).json(
      buildErrorResponse({
        now,
        force,
        bypassQuiet,
        limit,
        offset,
        message: error.message,
      })
    );
  }
};
