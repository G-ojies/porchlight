import { hourIn, isNight } from "./alert";
import type { DoorKind } from "./door-event";

/** One event as the digest sees it: the final kind after the frame was read. */
export interface DigestItem {
  id: string;
  at: number;
  /** Final kind after the frame was read. */
  kind: DoorKind;
  /** What Ring reported. A live view stays a live view (someone checked the door) whatever the frame showed. */
  ringKind?: DoorKind;
  caption: string;
}

/** The kind the digest counts: live views are always live views. */
export function digestKind(i: DigestItem): DoorKind {
  return i.ringKind === "live_view" ? "live_view" : i.kind;
}

export interface Digest {
  date: string;
  total: number;
  counts: Partial<Record<DoorKind, number>>;
  first: number | null;
  last: number | null;
  /** Events between 22:00 and 06:00 local time. */
  night: DigestItem[];
  /** Doorbell presses with no live view opened within the answer window. */
  unanswered: DigestItem[];
  /** Longest gap with no activity between 07:00 and 21:00, in minutes. */
  longestDaytimeQuietMinutes: number;
  /** Plain sentences for the caregiver, most important first. */
  notes: string[];
}

export const ANSWER_WINDOW_MS = 3 * 60 * 1000;

/** YYYY-MM-DD of a timestamp in a time zone. */
export function localDate(at: number, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
}

export function timeLabel(at: number, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(at);
}

/**
 * Build a caregiver's summary of one local day. Deterministic on purpose:
 * no model writes the numbers a caregiver acts on.
 */
export function buildDigest(items: DigestItem[], date: string, timeZone: string): Digest {
  const day = items.filter((i) => localDate(i.at, timeZone) === date).sort((a, b) => a.at - b.at);
  const counts: Partial<Record<DoorKind, number>> = {};
  for (const i of day) counts[digestKind(i)] = (counts[digestKind(i)] ?? 0) + 1;

  const liveViews = day.filter((i) => digestKind(i) === "live_view").map((i) => i.at);
  const unanswered = day.filter(
    (i) => digestKind(i) === "ding" && !liveViews.some((t) => t >= i.at && t - i.at <= ANSWER_WINDOW_MS),
  );
  const night = day.filter((i) => digestKind(i) !== "live_view" && isNight(i.at, timeZone));

  const daytime = day.filter((i) => {
    const h = hourIn(i.at, timeZone);
    return h >= 7 && h < 21 && digestKind(i) !== "live_view";
  });
  let longest = 0;
  for (let k = 1; k < daytime.length; k++) longest = Math.max(longest, daytime[k].at - daytime[k - 1].at);

  const notes: string[] = [];
  if (unanswered.length)
    notes.push(
      `The doorbell rang ${plural(unanswered.length, "time")} with no one checking the door: ${unanswered.map((u) => timeLabel(u.at, timeZone)).join(", ")}.`,
    );
  if (night.length)
    notes.push(`${plural(night.length, "event")} at night (22:00 to 06:00): ${night.map((n) => `${timeLabel(n.at, timeZone)} ${n.kind.replace("_", " ")}`).join(", ")}.`);
  if (counts.package) notes.push(`${plural(counts.package, "package")} delivered.`);
  if (counts.ding && counts.ding > unanswered.length) notes.push(`${plural(counts.ding - unanswered.length, "doorbell press", "doorbell presses")} answered.`);
  if (day.length === 0) notes.push("No door activity recorded on this day.");
  else if (longest >= 6 * 60 * 60 * 1000) notes.push(`A quiet stretch of ${Math.round(longest / 3600000)} hours during the day.`);

  return {
    date,
    total: day.length,
    counts,
    first: day[0]?.at ?? null,
    last: day[day.length - 1]?.at ?? null,
    night,
    unanswered,
    longestDaytimeQuietMinutes: Math.round(longest / 60000),
    notes,
  };
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}
