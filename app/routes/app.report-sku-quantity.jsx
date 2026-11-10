import { boundary } from "@shopify/shopify-app-react-router/server";
import ReportScreen from "../components/ReportScreen";
import { reportScreenAction, reportScreenLoader } from "../pipeline/report-screen.server";

// The Quantity Report for SKU (Yearly) screen. Its filters come from
// app/config/reports/r5-sku-quantity.js.
const REPORT_KEY = "skuQuantity";

export const loader = ({ request }) => reportScreenLoader({ request, reportKey: REPORT_KEY });
export const action = ({ request }) => reportScreenAction({ request, reportKey: REPORT_KEY });

export default function SkuQuantityReport() {
  return <ReportScreen reportKey={REPORT_KEY} />;
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
