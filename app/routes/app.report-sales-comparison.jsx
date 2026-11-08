import { boundary } from "@shopify/shopify-app-react-router/server";
import ReportScreen from "../components/ReportScreen";
import { reportScreenAction, reportScreenLoader } from "../pipeline/report-screen.server";

// The Sales Comparison Report (Yearly) screen. Its filters come from
// app/config/reports/r3-sales-comparison.js.
const REPORT_KEY = "salesComparison";

export const loader = ({ request }) => reportScreenLoader({ request, reportKey: REPORT_KEY });
export const action = ({ request }) => reportScreenAction({ request, reportKey: REPORT_KEY });

export default function SalesComparisonReport() {
  return <ReportScreen reportKey={REPORT_KEY} />;
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
