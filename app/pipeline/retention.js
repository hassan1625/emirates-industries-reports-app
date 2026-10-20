// Finished reports are kept for a limited time (REPORT_RETENTION_DAYS, default
// 30; 0 keeps them forever). After that the file is deleted from storage and the
// job is marked EXPIRED, so the list says so instead of offering a dead download.
// An S3 lifecycle rule on the bucket can enforce the same limit as a safety net.
import { STAGES } from "./job-stages.js";

export const DEFAULT_RETENTION_DAYS = 30;
const DAY = 24 * 60 * 60 * 1000;

export const retentionDays = (env = process.env) => {
  const value = Number(env.REPORT_RETENTION_DAYS);
  return env.REPORT_RETENTION_DAYS !== undefined && env.REPORT_RETENTION_DAYS !== "" && Number.isFinite(value) && value >= 0 ? value : DEFAULT_RETENTION_DAYS;
};

// Returns how many reports were expired.
export async function expireOldReports({ db, store, now = Date.now(), days = retentionDays() }) {
  if (!days) return 0;
  const cutoff = new Date(now - days * DAY);
  const jobs = await db.reportJob.findMany({ where: { stage: STAGES.READY, updatedAt: { lt: cutoff } } });
  let expired = 0;
  for (const job of jobs) {
    try {
      if (job.resultFileUrl) await store.remove(job.resultFileUrl);
      const { count } = await db.reportJob.updateMany({ where: { id: job.id, stage: STAGES.READY }, data: { stage: STAGES.EXPIRED, resultFileUrl: null } });
      expired += count;
    } catch (error) {
      console.error(`Could not expire the report of job ${job.id}:`, error.message); // retried on the next pass
    }
  }
  return expired;
}
