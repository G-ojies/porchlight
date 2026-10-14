import { NextRequest, NextResponse } from "next/server";
import { isDoorKind } from "@/lib/describe";
import { eventSnapshot, ringClient } from "@/lib/server";

export const dynamic = "force-dynamic";

/** The camera frame for a live event, proxied server-side (Ring blocks browser calls). */
export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const deviceId = p.get("device") ?? "";
  const at = Number(p.get("at"));
  const kind = p.get("kind") ?? "unknown";
  const end = p.get("end") ? Number(p.get("end")) : null;
  const client = ringClient();
  if (!client || !deviceId || !Number.isFinite(at) || !isDoorKind(kind)) return NextResponse.json({ error: "bad request" }, { status: 400 });
  try {
    const snap = await eventSnapshot(client, deviceId, at, kind, end);
    return new NextResponse(Buffer.from(snap.bytes), {
      headers: { "Content-Type": snap.contentType, "Cache-Control": "private, max-age=3600" },
    });
  } catch {
    return NextResponse.json({ error: "No frame available for this event yet." }, { status: 404 });
  }
}
