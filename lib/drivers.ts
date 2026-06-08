// ─────────────────────────────────────────────────────────────────────────
// "Driver" convention for chats & tickets.
//
// tawk.to has no native driver/reason field — the only categorization the API
// exposes is free-text `tags`. We treat a tag prefixed with `driver:` as a
// driver (e.g. `driver:billing` → "billing"). The Drivers report can also run
// in "all tags" mode, which doubles as the Support Tags report.
// ─────────────────────────────────────────────────────────────────────────

export const DRIVER_TAG_PREFIX = "driver:";

/** A tag with no value, bucketed so totals stay honest. */
export const UNTAGGED = "(untagged)";

export function isDriverTag(tag: string): boolean {
  return tag.toLowerCase().startsWith(DRIVER_TAG_PREFIX);
}

/** Strip the `driver:` prefix and tidy the label for display. */
export function driverLabel(tag: string): string {
  if (!isDriverTag(tag)) return tag;
  return tag.slice(DRIVER_TAG_PREFIX.length).trim() || tag;
}
