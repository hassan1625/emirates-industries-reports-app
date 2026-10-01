// Fails if a field/filter label defined in app/config is hardcoded as a string
// literal elsewhere under app/ (Dev Plan Step 9: no second hardcoded list).
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { REPORTS, getReportFields, getReportFilters } from "../app/config/index.js";

const APP_DIR = fileURLToPath(new URL("../app", import.meta.url));
const CONFIG_DIR = join(APP_DIR, "config");

const labels = new Set();
for (const key of Object.keys(REPORTS)) {
  const report = REPORTS[key];
  const sections = [...getReportFields(key), ...getReportFilters(key)];
  for (const sub of report.subReports ?? []) sections.push(...sub.columns);
  for (const item of sections) if (item.label) labels.add(item.label);
}

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (path === CONFIG_DIR || path.includes(`${sep}types${sep}`)) continue;
    if (statSync(path).isDirectory()) yield* walk(path);
    else if (/\.(js|jsx)$/.test(name)) yield path;
  }
}

const violations = [];
for (const file of walk(APP_DIR)) {
  const source = readFileSync(file, "utf8");
  for (const label of labels) {
    if (source.includes(`"${label}"`) || source.includes(`'${label}'`)) {
      violations.push(`${relative(process.cwd(), file)}: hardcoded "${label}"`);
    }
  }
}

if (violations.length) {
  console.error("Hardcoded field/filter labels found outside app/config:\n" + violations.join("\n"));
  process.exit(1);
}
console.log(`OK: no hardcoded field/filter labels outside app/config (${labels.size} labels checked).`);
