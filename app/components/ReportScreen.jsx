// A report's request screen: the form, the status card and the Recent reports
// list. The same component serves every report; the route only names the report.
import { useEffect, useRef, useState } from "react";
import { useFetcher, useLoaderData, useRevalidator, useSearchParams } from "react-router";
import ReportRequestForm from "./ReportRequestForm";
import { RecentReports } from "./JobStatus";
import ReportStatusCard from "./ReportStatusCard";
import { useReportDownload } from "./useReportDownload";
import { isTerminalStage } from "../pipeline/job-stages";

const POLL_MS = 4000;

// reportKey  key in app/config/reports; the screen follows that report's config
export default function ReportScreen({ reportKey }) {
  const { options, defaults, recent } = useLoaderData();
  const revalidator = useRevalidator();
  const { download, busyId, error: downloadError } = useReportDownload();
  const submit = useFetcher();
  const status = useFetcher();
  const [searchParams, setSearchParams] = useSearchParams();

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

  // Elapsed time on the status card ticks every second while a report builds.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!jobId || terminal) return undefined;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [jobId, terminal]);

  return (
    <ReportRequestForm
      reportKey={reportKey}
      options={options}
      defaults={defaults}
      errors={submit.data?.errors ?? {}}
      busy={submit.state !== "idle"}
      onSubmit={(payload) => submit.submit(payload, { method: "post", encType: "application/json" })}
      renderStatus={({ submit: resubmit, clearFilters }) => (
        <>
          {submit.data?.errors?.form && (
            <s-section>
              <s-banner tone="critical">{submit.data.errors.form}</s-banner>
            </s-section>
          )}
          <ReportStatusCard
            status={current?.job ?? null}
            file={current?.file ?? null}
            now={now}
            onDownload={() => download(jobId)}
            downloading={busyId === jobId}
            downloadError={downloadError}
            onRetry={resubmit}
            onClearFilters={clearFilters}
          />
        </>
      )}
    >
      {downloadError && !current?.file && (
        <s-section>
          <s-banner tone="critical">{downloadError}</s-banner>
        </s-section>
      )}
      <RecentReports jobs={recent} onOpen={(id) => setSearchParams({ job: id })} onDownload={download} downloadingId={busyId} />
    </ReportRequestForm>
  );
}

