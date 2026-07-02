import { NextRequest, NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { requireHrOrAdmin } from "@/lib/auth";

export const dynamic = "force-dynamic";

const BUCKET = "profile-photos";
const MAX_BYTES = 5 * 1024 * 1024; // 5 MB

// POST /api/profile/photo  (multipart: userId, file) — upload a profile photo to
// Supabase Storage, save its public URL on the profile. HR/admin only.
export async function POST(req: NextRequest) {
  const g = await requireHrOrAdmin(req);
  if ("error" in g) return g.error;
  try {
    const form = await req.formData();
    const userId = String(form.get("userId") ?? "").trim();
    const file = form.get("file");
    if (!userId) return NextResponse.json({ error: "userId required" }, { status: 400 });
    if (!(file instanceof File)) return NextResponse.json({ error: "file required" }, { status: 400 });
    if (!file.type.startsWith("image/")) return NextResponse.json({ error: "File must be an image" }, { status: 400 });
    if (file.size > MAX_BYTES) return NextResponse.json({ error: "Image must be 5 MB or smaller" }, { status: 400 });

    const ext = (file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
    const path = `${userId}/${Date.now()}.${ext}`;
    const buffer = Buffer.from(await file.arrayBuffer());

    const sb = getSupabase();
    const { error: upErr } = await sb.storage.from(BUCKET).upload(path, buffer, {
      contentType: file.type,
      upsert: true,
    });
    if (upErr) throw new Error(upErr.message);

    const { data: pub } = sb.storage.from(BUCKET).getPublicUrl(path);
    const photoUrl = pub.publicUrl;

    const { error: dbErr } = await sb
      .from("employee_profiles")
      .upsert({ user_id: userId, photo_url: photoUrl, updated_at: new Date().toISOString(), updated_by: g.session.username }, { onConflict: "user_id" });
    if (dbErr) throw new Error(dbErr.message);

    return NextResponse.json({ photoUrl });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 400 });
  }
}
