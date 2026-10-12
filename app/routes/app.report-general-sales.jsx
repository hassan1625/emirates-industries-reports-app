import { boundary } from "@shopify/shopify-app-react-router/server";
import ReportScreen from "../components/ReportScreen";
import { reportScreenAction, reportScreenLoader } from "../pipeline/report-screen.server";

// The General Sales Report screen. Its filters and fields come from
// app/config/reports/r1-general-sales.js.
const REPORT_KEY = "generalSales";

export const loader = ({ request }) => reportScreenLoader({ request, reportKey: REPORT_KEY });
export const action = ({ request }) => reportScreenAction({ request, reportKey: REPORT_KEY });

export default function GeneralSalesReport() {
  return <ReportScreen reportKey={REPORT_KEY} />;
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
