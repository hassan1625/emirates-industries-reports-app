// The request summary and the Recent reports table of the report screens.
import { STAGES } from "../pipeline/job-stages";
import { formatBytes } from "../pipeline/report-file";
import { STORE_TIME_ZONE } from "../config/store";

// request  { range: { from, to, timeZone }, filters, fields } of the job
export function RequestSummary({ request, fieldLabels }) {
  if (!request?.range) return null;
  const filterCount = Object.keys(request.filters ?? {}).length;
  return (
    <s-paragraph>
      {request.range.from} to {request.range.to} ({request.range.timeZone}),{" "}
      {filterCount === 0 ? "no filters" : `filters: ${JSON.stringify(request.filters)}`}, {request.fields?.length ?? "all"} fields
      {request.fields ? `: ${request.fields.map((key) => fieldLabels[key]).join(", ")}` : ""}.
    </s-paragraph>
  );
}


// The store-time date and time shown in lists, e.g. "13 Oct 2026, 01:04".
export const formatCreated = (value) => new Date(value).toLocaleString("en-GB", { timeZone: STORE_TIME_ZONE, day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

// jobs  [{ id, reportLabel, route, stage, label, terminal, createdAt, range, filterCount, error, file }]
// showReport   adds a Report column (for lists that mix reports)
// onOpen       (id) => void for "Details"; or detailsHref(job) => url to link instead
export function RecentReports({ jobs, heading = "Recent reports", showReport = false, onOpen, detailsHref, onDownload, downloadingId = null, children }) {
  if (!jobs?.length) return null;
  const tone = (job) => (job.stage === STAGES.READY ? "success" : job.stage === STAGES.FAILED ? "critical" : "info");
  return (
    <s-section heading={heading}>
      {children}
      <s-table>
        <s-table-header-row>
          {showReport && <s-table-header>Report</s-table-header>}
          <s-table-header>Created</s-table-header>
          <s-table-header>Date range</s-table-header>
          <s-table-header>Filters</s-table-header>
          <s-table-header>Status</s-table-header>
          <s-table-header>File</s-table-header>
          <s-table-header></s-table-header>
        </s-table-header-row>
        <s-table-body>
          {jobs.map((job) => (
            <s-table-row key={job.id}>
              {showReport && <s-table-cell>{job.reportLabel ?? ""}</s-table-cell>}
              <s-table-cell>{formatCreated(job.createdAt)}</s-table-cell>
              <s-table-cell>{job.range ? `${job.range.from} to ${job.range.to}` : ""}</s-table-cell>
              <s-table-cell>{job.filterCount ? `${job.filterCount} applied` : "None"}</s-table-cell>
              <s-table-cell>
                <s-badge tone={tone(job)}>{job.label}</s-badge>
              </s-table-cell>
              <s-table-cell>{job.file ? [Number.isFinite(job.file.rows) ? `${job.file.rows.toLocaleString("en-US")} rows` : null, Number.isFinite(job.file.bytes) ? formatBytes(job.file.bytes) : null].filter(Boolean).join(" · ") : ""}</s-table-cell>
              <s-table-cell>
                <s-stack direction="inline" gap="small">
                  {job.file && onDownload && (
                    <s-button variant="tertiary" onClick={() => onDownload(job.id)} loading={downloadingId === job.id || undefined}>
                      Download
                    </s-button>
                  )}
                  {(onOpen || detailsHref) && (
                    <s-button variant="tertiary" href={detailsHref ? detailsHref(job) : undefined} onClick={onOpen && !detailsHref ? () => onOpen(job.id) : undefined}>
                      {job.terminal ? "Details" : "View progress"}
                    </s-button>
                  )}
                </s-stack>
              </s-table-cell>
            </s-table-row>
          ))}
        </s-table-body>
      </s-table>
    </s-section>
  );
}
