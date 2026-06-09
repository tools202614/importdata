import { NextResponse } from "next/server";
import { getCustomAttributeRows } from "@/lib/data-source";

export const maxDuration = 300;

// GET /api/attributes
// Lists custom contact attribute definitions. Reads the synced `custom_attributes`
// table when Supabase is configured, else queries tawk.to live.
export async function GET() {
  try {
    const rows = await getCustomAttributeRows();
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
