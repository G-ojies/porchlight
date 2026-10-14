import { createHmac, timingSafeEqual } from "node:crypto";
import type { WebhookEvent } from "./types";

/**
 * Verify Ring's X-Signature header: "sha256=<hex HMAC-SHA256 of the raw body>".
 * Pass the body exactly as received; re-serialised JSON will not match.
 */
export function verifyWebhookSignature(signingKey: string, rawBody: string | Uint8Array, header: string | null): boolean {
  if (!signingKey || !header) return false;
  const received = header.startsWith("sha256=") ? header.slice(7) : header;
  if (!/^[0-9a-f]+$/i.test(received)) return false;
  const expected = createHmac("sha256", signingKey).update(rawBody).digest("hex");
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(received.toLowerCase(), "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Build the header value for a body, for tests and local replays. */
export function signWebhookBody(signingKey: string, rawBody: string | Uint8Array): string {
  return `sha256=${createHmac("sha256", signingKey).update(rawBody).digest("hex")}`;
}

/** Parse a v1.1 webhook payload. Returns null when the shape is not a Ring webhook. */
export function parseWebhook(payload: unknown): WebhookEvent | null {
  if (!payload || typeof payload !== "object") return null;
  const { meta, data } = payload as { meta?: Record<string, unknown>; data?: Record<string, unknown> };
  if (!meta || !data || typeof meta.request_id !== "string" || typeof data.type !== "string") return null;
  const attrs = (data.attributes ?? {}) as Record<string, unknown>;
  const ts = typeof attrs.timestamp === "number" ? attrs.timestamp : Date.parse(String(attrs.timestamp ?? meta.time ?? ""));
  return {
    requestId: meta.request_id,
    accountId: typeof meta.account_id === "string" ? meta.account_id : null,
    eventId: typeof data.id === "string" ? data.id : meta.request_id,
    type: data.type,
    deviceId: typeof attrs.source === "string" ? attrs.source : null,
    timestamp: Number.isFinite(ts) ? ts : Date.now(),
    // Ring documents sub_type as open-ended: pass unknown values through.
    subType: typeof attrs.sub_type === "string" ? attrs.sub_type : null,
    componentIds: Array.isArray(attrs.component_ids) ? attrs.component_ids.map(String) : [],
  };
}

/** Remembers recent request ids so retried deliveries are processed once. */
export class DeliveryDeduper {
  private readonly seen = new Set<string>();
  constructor(private readonly max = 1000) {}

  /** True the first time an id is seen. */
  firstTime(id: string): boolean {
    if (this.seen.has(id)) return false;
    this.seen.add(id);
    if (this.seen.size > this.max) {
      const oldest = this.seen.values().next().value;
      if (oldest !== undefined) this.seen.delete(oldest);
    }
    return true;
  }
}
