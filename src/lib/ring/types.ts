/**
 * Types for the Ring Partner API (api.amazonvision.com), written from the
 * public documentation at developer.amazon.com/docs/ring/api-documentation.html.
 * Only the fields this kit reads are typed; everything else stays on `raw`.
 */

export interface RingDevice {
  id: string;
  name: string;
  imageUrl: string | null;
  online: boolean | null;
}

/** History event types. `motion` events may carry a subtype (motion.human, ...). */
export type HistoryEventType = "motion" | "ding" | "on_demand" | (string & {});

export interface HistoryEvent {
  id: string;
  deviceId: string;
  type: HistoryEventType;
  /** Present only when the API reports one, e.g. "human" for motion.human. */
  subType: string | null;
  start: number;
  end: number | null;
  reviewed: boolean;
}

export interface HistoryPage {
  events: HistoryEvent[];
  /** Relative URL of the next (older) page, or null when there is none. */
  next: string | null;
}

export type SnapshotRequest =
  | { type: "at_timestamp"; timestamp: number }
  | { type: "latest_in_range"; startTimestamp: number; endTimestamp?: number };

export interface SnapshotOptions {
  format?: "jpeg" | "png";
  width?: number;
  height?: number;
  /** Camera module on a multi-camera device such as Ring Elite. */
  componentId?: string;
}

export interface Snapshot {
  bytes: Uint8Array;
  contentType: string;
  /** Epoch ms of the captured frame, from X-Media-Timestamp. */
  timestamp: number | null;
  /** "recording" (frame from video) or "snapshot" (stored still). */
  origin: string | null;
}

/** Webhook event types documented for payload v1.1. */
export type WebhookEventType =
  | "motion_detected"
  | "button_press"
  | "device_added"
  | "device_removed"
  | "device_online"
  | "device_offline"
  | "app_integration_added"
  | "app_integration_removed"
  | (string & {});

export interface WebhookEvent {
  requestId: string;
  accountId: string | null;
  eventId: string;
  type: WebhookEventType;
  deviceId: string | null;
  timestamp: number;
  subType: string | null;
  componentIds: string[];
}

export class RingApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string | null,
    readonly requestId: string | null,
  ) {
    super(message);
    this.name = "RingApiError";
  }
}
