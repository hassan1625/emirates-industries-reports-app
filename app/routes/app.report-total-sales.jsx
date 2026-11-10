import { boundary } from "@shopify/shopify-app-react-router/server";
import ReportScreen from "../components/ReportScreen";
import { reportScreenAction, reportScreenLoader } from "../pipeline/report-screen.server";

// The Total Sales Report by Date Range screen. Its filters come from
// app/config/reports/r4-total-sales-matrix.js.
const REPORT_KEY = "totalSalesMatrix";

export const loader = ({ request }) => reportScreenLoader({ request, reportKey: REPORT_KEY });
export const action = ({ request }) => reportScreenAction({ request, reportKey: REPORT_KEY });

export default function TotalSalesReport() {
  return <ReportScreen reportKey={REPORT_KEY} />;
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
