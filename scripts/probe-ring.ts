/** Probe the Ring API with a Playground token: devices, history, one snapshot. Usage: RING_TOKEN_FILE=path npx tsx scripts/probe-ring.ts */
import { readFileSync, writeFileSync } from "node:fs";
import { RingClient } from "../src/lib/ring";

(async () => {
  const token = readFileSync(process.env.RING_TOKEN_FILE!, "utf8").trim();
  const ring = new RingClient({ token });
  const devices = await ring.listDevices();
  console.log("devices", JSON.stringify(devices.map((d) => ({ ...d, id: d.id.slice(0, 24) + "..." }))));
  for (const d of devices) {
    const page = await ring.history(d.id);
    console.log("history", page.events.length, JSON.stringify(page.events.slice(0, 5).map((e) => ({ type: e.type, sub: e.subType, start: new Date(e.start).toISOString(), end: e.end && new Date(e.end).toISOString() }))));
    const e = page.events[0];
    if (e) {
      try {
        const s = await ring.snapshot(d.id, { type: "latest_in_range", startTimestamp: e.start, endTimestamp: e.end ?? e.start + 15000 }, { format: "jpeg", width: 640, height: 360 });
        writeFileSync(process.env.OUT ?? "/tmp/ring-snap.jpg", s.bytes);
        console.log("snapshot", s.contentType, s.bytes.length, s.origin, s.timestamp && new Date(s.timestamp).toISOString());
      } catch (err) {
        console.log("snapshot failed", (err as Error).message);
      }
    }
  }
})().catch((e) => console.error("ERR", e.message, e.status, e.code));
