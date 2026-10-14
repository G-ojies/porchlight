import type { DoorEvent, DoorKind } from "./door-event";

/**
 * Demo mode replays frames from real home security cameras, published on
 * Wikimedia Commons under CC BY 3.0 (credited below and on the page). They are
 * not Ring footage: live mode uses the Ring Developer Playground instead.
 */
export interface DemoScene {
  id: string;
  image: string;
  /** What a Ring doorbell would have reported for this moment. */
  ringKind: DoorKind;
  label: string;
  credit: { author: string; title: string; url: string; license: "CC BY 3.0" };
}

const VPD = {
  author: "Vancouver Police Department (vpdonline)",
  title: "Don't Tempt a Thief with Unattended Parcels",
  url: "https://commons.wikimedia.org/wiki/File:Don%27t_Tempt_a_Thief_with_Unattended_Parcels.ogv",
  license: "CC BY 3.0" as const,
};
const DONGAR = {
  author: "DonGar37",
  title: "Package Theft from home",
  url: "https://commons.wikimedia.org/wiki/File:Package_Theft_from_home.ogv",
  license: "CC BY 3.0" as const,
};
const ENNIS = {
  author: "Brandon Ennis",
  title: "Mail Theft Caught on Camera - Las Vegas",
  url: "https://commons.wikimedia.org/wiki/File:Mail_Theft_Caught_on_Camera_-_Las_Vegas.ogv",
  license: "CC BY 3.0" as const,
};
const FIATAL = {
  author: "Trevor Fiatal",
  title: "Front Porch Theft 2012 11 17 101117",
  url: "https://commons.wikimedia.org/wiki/File:Front_Porch_Theft_2012_11_17_101117.ogv",
  license: "CC BY 3.0" as const,
};
const MCKEAN = {
  author: "Shikha Bhargava",
  title: "Theft@McKean",
  url: "https://commons.wikimedia.org/wiki/File:Theft%40McKean.ogv",
  license: "CC BY 3.0" as const,
};

export const DEMO_SCENES: DemoScene[] = [
  { id: "ding", image: "/demo/person-door.jpg", ringKind: "ding", label: "Doorbell press", credit: VPD },
  { id: "package", image: "/demo/package-door.jpg", ringKind: "package", label: "Package delivery", credit: DONGAR },
  { id: "vehicle", image: "/demo/vehicle-arrives.jpg", ringKind: "vehicle", label: "Vehicle", credit: ENNIS },
  { id: "motion", image: "/demo/person-driveway.jpg", ringKind: "motion", label: "Motion (unclassified)", credit: DONGAR },
  { id: "liveview", image: "/demo/porch-parcels.jpg", ringKind: "live_view", label: "Live view", credit: FIATAL },
  { id: "porch", image: "/demo/person-porch.jpg", ringKind: "motion", label: "Motion on the porch", credit: MCKEAN },
  { id: "carry", image: "/demo/person-parcel.jpg", ringKind: "motion", label: "Someone carrying a box", credit: VPD },
];

export const DEMO_DEVICE = { id: "demo.front-door", name: "Front door (demo)" };

export function sceneById(id: string): DemoScene | undefined {
  return DEMO_SCENES.find((s) => s.id === id);
}

export function demoEvent(scene: DemoScene, at: number): DoorEvent {
  return {
    id: `demo_${scene.id}_${at}`,
    deviceId: DEMO_DEVICE.id,
    deviceName: DEMO_DEVICE.name,
    ringKind: scene.ringKind,
    at,
    source: "demo",
    demoImage: scene.image,
  };
}

/** Local wall-clock times of a sample day, chosen to exercise every digest rule. */
const SAMPLE_DAY: [string, string][] = [
  ["00:47", "porch"],
  ["08:15", "vehicle"],
  ["08:16", "package"],
  ["10:02", "ding"],
  ["10:03", "liveview"],
  ["13:40", "motion"],
  ["16:22", "ding"],
  ["16:24", "carry"],
  ["22:51", "porch"],
];

/**
 * The sample day's events for a local date in a time zone. Times are found by
 * stepping from UTC midnight until the local clock matches, so DST is handled.
 */
export function sampleDay(date: string, timeZone: string): DoorEvent[] {
  return SAMPLE_DAY.map(([hhmm, id]) => {
    const scene = sceneById(id)!;
    return demoEvent(scene, zonedTime(date, hhmm, timeZone));
  }).sort((a, b) => b.at - a.at);
}

export function zonedTime(date: string, hhmm: string, timeZone: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  const guess = Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)), h, m);
  // Offset of the zone at that instant, then correct once more for DST edges.
  let t = guess - offsetMinutes(guess, timeZone) * 60000;
  t = guess - offsetMinutes(t, timeZone) * 60000;
  return t;
}

function offsetMinutes(at: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"));
  return Math.round((asUtc - Math.floor(at / 60000) * 60000) / 60000);
}
