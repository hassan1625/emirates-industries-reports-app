import { useEffect, useRef } from "react";
import { useFetcher, useLoaderData, useRevalidator, useSearchParams } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import ReportRequestForm from "../components/ReportRequestForm";
import { JobStatus, RecentReports, RequestSummary } from "../components/JobStatus";
import { useReportDownload } from "../components/useReportDownload";
import { defaultFieldKeys, getReportFields } from "../config";
import { STORE_TIME_ZONE } from "../config/store";
import { addDays, todayInZone } from "../pipeline/dates";
import { allowedValues, loadFilterOptions } from "../pipeline/filter-options";
import { STAGES, isTerminalStage } from "../pipeline/job-stages";
import { describeFilters, parseReportRequest } from "../pipeline/report-request";
import { listRecentJobs } from "../pipeline/recent-jobs";
import { startReportJob } from "../pipeline/start-job";

// This screen is the Report 1 request screen. Which filters and fields it shows
// comes from app/config/reports/r1-general-sales.js.
const REPORT_KEY = "generalSales";
const POLL_MS = 4000;

export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const today = todayInZone(STORE_TIME_ZONE);
  return {
    options: await loadFilterOptions(admin, session.shop),
    recent: await listRecentJobs({ db, shop: session.shop, reportType: REPORT_KEY }),
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
  const options = await loadFilterOptions(admin, session.shop);
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
  const { options, defaults, recent } = useLoaderData();
  const revalidator = useRevalidator();
  const { download, busyId, error: downloadError } = useReportDownload();
  const submit = useFetcher();
  const status = useFetcher();
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

  // Poll until the job reaches a final stage.
  useEffect(() => {
    if (!jobId || terminal) return undefined;
    loadStatus(`/app/report-jobs/${jobId}`);
    const timer = setInterval(() => loadStatus(`/app/report-jobs/${jobId}`), POLL_MS);
    return () => clearInterval(timer);
  }, [jobId, terminal, loadStatus]);

  // When the watched job reaches a final stage, refresh the Recent reports list once.
  const refreshedFor = useRef(null);
  useEffect(() => {
    if (jobId && terminal && refreshedFor.current !== jobId) {
      refreshedFor.current = jobId;
      revalidator.revalidate();
    }
  }, [jobId, terminal, revalidator]);

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
          <JobStatus status={current.job} file={current.file} onDownload={() => download(jobId)} downloading={busyId === jobId} downloadError={downloadError} />
          {stage === STAGES.READY && (
            <s-section heading="Your request">
              <RequestSummary request={current.request} fieldLabels={fieldLabels} />
            </s-section>
          )}
        </>
      )}
      {downloadError && !current?.file && <s-banner tone="critical">{downloadError}</s-banner>}
      <RecentReports jobs={recent} onOpen={(id) => setSearchParams({ job: id })} onDownload={download} downloadingId={busyId} />
    </ReportRequestForm>
  );
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
