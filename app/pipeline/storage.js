// Where downloaded bulk export files live. Local disk for now; the S3 move
// (Dev Plan Steps 4 and 28) replaces this module, not its callers.
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
