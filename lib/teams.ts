// ─────────────────────────────────────────────────────────────────────────
// Team → property mapping for the daily Team Report.
//
// Property names must match those in properties.ts (and the `property` column in
// daily_counts). A property not listed in any team lands in an "Unassigned"
// section so its chats are never silently dropped.
// ─────────────────────────────────────────────────────────────────────────

export interface Team {
  /** Short name; matches the Channel Issue form's Team option where applicable. */
  name: string;
  /** Display title shown on the report. */
  title: string;
  /** Property names belonging to this team. */
  properties: string[];
}

export const TEAMS: Team[] = [
  {
    name: "Sunshine",
    title: "TEAM SUNSHINE",
    properties: ["Creativetain", "BringTheStreams", "Streamsdepot", "Axentv", "PhoxStreams", "Gyrostreams", "Dipiptv"],
  },
  {
    name: "PY/FMB",
    title: "TEAM PYROFBM",
    properties: ["Omniservetek", "Pyrostreams", "FirstBallotMedia", "WL4L", "Enterprise One"],
  },
  {
    name: "Powell",
    title: "TEAM POWELL",
    properties: ["AllSmartMedia", "ILML3", "One Love Streaming"],
  },
  {
    name: "Inigo",
    title: "TEAM INIGO",
    properties: ["Carefreestreams"],
  },
];

/** Map a property name to its team name, or null if unassigned. */
export function teamForProperty(property: string): string | null {
  for (const t of TEAMS) {
    if (t.properties.includes(property)) return t.name;
  }
  return null;
}
