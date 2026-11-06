import { boundary } from "@shopify/shopify-app-react-router/server";
import ReportScreen from "../components/ReportScreen";
import { reportScreenAction, reportScreenLoader } from "../pipeline/report-screen.server";

// The Stock Report by Location screen. Its filters come from
// app/config/reports/r2-stock-by-location.js.
const REPORT_KEY = "stockByLocation";

export const loader = ({ request }) => reportScreenLoader({ request, reportKey: REPORT_KEY });
export const action = ({ request }) => reportScreenAction({ request, reportKey: REPORT_KEY });

export default function StockReport() {
  return <ReportScreen reportKey={REPORT_KEY} />;
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
