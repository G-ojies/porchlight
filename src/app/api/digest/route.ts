import { NextRequest, NextResponse } from "next/server";
import { resolveKind } from "@/lib/describe";
import { buildDigest, localDate, type DigestItem } from "@/lib/digest";
import { sampleDay } from "@/lib/demo";
import { cachedDescription, demoDescription, liveEvents, ringClient } from "@/lib/server";
import { fallbackDescription } from "@/lib/describe";

export const dynamic = "force-dynamic";

function validZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** The caregiver's summary for one local day. Demo mode uses a sample day. */
export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const tz = p.get("tz") && validZone(p.get("tz")!) ? p.get("tz")! : "UTC";
  const date = /^\d{4}-\d{2}-\d{2}$/.test(p.get("date") ?? "") ? p.get("date")! : localDate(Date.now(), tz);
  const client = ringClient();

  if (!client) {
    const items: DigestItem[] = sampleDay(date, tz).map((e) => {
      const d = demoDescription(e.demoImage!, e.ringKind);
      return { id: e.id, at: e.at, kind: resolveKind(e.ringKind, d), ringKind: e.ringKind, caption: d.caption };
    });
    return NextResponse.json({ mode: "demo", digest: buildDigest(items, date, tz), items });
  }
  try {
    const { events } = await liveEvents(client);
    const items: DigestItem[] = events.map((e) => {
      const d = cachedDescription(e.deviceId, e.at) ?? fallbackDescription(e.ringKind);
      return { id: e.id, at: e.at, kind: resolveKind(e.ringKind, d), ringKind: e.ringKind, caption: d.caption };
    });
    return NextResponse.json({ mode: "live", digest: buildDigest(items, date, tz), items: items.filter((i) => localDate(i.at, tz) === date) });
  } catch {
    return NextResponse.json({ error: "Ring did not answer." }, { status: 502 });
  }
}
