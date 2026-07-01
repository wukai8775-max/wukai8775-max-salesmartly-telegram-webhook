const DEFAULT_TIMEZONE = "Asia/Shanghai";
const DEFAULT_START = "13:00";
const DEFAULT_END = "19:00";
const DEFAULT_BEHAVIOR = "defer";

function firstNonEmpty(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      return String(value).trim();
    }
  }

  return "";
}

function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null || String(value).trim() === "") {
    return fallback;
  }

  return ["1", "true", "yes", "y", "on"].includes(String(value).trim().toLowerCase());
}

function parseTimeToMinutes(value, fallback) {
  const text = firstNonEmpty(value, fallback);
  const match = /^(\d{1,2}):(\d{2})$/.exec(text);

  if (!match) {
    return parseTimeToMinutes(fallback, "00:00");
  }

  const hours = Number(match[1]);
  const minutes = Number(match[2]);

  if (!Number.isInteger(hours) || !Number.isInteger(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    return parseTimeToMinutes(fallback, "00:00");
  }

  return hours * 60 + minutes;
}

function formatMinutes(totalMinutes) {
  const hours = Math.floor(totalMinutes / 60) % 24;
  const minutes = totalMinutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function getQuietHoursConfig(overrides = {}) {
  const enabled = parseBoolean(
    firstNonEmpty(overrides.enabled, process.env.FOLLOWUP_QUIET_HOURS_ENABLED),
    false
  );
  const timezone = firstNonEmpty(overrides.timezone, process.env.FOLLOWUP_QUIET_TIMEZONE, DEFAULT_TIMEZONE);
  const start = firstNonEmpty(overrides.start, process.env.FOLLOWUP_QUIET_START, DEFAULT_START);
  const end = firstNonEmpty(overrides.end, process.env.FOLLOWUP_QUIET_END, DEFAULT_END);
  const behavior = firstNonEmpty(overrides.behavior, process.env.FOLLOWUP_QUIET_BEHAVIOR, DEFAULT_BEHAVIOR).toLowerCase();

  return {
    enabled,
    timezone,
    start,
    end,
    behavior: behavior === "defer" ? "defer" : DEFAULT_BEHAVIOR,
  };
}

function getZonedParts(date, timezone) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour12: false,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));

  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

function getTimeZoneOffset(date, timezone) {
  const parts = getZonedParts(date, timezone);
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second || 0);
  return asUtc - date.getTime();
}

function zonedTimeToUtc({ year, month, day, hour, minute }, timezone) {
  let utc = Date.UTC(year, month - 1, day, hour, minute, 0, 0);

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const offset = getTimeZoneOffset(new Date(utc), timezone);
    const next = Date.UTC(year, month - 1, day, hour, minute, 0, 0) - offset;
    if (Math.abs(next - utc) < 1000) {
      utc = next;
      break;
    }
    utc = next;
  }

  return new Date(utc);
}

function addLocalDays(parts, days) {
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days, 12, 0, 0));
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  };
}

function isWithinQuietWindow(currentMinutes, startMinutes, endMinutes) {
  if (startMinutes === endMinutes) {
    return false;
  }

  if (startMinutes < endMinutes) {
    return currentMinutes >= startMinutes && currentMinutes < endMinutes;
  }

  return currentMinutes >= startMinutes || currentMinutes < endMinutes;
}

function getQuietEndAt(nowDate, parts, startMinutes, endMinutes, timezone) {
  const currentMinutes = parts.hour * 60 + parts.minute;
  const endHour = Math.floor(endMinutes / 60);
  const endMinute = endMinutes % 60;
  let endDateParts = {
    year: parts.year,
    month: parts.month,
    day: parts.day,
  };

  if (startMinutes > endMinutes && currentMinutes >= startMinutes) {
    endDateParts = addLocalDays(parts, 1);
  }

  let endAt = zonedTimeToUtc({ ...endDateParts, hour: endHour, minute: endMinute }, timezone);
  if (endAt.getTime() <= nowDate.getTime()) {
    endDateParts = addLocalDays(endDateParts, 1);
    endAt = zonedTimeToUtc({ ...endDateParts, hour: endHour, minute: endMinute }, timezone);
  }

  return endAt;
}

function getQuietHoursState(now = new Date(), overrides = {}) {
  const config = getQuietHoursConfig(overrides);
  const startMinutes = parseTimeToMinutes(config.start, DEFAULT_START);
  const endMinutes = parseTimeToMinutes(config.end, DEFAULT_END);
  const start = formatMinutes(startMinutes);
  const end = formatMinutes(endMinutes);
  const nowDate = now instanceof Date ? now : new Date(now);

  if (!config.enabled) {
    return {
      enabled: false,
      active: false,
      timezone: config.timezone,
      start,
      end,
      behavior: config.behavior,
      defer_until: null,
    };
  }

  try {
    const parts = getZonedParts(nowDate, config.timezone);
    const currentMinutes = parts.hour * 60 + parts.minute;
    const active = isWithinQuietWindow(currentMinutes, startMinutes, endMinutes);
    const deferUntil = active ? getQuietEndAt(nowDate, parts, startMinutes, endMinutes, config.timezone) : null;

    return {
      enabled: true,
      active,
      timezone: config.timezone,
      start,
      end,
      behavior: config.behavior,
      defer_until: deferUntil ? deferUntil.toISOString() : null,
    };
  } catch (error) {
    console.warn("Invalid follow-up quiet hours config", {
      quiet_hours_enabled: true,
      quiet_timezone: config.timezone,
      quiet_start: start,
      quiet_end: end,
      error_name: error?.name || "Error",
      error_message: String(error?.message || "invalid_quiet_hours_config").slice(0, 120),
    });

    return {
      enabled: false,
      active: false,
      timezone: config.timezone,
      start,
      end,
      behavior: config.behavior,
      defer_until: null,
    };
  }
}

function shouldDeferForQuietHours(decision = {}, quietState = {}, bypassQuiet = false) {
  return Boolean(
    quietState.enabled &&
      quietState.active &&
      !bypassQuiet &&
      decision.telegram_alert_allowed &&
      decision.risk_level !== "high"
  );
}

function getQuietHoursResponseFields(quietState = {}) {
  return {
    quiet_hours_enabled: Boolean(quietState.enabled),
    quiet_hours_active: Boolean(quietState.active),
    quiet_timezone: quietState.timezone || DEFAULT_TIMEZONE,
    quiet_start: quietState.start || DEFAULT_START,
    quiet_end: quietState.end || DEFAULT_END,
  };
}

module.exports = {
  DEFAULT_TIMEZONE,
  DEFAULT_START,
  DEFAULT_END,
  DEFAULT_BEHAVIOR,
  getQuietHoursConfig,
  getQuietHoursState,
  getQuietHoursResponseFields,
  shouldDeferForQuietHours,
};
