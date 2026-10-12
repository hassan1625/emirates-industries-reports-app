// Renders the real request-screen component (server side, through Vite) with the
// real Report 1 config, to catch broken markup, missing imports and filters that
// stop following the config. Slower than the other tests (it starts Vite).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { getReportFields, getReportFilters, defaultFieldKeys } from "../app/config/index.js";
import { withStaffUnavailable } from "./helpers/staff-unavailable.js";

const root = fileURLToPath(new URL("..", import.meta.url));
let vite;
let Form;
let MultiFilter;
let viteReport; // the config module instance the component reads

before(async () => {
  vite = await createServer({ root, configFile: false, logLevel: "error", server: { middlewareMode: true }, appType: "custom", optimizeDeps: { noDiscovery: true, include: [] }, esbuild: { jsx: "automatic" } });
  Form = (await vite.ssrLoadModule("/app/components/ReportRequestForm.jsx")).default;
  MultiFilter = (await vite.ssrLoadModule("/app/components/MultiFilter.jsx")).default;
  viteReport = (await vite.ssrLoadModule("/app/config/reports/r1-general-sales.js")).generalSalesReport;
});
after(async () => {
  await vite.close();
});

const options = {
  salesChannel: [{ value: "pos", label: "Point of Sale" }, { value: "web", label: "Online Store" }],
  posLocation: [{ value: "L1", label: "Al Ain" }],
  posStaff: [{ value: "Sara", label: "Sara" }],
  collection: [{ value: "Boys", label: "Boys" }],
};
const DATES = { dateRange: { from: "2026-09-01", to: "2026-09-30" }, today: "2026-10-13" };
const render = (props = {}) => renderToStaticMarkup(createElement(Form, { reportKey: "generalSales", options, defaults: DATES, onSubmit: () => {}, ...props }));
const checkboxTag = (html, label) => html.match(new RegExp(`<s-checkbox[^>]*label="${label}"[^>]*>`))?.[0];
const columnsHtml = (html) => html.slice(html.indexOf('<s-section heading="Columns">'));

test("shows the report title, its description and the date range with a period choice", () => {
  const html = render();
  assert.match(html, /<s-page heading="General Sales Report">/);
  assert.match(html, /dated on the day it happened/);
  assert.match(html, /<s-section heading="Date Range">/);
  assert.match(html, /label="Start date"[^>]*value="2026-09-01"/);
  assert.match(html, /label="End date"[^>]*value="2026-09-30"/);
  assert.match(html, /<s-select[^>]*label="Period"/);
  assert.match(html, /<s-option value="lastMonth" selected="true">Last month<\/s-option>/); // Sept 1-30 is last month on 13 Oct
});

test("dates that match no preset show Custom", () => {
  const html = render({ defaults: { ...DATES, dateRange: { from: "2026-09-02", to: "2026-09-30" } } });
  assert.match(html, /<s-option value="custom" selected="true">Custom<\/s-option>/);
});

test("renders every available select filter the config lists, in config order, each collapsed with its choice count", () => {
  const html = render();
  const filters = getReportFilters("generalSales").filter((f) => f.type === "multiSelect");
  let last = -1;
  for (const filter of filters) {
    const at = html.indexOf(`>${filter.label}</s-text>`);
    assert.ok(at > last, `${filter.label} missing or out of order`);
    last = at;
    assert.ok(html.includes(filter.allLabel), `${filter.label} should read "${filter.allLabel}"`);
  }
  assert.match(html, /Choose from 2/); // sales channels
  assert.match(html, /<s-search-field[^>]*placeholder="Search POS Staff"/);
  assert.doesNotMatch(html, /<s-choice-list/); // no long open lists
});

test("a filter marked unavailable is left out of the screen and the summary", () => {
  withStaffUnavailable(() => {
    const html = render();
    assert.doesNotMatch(html, />POS Staff<\/s-text>\s*<s-text color="subdued">All staff/);
    assert.doesNotMatch(html, /All staff/);
    assert.match(html, /All locations/);
  }, viteReport);
});

test("server errors appear on the date field and on the right filter", () => {
  const html = render({ errors: { dateRange: "The start date must not be after the end date", salesChannel: "Pick again" } });
  assert.match(html.match(/<s-date-field label="Start date"[^>]*>/)[0], /error="The start date must not be after the end date"/);
  assert.match(html, /<s-text tone="critical">Pick again<\/s-text>/);
});

test("false-valued attributes are left out, not rendered as the string 'false'", () => {
  const html = render({ busy: false });
  assert.doesNotMatch(html, /="false"/);
  assert.doesNotMatch(html.match(/<s-button[^>]*>/)[0], /loading/);
  assert.match(render({ busy: true }).match(/<s-button[^>]*>/)[0], /loading="true"/);
});

test("the form has a primary Generate report action", () => {
  assert.match(render(), /<s-button slot="primary-action" variant="primary">Generate report<\/s-button>/);
});

