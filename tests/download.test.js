import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createDownloadPath, verifyDownload, DOWNLOAD_LINK_TTL_MS } from "../app/pipeline/download-token.js";
import { describeReportFile, formatBytes, reportFileName } from "../app/pipeline/report-file.js";
import { listRecentJobs } from "../app/pipeline/recent-jobs.js";

const SECRET = "test-secret";
const NOW = 1_800_000_000_000;
const query = (path) => Object.fromEntries(new URL(path, "https://app.test").searchParams);

describe("signed download links", () => {
  test("a fresh link verifies for its own job", () => {
    const path = createDownloadPath({ jobId: "job1", secret: SECRET, now: NOW });
    assert.match(path, /^\/download\/report\/job1\?expires=\d+&sig=[0-9a-f]{64}$/);
    const { expires, sig } = query(path);
    assert.equal(verifyDownload({ jobId: "job1", expires, sig, secret: SECRET, now: NOW + 1000 }), true);
  });

  test("it stops working after the lifetime", () => {
    const { expires, sig } = query(createDownloadPath({ jobId: "job1", secret: SECRET, now: NOW }));
    assert.equal(verifyDownload({ jobId: "job1", expires, sig, secret: SECRET, now: NOW + DOWNLOAD_LINK_TTL_MS - 1 }), true);
    assert.equal(verifyDownload({ jobId: "job1", expires, sig, secret: SECRET, now: NOW + DOWNLOAD_LINK_TTL_MS + 1 }), false);
  });

  test("it cannot be used for another job, with another secret, or with the expiry changed", () => {
    const { expires, sig } = query(createDownloadPath({ jobId: "job1", secret: SECRET, now: NOW }));
    assert.equal(verifyDownload({ jobId: "job2", expires, sig, secret: SECRET, now: NOW }), false);
    assert.equal(verifyDownload({ jobId: "job1", expires, sig, secret: "other", now: NOW }), false);
    assert.equal(verifyDownload({ jobId: "job1", expires: Number(expires) + 60_000, sig, secret: SECRET, now: NOW }), false);
  });

  test("missing or malformed parts are refused, not thrown on", () => {
    assert.equal(verifyDownload({ jobId: "job1", expires: "soon", sig: "x", secret: SECRET }), false);
    assert.equal(verifyDownload({ jobId: "job1", expires: String(NOW + 1000), sig: "short", secret: SECRET, now: NOW }), false);
    assert.equal(verifyDownload({ jobId: "job1", expires: String(NOW + 1000), sig: null, secret: SECRET, now: NOW }), false);
    assert.equal(verifyDownload({ jobId: "job1", expires: String(NOW + 1000), sig: "a".repeat(64), secret: "", now: NOW }), false);
  });

  test("a link cannot be made without a secret", () => {
    assert.throws(() => createDownloadPath({ jobId: "job1", secret: "" }), /secret/);
  });
});

describe("file names and sizes", () => {
  const job = { reportType: "generalSales", params: JSON.stringify({ reportKey: "generalSales", localRange: { from: "2026-10-05", to: "2026-10-11" } }) };

  test("the name carries the report and the period", () => {
    assert.equal(reportFileName(job), "General-Sales-Report_2026-10-05_to_2026-10-11.xlsx");
  });

  test("a job with no recorded period or an unknown report still gets a safe name", () => {
    assert.equal(reportFileName({ reportType: "generalSales", params: "{}" }), "General-Sales-Report.xlsx");
    assert.equal(reportFileName({ reportType: "nope", params: "not json" }), "Report.xlsx");
  });

  test("only a READY job with a file is described", () => {
    assert.deepEqual(describeReportFile({ ...job, stage: "READY", resultFileUrl: "local:jobs/j/report.xlsx", resultBytes: 2048, resultRows: 12 }), { name: "General-Sales-Report_2026-10-05_to_2026-10-11.xlsx", bytes: 2048, rows: 12 });
    assert.equal(describeReportFile({ ...job, stage: "GENERATING", resultFileUrl: null }), null);
    assert.equal(describeReportFile({ ...job, stage: "READY", resultFileUrl: null }), null);
  });

  test("sizes read naturally", () => {
    assert.equal(formatBytes(512), "512 B");
    assert.equal(formatBytes(141_206), "138 KB");
    assert.equal(formatBytes(22_872_652), "21.8 MB");
    assert.equal(formatBytes(null), "");
  });
});

describe("recent reports", () => {
  const rows = [
    { id: "a", shop: "s", reportType: "generalSales", stage: "READY", createdAt: new Date("2026-10-13T10:00:00Z"), params: JSON.stringify({ reportKey: "generalSales", localRange: { from: "2026-10-05", to: "2026-10-11" }, filters: { posStaff: ["Sara"] } }), resultFileUrl: "local:x", resultBytes: 1024, resultRows: 7, error: null },
    { id: "b", shop: "s", reportType: "generalSales", stage: "FAILED", createdAt: new Date("2026-10-12T10:00:00Z"), params: "{}", resultFileUrl: null, error: "Shopify said no" },
    { id: "c", shop: "s", reportType: "generalSales", stage: "EVENTS_RUNNING", createdAt: new Date("2026-10-11T10:00:00Z"), params: "{}", resultFileUrl: null, error: null },
  ];
  const fakeDb = { reportJob: { findMany: async (args) => { fakeDb.args = args; return rows; } } };

  test("asks for this shop's latest jobs of the report", async () => {
    await listRecentJobs({ db: fakeDb, shop: "s", reportType: "generalSales", limit: 5 });
    assert.deepEqual(fakeDb.args, { where: { shop: "s", reportType: "generalSales" }, orderBy: { createdAt: "desc" }, take: 5 });
  });

  test("each job says what it was, how it ended and what file it has", async () => {
    const [ready, failed, running] = await listRecentJobs({ db: fakeDb, shop: "s", reportType: "generalSales" });
    assert.deepEqual(ready.range, { from: "2026-10-05", to: "2026-10-11" });
    assert.equal(ready.filterCount, 1);
    assert.equal(ready.file.rows, 7);
    assert.equal(ready.terminal, true);
    assert.equal(failed.error, "Shopify said no");
    assert.equal(failed.file, null);
    assert.equal(running.terminal, false);
    assert.equal(running.label, "Collecting returns and exchanges");
    assert.equal(running.error, null);
  });
});
