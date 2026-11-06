// Writes a report to an XLSX file (Dev Plan Step 27). Streams: rows go to disk
// as they are produced, so a year of orders (about 185,000 rows) never sits in
// memory. XLSX only; never CSV (CSV cannot carry formatting).
//
// Cells are typed from the report config: money and counts are numbers (with a
// number format), the order date is a real Excel date-time in the STORE's local
// time, and everything else is text. SKUs and barcodes stay text so Excel does
// not turn a long barcode into scientific notation.
import ExcelJS from "exceljs";
import { ensureParentDir } from "./storage.js";

// Excel's hard limit per sheet, including the header row.
export const MAX_SHEET_ROWS = 1_048_576;

const NUMBER_FORMATS = { currency: "#,##0.00", number: "#,##0", date: "yyyy-mm-dd hh:mm:ss", string: "@" };
const DEFAULT_WIDTHS = { currency: 14, number: 10, date: 20, string: 18 };

// "2026-08-31 00:34:57" (store wall-clock) -> a Date whose UTC parts are those
// numbers, which Excel shows as the same wall-clock time.
export function parseLocalDateTime(text) {
  const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/.exec(String(text));
  if (!match) return null;
  const [y, mo, d, h, mi, s] = match.slice(1).map(Number);
  return new Date(Date.UTC(y, mo - 1, d, h, mi, s));
}

// The value to put in a cell for a column type, or null for an empty cell.
export function toCellValue(value, type) {
  if (value === null || value === undefined || value === "") return null;
  if (type === "currency" || type === "number") return Number.isFinite(Number(value)) ? Number(value) : null;
  if (type === "date") return parseLocalDateTime(value);
  return String(value);
}

const columnWidth = (column) => column.width ?? Math.max(column.label.length + 3, DEFAULT_WIDTHS[column.type] ?? DEFAULT_WIDTHS.string);

// columns  [{ key, label, type, width? }] in sheet order
// rows     async/sync iterable of objects keyed by column key
// footer   optional values (keyed by column key) written bold under the last row
//          (a totals row); it is not counted in `rows`
// summary  optional extra sheet: [{ label, value, type? }] ("currency" and
//          "number" values are numbers, anything else text); a row with no
//          value is a bold heading
// title    optional [{ label, value }] rows written above the table (e.g. the stock
//          report's fixed Location Name), followed by a blank row
// highlight optional { column: key, value, color? } — the whole data row turns
//          red when that column is at or below the value (conditional
//          formatting, so it keeps working when someone edits a number)
// request  { reportLabel, period?: text that replaces the date range line, generatedAt: Date (store wall-clock, like Order Date), range: { from, to, timeZone },
//            filters: [{ label, values: string[] }], notes: string[] } for the
//            "Request" sheet. Optional.
// Resolves to { rows, bytes } (rows excludes the header).
export async function writeReportXlsx({ filePath, sheetName, columns, rows, footer, summary, request, title, highlight }) {
  await ensureParentDir(filePath);
  const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({ filename: filePath, useStyles: true, useSharedStrings: false });
  const titleRows = title?.length ? title.length + 1 : 0; // the title lines and a blank one
  const headerRow = titleRows + 1;
  const sheet = workbook.addWorksheet(sheetName.slice(0, 31), { views: [{ state: "frozen", ySplit: headerRow }] });

  sheet.columns = columns.map((column) => ({
    key: column.key,
    width: columnWidth(column),
    style: { numFmt: NUMBER_FORMATS[column.type] ?? NUMBER_FORMATS.string },
  }));
  sheet.autoFilter = { from: { row: headerRow, column: 1 }, to: { row: headerRow, column: columns.length } };

  for (const { label, value } of title ?? []) {
    const line = sheet.addRow([label, value]);
    line.getCell(1).font = { bold: true };
    line.commit();
  }
  if (titleRows) sheet.addRow([]).commit();

  const header = sheet.addRow(columns.map((column) => column.label));
  header.font = { bold: true };
  header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8EEF4" } };
  header.alignment = { vertical: "middle" };
  header.commit();

  let count = 0;
  for await (const values of rows) {
    if (count + 1 >= MAX_SHEET_ROWS) throw new Error(`The report has more rows than one Excel sheet can hold (${MAX_SHEET_ROWS - 1}); choose a shorter date range`);
    sheet.addRow(columns.map((column) => toCellValue(values[column.key], column.type))).commit();
    count += 1;
  }
  if (highlight && count > 0) {
    const letter = (n) => { let name = ""; for (let i = n; i > 0; i = Math.floor((i - 1) / 26)) name = String.fromCharCode(65 + ((i - 1) % 26)) + name; return name; };
    const at = letter(columns.findIndex((column) => column.key === highlight.column) + 1);
    const first = headerRow + 1;
    sheet.addConditionalFormatting({
      ref: `A${first}:${letter(columns.length)}${headerRow + count}`,
      rules: [{ type: "expression", formulae: [`$${at}${first}<=${highlight.value}`], priority: 1, style: { fill: { type: "pattern", pattern: "solid", bgColor: { argb: highlight.color ?? "FFF8C4C4" } }, font: { color: { argb: "FF9C0006" } } } }],
    });
  }
  if (footer) {
    const total = sheet.addRow(columns.map((column) => toCellValue(footer[column.key], column.type)));
    total.font = { bold: true };
    total.commit();
  }
  sheet.commit();

  if (summary?.length) {
    const page = workbook.addWorksheet("Summary");
    page.columns = [{ width: 44 }, { width: 24 }];
    for (const { label, value, type } of summary) {
      const row = page.addRow([label, value === undefined || value === null ? null : toCellValue(value, type)]);
      if (value === undefined || value === null) row.font = { bold: true };
      else if (type === "currency" || type === "number") row.getCell(2).numFmt = NUMBER_FORMATS[type];
      row.commit();
    }
    page.commit();
  }

  if (request) {
    const info = workbook.addWorksheet("Request");
    info.columns = [{ width: 24 }, { width: 80 }];
    const add = (label, value) => {
      const row = info.addRow([label, value]);
      if (value instanceof Date) row.getCell(2).numFmt = NUMBER_FORMATS.date; // show a date, not a serial number
      row.commit();
    };
    add("Report", request.reportLabel);
    add("Generated (store time)", request.generatedAt);
    add("Period", request.period ?? (request.range ? `${request.range.from} to ${request.range.to} (${request.range.timeZone})` : ""));
    for (const filter of request.filters ?? []) add(filter.label, filter.values.join(", "));
    if (!(request.filters ?? []).length) add("Filters", "None (everything)");
    add("Columns", columns.map((column) => column.label).join(", "));
    add("Rows", count);
    for (const note of request.notes ?? []) add("Note", note);
    info.commit();
  }

  await workbook.commit();
  const { size } = await (await import("node:fs/promises")).stat(filePath);
  return { rows: count, bytes: size };
}
