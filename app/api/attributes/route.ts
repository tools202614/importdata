import { NextResponse } from "next/server";
import { getCustomAttributes } from "@/lib/tawk-api";
import { PROPERTIES } from "@/lib/properties";

export const maxDuration = 300;

// GET /api/attributes
// Lists the custom contact attribute *definitions* (person + organization) for
// every property. tawk.to only exposes attribute schemas via the API (not their
// per-conversation values), so this is a reference view of what's configured.
export async function GET() {
  try {
    const rows: { property: string; object: string; key: string; label: string; dataType: string }[] = [];

    for (const prop of PROPERTIES) {
      for (const object of ["person", "organization"] as const) {
        let attrs;
        try {
          attrs = await getCustomAttributes(prop.id, object);
        } catch {
          // Some properties may lack scope/attributes — skip rather than fail the whole report.
          continue;
        }
        for (const a of attrs) {
          rows.push({
            property: prop.name,
            object,
            key: a.key,
            label: a.label || a.key,
            dataType: a.dataType || "",
          });
        }
      }
    }

    rows.sort(
      (a, b) =>
        a.property.localeCompare(b.property) ||
        a.object.localeCompare(b.object) ||
        a.label.localeCompare(b.label)
    );

    return NextResponse.json({ rows });
  } catch (err) {
    console.error("Attributes report error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
