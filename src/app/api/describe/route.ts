import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isDoorKind, resolveKind } from "@/lib/describe";
import { DEMO_SCENES } from "@/lib/demo";
import { demoDescription, describeLiveEvent, ringClient } from "@/lib/server";

export const dynamic = "force-dynamic";
// A rate-limited vision call can wait up to ~40 s across retries.
export const maxDuration = 60;

const Body = z.object({
  deviceId: z.string().min(1).max(300),
  at: z.number().int().positive(),
  end: z.number().int().positive().nullish(),
  ringKind: z.string().refine(isDoorKind),
  demoImage: z.string().max(100).nullish(),
});

/** Read the event's frame and decide what to tell the person. */
export async function POST(req: NextRequest) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "bad request" }, { status: 400 });
  const { deviceId, at, end, demoImage } = parsed.data;
  const ringKind = parsed.data.ringKind as Parameters<typeof resolveKind>[0];

  if (demoImage) {
    if (!DEMO_SCENES.some((s) => s.image === demoImage)) return NextResponse.json({ error: "unknown demo image" }, { status: 400 });
    const description = demoDescription(demoImage, ringKind);
    return NextResponse.json({ description, kind: resolveKind(ringKind, description) });
  }
  const client = ringClient();
  if (!client) return NextResponse.json({ error: "Connect a Ring token first." }, { status: 401 });
  return NextResponse.json(await describeLiveEvent(client, deviceId, at, ringKind, end));
}
