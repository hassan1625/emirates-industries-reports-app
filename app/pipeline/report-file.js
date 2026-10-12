// How a finished report is named and described to the person downloading it.
import { getReport } from "../config/index.js";

const parseParams = (text) => {
  try {
    return JSON.parse(text ?? "{}");
  } catch {
    return {};
  }
};

// e.g. "General-Sales-Report_2026-10-05_to_2026-10-11.xlsx"
export function reportFileName(job) {
  const params = parseParams(job.params);
  let label = "Report";
  try {
    label = getReport(params.reportKey ?? job.reportType).label;
  } catch {
    // an unknown report type keeps the generic name
  }
  const range = params.localRange?.from && params.localRange?.to ? `_${params.localRange.from}_to_${params.localRange.to}` : "";
  return `${label.replace(/[^\w]+/g, "-").replace(/^-+|-+$/g, "")}${range}.xlsx`;
}

// { name, bytes, rows } of a READY job's file, or null.
export function describeReportFile(job) {
  if (job.stage !== "READY" || !job.resultFileUrl) return null;
  return { name: reportFileName(job), bytes: job.resultBytes ?? null, rows: job.resultRows ?? null };
}

// "21.8 MB", "140 KB"
export function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
