import { test } from "node:test";
import assert from "node:assert/strict";
import { jobWindow } from "../app/pipeline/job-window.js";
import { EXPORTS, NEXT_EXPORT, STAGES, STAGE_INFO, exportOfStage } from "../app/pipeline/job-stages.js";

test("the window is the range start up to the recorded cutoff", () => {
  const job = { params: JSON.stringify({ range: { start: "2026-08-01T00:00:00.000Z" }, cutoff: "2026-10-12T10:00:00.000Z" }), createdAt: new Date("2026-10-12T09:00:00Z") };
  assert.deepEqual(jobWindow(job), { start: "2026-08-01T00:00:00.000Z", cutoff: "2026-10-12T10:00:00.000Z" });
});

test("jobs created before the cutoff was recorded fall back to their creation time", () => {
  const job = { params: JSON.stringify({ range: { start: "2026-08-01T00:00:00.000Z" } }), createdAt: new Date("2026-10-12T09:00:00Z") };
  assert.equal(jobWindow(job).cutoff, "2026-10-12T09:00:00.000Z");
});

test("a job without a range is refused", () => {
  assert.throws(() => jobWindow({ params: "{}", createdAt: new Date() }), /no date range/);
});

test("the exports run in order and every stage is described", () => {
  assert.deepEqual(EXPORTS, ["orders", "events", "products"]);
  assert.deepEqual(NEXT_EXPORT, { orders: "events", events: "products" });
  for (const stage of Object.values(STAGES)) assert.ok(STAGE_INFO[stage], stage);
  assert.equal(exportOfStage(STAGES.EVENTS_DOWNLOADING), "events");
  assert.equal(exportOfStage(STAGES.EVENTS_READY), "events");
  assert.equal(exportOfStage(STAGES.DATA_READY), null);
});

test("every export the chain runs has a file location", async () => {
  const { jobFilePath } = await import("../app/pipeline/storage.js");
  for (const name of EXPORTS) assert.match(jobFilePath("job1", name), new RegExp(`job1[/\\\\]${name}\\.jsonl$`));
  assert.throws(() => jobFilePath("job1", "nope"), /Unknown export/);
});
