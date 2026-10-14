import "server-only";
import { cookies } from "next/headers";
import demoCaptions from "./demo-captions.json";
import { describeFrame, fallbackDescription, resolveKind, type FrameDescription } from "./describe";
import { fromHistory, type DoorEvent, type DoorKind } from "./door-event";
import { RingClient, type RingDevice } from "./ring";

export const TOKEN_COOKIE = "pl_ring";
/** Playground tokens last about 30 minutes; the cookie never outlives that. */
export const TOKEN_MAX_AGE = 30 * 60;

export function ringToken(): string | null {
  return cookies().get(TOKEN_COOKIE)?.value || process.env.RING_ACCESS_TOKEN || null;
}

export function ringClient(token = ringToken()): RingClient | null {
  return token ? new RingClient({ token }) : null;
}

export function visionConfig() {
  const apiKey = process.env.GROQ_API_KEY;
  return apiKey ? { apiKey, model: process.env.VISION_MODEL || undefined } : null;
}

/** Small insertion-ordered cache; old entries fall out first. */
class Lru<V> {
  private readonly map = new Map<string, V>();
  constructor(private readonly max: number) {}
  get(k: string): V | undefined {
    return this.map.get(k);
  }
  set(k: string, v: V): void {
    this.map.delete(k);
    this.map.set(k, v);
    if (this.map.size > this.max) this.map.delete(this.map.keys().next().value as string);
  }
}

const descriptions = new Lru<FrameDescription>(500);
const snapshots = new Lru<{ bytes: Uint8Array; contentType: string }>(40);
/** Webhook deliveries received by this instance, newest last. */
export const webhookEvents: DoorEvent[] = [];

export function rememberWebhookEvent(e: DoorEvent): void {
  webhookEvents.push(e);
  if (webhookEvents.length > 200) webhookEvents.shift();
}

const key = (deviceId: string, at: number) => `${deviceId}:${at}`;

export function cachedDescription(deviceId: string, at: number): FrameDescription | undefined {
  return descriptions.get(key(deviceId, at));
}

const baked = demoCaptions as Record<string, FrameDescription>;

export function demoDescription(image: string, ringKind: DoorKind): FrameDescription {
  return baked[image] ?? fallbackDescription(ringKind);
}

/** Devices plus their newest history page, merged newest first. */
export async function liveEvents(client: RingClient): Promise<{ devices: RingDevice[]; events: DoorEvent[] }> {
  const devices = (await client.listDevices()).slice(0, 4);
  const pages = await Promise.all(
    devices.map((d) => client.history(d.id).then((p) => p.events.map((e) => fromHistory({ ...e, deviceId: e.deviceId || d.id }, d.name)))),
  );
  const names = new Map(devices.map((d) => [d.id, d.name]));
  const hooks = webhookEvents.filter((e) => names.has(e.deviceId));
  const all = [...pages.flat(), ...hooks].sort((a, b) => b.at - a.at);
  return { devices, events: all.slice(0, 60) };
}

/**
 * The frame for an event. Doorbell presses and motion use the moment just after
 * the event starts; live views (all the Playground produces) use the newest
 * frame in the session window.
 */
export async function eventSnapshot(
  client: RingClient,
  deviceId: string,
  at: number,
  ringKind: DoorKind,
  end?: number | null,
): Promise<{ bytes: Uint8Array; contentType: string }> {
  const k = key(deviceId, at);
  const hit = snapshots.get(k);
  if (hit) return hit;
  const opts = { format: "jpeg" as const, width: 640, height: 360 };
  const inRange = { type: "latest_in_range" as const, startTimestamp: at, endTimestamp: Math.min(end ?? at + 15000, Date.now()) };
  const atTime = { type: "at_timestamp" as const, timestamp: Math.min(at + 1500, Date.now()) };
  const [first, second] = ringKind === "live_view" ? [inRange, atTime] : [atTime, inRange];
  let snap;
  try {
    snap = await client.snapshot(deviceId, first, opts);
  } catch {
    snap = await client.snapshot(deviceId, second, opts);
  }
  const v = { bytes: snap.bytes, contentType: snap.contentType };
  snapshots.set(k, v);
  return v;
}

export async function describeLiveEvent(
  client: RingClient,
  deviceId: string,
  at: number,
  ringKind: DoorKind,
  end?: number | null,
): Promise<{ description: FrameDescription; kind: DoorKind }> {
  const k = key(deviceId, at);
  let d = descriptions.get(k);
  if (!d) {
    try {
      const snap = await eventSnapshot(client, deviceId, at, ringKind, end);
      d = await describeFrame(snap.bytes, snap.contentType, ringKind, visionConfig());
    } catch {
      d = fallbackDescription(ringKind);
    }
    // Do not pin a fallback: a later poll may get past a rate limit.
    if (d.by === "model") descriptions.set(k, d);
  }
  return { description: d, kind: resolveKind(ringKind, d) };
}
