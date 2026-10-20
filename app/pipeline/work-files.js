// The bulk exports of a job (orders, events, products) are large working files:
// about 100-250 MB per job. Once the report exists they are not needed again, so
// production removes them; development keeps them so a finished job can be
// inspected (REPORT_KEEP_WORK_FILES=on forces keeping them anywhere).
import { unlink } from "node:fs/promises";
import { FILE_COLUMN } from "./job-stages.js";

export const shouldKeepWorkFiles = (env = process.env) => env.REPORT_KEEP_WORK_FILES === "on" || env.NODE_ENV !== "production";

// Deletes the job's export files and forgets their paths. Files already gone are fine.
export async function removeWorkFiles({ db, job, remove = unlink }) {
  const cleared = {};
  for (const column of Object.values(FILE_COLUMN)) {
    if (job[column]) await remove(job[column]).catch((error) => { if (error.code !== "ENOENT") throw error; });
    cleared[column] = null;
  }
  await db.reportJob.update({ where: { id: job.id }, data: cleared });
}
