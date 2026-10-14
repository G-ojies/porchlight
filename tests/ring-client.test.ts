import { test } from "node:test";
import assert from "node:assert/strict";
import { RingClient, RingApiError, parseHistory, snapshotBody } from "../src/lib/ring";

type Call = { url: string; init?: RequestInit };

function fakeFetch(handler: (url: string, init?: RequestInit) => Response) {
  const calls: Call[] = [];
  const fn = async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return handler(url, init);
  };
  return { fn, calls };
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

test("listDevices joins included status into each device", async () => {
  const { fn, calls } = fakeFetch(() =>
    json({
      data: [
        { type: "devices", id: "dev1", attributes: { name: "Front Door" }, relationships: { status: { data: { type: "device-status", id: "s1" } } } },
        { type: "devices", id: "dev2", attributes: {}, relationships: {} },
      ],
      included: [{ type: "device-status", id: "s1", attributes: { online: false } }],
    }),
  );
  const devices = await new RingClient({ token: "tok", fetch: fn }).listDevices();
  assert.deepEqual(devices, [
    { id: "dev1", name: "Front Door", imageUrl: null, online: false },
    { id: "dev2", name: "Ring device", imageUrl: null, online: null },
  ]);
  assert.equal(calls[0].url, "https://api.amazonvision.com/v1/devices?include=status");
  assert.equal((calls[0].init?.headers as Record<string, string>).Authorization, "Bearer tok");
});

test("history encodes event type filters and follows next links as given", async () => {
  const { fn, calls } = fakeFetch(() => json({ data: [], links: { next: "/v1/history/devices/d/events?page[key]=2025-07-06T11:11:00Z" } }));
  const c = new RingClient({ token: async () => "fresh", fetch: fn });
  const page = await c.history("d", { eventTypes: ["ding", "motion.human"] });
  assert.equal(calls[0].url, "https://api.amazonvision.com/v1/history/devices/d/events?event_types=ding%2Cmotion.human");
  await c.history("d", { next: page.next });
  assert.equal(calls[1].url, "https://api.amazonvision.com/v1/history/devices/d/events?page[key]=2025-07-06T11:11:00Z");
  assert.equal((calls[1].init?.headers as Record<string, string>).Authorization, "Bearer fresh");
});

test("parseHistory splits composite types and keeps unknown subtypes", () => {
  const page = parseHistory({
    data: [
      { type: "history-events", id: "e1", attributes: { event_type: "motion.vehicle", start: 10, end: 20, is_third_party_reviewed: true }, relationships: { source: { data: { type: "devices", id: "d" } } } },
      { type: "history-events", id: "e2", attributes: { event_type: "ding", start: 5 } },
    ],
  });
  assert.deepEqual(page.events[0], { id: "e1", deviceId: "d", type: "motion", subType: "vehicle", start: 10, end: 20, reviewed: true });
  assert.equal(page.events[1].subType, null);
  assert.equal(page.events[1].end, null);
  assert.equal(page.next, null);
});

test("snapshot follows the 303 to the pre-signed URL without the bearer token", async () => {
  const { fn, calls } = fakeFetch((url) =>
    url.startsWith("https://download")
      ? new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "image/jpeg", "x-media-timestamp": "1699457230000", "x-media-origin": "recording" } })
      : new Response(null, { status: 303, headers: { location: "https://download-eu.example/v1/download?security_token=x" } }),
  );
  const snap = await new RingClient({ token: "tok", fetch: fn }).snapshot("d 1", { type: "at_timestamp", timestamp: 1699457230000 }, { format: "jpeg", width: 640, height: 360 });
  assert.deepEqual([...snap.bytes], [1, 2, 3]);
  assert.equal(snap.timestamp, 1699457230000);
  assert.equal(snap.origin, "recording");
  assert.equal(calls[0].url, "https://api.amazonvision.com/v1/devices/d%201/media/image/download");
  assert.equal(calls[0].init?.redirect, "manual");
  assert.deepEqual(JSON.parse(String(calls[0].init?.body)), { type: "at_timestamp", timestamp: 1699457230000, image_options: { format: "jpeg", resolution: { width: 640, height: 360 } } });
  assert.equal(calls[1].init, undefined, "pre-signed GET must not carry Authorization");
});

test("snapshotBody builds latest_in_range with one camera component as a string", () => {
  assert.deepEqual(snapshotBody({ type: "latest_in_range", startTimestamp: 1, endTimestamp: 2 }, { componentId: "1" }), {
    type: "latest_in_range",
    start_timestamp: 1,
    end_timestamp: 2,
    components: [{ component_id: "1" }],
  });
});

test("API errors carry status, code and request id", async () => {
  const { fn } = fakeFetch(() => json({ errors: [{ code: "UNAUTHORIZED", detail: "token expired" }] }, 401, { "x-request-id": "r1" }));
  await assert.rejects(new RingClient({ token: "t", fetch: fn }).listDevices(), (e: unknown) => {
    assert.ok(e instanceof RingApiError);
    assert.equal(e.status, 401);
    assert.equal(e.code, "UNAUTHORIZED");
    assert.equal(e.requestId, "r1");
    assert.match(e.message, /token expired/);
    return true;
  });
});
