// Server-side renders of the report status card, request summary and Recent
// reports table.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PROGRESS_STEPS, STAGES, stepOfStage } from "../app/pipeline/job-stages.js";

const root = fileURLToPath(new URL("..", import.meta.url));
let vite;
let ReportStatusCard, RequestSummary, RecentReports;

before(async () => {
  vite = await createServer({ root, configFile: false, logLevel: "error", server: { middlewareMode: true }, appType: "custom", optimizeDeps: { noDiscovery: true, include: [] }, esbuild: { jsx: "automatic" } });
  ({ RequestSummary, RecentReports } = await vite.ssrLoadModule("/app/components/JobStatus.jsx"));
  ReportStatusCard = (await vite.ssrLoadModule("/app/components/ReportStatusCard.jsx")).default;
});
after(async () => vite.close());

const CREATED = Date.parse("2026-10-04T10:00:00.000Z");
const status = (stage, extra = {}) => ({ id: "j1", stage, error: null, createdAt: "2026-10-04T10:00:00.000Z", updatedAt: "2026-10-04T10:03:12.000Z", ...extra });
const render = (component, props) => renderToStaticMarkup(createElement(component, props));
const file = { name: "General-Sales-Report_2026-10-05_to_2026-10-11.xlsx", bytes: 22_872_652, rows: 172019 };

test("before any request the card says no report yet", () => {
  const html = render(ReportStatusCard, { status: null });
  assert.match(html, /No report yet/);
  assert.match(html, /Generate report/);
  assert.doesNotMatch(html, /<s-spinner/);
});

test("building: a spinner on the current step, finished steps ticked, elapsed time and the leave-the-page note", () => {
  const html = render(ReportStatusCard, { status: status(STAGES.EVENTS_RUNNING), now: CREATED + 102_000 });
  assert.match(html, /Step 2 of 4/);
  assert.match(html, /Elapsed 1:42/);
  assert.equal((html.match(/<s-spinner/g) ?? []).length, 1);
  assert.equal((html.match(/type="check-circle"/g) ?? []).length, 1); // orders done
  assert.equal((html.match(/type="circle"/g) ?? []).length, 2); // products and the file still to do
  for (const step of PROGRESS_STEPS) assert.ok(html.includes(step.label), step.label);
  assert.match(html, /several minutes/);
  assert.match(html, /leave this page/);
});

test("every stage of a running job belongs to exactly one step", () => {
  const running = Object.values(STAGES).filter((stage) => ![STAGES.READY, STAGES.FAILED].includes(stage));
  for (const stage of running) assert.ok(stepOfStage(stage) >= 0, stage);
  assert.equal(stepOfStage(STAGES.PENDING), 0);
  assert.equal(stepOfStage(STAGES.PRODUCTS_DOWNLOADING), 2);
  assert.equal(stepOfStage(STAGES.GENERATING), 3);
  for (const stage of running) assert.match(render(ReportStatusCard, { status: status(stage), now: CREATED }), /<s-spinner/, stage);
});

test("ready: file name, size, rows, how long it took and a Download button", () => {
  const html = render(ReportStatusCard, { status: status(STAGES.READY), file, onDownload: () => {} });
  assert.match(html, /<s-badge tone="success">Report ready<\/s-badge>/);
  assert.match(html, /General-Sales-Report_2026-10-05_to_2026-10-11\.xlsx/);
  assert.match(html, /21\.8 MB/);
  assert.match(html, /172,019 rows/);
  assert.match(html, /Built in 3:12/);
  assert.match(html, /Download Excel file/);
  assert.doesNotMatch(html, /<s-spinner/);
});

test("ready without a handler has no Download button; a download error is shown", () => {
  assert.doesNotMatch(render(ReportStatusCard, { status: status(STAGES.READY), file }), /Download Excel file/);
  assert.match(render(ReportStatusCard, { status: status(STAGES.READY), file, onDownload: () => {}, downloadError: "Could not prepare the download." }), /Could not prepare the download\./);
});

test("ready with no rows explains why and offers Clear filters", () => {
  const html = render(ReportStatusCard, { status: status(STAGES.READY), file: { ...file, rows: 0 }, onDownload: () => {}, onClearFilters: () => {} });
  assert.match(html, /No orders match these filters/);
  assert.match(html, /Clear filters/);
  assert.doesNotMatch(html, /Download Excel file/);
});

test("failed: plain message, the reason, and Try again", () => {
  const html = render(ReportStatusCard, { status: status(STAGES.FAILED, { error: "orders export FAILED (TIMEOUT)" }), onRetry: () => {} });
  assert.match(html, /We couldn&#x27;t build your report|We couldn't build your report/);
  assert.match(html, /orders export FAILED \(TIMEOUT\)/);
  assert.match(html, /Try again/);
  assert.match(html, /saved/);
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

const job = (over = {}) => ({ id: "j1", reportLabel: "General Sales Report", route: "/app/report-general-sales", stage: STAGES.READY, label: "Report ready", terminal: true, createdAt: "2026-10-13T10:04:00.000Z", range: { from: "2026-10-05", to: "2026-10-11" }, filterCount: 2, error: null, file, ...over });

test("Recent reports lists each job with its period, status and a Download for finished ones", () => {
  const html = render(RecentReports, { jobs: [job(), job({ id: "j2", stage: STAGES.FAILED, label: "Failed", file: null }), job({ id: "j3", stage: STAGES.EVENTS_RUNNING, label: "Collecting returns and exchanges", terminal: false, file: null })], onOpen: () => {}, onDownload: () => {} });
  assert.match(html, /heading="Recent reports"/);
  assert.match(html, /2026-10-05 to 2026-10-11/);
  assert.match(html, /2 applied/);
  assert.match(html, /13 Oct 2026, 14:04/); // 10:04 UTC is 14:04 in Muscat
  assert.equal((html.match(/>Download</g) ?? []).length, 1); // only the finished report
  assert.match(html, /View progress/);
  assert.match(html, /Details/);
  assert.doesNotMatch(html, /<s-table-header>Report<\/s-table-header>/);
});

test("a list that mixes reports shows the Report column and links Details to the report screen", () => {
  const html = render(RecentReports, { jobs: [job()], heading: "Recent exports", showReport: true, detailsHref: (j) => `${j.route}?job=${j.id}`, onDownload: () => {} });
  assert.match(html, /heading="Recent exports"/);
  assert.match(html, /<s-table-header>Report<\/s-table-header>/);
  assert.match(html, /General Sales Report/);
  assert.match(html, /href="\/app\/report-general-sales\?job=j1"/);
});

test("the list scrolls inside its section, the tabs sit apart from it, and a row's buttons stay side by side", () => {
  const jobs = Array.from({ length: 15 }, (_, i) => job({ id: `j${i}` }));
  const html = render(RecentReports, { jobs, showReport: true, onDownload: () => {}, detailsHref: (j) => `/x?job=${j.id}`, children: createElement("s-clickable-chip", null, "All 15") });
  assert.match(html, /<div style="max-height:480px;overflow-y:auto" data-scroll="recent-reports">/);
  assert.ok(html.indexOf("All 15") < html.indexOf('data-scroll="recent-reports"')); // tabs stay outside the scrolling area
  assert.match(html, /<div style="margin-bottom:12px"><s-clickable-chip>All 15/);
  assert.match(html, /<div style="display:flex;gap:8px;white-space:nowrap">/);
  assert.equal((html.match(/<s-table-row>/g) ?? []).length, 15);
});

test("Recent reports renders nothing when there are none", () => {
  assert.equal(render(RecentReports, { jobs: [] }), "");
});
