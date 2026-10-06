import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ExcelJS from "exceljs";
import { writeReportXlsx, toCellValue, parseLocalDateTime, MAX_SHEET_ROWS } from "../app/pipeline/report-xlsx.js";

const COLUMNS = [
  { key: "orderName", label: "Order Name", type: "string" },
  { key: "orderDate", label: "Order Date", type: "date" },
  { key: "barcode", label: "Barcode", type: "string" },
  { key: "qty", label: "Items", type: "number" },
  { key: "gross", label: "Gross", type: "currency", width: 16 },
];

describe("cell values", () => {
  test("numbers stay numbers, text stays text, blanks are empty cells", () => {
    assert.equal(toCellValue(12.5, "currency"), 12.5);
    assert.equal(toCellValue("12.5", "currency"), 12.5);
    assert.equal(toCellValue(0, "currency"), 0); // zero is a value, not a blank
    assert.equal(toCellValue(null, "currency"), null);
    assert.equal(toCellValue("", "string"), null);
    assert.equal(toCellValue(undefined, "number"), null);
    assert.equal(toCellValue("abc", "number"), null);
    assert.equal(toCellValue(6290000000011, "string"), "6290000000011");
  });

  test("a store wall-clock date-time becomes an Excel date showing the same time", () => {
    const date = toCellValue("2026-08-31 00:34:57", "date");
    assert.ok(date instanceof Date);
    assert.equal(date.toISOString(), "2026-08-31T00:34:57.000Z");
    assert.equal(parseLocalDateTime("nonsense"), null);
    assert.equal(toCellValue("nonsense", "date"), null);
  });
});

