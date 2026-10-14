import { test } from "node:test";
import assert from "node:assert/strict";
import { describeFrame, fallbackDescription, parseModelReply, resolveKind, retryAfterSeconds } from "../src/lib/describe";

const reply = (o: unknown) => JSON.stringify(o);

test("parseModelReply accepts fenced JSON and tidies the caption", () => {
  const d = parseModelReply("```json\n" + reply({ caption: "A **courier** holds a box", seen: "person", people: 1, package_visible: true, confident: true }) + "\n```")!;
  assert.equal(d.caption, "A courier holds a box.");
  assert.equal(d.by, "model");
  assert.equal(d.packageVisible, true);
});

test("parseModelReply rejects unusable replies", () => {
  assert.equal(parseModelReply("I see a door."), null);
  assert.equal(parseModelReply(reply({ caption: "x", seen: "dragon" })), null);
  assert.equal(parseModelReply("{not json}"), null);
});

test("parseModelReply defaults bad counts instead of failing", () => {
  const d = parseModelReply(reply({ caption: "Empty porch", seen: "unknown", people: "two", package_visible: "yes", confident: false }))!;
  assert.equal(d.people, 0);
  assert.equal(d.packageVisible, false);
});

test("resolveKind: Ring wins when specific, the frame decides when Ring is generic", () => {
  const seen = (s: "person" | "package" | "vehicle" | "unknown", confident = true, packageVisible = false) => ({ caption: "c", seen: s, people: 1, packageVisible, confident, by: "model" as const });
  assert.equal(resolveKind("ding", seen("vehicle")), "ding");
  assert.equal(resolveKind("live_view", seen("package")), "package");
  assert.equal(resolveKind("motion", seen("person", true, true)), "person", "a person beside a box is still a person");
  assert.equal(resolveKind("package", seen("person", true, true)), "package");
  assert.equal(resolveKind("motion", seen("vehicle", false)), "motion", "unsure frames do not override");
  assert.equal(resolveKind("live_view", seen("unknown")), "live_view");
  assert.equal(resolveKind("vehicle", seen("person")), "person");
  assert.equal(resolveKind("motion", fallbackDescription("motion")), "motion");
  assert.equal(resolveKind("motion", null), "motion");
});

test("retryAfterSeconds reads Groq's wait hint", () => {
  assert.equal(retryAfterSeconds("Please try again in 3.771428571s. Need more"), 3.771428571);
  assert.equal(retryAfterSeconds("try again in 1m2.5s"), 62.5);
  assert.equal(retryAfterSeconds("nothing"), null);
});

test("describeFrame retries once after a short rate limit, then returns the model's reading", async () => {
  let n = 0;
  const fetch = async () => {
    n++;
    if (n === 1) return new Response('{"error":{"message":"Please try again in 0.01s."}}', { status: 429 });
    return new Response(JSON.stringify({ choices: [{ message: { content: reply({ caption: "A car parks", seen: "vehicle", people: 0, package_visible: false, confident: true }) } }] }));
  };
  const d = await describeFrame(new Uint8Array([1]), "image/jpeg", "motion", { apiKey: "k", fetch });
  assert.equal(n, 2);
  assert.equal(d.seen, "vehicle");
});

test("describeFrame falls back without a key, on long waits and on errors", async () => {
  assert.equal((await describeFrame(new Uint8Array(), "image/jpeg", "ding", null)).by, "fallback");
  const slow = async () => new Response('{"error":{"message":"Please try again in 50s."}}', { status: 429 });
  const d = await describeFrame(new Uint8Array(), "image/jpeg", "package", { apiKey: "k", fetch: slow });
  assert.deepEqual([d.by, d.caption], ["fallback", "Ring saw a package delivery."]);
  const boom = async (): Promise<Response> => {
    throw new Error("offline");
  };
  assert.equal((await describeFrame(new Uint8Array(), "image/jpeg", "motion", { apiKey: "k", fetch: boom })).by, "fallback");
});

test("the request carries the image as a data URL and the safety prompt", async () => {
  let sent: { messages: { role: string; content: unknown }[] } | null = null;
  const fetch = async (_u: string, init?: RequestInit) => {
    sent = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({ choices: [{ message: { content: "{}" } }] }));
  };
  await describeFrame(new Uint8Array([255, 216]), "image/jpeg", "ding", { apiKey: "k", fetch });
  const s = sent as unknown as { messages: { role: string; content: unknown }[] };
  assert.match(String(s.messages[0].content), /Do not guess who someone is/);
  assert.match(JSON.stringify(s.messages[1].content), /data:image\/jpeg;base64,\/9g=/);
});
