import { test } from "node:test";
import assert from "node:assert/strict";
import { alertFor, takesOverScreen } from "../src/lib/alert";
import { buildDigest, localDate, type DigestItem } from "../src/lib/digest";
import { sampleDay, zonedTime } from "../src/lib/demo";

const TZ = "Africa/Lagos"; // UTC+1, no DST
const at = (hhmm: string) => zonedTime("2026-10-14", hhmm, TZ);
const item = (id: string, hhmm: string, kind: DigestItem["kind"]): DigestItem => ({ id, at: at(hhmm), kind, caption: "c" });

test("zonedTime finds local wall-clock times, including across DST", () => {
  assert.equal(new Date(at("08:15")).toISOString(), "2026-10-14T07:15:00.000Z");
  const london = zonedTime("2026-03-29", "12:00", "Europe/London"); // first day of BST
  assert.equal(new Date(london).toISOString(), "2026-03-29T11:00:00.000Z");
});

test("unanswered doorbell presses are those with no live view within three minutes", () => {
  const d = buildDigest([item("a", "10:00", "ding"), item("b", "10:02", "live_view"), item("c", "16:00", "ding"), item("d", "16:05", "live_view")], "2026-10-14", TZ);
  assert.deepEqual(d.unanswered.map((u) => u.id), ["c"]);
  assert.match(d.notes[0], /rang 1 time with no one checking the door: 16:00/);
  assert.ok(d.notes.some((n) => n === "1 doorbell press answered."));
});

test("a live view answers the doorbell even when its frame shows a package", () => {
  const d = buildDigest([item("a", "10:00", "ding"), { ...item("b", "10:01", "package"), ringKind: "live_view" }], "2026-10-14", TZ);
  assert.equal(d.unanswered.length, 0);
  assert.equal(d.counts.package, undefined);
  assert.equal(d.counts.live_view, 1);
});

test("night events and packages are called out; other days are ignored", () => {
  const items = [item("n", "23:30", "person"), item("p", "09:00", "package"), item("p2", "09:05", "package"), { id: "x", at: at("12:00") + 86400000, kind: "ding" as const, caption: "" }];
  const d = buildDigest(items, "2026-10-14", TZ);
  assert.equal(d.total, 3);
  assert.deepEqual(d.night.map((n) => n.id), ["n"]);
  assert.ok(d.notes.includes("2 packages delivered."));
});

test("an empty day says so, and a long daytime gap is noted", () => {
  assert.deepEqual(buildDigest([], "2026-10-14", TZ).notes, ["No door activity recorded on this day."]);
  const d = buildDigest([item("a", "08:00", "motion"), item("b", "15:30", "motion")], "2026-10-14", TZ);
  assert.equal(d.longestDaytimeQuietMinutes, 450);
  assert.ok(d.notes.some((n) => /quiet stretch of 8 hours/.test(n)));
});

test("the sample day lands on the requested local date and exercises every rule", () => {
  const events = sampleDay("2026-10-14", TZ);
  assert.ok(events.every((e) => localDate(e.at, TZ) === "2026-10-14"));
  const d = buildDigest(events.map((e) => ({ id: e.id, at: e.at, kind: e.ringKind, caption: "" })), "2026-10-14", TZ);
  assert.equal(d.unanswered.length, 1);
  assert.equal(d.night.length, 2);
});

test("alerts: quiet kinds stay in the timeline, people at night become urgent", () => {
  assert.equal(takesOverScreen(alertFor("motion", at("12:00"), TZ)), false);
  assert.equal(takesOverScreen(alertFor("ding", at("12:00"), TZ)), true);
  assert.equal(alertFor("vehicle", at("12:00"), TZ).priority, "notice");
  assert.equal(alertFor("vehicle", at("23:10"), TZ).priority, "urgent");
  assert.ok(alertFor("vehicle", at("23:10"), TZ).flash);
});
