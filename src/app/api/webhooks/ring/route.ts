import { NextRequest, NextResponse } from "next/server";
import { fromWebhook } from "@/lib/door-event";
import { DeliveryDeduper, parseWebhook, verifyWebhookSignature } from "@/lib/ring";
import { rememberWebhookEvent } from "@/lib/server";

export const dynamic = "force-dynamic";

const deduper = new DeliveryDeduper();

/**
 * Ring webhook receiver (for a registered Ring app). Verifies X-Signature over
 * the raw body before reading it, drops retried deliveries, answers fast.
 */
export async function POST(req: NextRequest) {
  const key = process.env.RING_WEBHOOK_SIGNING_KEY;
  if (!key) return NextResponse.json({ error: "webhooks are not configured" }, { status: 503 });
  const raw = await req.text();
  if (!verifyWebhookSignature(key, raw, req.headers.get("x-signature"))) return NextResponse.json({ error: "bad signature" }, { status: 401 });
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }
  const event = parseWebhook(payload);
  if (!event) return NextResponse.json({ error: "not a Ring webhook" }, { status: 400 });
  if (!deduper.firstTime(event.requestId)) return NextResponse.json({ status: "duplicate" });
  const door = fromWebhook(event, "Ring device");
  if (door) rememberWebhookEvent(door);
  return NextResponse.json({ status: "ok" });
}
