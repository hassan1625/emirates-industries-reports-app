// Renders the real request-screen component (server side, through Vite) with the
// real Report 1 config, to catch broken markup, missing imports and filters that
// stop following the config. Slower than the other tests (it starts Vite).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { getReportFilters } from "../app/config/index.js";

const root = fileURLToPath(new URL("..", import.meta.url));
let vite;
let Form;

before(async () => {
  vite = await createServer({ root, configFile: false, logLevel: "error", server: { middlewareMode: true }, appType: "custom", optimizeDeps: { noDiscovery: true, include: [] }, esbuild: { jsx: "automatic" } });
  Form = (await vite.ssrLoadModule("/app/components/ReportRequestForm.jsx")).default;
});
after(async () => {
  await vite.close();
});

const options = {
  salesChannel: [{ value: "pos", label: "Point of Sale" }, { value: "web", label: "Online Store" }],
  posLocation: [{ value: "L1", label: "Al Ain" }],
  collection: [{ value: "Boys", label: "Boys" }],
};
const render = (props = {}) =>
  renderToStaticMarkup(createElement(Form, { reportKey: "generalSales", options, defaults: { dateRange: { from: "2026-09-01", to: "2026-09-30" } }, onSubmit: () => {}, ...props }));

test("shows the report title and a date range with the default dates", () => {
  const html = render();
  assert.match(html, /<s-page heading="General Sales Report">/);
  assert.match(html, /<s-section heading="Date Range">/);
  assert.match(html, /label="From"[^>]*value="2026-09-01"/);
  assert.match(html, /label="To"[^>]*value="2026-09-30"/);
});

test("renders every select filter the config lists, in config order, with its options", () => {
  const html = render();
  const labels = getReportFilters("generalSales").filter((f) => f.type === "multiSelect").map((f) => f.label);
  let last = -1;
  for (const label of labels) {
    const at = html.indexOf(`label="${label}"`);
    assert.ok(at > last, `${label} missing or out of order`);
    last = at;
  }
  assert.match(html, /<s-choice value="pos">Point of Sale<\/s-choice>/);
  assert.match(html, /<s-choice value="L1">Al Ain<\/s-choice>/);
  assert.match(html, /<s-choice value="Boys">Boys<\/s-choice>/);
});

test("the filter that is unavailable on this plan is disabled and says why", () => {
  const html = render();
  const staff = html.match(/<s-choice-list label="POS Staff"[^>]*>/)[0];
  assert.match(staff, /disabled="true"/);
  assert.match(staff, /Plus and Advanced plans/);
  assert.doesNotMatch(html.match(/<s-choice-list label="Sales Channel"[^>]*>/)[0], /disabled/);
});

test("server errors appear on the right fields", () => {
  const html = render({ errors: { dateRange: "The start date must not be after the end date", salesChannel: "Pick again" } });
  assert.match(html.match(/<s-date-field label="From"[^>]*>/)[0], /error="The start date must not be after the end date"/);
  assert.match(html.match(/<s-choice-list label="Sales Channel"[^>]*>/)[0], /error="Pick again"/);
  assert.doesNotMatch(html.match(/<s-choice-list label="POS Location"[^>]*>/)[0], /error=/);
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

test("a filter with no options still renders (an empty list, not a crash)", () => {
  const html = render({ options: {} });
  assert.match(html, /<s-choice-list label="Collection Name"/);
});

import { getReportFields, defaultFieldKeys } from "../app/config/index.js";

const checkboxTag = (html, label) => html.match(new RegExp(`<s-checkbox[^>]*label="${label}"[^>]*>`))?.[0];

test("Fields section lists all 21 fields from the config, in column order, plus Select all", () => {
  const html = render({ defaults: { dateRange: { from: "2026-09-01", to: "2026-09-30" }, fields: defaultFieldKeys("generalSales") } });
  assert.match(html, /<s-section heading="Fields">/);
  const labels = getReportFields("generalSales").map((f) => f.label);
  assert.equal(labels.length, 21);
  // Only look inside the Fields section: some labels (e.g. "Sales Channel") are
  // also filter titles earlier on the page.
  const fieldsHtml = html.slice(html.indexOf('<s-section heading="Fields">'));
  const rendered = [...fieldsHtml.matchAll(/<s-checkbox[^>]*label="([^"]*)"/g)].map((m) => m[1]);
  assert.deepEqual(rendered, ["Select all", ...labels]);
});

test("by default every available field is checked, Select all is checked, and the count says so", () => {
  const html = render({ defaults: { dateRange: { from: "2026-09-01", to: "2026-09-30" }, fields: defaultFieldKeys("generalSales") } });
  assert.match(html, /20 of 20 fields selected/);
  assert.match(checkboxTag(html, "Select all"), /checked="true"/);
  assert.doesNotMatch(checkboxTag(html, "Select all"), /indeterminate/);
  assert.match(checkboxTag(html, "Order Name"), /checked="true"/);
  assert.match(checkboxTag(html, "Total Sales"), /checked="true"/);
});

test("POS Staff is listed, disabled, unchecked, and explains why", () => {
  const html = render({ defaults: { dateRange: { from: "2026-09-01", to: "2026-09-30" }, fields: defaultFieldKeys("generalSales") } });
  const staff = checkboxTag(html, "POS Staff");
  assert.match(staff, /disabled="true"/);
  assert.doesNotMatch(staff, /checked/);
  assert.match(staff, /Plus and Advanced plans/);
});

test("a partial selection shows Select all as mixed, not checked", () => {
  const html = render({ defaults: { dateRange: { from: "2026-09-01", to: "2026-09-30" }, fields: ["orderName", "sku"] } });
  assert.match(html, /2 of 20 fields selected/);
  const all = checkboxTag(html, "Select all");
  assert.match(all, /indeterminate="true"/);
  assert.doesNotMatch(all, /checked/);
  assert.match(checkboxTag(html, "Order Name"), /checked="true"/);
  assert.doesNotMatch(checkboxTag(html, "Barcode") ?? checkboxTag(html, "Product Variant Barcode"), /checked/);
});

test("nothing selected: Select all is unchecked and a server error is shown", () => {
  const html = render({ defaults: { dateRange: { from: "2026-09-01", to: "2026-09-30" }, fields: [] }, errors: { fields: "Choose at least one field" } });
  assert.match(html, /0 of 20 fields selected/);
  assert.doesNotMatch(checkboxTag(html, "Select all"), /checked|indeterminate/);
  assert.match(html, /<s-banner tone="critical">Choose at least one field<\/s-banner>/);
});

test("without `defaults.fields` everything available starts checked", () => {
  assert.match(render(), /20 of 20 fields selected/);
});

test("no attribute is ever rendered as the string 'false'", () => {
  assert.doesNotMatch(render({ defaults: { dateRange: { from: "2026-09-01", to: "2026-09-30" }, fields: ["sku"] } }), /="false"/);
});
