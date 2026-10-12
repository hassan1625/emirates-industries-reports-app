// The report screen's "Recent reports" list: this shop's latest jobs of one
// report, so a user who closed the page can find a finished file later.
import { REPORTS } from "../config/index.js";
import { STAGE_INFO, STAGES } from "./job-stages.js";
import { describeReportFile } from "./report-file.js";

const parseParams = (text) => {
  try {
    return JSON.parse(text ?? "{}");
  } catch {
    return {};
  }
};

// `reportType` narrows the list to one report; leave it out for every report.
export async function listRecentJobs({ db, shop, reportType, limit = 10 }) {
  const where = { shop, reportType: reportType ?? { in: Object.keys(REPORTS) } }; // debug jobs are never listed
  const jobs = await db.reportJob.findMany({ where, orderBy: { createdAt: "desc" }, take: limit });
  return jobs.map((job) => {
    const params = parseParams(job.params);
    const info = STAGE_INFO[job.stage] ?? STAGE_INFO[STAGES.FAILED];
    const report = REPORTS[params.reportKey ?? job.reportType];
    return {
      id: job.id,
      reportKey: report?.key ?? null,
      reportLabel: report?.label ?? null,
      route: report?.route ?? null,
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