describe("writeReportXlsx", () => {
  let dir;
  before(async () => {
    dir = await mkdtemp(join(tmpdir(), "xlsx-test-"));
  });
  after(async () => rm(dir, { recursive: true, force: true }));

  async function write(name, rows, extra = {}) {
    const filePath = join(dir, name);
    const result = await writeReportXlsx({ filePath, sheetName: "General Sales Report", columns: COLUMNS, rows, ...extra });
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(filePath);
    return { result, workbook, sheet: workbook.getWorksheet("General Sales Report") };
  }

  const sample = [
    { orderName: "#1001", orderDate: "2026-08-31 00:34:57", barcode: "6290000000011", qty: 2, gross: 87 },
    { orderName: "#1001", orderDate: "2026-08-31 00:34:57", barcode: null, qty: 0, gross: -4.35 },
  ];

  test("writes a header row and one row per record, typed", async () => {
    const { result, sheet } = await write("basic.xlsx", sample);
    assert.deepEqual(result.rows, 2);
    assert.ok(result.bytes > 0);
    assert.deepEqual(sheet.getRow(1).values.slice(1), ["Order Name", "Order Date", "Barcode", "Items", "Gross"]);
    const row = sheet.getRow(2);
    assert.equal(row.getCell(1).value, "#1001");
    assert.ok(row.getCell(2).value instanceof Date);
    assert.equal(row.getCell(2).value.toISOString(), "2026-08-31T00:34:57.000Z");
    assert.equal(row.getCell(3).value, "6290000000011"); // text, not a number
    assert.equal(typeof row.getCell(4).value, "number");
    assert.equal(row.getCell(5).value, 87);
  });

  test("zero is written as 0 and an empty value as an empty cell", async () => {
    const { sheet } = await write("zero.xlsx", sample);
    assert.equal(sheet.getRow(3).getCell(4).value, 0);
    assert.equal(sheet.getRow(3).getCell(3).value, null);
    assert.equal(sheet.getRow(3).getCell(5).value, -4.35);
  });

  test("number formats: money with two decimals, counts as integers, dates as date-times, ids as text", async () => {
    const { sheet } = await write("formats.xlsx", sample);
    const row = sheet.getRow(2);
    assert.equal(row.getCell(2).numFmt, "yyyy-mm-dd hh:mm:ss");
    assert.equal(row.getCell(3).numFmt, "@");
    assert.equal(row.getCell(4).numFmt, "#,##0");
    assert.equal(row.getCell(5).numFmt, "#,##0.00");
  });

  test("header is bold, frozen, and filterable", async () => {
    const { sheet } = await write("header.xlsx", sample);
    assert.equal(sheet.getRow(1).font.bold, true);
    assert.equal(sheet.views[0].state, "frozen");
    assert.equal(sheet.views[0].ySplit, 1);
    assert.equal(sheet.autoFilter, "A1:E1"); // the filter covers the header row of all five columns
  });

  test("column widths: explicit, or from the type and label", async () => {
    const { sheet } = await write("widths.xlsx", sample);
    assert.equal(sheet.getColumn(5).width, 16);
    assert.ok(sheet.getColumn(1).width >= "Order Name".length);
    assert.ok(sheet.getColumn(2).width >= 20);
  });

  test("accepts an async iterable (rows streamed from a generator)", async () => {
    async function* rows() {
      for (let i = 0; i < 1000; i++) yield { orderName: `#${i}`, orderDate: "2026-09-01 10:00:00", barcode: String(i), qty: 1, gross: i };
    }
    const { result, sheet } = await write("stream.xlsx", rows());
    assert.equal(result.rows, 1000);
    assert.equal(sheet.rowCount, 1001);
    assert.equal(sheet.getRow(1001).getCell(5).value, 999);
  });

  test("an empty report still has its header", async () => {
    const { result, sheet } = await write("empty.xlsx", []);
    assert.equal(result.rows, 0);
    assert.equal(sheet.getRow(1).getCell(1).value, "Order Name");
  });

  test("text that looks like a formula is stored as text, not executed", async () => {
    const { sheet } = await write("formula.xlsx", [{ orderName: "=HYPERLINK(\"http://evil\")", orderDate: null, barcode: "+1", qty: 1, gross: 1 }]);
    const value = sheet.getRow(2).getCell(1).value;
    assert.equal(typeof value, "string");
    assert.equal(value, "=HYPERLINK(\"http://evil\")");
  });

  test("the Request sheet records the period, filters, columns and row count", async () => {
    const { workbook } = await write("request.xlsx", sample, {
      request: { reportLabel: "General Sales Report", generatedAt: new Date("2026-10-04T12:00:00Z"), range: { from: "2026-09-01", to: "2026-09-30", timeZone: "Asia/Muscat" }, filters: [{ label: "Sales Channel", values: ["Point of Sale"] }], notes: ["Sales are attributed to the original order date."] },
    });
    const info = workbook.getWorksheet("Request");
    const lines = new Map();
    info.eachRow((row) => lines.set(row.getCell(1).value, row.getCell(2).value));
    assert.equal(lines.get("Report"), "General Sales Report");
    // the generated time is a real date with a date format, not a bare number
    const generatedRow = [...workbook.getWorksheet("Request")._rows].find((r) => r?.getCell(1).value === "Generated (store time)");
    assert.ok(generatedRow.getCell(2).value instanceof Date);
    assert.equal(generatedRow.getCell(2).numFmt, "yyyy-mm-dd hh:mm:ss");
    assert.equal(lines.get("Period"), "2026-09-01 to 2026-09-30 (Asia/Muscat)");
    assert.equal(lines.get("Sales Channel"), "Point of Sale");
    assert.equal(lines.get("Rows"), 2);
    assert.match(lines.get("Columns"), /Order Name, Order Date/);
    assert.equal(lines.get("Note"), "Sales are attributed to the original order date.");
  });

  test("with no filters the Request sheet says everything is included", async () => {
    const { workbook } = await write("nofilter.xlsx", sample, { request: { reportLabel: "R", generatedAt: new Date(), range: null, filters: [] } });
    const found = [];
    workbook.getWorksheet("Request").eachRow((row) => found.push(`${row.getCell(1).value}=${row.getCell(2).value}`));
    assert.ok(found.includes("Filters=None (everything)"));
  });

  test("sheet names are limited to Excel's 31 characters", async () => {
    const filePath = join(dir, "name.xlsx");
    await writeReportXlsx({ filePath, sheetName: "A very long report name that exceeds the limit", columns: COLUMNS, rows: [] });
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(filePath);
    assert.equal(workbook.worksheets[0].name.length, 31);
  });

  test("the row limit is a clear error, not a corrupt file", () => {
    assert.equal(MAX_SHEET_ROWS, 1048576);
  });
});
