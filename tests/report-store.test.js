import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAwsS3, createReportStore, parseS3Url, toS3Url, S3_LINK_TTL_SECONDS } from "../app/pipeline/report-store.js";
import { toLocalUrl } from "../app/pipeline/storage.js";
import { removeWorkFiles, shouldKeepWorkFiles } from "../app/pipeline/work-files.js";
import { expireOldReports, retentionDays, DEFAULT_RETENTION_DAYS } from "../app/pipeline/retention.js";
import { STAGES } from "../app/pipeline/job-stages.js";

const fakeS3 = () => {
  const calls = { upload: [], presign: [], remove: [] };
  return {
    calls,
    upload: async (args) => calls.upload.push(args),
    presign: async (args) => { calls.presign.push(args); return `https://${args.bucket}.s3.example/${args.key}?signature=abc`; },
    remove: async (args) => calls.remove.push(args),
  };
};
const job = { id: "job1", reportType: "generalSales", params: JSON.stringify({ reportKey: "generalSales", localRange: { from: "2026-10-05", to: "2026-10-11" } }) };

describe("S3 locations", () => {
  test("round-trip, and anything else is not an S3 location", () => {
    assert.deepEqual(parseS3Url(toS3Url("my-bucket", "reports/job1/a.xlsx")), { bucket: "my-bucket", key: "reports/job1/a.xlsx" });
    assert.equal(parseS3Url("local:jobs/job1/report.xlsx"), null);
    assert.equal(parseS3Url(null), null);
  });
});

describe("local mode (no bucket configured)", () => {
  let dir;
  const original = process.env.REPORT_STORAGE_DIR;
  before(async () => { dir = await mkdtemp(join(tmpdir(), "store-")); process.env.REPORT_STORAGE_DIR = dir; });
  after(async () => { if (original === undefined) delete process.env.REPORT_STORAGE_DIR; else process.env.REPORT_STORAGE_DIR = original; await rm(dir, { recursive: true, force: true }); });

  test("the file stays where it is and is recorded as a local location", async () => {
    const store = createReportStore({ env: {} });
    assert.equal(store.mode, "local");
    const path = join(dir, "jobs", "job1", "report.xlsx");
    assert.equal(await store.save({ jobId: "job1", localPath: path, fileName: "x.xlsx" }), "local:jobs/job1/report.xlsx");
  });

  test("a download link is the app's own signed link", async () => {
    const store = createReportStore({ env: {} });
    const { url } = await store.downloadLink({ job: { ...job, resultFileUrl: "local:jobs/job1/report.xlsx" }, secret: "s", now: 1000 });
    assert.match(url, /^\/download\/report\/job1\?expires=\d+&sig=[0-9a-f]{64}$/);
  });

  test("a job with no stored file has no link", async () => {
    await assert.rejects(createReportStore({ env: {} }).downloadLink({ job: { ...job, resultFileUrl: null }, secret: "s" }), /not available/);
  });

  test("remove deletes a local report and tolerates a missing one", async () => {
    const store = createReportStore({ env: {} });
    const path = join(dir, "jobs", "job9", "report.xlsx");
    await rm(join(dir, "jobs", "job9"), { recursive: true, force: true });
    await import("node:fs/promises").then(({ mkdir }) => mkdir(join(dir, "jobs", "job9"), { recursive: true }));
    await writeFile(path, "x");
    await store.remove(toLocalUrl(path));
    assert.equal(existsSync(path), false);
    await store.remove(toLocalUrl(path)); // already gone: no error
  });
});

