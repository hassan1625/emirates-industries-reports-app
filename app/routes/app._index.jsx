import { useState } from "react";
import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { RecentReports } from "../components/JobStatus";
import { useReportDownload } from "../components/useReportDownload";
import { REPORTS } from "../config";
import { STAGES } from "../pipeline/job-stages";
import { listRecentJobs } from "../pipeline/recent-jobs";

// Reports with a screen. Phase 2 reports are listed here as their screens are built.
const availableReports = () => Object.values(REPORTS).filter((report) => report.phase === 1);

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  return {
    reports: availableReports().map(({ key, label, description, route }) => ({ key, label, description: description ?? "", route })),
    recent: await listRecentJobs({ db, shop: session.shop, limit: 20 }),
  };
};

const TABS = [
  { key: "all", label: "All", match: () => true },
  { key: "ready", label: "Ready", match: (job) => job.stage === STAGES.READY },
  { key: "building", label: "Building", match: (job) => !job.terminal },
  { key: "failed", label: "Failed", match: (job) => job.stage === STAGES.FAILED },
];

export default function Index() {
  const { reports, recent } = useLoaderData();
  const [tab, setTab] = useState("all");
  const { download, busyId, error } = useReportDownload();
  const shown = recent.filter((job) => TABS.find((t) => t.key === tab).match(job));

  return (
    <s-page heading="Reports">
      <s-section>
        <s-text color="subdued">Build Excel reports from your orders, POS sales and stock, then download them here.</s-text>
      </s-section>

      <s-section heading="Reports">
        <s-stack gap="base">
          {reports.map((report) => (
            <s-stack key={report.key} direction="inline" justifyContent="space-between" alignItems="center" gap="base">
              <s-stack gap="small-300">
                <s-text type="strong">{report.label}</s-text>
                {report.description && <s-text color="subdued">{report.description}</s-text>}
              </s-stack>
              <s-button href={report.route}>Generate</s-button>
            </s-stack>
          ))}
        </s-stack>
      </s-section>

      {error && (
        <s-section>
          <s-banner tone="critical">{error}</s-banner>
        </s-section>
      )}

      {recent.length === 0 ? (
        <s-section heading="Recent exports">
          <s-text color="subdued">No exports yet. Open a report, choose your dates and filters, and select Generate report. Finished files stay here to download.</s-text>
        </s-section>
      ) : (
        <RecentReports jobs={shown} heading="Recent exports" showReport detailsHref={(job) => (job.route ? `${job.route}?job=${job.id}` : undefined)} onDownload={download} downloadingId={busyId}>
          <s-stack direction="inline" gap="small-200">
            {TABS.map((t) => (
              <s-clickable-chip key={t.key} color={tab === t.key ? "strong" : "base"} onClick={() => setTab(t.key)}>
                {t.label} {recent.filter(t.match).length}
              </s-clickable-chip>
            ))}
          </s-stack>
        </RecentReports>
      )}
    </s-page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
