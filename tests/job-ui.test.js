// Server-side renders of the job status, request summary and test preview
// components (Dev Plan Step 26).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { STAGES, STAGE_INFO } from "../app/pipeline/job-stages.js";

const root = fileURLToPath(new URL("..", import.meta.url));
let vite;
let JobStatus, RequestSummary, ReportPreview;

before(async () => {
  vite = await createServer({ root, configFile: false, logLevel: "error", server: { middlewareMode: true }, appType: "custom", optimizeDeps: { noDiscovery: true, include: [] }, esbuild: { jsx: "automatic" } });
  ({ JobStatus, RequestSummary } = await vite.ssrLoadModule("/app/components/JobStatus.jsx"));
  ReportPreview = (await vite.ssrLoadModule("/app/components/ReportPreview.jsx")).default;
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

const totals = { orders: 2, lineRows: 3, shippingRows: 1, itemsSold: 4, gross: 100, discounts: -10, returns: 5, net: 85, shipping: 20.95, taxes: 6, total: 111.95 };
const row = (key, extra = {}) => ({ key, ...totals, ...extra });
const preview = {
  totals,
  byMonth: [row("2026-09")],
  byDay: [row("2026-09-05")],
  byLocation: [row("Al Ain")],
  byChannel: [row("Point of Sale")],
  byCollection: [row("Boys")],
  columns: [{ key: "orderName", label: "Order Name" }, { key: "totalSales", label: "Total Sales" }],
  sample: [{ orderName: "#1001", totalSales: 111.95 }, { orderName: "#1002", totalSales: null }],
};

test("the preview is clearly marked temporary, with totals and the chosen columns only", () => {
  const html = render(ReportPreview, { preview });
  assert.match(html, /heading="Test preview \(temporary\)"/);
  assert.match(html, /For checking numbers only/);
  assert.match(html, /<th[^>]*>Order Name<\/th>/);
  assert.match(html, /<th[^>]*>Total Sales<\/th>/);
  assert.doesNotMatch(html, /Collection Name/);
});

test("the preview formats money with two decimals and counts as integers", () => {
  const html = render(ReportPreview, { preview: { ...preview, totals: { ...totals, orders: 36167, total: 12907701.55 } } });
  assert.match(html, /12,907,701\.55/);
  assert.match(html, /36,167/);
});

test("the preview shows every grouping and the sample rows, with blanks for missing values", () => {
  const html = render(ReportPreview, { preview });
  for (const heading of ["By month", "By day", "By location", "By sales channel", "By collection"]) assert.ok(html.includes(heading), heading);
  assert.match(html, /<td[^>]*>#1001<\/td>/);
  assert.match(html, /First 2 rows/);
  assert.match(html, /<td[^>]*><\/td><\/tr>/); // the null Total Sales cell is empty
});

test("a null count (by-collection orders) is shown as a dash, not 0", () => {
  const html = render(ReportPreview, { preview: { ...preview, byCollection: [row("Boys", { orders: null })] } });
  assert.match(html, /<td[^>]*>Boys<\/td><td[^>]*>–<\/td>/);
});
