// The report screen's "Recent reports" list: this shop's latest jobs of one
// report, so a user who closed the page can find a finished file later.
import { STAGE_INFO, STAGES } from "./job-stages.js";
import { describeReportFile } from "./report-file.js";

const parseParams = (text) => {
  try {
    return JSON.parse(text ?? "{}");
  } catch {
    return {};
  }
};

export async function listRecentJobs({ db, shop, reportType, limit = 10 }) {
  const jobs = await db.reportJob.findMany({ where: { shop, reportType }, orderBy: { createdAt: "desc" }, take: limit });
  return jobs.map((job) => {
    const params = parseParams(job.params);
    const info = STAGE_INFO[job.stage] ?? STAGE_INFO[STAGES.FAILED];
    return {
      id: job.id,
      stage: job.stage,
      label: info.label,
      terminal: info.terminal,
      createdAt: job.createdAt,
      range: params.localRange ? { from: params.localRange.from, to: params.localRange.to } : null,
      filterCount: Object.keys(params.filters ?? {}).length,
      error: job.stage === STAGES.FAILED ? job.error : null,
      file: describeReportFile(job),
    };
  });
}
