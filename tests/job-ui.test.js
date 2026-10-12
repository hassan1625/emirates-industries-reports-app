// Server-side renders of the job status and request summary components
// (Dev Plan Step 26).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { STAGES, STAGE_INFO } from "../app/pipeline/job-stages.js";

const root = fileURLToPath(new URL("..", import.meta.url));
let vite;
let JobStatus, RequestSummary, RecentReports;

before(async () => {
  vite = await createServer({ root, configFile: false, logLevel: "error", server: { middlewareMode: true }, appType: "custom", optimizeDeps: { noDiscovery: true, include: [] }, esbuild: { jsx: "automatic" } });
  ({ JobStatus, RequestSummary, RecentReports } = await vite.ssrLoadModule("/app/components/JobStatus.jsx"));
});
after(async () => vite.close());

const status = (stage, extra = {}) => ({ id: "j1", stage, label: STAGE_INFO[stage].label, detail: STAGE_INFO[stage].detail, error: null, createdAt: "2026-10-04T10:00:00.000Z", updatedAt: "2026-10-04T10:04:12.000Z", ...extra });
const render = (component, props) => renderToStaticMarkup(createElement(component, props));

test("a running job shows a spinner, its label and the keep-waiting hint", () => {
  const html = render(JobStatus, { status: status(STAGES.ORDERS_RUNNING) });
  assert.match(html, /<s-spinner/);
  assert.match(html, /<s-badge tone="info">Collecting orders<\/s-badge>/);
  assert.match(html, /This page updates by itself/);
  assert.match(html, /so far/);
});

test("every non-final stage shows a spinner and its own label", () => {
  for (const stage of [STAGES.PENDING, STAGES.ORDERS_RUNNING, STAGES.ORDERS_DOWNLOADING, STAGES.ORDERS_READY, STAGES.PRODUCTS_RUNNING, STAGES.PRODUCTS_DOWNLOADING, STAGES.DATA_READY, STAGES.GENERATING]) {
    const html = render(JobStatus, { status: status(stage) });
    assert.match(html, /<s-spinner/, stage);
    assert.ok(html.includes(STAGE_INFO[stage].label), stage);
  }
});

test("a finished job shows success, no spinner, and how long it took", () => {
  const html = render(JobStatus, { status: status(STAGES.READY) });
  assert.match(html, /<s-badge tone="success">Report ready<\/s-badge>/);
  assert.doesNotMatch(html, /<s-spinner/);
  assert.match(html, /took 252s/); // 4 min 12 s between created and updated
  assert.doesNotMatch(html, /This page updates by itself/);
});

test("a failed job shows the reason in a critical banner", () => {
  const html = render(JobStatus, { status: status(STAGES.FAILED, { error: "orders export FAILED (TIMEOUT)" }) });
  assert.match(html, /<s-badge tone="critical">Failed<\/s-badge>/);
  assert.match(html, /<s-banner tone="critical">orders export FAILED \(TIMEOUT\)<\/s-banner>/);
  assert.doesNotMatch(html, /<s-spinner/);
});

test("RequestSummary lists range, filters and the chosen fields by name", () => {
  const html = render(RequestSummary, {
    request: { range: { from: "2026-09-01", to: "2026-09-30", timeZone: "Asia/Muscat" }, filters: { salesChannel: ["pos"] }, fields: ["orderName", "totalSales"] },
    fieldLabels: { orderName: "Order Name", totalSales: "Total Sales" },
  });
  assert.match(html, /2026-09-01 to 2026-09-30 \(Asia\/Muscat\)/);
  assert.match(html, /filters: \{&quot;salesChannel&quot;:\[&quot;pos&quot;\]\}/);
  assert.match(html, /2 fields: Order Name, Total Sales/);
});

test("RequestSummary says 'no filters', and renders nothing without a request", () => {
  const html = render(RequestSummary, { request: { range: { from: "2026-09-01", to: "2026-09-30", timeZone: "Asia/Muscat" }, filters: {}, fields: ["orderName"] }, fieldLabels: { orderName: "Order Name" } });
  assert.match(html, /no filters/);
  assert.equal(render(RequestSummary, { request: null, fieldLabels: {} }), "");
});

const file = { name: "General-Sales-Report_2026-10-05_to_2026-10-11.xlsx", bytes: 22_872_652, rows: 172019 };

test("a finished report shows its file, row count, size and a Download button", () => {
  const html = render(JobStatus, { status: status(STAGES.READY), file, onDownload: () => {} });
  assert.match(html, /General-Sales-Report_2026-10-05_to_2026-10-11\.xlsx/);
  assert.match(html, /172,019 rows/);
  assert.match(html, /21\.8 MB/);
  assert.match(html, /Download Excel file/);
});

test("without a handler there is no Download button, and a download error is shown", () => {
  assert.doesNotMatch(render(JobStatus, { status: status(STAGES.READY), file }), /Download Excel file/);
  assert.match(render(JobStatus, { status: status(STAGES.READY), file, onDownload: () => {}, downloadError: "Could not prepare the download." }), /Could not prepare the download\./);
});

test("a running job says it can be left and found under Recent reports", () => {
  const html = render(JobStatus, { status: status(STAGES.EVENTS_RUNNING) });
  assert.match(html, /several minutes/);
  assert.match(html, /leave this page/);
  assert.match(html, /Recent reports/);
});

const job = (over = {}) => ({ id: "j1", stage: STAGES.READY, label: "Report ready", terminal: true, createdAt: "2026-10-13T10:04:00.000Z", range: { from: "2026-10-05", to: "2026-10-11" }, filterCount: 2, error: null, file, ...over });

test("Recent reports lists each job with its period, status and a Download for finished ones", () => {
  const html = render(RecentReports, { jobs: [job(), job({ id: "j2", stage: STAGES.FAILED, label: "Failed", file: null }), job({ id: "j3", stage: STAGES.EVENTS_RUNNING, label: "Collecting returns and exchanges", terminal: false, file: null })], onOpen: () => {}, onDownload: () => {} });
  assert.match(html, /heading="Recent reports"/);
  assert.match(html, /2026-10-05 to 2026-10-11/);
  assert.match(html, /2 applied/);
  assert.match(html, /13 Oct 2026, 14:04/); // 10:04 UTC is 14:04 in Muscat
  assert.equal((html.match(/>Download</g) ?? []).length, 1); // only the finished report
  assert.match(html, /View progress/);
  assert.match(html, /Details/);
});

test("Recent reports renders nothing when there are none", () => {
  assert.equal(render(RecentReports, { jobs: [] }), "");
});
