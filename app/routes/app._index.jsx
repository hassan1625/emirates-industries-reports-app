import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { REPORTS } from "../config";

export const loader = async ({ request }) => {
  await authenticate.admin(request);

  return null;
};

export default function Index() {
  return (
    <s-page heading="Emirates Industries Reports">
      <s-section heading="Reports">
        <s-stack gap="base">
          {Object.values(REPORTS)
            .filter((report) => report.phase === 1)
            .map((report) => (
              <s-link key={report.key} href={report.route}>
                {report.label}
              </s-link>
            ))}
        </s-stack>
      </s-section>
    </s-page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
