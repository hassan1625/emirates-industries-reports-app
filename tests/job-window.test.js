import { test } from "node:test";
import assert from "node:assert/strict";
import { jobWindow } from "../app/pipeline/job-window.js";
import { EXPORTS, STAGES, STAGE_INFO, exportOfStage, exportSequence, firstExport, nextExport } from "../app/pipeline/job-stages.js";

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
  assert.deepEqual(exportSequence("generalSales"), ["orders", "events", "products"]);
  assert.deepEqual(exportSequence("refundCredit"), ["orders", "events", "products"]);
  assert.deepEqual(exportSequence("stockByLocation"), ["products", "inventory"]);
  assert.equal(firstExport("generalSales"), "orders");
  assert.equal(firstExport("stockByLocation"), "products");
  assert.equal(nextExport("generalSales", "events"), "products");
  assert.equal(nextExport("generalSales", "products"), undefined);
  assert.equal(nextExport("stockByLocation", "products"), "inventory");
  assert.equal(nextExport("stockByLocation", "inventory"), undefined);
  assert.equal(exportOfStage(STAGES.PRODUCTS_READY), "products");
  assert.equal(exportOfStage(STAGES.INVENTORY_RUNNING), "inventory");
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

test("a comparison job carries its two periods, so the export skips the gap between them", () => {
  const previous = { from: "2025-10-10", to: "2025-11-08", start: "2025-10-09T20:00:00.000Z", end: "2025-11-08T19:59:59.000Z" };
  const current = { from: "2026-10-10", to: "2026-11-08", start: "2026-10-09T20:00:00.000Z", end: "2026-11-08T19:59:59.000Z" };
  const job = { params: JSON.stringify({ range: { start: previous.start, end: current.end }, periods: { previous, current }, cutoff: "2026-11-08T10:00:00.000Z" }), createdAt: new Date() };
  assert.deepEqual(jobWindow(job), { start: previous.start, cutoff: "2026-11-08T10:00:00.000Z", periods: [{ start: previous.start, end: previous.end }, { start: current.start, end: current.end }] });
});
