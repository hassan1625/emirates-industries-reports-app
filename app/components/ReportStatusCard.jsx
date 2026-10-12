// The report status card at the top of a report screen. One component for every
// state: nothing requested yet, building (named steps and elapsed time), ready
// (file details and Download), ready with no rows, and failed (with Try again).
import { PROGRESS_STEPS, STAGES, isTerminalStage, stepOfStage } from "../pipeline/job-stages";
import { formatBytes } from "../pipeline/report-file";

const clock = (seconds) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
const elapsedSeconds = (from, to) => Math.max(0, Math.round((to - from) / 1000));

function Steps({ current }) {
  return (
    <s-stack gap="small-200">
      {PROGRESS_STEPS.map((step, index) => {
        const state = index < current ? "done" : index === current ? "current" : "todo";
        return (
          <s-stack key={step.label} direction="inline" gap="small" alignItems="center">
            {state === "done" && <s-icon type="check-circle" tone="success" />}
            {state === "current" && <s-spinner size="base" accessibilityLabel="Working" />}
            {state === "todo" && <s-icon type="circle" color="subdued" />}
            <s-text type={state === "current" ? "strong" : undefined} color={state === "todo" ? "subdued" : undefined}>
              {step.label}
            </s-text>
          </s-stack>
        );
      })}
    </s-stack>
  );
}

// status    { stage, label, detail, error, createdAt, updatedAt } of the job, or null
// file      { name, bytes, rows } of a finished report
// onDownload, onRetry, onClearFilters   button handlers (a button is hidden without its handler)
// now       current time in ms, passed in so the screen can tick it
export default function ReportStatusCard({ status, file = null, onDownload, downloading = false, downloadError = null, onRetry, onClearFilters, now = Date.now() }) {
  if (!status) {
    return (
      <s-section>
        <s-stack direction="inline" gap="base" alignItems="center">
          <s-icon type="table" color="subdued" />
          <s-stack gap="small-300">
            <s-text type="strong">No report yet</s-text>
            <s-text color="subdued">Choose your dates, filters and columns, then select Generate report. Your file will appear here to download.</s-text>
          </s-stack>
        </s-stack>
      </s-section>
    );
  }

  const created = Date.parse(status.createdAt);
  const terminal = isTerminalStage(status.stage);

  if (status.stage === STAGES.FAILED) {
    return (
      <s-section>
        <s-banner tone="critical" heading="We couldn't build your report">
          <s-stack gap="small">
            <s-text>Your dates, filters and columns are saved, so you can try again.</s-text>
            {status.error && <s-text color="subdued">{status.error}</s-text>}
            {onRetry && (
              <s-stack direction="inline">
                <s-button onClick={onRetry}>Try again</s-button>
              </s-stack>
            )}
          </s-stack>
        </s-banner>
      </s-section>
    );
  }

  if (status.stage === STAGES.READY && file?.rows === 0) {
    return (
      <s-section>
        <s-banner tone="info" heading="No orders match these filters">
          <s-stack gap="small">
            <s-text>Nothing was sold or returned in this period with these filters. Try wider dates or remove a filter.</s-text>
            {onClearFilters && (
              <s-stack direction="inline">
                <s-button onClick={onClearFilters}>Clear filters</s-button>
              </s-stack>
            )}
          </s-stack>
        </s-banner>
      </s-section>
    );
  }

  if (status.stage === STAGES.READY) {
    const facts = [Number.isFinite(file?.bytes) ? formatBytes(file.bytes) : null, Number.isFinite(file?.rows) ? `${file.rows.toLocaleString("en-US")} rows` : null, `Built in ${clock(elapsedSeconds(created, Date.parse(status.updatedAt)))}`].filter(Boolean);
    return (
      <s-section>
        <s-stack gap="small">
          <s-stack direction="inline" gap="base" alignItems="center" justifyContent="space-between">
            <s-stack gap="small-300">
              <s-stack direction="inline" gap="small" alignItems="center">
                <s-badge tone="success">Report ready</s-badge>
                <s-text type="strong">Your report is ready</s-text>
              </s-stack>
              {file && <s-text>{file.name}</s-text>}
              <s-text color="subdued">{facts.join(" · ")}</s-text>
            </s-stack>
            {file && onDownload && (
              <s-button variant="primary" icon="download" onClick={onDownload} loading={downloading || undefined}>
                Download Excel file
              </s-button>
            )}
          </s-stack>
          {downloadError && <s-banner tone="critical">{downloadError}</s-banner>}
        </s-stack>
      </s-section>
    );
  }

  const current = Math.max(0, stepOfStage(status.stage));
  return (
    <s-section>
      <s-stack gap="base">
        <s-stack direction="inline" justifyContent="space-between" alignItems="center">
          <s-text type="strong">
            Building your report <s-text color="subdued">Step {current + 1} of {PROGRESS_STEPS.length}</s-text>
          </s-text>
          <s-text color="subdued">{terminal ? "" : `Elapsed ${clock(elapsedSeconds(created, now))}`}</s-text>
        </s-stack>
        <Steps current={current} />
        <s-banner tone="info">This can take several minutes. You can leave this page; your report keeps building and will be listed under Recent reports when you come back.</s-banner>
      </s-stack>
    </s-section>
  );
}
