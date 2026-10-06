import { useEffect, useRef } from "react";
import { useFetcher, useLoaderData, useSearchParams } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import ReportRequestForm from "../components/ReportRequestForm";
import ReportPreview from "../components/ReportPreview";
import { JobStatus, RequestSummary } from "../components/JobStatus";
import { defaultFieldKeys, getReportFields } from "../config";
import { STORE_TIME_ZONE } from "../config/store";
import { addDays, todayInZone } from "../pipeline/dates";
import { allowedValues, loadFilterOptions } from "../pipeline/filter-options";
import { STAGES, isTerminalStage } from "../pipeline/job-stages";
import { describeFilters, parseReportRequest } from "../pipeline/report-request";
import { startReportJob } from "../pipeline/start-job";

// This screen is the Report 1 request screen. Which filters and fields it shows
// comes from app/config/reports/r1-general-sales.js.
const REPORT_KEY = "generalSales";
const POLL_MS = 4000;

export const loader = async ({ request }) => {
  const { admin } = await authenticate.admin(request);
  const today = todayInZone(STORE_TIME_ZONE);
  return {
    options: await loadFilterOptions(admin),
    defaults: { dateRange: { from: addDays(today, -29), to: today }, fields: defaultFieldKeys(REPORT_KEY) }, // last 30 days
  };
};

// Reads the submitted request body back into { dateRange, filters, fields }.
const readRequest = async (request) => {
  const body = await request.json();
  return { dateRange: body.dateRange ?? {}, filters: body.filters ?? {}, fields: body.fields };
};

// Validates the request again on the server, then starts the real job.
export const action = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const options = await loadFilterOptions(admin);
  const result = parseReportRequest(REPORT_KEY, await readRequest(request), { allowedOptions: allowedValues(options) });
  if (!result.ok) return { errors: result.errors, jobId: null };

  const { range, filters, fields } = result.value;
  try {
    const job = await startReportJob({
      db,
      admin,
      shop: session.shop,
      reportType: REPORT_KEY,
      range: { start: range.start, end: range.end },
      params: { reportKey: REPORT_KEY, filters, filterSummary: describeFilters(REPORT_KEY, filters, options), fields, localRange: { from: range.from, to: range.to, timeZone: range.timeZone } },
    });
    return { errors: {}, jobId: job.id };
  } catch (error) {
    // Shopify refused to start the export (for example it is busy).
    return { errors: { form: `Could not start the report: ${error.message}` }, jobId: null };
  }
};

export default function GeneralSalesReport() {
  const { options, defaults } = useLoaderData();
  const submit = useFetcher();
  const status = useFetcher();
  const preview = useFetcher();
  const [searchParams, setSearchParams] = useSearchParams();
  const fieldLabels = Object.fromEntries(getReportFields(REPORT_KEY).map((field) => [field.key, field.label]));

  // The job being watched: the one just started, or the one named in the URL
  // (so reloading the page keeps following it).
  const jobId = submit.data?.jobId ?? searchParams.get("job");
  useEffect(() => {
    if (submit.data?.jobId) setSearchParams({ job: submit.data.jobId }, { replace: true });
  }, [submit.data?.jobId, setSearchParams]);

  const current = status.data?.job?.id === jobId ? status.data : null;
  const stage = current?.job.stage;
  const terminal = stage ? isTerminalStage(stage) : false;
  const loadStatus = status.load;
  const loadPreview = preview.load;

  // Poll until the job reaches a final stage.
  useEffect(() => {
    if (!jobId || terminal) return undefined;
    loadStatus(`/app/report-jobs/${jobId}`);
    const timer = setInterval(() => loadStatus(`/app/report-jobs/${jobId}`), POLL_MS);
    return () => clearInterval(timer);
  }, [jobId, terminal, loadStatus]);

  // Fetch the test preview once, when the data is ready.
  const previewedFor = useRef(null);
  useEffect(() => {
    if (jobId && stage === STAGES.READY && previewedFor.current !== jobId) {
      previewedFor.current = jobId;
      loadPreview(`/app/report-jobs/${jobId}?preview=1`);
    }
  }, [jobId, stage, loadPreview]);

  const previewData = preview.data?.job?.id === jobId ? preview.data : null;

  return (
    <ReportRequestForm
      reportKey={REPORT_KEY}
      options={options}
      defaults={defaults}
      errors={submit.data?.errors ?? {}}
      busy={submit.state !== "idle"}
      onSubmit={(payload) => submit.submit(payload, { method: "post", encType: "application/json" })}
    >
      {submit.data?.errors?.form && <s-banner tone="critical">{submit.data.errors.form}</s-banner>}
      {current && (
        <>
          <JobStatus status={current.job} />
          {stage === STAGES.READY && (
            <s-section heading="Your request">
              <RequestSummary request={current.request} fieldLabels={fieldLabels} />
            </s-section>
          )}
        </>
      )}
      {stage === STAGES.READY && !previewData && preview.state !== "idle" && <s-paragraph>Preparing the preview...</s-paragraph>}
      {previewData?.preview && <ReportPreview preview={previewData.preview} />}
      {previewData?.previewError && <s-banner tone="critical">Preview failed: {previewData.previewError}</s-banner>}
    </ReportRequestForm>
  );
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