describe("S3 mode (bucket configured)", () => {
  let dir;
  before(async () => { dir = await mkdtemp(join(tmpdir(), "store-s3-")); });
  after(async () => rm(dir, { recursive: true, force: true }));
  const env = { REPORT_S3_BUCKET: "emirates-reports", REPORT_S3_REGION: "me-central-1" };

  test("uploads the finished file, records its S3 location and removes the local copy", async () => {
    const s3 = fakeS3();
    const store = createReportStore({ env, s3 });
    assert.equal(store.mode, "s3");
    const path = join(dir, "report.xlsx");
    await writeFile(path, "data");
    const url = await store.save({ jobId: "job1", localPath: path, fileName: "General-Sales-Report.xlsx" });
    assert.equal(url, "s3://emirates-reports/reports/job1/General-Sales-Report.xlsx");
    assert.equal(s3.calls.upload.length, 1);
    assert.deepEqual({ ...s3.calls.upload[0] }, { bucket: "emirates-reports", key: "reports/job1/General-Sales-Report.xlsx", filePath: path, contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    assert.equal(existsSync(path), false);
  });

  test("a failed upload keeps the local file and reports the error", async () => {
    const s3 = { ...fakeS3(), upload: async () => { throw new Error("AccessDenied"); } };
    const store = createReportStore({ env, s3 });
    const path = join(dir, "keep.xlsx");
    await writeFile(path, "data");
    await assert.rejects(store.save({ jobId: "job2", localPath: path, fileName: "a.xlsx" }), /AccessDenied/);
    assert.equal(existsSync(path), true);
  });

  test("the download link is a short-lived presigned S3 link with the report's file name", async () => {
    const s3 = fakeS3();
    const { url } = await createReportStore({ env, s3 }).downloadLink({ job: { ...job, resultFileUrl: "s3://emirates-reports/reports/job1/a.xlsx" }, secret: "unused" });
    assert.match(url, /^https:\/\/emirates-reports\.s3\.example\/reports\/job1\/a\.xlsx\?signature=/);
    assert.deepEqual(s3.calls.presign, [{ bucket: "emirates-reports", key: "reports/job1/a.xlsx", fileName: "General-Sales-Report_2026-10-05_to_2026-10-11.xlsx", expiresIn: S3_LINK_TTL_SECONDS }]);
    assert.equal(S3_LINK_TTL_SECONDS, 600);
  });

  test("a report saved before S3 was switched on still downloads through the app", async () => {
    const { url } = await createReportStore({ env, s3: fakeS3() }).downloadLink({ job: { ...job, resultFileUrl: "local:jobs/job1/report.xlsx" }, secret: "s" });
    assert.match(url, /^\/download\/report\/job1\?/);
  });

  test("remove deletes the object", async () => {
    const s3 = fakeS3();
    await createReportStore({ env, s3 }).remove("s3://emirates-reports/reports/job1/a.xlsx");
    assert.deepEqual(s3.calls.remove, [{ bucket: "emirates-reports", key: "reports/job1/a.xlsx" }]);
  });
});

describe("the AWS adapter", () => {
  test("loads the SDK only when used, with the region, and streams uploads and presigns downloads", async () => {
    const seen = {};
    class S3Client { constructor(config) { seen.config = config; this.sent = []; } send(command) { seen.sent = command; return Promise.resolve(); } }
    class GetObjectCommand { constructor(input) { this.input = input; } }
    class DeleteObjectCommand { constructor(input) { this.input = input; } }
    class Upload { constructor(args) { seen.upload = args.params; } done() { return Promise.resolve(); } }
    let loads = 0;
    const loader = async () => { loads += 1; return [{ S3Client, GetObjectCommand, DeleteObjectCommand }, { Upload }, { getSignedUrl: async (_c, command, options) => { seen.signed = { input: command.input, options }; return "https://signed"; } }]; };
    const aws = createAwsS3({ region: "me-central-1", loader });
    assert.equal(loads, 0);
    const dir = await mkdtemp(join(tmpdir(), "aws-"));
    try {
      const path = join(dir, "f.xlsx");
      await writeFile(path, "x");
      await aws.upload({ bucket: "b", key: "k", filePath: path, contentType: "type" });
      assert.deepEqual({ Bucket: seen.upload.Bucket, Key: seen.upload.Key, ContentType: seen.upload.ContentType }, { Bucket: "b", Key: "k", ContentType: "type" });
      assert.ok(seen.upload.Body, "the file is streamed");
      assert.equal(await aws.presign({ bucket: "b", key: "k", fileName: "Report.xlsx", expiresIn: 600 }), "https://signed");
      assert.equal(seen.signed.input.ResponseContentDisposition, 'attachment; filename="Report.xlsx"');
      assert.equal(seen.signed.options.expiresIn, 600);
      await aws.remove({ bucket: "b", key: "k" });
      assert.deepEqual(seen.sent.input, { Bucket: "b", Key: "k" });
      assert.deepEqual(seen.config, { region: "me-central-1" });
      assert.equal(loads, 1); // loaded once, reused
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("working files", () => {
  test("production removes them after the report exists; development keeps them", () => {
    assert.equal(shouldKeepWorkFiles({ NODE_ENV: "production" }), false);
    assert.equal(shouldKeepWorkFiles({ NODE_ENV: "development" }), true);
    assert.equal(shouldKeepWorkFiles({}), true);
    assert.equal(shouldKeepWorkFiles({ NODE_ENV: "production", REPORT_KEEP_WORK_FILES: "on" }), true);
  });

  test("removeWorkFiles deletes all three exports and forgets their paths; a missing file is fine", async () => {
    const removed = [];
    const updates = [];
    const db = { reportJob: { update: async (args) => updates.push(args) } };
    const remove = async (path) => { removed.push(path); if (path === "/gone/events.jsonl") throw Object.assign(new Error("gone"), { code: "ENOENT" }); };
    await removeWorkFiles({ db, job: { id: "job1", ordersFile: "/x/orders.jsonl", eventsFile: "/gone/events.jsonl", productsFile: "/x/products.jsonl" }, remove });
    assert.deepEqual(removed, ["/x/orders.jsonl", "/gone/events.jsonl", "/x/products.jsonl"]);
    assert.deepEqual(updates, [{ where: { id: "job1" }, data: { ordersFile: null, eventsFile: null, productsFile: null } }]);
  });

  test("any other deletion error is surfaced", async () => {
    await assert.rejects(removeWorkFiles({ db: { reportJob: { update: async () => {} } }, job: { id: "j", ordersFile: "/x/o" }, remove: async () => { throw Object.assign(new Error("EACCES"), { code: "EACCES" }); } }), /EACCES/);
  });
});

describe("retention", () => {
  test("the period comes from REPORT_RETENTION_DAYS, 30 by default, 0 for never", () => {
    assert.equal(retentionDays({}), DEFAULT_RETENTION_DAYS);
    assert.equal(retentionDays({ REPORT_RETENTION_DAYS: "90" }), 90);
    assert.equal(retentionDays({ REPORT_RETENTION_DAYS: "0" }), 0);
    assert.equal(retentionDays({ REPORT_RETENTION_DAYS: "soon" }), DEFAULT_RETENTION_DAYS);
    assert.equal(retentionDays({ REPORT_RETENTION_DAYS: "-5" }), DEFAULT_RETENTION_DAYS);
  });

  const NOW = Date.parse("2026-11-20T00:00:00Z");
  const makeDb = (jobs) => ({
    jobs,
    reportJob: {
      findMany: async ({ where }) => jobs.filter((j) => j.stage === where.stage && j.updatedAt < where.updatedAt.lt),
      updateMany: async ({ where, data }) => { const j = jobs.find((x) => x.id === where.id && x.stage === where.stage); if (!j) return { count: 0 }; Object.assign(j, data); return { count: 1 }; },
    },
  });

  test("old finished reports are deleted from storage and marked EXPIRED; recent ones and other stages are left alone", async () => {
    const day = 24 * 60 * 60 * 1000;
    const jobs = [
      { id: "old", stage: STAGES.READY, resultFileUrl: "s3://b/reports/old/a.xlsx", updatedAt: new Date(NOW - 31 * day) },
      { id: "recent", stage: STAGES.READY, resultFileUrl: "s3://b/reports/recent/a.xlsx", updatedAt: new Date(NOW - 5 * day) },
      { id: "failed", stage: STAGES.FAILED, resultFileUrl: null, updatedAt: new Date(NOW - 90 * day) },
    ];
    const db = makeDb(jobs);
    const removed = [];
    const expired = await expireOldReports({ db, store: { remove: async (url) => removed.push(url) }, now: NOW, days: 30 });
    assert.equal(expired, 1);
    assert.deepEqual(removed, ["s3://b/reports/old/a.xlsx"]);
    assert.deepEqual([jobs[0].stage, jobs[0].resultFileUrl], [STAGES.EXPIRED, null]);
    assert.equal(jobs[1].stage, STAGES.READY);
    assert.equal(jobs[2].stage, STAGES.FAILED);
  });

  test("0 days keeps everything, and a failed deletion is retried later instead of expiring the job", async () => {
    const jobs = [{ id: "old", stage: STAGES.READY, resultFileUrl: "s3://b/k", updatedAt: new Date(NOW - 400 * 24 * 60 * 60 * 1000) }];
    assert.equal(await expireOldReports({ db: makeDb(jobs), store: { remove: async () => { throw new Error("no"); } }, now: NOW, days: 0 }), 0);
    const errors = console.error;
    console.error = () => {};
    try {
      assert.equal(await expireOldReports({ db: makeDb(jobs), store: { remove: async () => { throw new Error("AccessDenied"); } }, now: NOW, days: 30 }), 0);
    } finally {
      console.error = errors;
    }
    assert.equal(jobs[0].stage, STAGES.READY);
  });
});
