import type { HistoryEvent, WebhookEvent } from "./ring";

/** What happened at the door, after merging Ring's event type with what the camera frame shows. */
export type DoorKind = "ding" | "person" | "package" | "vehicle" | "animal" | "motion" | "live_view" | "unknown";

export type EventSource = "history" | "webhook" | "demo";

export interface DoorEvent {
  id: string;
  deviceId: string;
  deviceName: string;
  /** What Ring reported, before any image description. */
  ringKind: DoorKind;
  at: number;
  /** End of the event window, when Ring reports one (history only). */
  end?: number | null;
  source: EventSource;
  /** Demo events point at a bundled image instead of a Ring snapshot. */
  demoImage?: string;
}

const MOTION_SUBTYPES: Record<string, DoorKind> = {
  human: "person",
  vehicle: "vehicle",
  package_delivery: "package",
  animal: "animal",
  other_motion: "motion",
  motion: "motion",
};

export function kindFromRing(type: string, subType: string | null): DoorKind {
  switch (type) {
    case "ding":
    case "button_press":
      return "ding";
    case "on_demand":
      return "live_view";
    case "motion":
    case "motion_detected":
      return (subType && MOTION_SUBTYPES[subType]) || "motion";
    default:
      return "unknown";
  }
}

export function fromHistory(e: HistoryEvent, deviceName: string): DoorEvent {
  return {
    id: e.id,
    deviceId: e.deviceId,
    deviceName,
    ringKind: kindFromRing(e.type, e.subType),
    at: e.start,
    end: e.end,
    source: "history",
  };
}

/** Only device events become door events; lifecycle webhooks (device_added, ...) return null. */
export function fromWebhook(e: WebhookEvent, deviceName: string): DoorEvent | null {
  if (!e.deviceId || (e.type !== "motion_detected" && e.type !== "button_press")) return null;
  return {
    id: e.eventId,
    deviceId: e.deviceId,
    deviceName,
    ringKind: kindFromRing(e.type, e.subType),
    at: e.timestamp,
    source: "webhook",
  };
}

/** Newest first, one entry per id (a webhook and its history row share nothing but time, so ids decide). */
export function mergeEvents(...lists: DoorEvent[][]): DoorEvent[] {
  const byId = new Map<string, DoorEvent>();
  for (const list of lists) for (const e of list) if (!byId.has(e.id)) byId.set(e.id, e);
  return [...byId.values()].sort((a, b) => b.at - a.at);
}