test("the status card renders first, before the date range", () => {
  const html = render({ renderStatus: () => createElement("s-banner", { tone: "info" }, "STATUS-HERE") });
  assert.ok(html.indexOf("STATUS-HERE") > -1);
  assert.ok(html.indexOf("STATUS-HERE") < html.indexOf("Date Range"));
});

test("a filter with no options still renders (nothing to choose, not a crash)", () => {
  const html = render({ options: {} });
  assert.match(html, /Choose from 0/);
});

test("the Summary beside the form restates the request", () => {
  const html = render();
  const summary = html.slice(html.indexOf('<div slot="aside"'));
  assert.match(summary, /position:sticky/); // stays in view while the form scrolls
  assert.match(summary, /<s-section heading="Summary">/);
  assert.match(summary, /2026-09-01 to 2026-09-30/);
  assert.match(summary, /All sales channels/);
  assert.match(summary, /All staff/);
  assert.match(summary, /23 of 23/);
  assert.match(summary, /Excel \(\.xlsx\)/);
});

test("Columns lists all 23 fields from the config, in column order, with Select all and Clear", () => {
  const html = render({ defaults: { ...DATES, fields: defaultFieldKeys("generalSales") } });
  const labels = getReportFields("generalSales").map((f) => f.label);
  assert.equal(labels.length, 23);
  const section = columnsHtml(html);
  assert.deepEqual([...section.matchAll(/<s-checkbox[^>]*label="([^"]*)"/g)].map((m) => m[1]), labels);
  assert.match(section, />Select all<\/s-button>/);
  assert.match(section, />Clear<\/s-button>/);
});

test("Columns are laid out in three equal columns", () => {
  assert.match(columnsHtml(render()), /<s-grid gridTemplateColumns="repeat\(3, minmax\(0, 1fr\)\)"/);
});

test("by default every available field is checked and the count says so", () => {
  const html = render({ defaults: { ...DATES, fields: defaultFieldKeys("generalSales") } });
  assert.match(html, /23 of 23 selected/);
  for (const label of ["Order Name", "Total Sales", "POS Staff", "Order Type", "Is Shipping Charges"]) {
    const tag = checkboxTag(columnsHtml(html), label);
    assert.match(tag, /checked="true"/, label);
    assert.doesNotMatch(tag, /disabled/, label);
  }
});

test("a partial selection shows the count and unchecks the rest", () => {
  const html = render({ defaults: { ...DATES, fields: ["orderName", "sku"] } });
  assert.match(html, /2 of 23 selected/);
  assert.match(checkboxTag(columnsHtml(html), "Order Name"), /checked="true"/);
  assert.doesNotMatch(checkboxTag(columnsHtml(html), "Product Variant Barcode"), /checked/);
});

test("nothing selected: the count is zero and a server error is shown", () => {
  const html = render({ defaults: { ...DATES, fields: [] }, errors: { fields: "Choose at least one field" } });
  assert.match(html, /0 of 23 selected/);
  assert.match(html, /<s-banner tone="critical">Choose at least one field<\/s-banner>/);
});

test("without `defaults.fields` everything available starts checked", () => {
  assert.match(render(), /23 of 23 selected/);
});

test("a field marked unavailable is listed, disabled, unchecked, and explains why", () => {
  withStaffUnavailable(() => {
    const html = render({ defaults: { ...DATES, fields: defaultFieldKeys("generalSales") } });
    const staff = checkboxTag(columnsHtml(html), "POS Staff");
    assert.match(staff, /disabled="true"/);
    assert.doesNotMatch(staff, /checked/);
    assert.match(staff, /Not available on this plan/);
    assert.match(html, /22 of 22 selected/);
  }, viteReport);
});

test("no attribute is ever rendered as the string 'false'", () => {
  assert.doesNotMatch(render({ defaults: { ...DATES, fields: ["sku"] } }), /="false"/);
});

const filter = { key: "posStaff", label: "POS Staff", allLabel: "All staff" };
const renderFilter = (props) => renderToStaticMarkup(createElement(MultiFilter, { filter, options: [{ value: "Sara", label: "Sara" }, { value: "Omar", label: "Omar" }], values: [], onValues: () => {}, ...props }));

test("MultiFilter: collapsed by default, with its summary and a search box", () => {
  const html = renderFilter();
  assert.match(html, /All staff/);
  assert.match(html, /Choose from 2/);
  assert.doesNotMatch(html, /<s-checkbox/);
});

test("MultiFilter: open shows every choice, checked for chosen values, and a count with chips", () => {
  const html = renderFilter({ defaultOpen: true, values: ["Omar"] });
  assert.match(html, /1 selected/);
  assert.match(html, /<s-clickable-chip[^>]*removable[^>]*>Omar<\/s-clickable-chip>/);
  assert.match(checkboxTag(html, "Omar"), /checked="true"/);
  assert.doesNotMatch(checkboxTag(html, "Sara"), /checked/);
  assert.match(html, />Hide choices</);
});

test("MultiFilter: an error is shown under the filter", () => {
  assert.match(renderFilter({ error: "Pick again" }), /<s-text tone="critical">Pick again<\/s-text>/);
});
