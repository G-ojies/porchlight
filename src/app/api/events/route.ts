import { NextResponse } from "next/server";
import { DEMO_DEVICE } from "@/lib/demo";
import { RingApiError } from "@/lib/ring";
import { liveEvents, ringClient } from "@/lib/server";

export const dynamic = "force-dynamic";

/** Live mode: the Ring account's devices and newest events. Demo mode: the demo device, no events (the page adds them). */
export async function GET() {
  const client = ringClient();
  if (!client) return NextResponse.json({ mode: "demo", devices: [{ ...DEMO_DEVICE, online: true, imageUrl: null }], events: [] });
  try {
    const { devices, events } = await liveEvents(client);
    return NextResponse.json({ mode: "live", devices, events });
  } catch (e) {
    const status = e instanceof RingApiError ? e.status : 502;
    const expired = status === 401 || status === 403;
    return NextResponse.json(
      { mode: "live", error: expired ? "Your Ring token has expired. Paste a fresh one from the Playground." : "Ring did not answer. Trying again shortly." , expired },
      { status: expired ? 401 : 502 },
    );
  }
}
