// Job status and request summary shown under the request form (Dev Plan Step 26).
import { STAGES, isTerminalStage } from "../pipeline/job-stages";
import { formatBytes } from "../pipeline/report-file";
import { STORE_TIME_ZONE } from "../config/store";

const seconds = (from, to) => Math.max(0, Math.round((to - from) / 1000));

// status  { stage, label, detail, error, createdAt, updatedAt } from the job status endpoint
// file    { name, bytes, rows } of a finished report, with onDownload() to fetch it
export function JobStatus({ status, file = null, onDownload, downloading = false, downloadError = null }) {
  const terminal = isTerminalStage(status.stage);
  const failed = status.stage === STAGES.FAILED;
  const ready = status.stage === STAGES.READY;
  const elapsed = seconds(Date.parse(status.createdAt), terminal ? Date.parse(status.updatedAt) : Date.now());
  return (
    <s-section heading="Report status">
      <s-stack gap="base">
        <s-stack direction="inline" gap="small" alignItems="center">
          {!terminal && <s-spinner accessibilityLabel="Working" />}
          <s-badge tone={failed ? "critical" : ready ? "success" : "info"}>{status.label}</s-badge>
          <s-text>{terminal ? `took ${elapsed}s` : `${elapsed}s so far`}</s-text>
        </s-stack>
        <s-paragraph>{status.detail}</s-paragraph>
        {!terminal && <s-paragraph>This page updates by itself. A report can take several minutes, longer for big date ranges. You can leave this page: your report keeps building, and it will be listed under Recent reports when you come back.</s-paragraph>}
        {ready && file && (
          <s-stack gap="small">
            <s-text>
              {file.name}
              {Number.isFinite(file.rows) ? ` · ${file.rows.toLocaleString("en-US")} rows` : ""}
              {Number.isFinite(file.bytes) ? ` · ${formatBytes(file.bytes)}` : ""}
            </s-text>
            {onDownload && (
              <s-stack direction="inline">
                <s-button variant="primary" onClick={onDownload} loading={downloading || undefined}>
                  Download Excel file
                </s-button>
              </s-stack>
            )}
            {downloadError && <s-banner tone="critical">{downloadError}</s-banner>}
          </s-stack>
        )}
        {failed && status.error && <s-banner tone="critical">{status.error}</s-banner>}
      </s-stack>
    </s-section>
  );
}

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

// jobs  [{ id, stage, label, terminal, createdAt, range, filterCount, error, file }] from the recent-jobs list
export function RecentReports({ jobs, onOpen, onDownload, downloadingId = null }) {
  if (!jobs?.length) return null;
  const tone = (job) => (job.stage === STAGES.READY ? "success" : job.stage === STAGES.FAILED ? "critical" : "info");
  return (
    <s-section heading="Recent reports">
      <s-table>
        <s-table-header-row>
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
                  {onOpen && (
                    <s-button variant="tertiary" onClick={() => onOpen(job.id)}>
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
