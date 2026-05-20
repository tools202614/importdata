// IANA timezone name used by reports for day boundaries.
// Common values:
//   US Central (CST/CDT, handles DST): "America/Chicago"
//   US Eastern (EST/EDT):               "America/New_York"
//   US Pacific (PST/PDT):               "America/Los_Angeles"
//   Philippines (no DST):               "Asia/Manila"
//   UTC:                                "UTC"
export const REPORT_TIMEZONE = "America/Chicago";

// Returns the YYYY-MM-DD date string for an instant in the configured timezone.
export function dateKeyInTz(iso: string | Date): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  // en-CA gives YYYY-MM-DD
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: REPORT_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

// Returns the UTC instants for [local midnight, local 23:59:59.999] of a given YYYY-MM-DD.
export function localDayUtcRange(localDate: string): { startUtc: Date; endUtc: Date } {
  // Compute the timezone offset for this specific date (handles DST automatically)
  // by formatting noon UTC into the local timezone and seeing what wall-clock time we get.
  const noon = new Date(`${localDate}T12:00:00Z`);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: REPORT_TIMEZONE,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false,
  }).formatToParts(noon);
  const p: Record<string, string> = {};
  for (const part of parts) if (part.type !== "literal") p[part.type] = part.value;
  const hour = p.hour === "24" ? 0 : parseInt(p.hour, 10);
  const localAsUtcMs = Date.UTC(
    parseInt(p.year, 10),
    parseInt(p.month, 10) - 1,
    parseInt(p.day, 10),
    hour,
    parseInt(p.minute, 10),
    parseInt(p.second, 10)
  );
  const offsetMs = localAsUtcMs - noon.getTime();
  // local midnight in UTC ms:
  const localMidnightUtcMs = Date.UTC(
    parseInt(localDate.slice(0, 4), 10),
    parseInt(localDate.slice(5, 7), 10) - 1,
    parseInt(localDate.slice(8, 10), 10),
    0, 0, 0
  ) - offsetMs;
  return {
    startUtc: new Date(localMidnightUtcMs),
    endUtc: new Date(localMidnightUtcMs + 24 * 60 * 60 * 1000 - 1),
  };
}
