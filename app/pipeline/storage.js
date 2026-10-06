// Where downloaded bulk export files live. Local disk for now; the S3 move
// (Dev Plan Steps 4 and 28) replaces this module, not its callers.
import { existsSync, readdirSync, statSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

// eslint-disable-next-line no-undef
const ROOT = () => process.env.REPORT_STORAGE_DIR ?? join(process.cwd(), "storage");

// e.g. <root>/jobs/<jobId>/orders.jsonl
export function jobFilePath(jobId, which) {
  if (!/^[\w-]+$/.test(jobId)) throw new Error(`Unsafe job id: ${jobId}`);
  if (!["orders", "products"].includes(which)) throw new Error(`Unknown export: ${which}`);
  return join(ROOT(), "jobs", jobId, `${which}.jsonl`);
}

export async function ensureParentDir(filePath) {
  await mkdir(join(filePath, ".."), { recursive: true });
}

// The finished report file of a job, e.g. <root>/jobs/<jobId>/report.xlsx.
export function jobReportPath(jobId) {
  if (!/^[\w-]+$/.test(jobId)) throw new Error(`Unsafe job id: ${jobId}`);
  return join(ROOT(), "jobs", jobId, "report.xlsx");
}

// resultFileUrl values for files kept on local disk are "local:<path under the
// storage root>". Step 28 stores S3 locations in the same column.
export const toLocalUrl = (absolutePath) => `local:${absolutePath.slice(ROOT().length).replace(/^[\\/]+/, "")}`;
export const fromLocalUrl = (url) => (url?.startsWith("local:") ? join(ROOT(), url.slice("local:".length)) : null);

// Files saved by hand while prototyping, e.g. <root>/prototype/ledgerAgreements.jsonl.
export function prototypeFilePath(name) {
  if (!/^[\w-]+$/.test(name)) throw new Error(`Unsafe file name: ${name}`);
  return join(ROOT(), "prototype", `${name}.jsonl`);
}

// Reports built by hand while prototyping, e.g. <root>/prototype/sample-general-sales.xlsx.
export function prototypeReportPath(name) {
  if (!/^[\w-]+$/.test(name)) throw new Error(`Unsafe file name: ${name}`);
  return join(ROOT(), "prototype", `${name}.xlsx`);
}

// The newest downloaded products export of any job, or null. Prototyping only.
export function latestProductsFile() {
  const jobs = join(ROOT(), "jobs");
  if (!existsSync(jobs)) return null;
  const files = readdirSync(jobs).map((id) => join(jobs, id, "products.jsonl")).filter((file) => existsSync(file));
  return files.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0] ?? null;
}
