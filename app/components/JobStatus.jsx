// Job status and request summary shown under the request form (Dev Plan Step 26).
import { STAGES, isTerminalStage } from "../pipeline/job-stages";

const seconds = (from, to) => Math.max(0, Math.round((to - from) / 1000));

// status  { stage, label, detail, error, createdAt, updatedAt } from the job status endpoint
export function JobStatus({ status }) {
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
        {!terminal && <s-paragraph>This page updates by itself. Large date ranges can take a few minutes.</s-paragraph>}
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

