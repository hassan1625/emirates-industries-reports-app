import { useFetcher, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import ReportRequestForm from "../components/ReportRequestForm";
import { defaultFieldKeys, getReport, getReportFields } from "../config";
import { STORE_TIME_ZONE } from "../config/store";
import { addDays, todayInZone } from "../pipeline/dates";
import { allowedValues, loadFilterOptions } from "../pipeline/filter-options";
import { parseReportRequest } from "../pipeline/report-request";

// This screen is the Report 1 request screen. Which filters it shows comes from
// app/config/reports/r1-general-sales.js.
const REPORT_KEY = "generalSales";

export const loader = async ({ request }) => {
  const { admin } = await authenticate.admin(request);
  const today = todayInZone(STORE_TIME_ZONE);
  return {
    options: await loadFilterOptions(admin),
    defaults: { dateRange: { from: addDays(today, -29), to: today }, fields: defaultFieldKeys(REPORT_KEY) }, // last 30 days
  };
};

// Reads the submitted form back into { dateRange, filters }.
const readRequest = async (request) => {
  const body = await request.json();
  return { dateRange: body.dateRange ?? {}, filters: body.filters ?? {}, fields: body.fields };
};

export const action = async ({ request }) => {
  const { admin } = await authenticate.admin(request);
  const options = await loadFilterOptions(admin);
  const result = parseReportRequest(REPORT_KEY, await readRequest(request), { allowedOptions: allowedValues(options) });
  if (!result.ok) return { errors: result.errors, accepted: null };
  // Starting the job from this request is wired in Step 26.
  return { errors: {}, accepted: result.value };
};

export default function GeneralSalesReport() {
  const { options, defaults } = useLoaderData();
  const fetcher = useFetcher();
  const report = getReport(REPORT_KEY);
  const accepted = fetcher.data?.accepted;
  const fieldLabels = Object.fromEntries(getReportFields(REPORT_KEY).map((field) => [field.key, field.label]));

  return (
    <>
      <ReportRequestForm
        reportKey={REPORT_KEY}
        options={options}
        defaults={defaults}
        errors={fetcher.data?.errors ?? {}}
        busy={fetcher.state !== "idle"}
        onSubmit={(payload) => fetcher.submit(payload, { method: "post", encType: "application/json" })}
      />
      {accepted && (
        <s-page heading={`${report.label}: request accepted`}>
          <s-section heading="What would be generated">
            <s-paragraph>
              {accepted.range.from} to {accepted.range.to} ({accepted.range.timeZone}), {Object.keys(accepted.filters).length === 0 ? "no filters" : `filters: ${JSON.stringify(accepted.filters)}`}. Fields ({accepted.fields.length}): {accepted.fields.map((key) => fieldLabels[key]).join(", ")}. Report generation is connected in Step 26.
            </s-paragraph>
          </s-section>
        </s-page>
      )}
    </>
  );
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
