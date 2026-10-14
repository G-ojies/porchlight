import { test } from "node:test";
import assert from "node:assert/strict";
import { DeliveryDeduper, parseWebhook, signWebhookBody, verifyWebhookSignature } from "../src/lib/ring";
import { fromWebhook, kindFromRing, mergeEvents, type DoorEvent } from "../src/lib/door-event";

const body = JSON.stringify({
  meta: { version: "1.1", time: "2026-02-13T13:39:57Z", request_id: "req-1", account_id: "ava1.ring.account.X" },
  data: {
    id: "dev_motion_1786715596787",
    type: "motion_detected",
    attributes: { source: "dev", source_type: "devices", timestamp: 1786715596787, sub_type: "package_delivery", component_ids: ["0"] },
  },
});

test("signature verifies over the raw body and rejects tampering", () => {
  const sig = signWebhookBody("key", body);
  assert.ok(verifyWebhookSignature("key", body, sig));
  assert.ok(verifyWebhookSignature("key", body, sig.slice(7)), "bare hex is accepted");
  assert.ok(!verifyWebhookSignature("other", body, sig));
  assert.ok(!verifyWebhookSignature("key", body.replace("package_delivery", "human"), sig));
  assert.ok(!verifyWebhookSignature("key", JSON.stringify(JSON.parse(body), null, 2), sig), "re-serialised JSON must not verify");
  assert.ok(!verifyWebhookSignature("key", body, null));
  assert.ok(!verifyWebhookSignature("key", body, "sha256=zz"));
  assert.ok(!verifyWebhookSignature("", body, sig));
});

test("parseWebhook reads v1.1 attributes including sub_type", () => {
  const e = parseWebhook(JSON.parse(body))!;
  assert.equal(e.requestId, "req-1");
  assert.equal(e.accountId, "ava1.ring.account.X");
  assert.equal(e.deviceId, "dev");
  assert.equal(e.subType, "package_delivery");
  assert.deepEqual(e.componentIds, ["0"]);
  assert.equal(parseWebhook({ hello: 1 }), null);
  assert.equal(parseWebhook(null), null);
});

test("door events come from motion and button presses only", () => {
  const e = parseWebhook(JSON.parse(body))!;
  assert.equal(fromWebhook(e, "Front")!.ringKind, "package");
  assert.equal(fromWebhook({ ...e, type: "device_online" }, "Front"), null);
  assert.equal(kindFromRing("button_press", null), "ding");
  assert.equal(kindFromRing("motion", "human"), "person");
  assert.equal(kindFromRing("motion", "something_new"), "motion");
  assert.equal(kindFromRing("on_demand", null), "live_view");
});

test("deduper lets each delivery through once and forgets the oldest", () => {
  const d = new DeliveryDeduper(2);
  assert.ok(d.firstTime("a"));
  assert.ok(!d.firstTime("a"));
  d.firstTime("b");
  d.firstTime("c");
  assert.ok(d.firstTime("a"), "a was evicted");
});

test("mergeEvents keeps the first copy of an id, newest first", () => {
  const ev = (id: string, at: number, deviceName = "x"): DoorEvent => ({ id, at, deviceId: "d", deviceName, ringKind: "ding", source: "history" });
  const merged = mergeEvents([ev("a", 1, "first"), ev("b", 3)], [ev("a", 1, "second"), ev("c", 2)]);
  assert.deepEqual(merged.map((e) => e.id), ["b", "c", "a"]);
  assert.equal(merged[2].deviceName, "first");
});
