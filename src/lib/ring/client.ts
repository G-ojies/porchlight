import {
  RingApiError,
  type HistoryEvent,
  type HistoryPage,
  type RingDevice,
  type Snapshot,
  type SnapshotOptions,
  type SnapshotRequest,
} from "./types";

export const RING_API_BASE = "https://api.amazonvision.com";

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface RingClientOptions {
  /** Bearer token, or a function that returns a fresh one (for refresh flows). */
  token: string | (() => Promise<string>);
  baseUrl?: string;
  fetch?: FetchLike;
}

interface JsonApiResource {
  type: string;
  id: string;
  attributes?: Record<string, unknown>;
  relationships?: Record<string, { data?: { type: string; id: string } | null }>;
}

/**
 * A small, dependency-free client for the Ring Partner API.
 * Every call is server-to-server: Ring blocks browser requests with CORS.
 */
export class RingClient {
  private readonly base: string;
  private readonly fetcher: FetchLike;

  constructor(private readonly opts: RingClientOptions) {
    this.base = (opts.baseUrl ?? RING_API_BASE).replace(/\/$/, "");
    this.fetcher = opts.fetch ?? ((i, init) => fetch(i, init));
  }

  private async authHeader(): Promise<string> {
    const t = typeof this.opts.token === "function" ? await this.opts.token() : this.opts.token;
    return `Bearer ${t}`;
  }

  private url(path: string): string {
    return path.startsWith("http") ? path : `${this.base}${path.startsWith("/") ? "" : "/"}${path}`;
  }

  private async request(path: string, init: RequestInit = {}): Promise<Response> {
    const res = await this.fetcher(this.url(path), {
      ...init,
      headers: { Authorization: await this.authHeader(), Accept: "application/json", ...(init.headers ?? {}) },
    });
    if (!res.ok && res.status !== 303) throw await toError(res);
    return res;
  }

  private async json<T>(path: string): Promise<T> {
    return (await (await this.request(path)).json()) as T;
  }

  /** GET /v1/devices?include=status — devices shared with this app, with online state. */
  async listDevices(): Promise<RingDevice[]> {
    const body = await this.json<{ data: JsonApiResource[]; included?: JsonApiResource[] }>(
      "/v1/devices?include=status",
    );
    return parseDevices(body);
  }

  /** GET /v1/devices/{id}/status */
  async deviceOnline(deviceId: string): Promise<boolean> {
    const body = await this.json<{ data: JsonApiResource }>(`/v1/devices/${encodeURIComponent(deviceId)}/status`);
    return body.data?.attributes?.online === true;
  }

  /**
   * GET /v1/history/devices/{id}/events, newest first.
   * `eventTypes` accepts the documented composite syntax, e.g. ["ding", "motion.human"].
   * Pass `next` from a previous page to continue.
   */
  async history(deviceId: string, opts: { eventTypes?: string[]; next?: string | null } = {}): Promise<HistoryPage> {
    let path = opts.next ?? `/v1/history/devices/${encodeURIComponent(deviceId)}/events`;
    if (!opts.next && opts.eventTypes?.length) path += `?event_types=${encodeURIComponent(opts.eventTypes.join(","))}`;
    const body = await this.json<{ data: JsonApiResource[]; links?: { next?: string } }>(path);
    return parseHistory(body);
  }

  /**
   * POST /v1/devices/{id}/media/image/download, then follow the 303 to the
   * pre-signed URL. The pre-signed GET carries no Authorization header.
   */
  async snapshot(deviceId: string, req: SnapshotRequest, opts: SnapshotOptions = {}): Promise<Snapshot> {
    const res = await this.request(`/v1/devices/${encodeURIComponent(deviceId)}/media/image/download`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(snapshotBody(req, opts)),
      redirect: "manual",
    });
    let media = res;
    if (res.status === 303 || res.headers.get("location")) {
      const loc = res.headers.get("location");
      if (!loc) throw new RingApiError("Snapshot redirect had no Location header", res.status, null, res.headers.get("x-request-id"));
      media = await this.fetcher(loc);
      if (!media.ok) throw await toError(media);
    }
    return {
      bytes: new Uint8Array(await media.arrayBuffer()),
      contentType: media.headers.get("content-type") ?? "image/jpeg",
      timestamp: numOrNull(media.headers.get("x-media-timestamp")),
      origin: media.headers.get("x-media-origin"),
    };
  }
}

export function snapshotBody(req: SnapshotRequest, opts: SnapshotOptions = {}): Record<string, unknown> {
  const body: Record<string, unknown> =
    req.type === "at_timestamp"
      ? { type: "at_timestamp", timestamp: req.timestamp }
      : {
          type: "latest_in_range",
          start_timestamp: req.startTimestamp,
          ...(req.endTimestamp !== undefined ? { end_timestamp: req.endTimestamp } : {}),
        };
  const image: Record<string, unknown> = {};
  if (opts.format) image.format = opts.format;
  if (opts.width || opts.height) image.resolution = { width: opts.width, height: opts.height };
  if (Object.keys(image).length) body.image_options = image;
  if (opts.componentId !== undefined) body.components = [{ component_id: String(opts.componentId) }];
  return body;
}

export function parseDevices(body: { data?: JsonApiResource[]; included?: JsonApiResource[] }): RingDevice[] {
  const included = new Map((body.included ?? []).map((r) => [`${r.type}:${r.id}`, r]));
  return (body.data ?? []).map((d) => {
    const rel = d.relationships?.status?.data;
    const status = rel ? included.get(`${rel.type}:${rel.id}`) : undefined;
    const online = status?.attributes?.online;
    return {
      id: d.id,
      name: typeof d.attributes?.name === "string" ? d.attributes.name : "Ring device",
      imageUrl: typeof d.attributes?.image_url === "string" ? d.attributes.image_url : null,
      online: typeof online === "boolean" ? online : null,
    };
  });
}

export function parseHistory(body: { data?: JsonApiResource[]; links?: { next?: string } }): HistoryPage {
  const events: HistoryEvent[] = (body.data ?? []).map((e) => {
    const a = e.attributes ?? {};
    const rawType = String(a.event_type ?? "unknown");
    // The API may report a composite "motion.human"; split it so callers see one shape.
    const [type, dotted] = rawType.split(".", 2);
    const sub = typeof a.sub_type === "string" ? a.sub_type : dotted ?? null;
    return {
      id: e.id,
      deviceId: e.relationships?.source?.data?.id ?? "",
      type,
      subType: sub,
      start: Number(a.start),
      end: numOrNull(a.end),
      reviewed: a.is_third_party_reviewed === true,
    };
  });
  return { events, next: body.links?.next ?? null };
}

async function toError(res: Response): Promise<RingApiError> {
  let code: string | null = null;
  let detail = `Ring API ${res.status}`;
  try {
    const body = (await res.json()) as { errors?: { code?: string; detail?: string }[] };
    const e = body.errors?.[0];
    if (e?.code) code = e.code;
    if (e?.detail) detail = `${detail}: ${e.detail}`;
  } catch {
    /* body was not JSON */
  }
  return new RingApiError(detail, res.status, code, res.headers.get("x-request-id"));
}

function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
