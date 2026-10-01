// Sends a fake, correctly signed bulk_operations/finish webhook to a local
// server (Dev Plan Step 12).
//
//   SHOPIFY_API_SECRET=<secret> npm run simulate:webhook -- \
//     --url http://localhost:<port>/webhooks/bulk-operations-finish \
//     --shop hassan-app-development.myshopify.com \
//     --id gid://shopify/BulkOperation/123 [--status failed --error-code timeout]
//
// Add --dry-run to print the request without sending it. Get the secret with
// `npm run env -- show`, or from the Partner Dashboard (Client secret).
import { parseArgs } from "node:util";
import { buildSimulatedRequest } from "../app/testing/bulk-operations-finish.js";

const { values } = parseArgs({
  options: {
    url: { type: "string", default: process.env.SIMULATE_WEBHOOK_URL ?? "http://localhost:3000/webhooks/bulk-operations-finish" },
    shop: { type: "string", default: process.env.SHOPIFY_SHOP },
    id: { type: "string" },
    status: { type: "string", default: "completed" },
    "error-code": { type: "string" },
    type: { type: "string", default: "query" },
    "dry-run": { type: "boolean", default: false },
  },
});

const secret = process.env.SHOPIFY_API_SECRET;
if (!secret) {
  console.error("SHOPIFY_API_SECRET is required (it is used to sign the request).");
  process.exit(1);
}
if (!values.shop) {
  console.error("--shop (or SHOPIFY_SHOP) is required, e.g. my-store.myshopify.com");
  process.exit(1);
}

const { rawBody, headers } = buildSimulatedRequest({
  shop: values.shop,
  secret,
  id: values.id,
  status: values.status,
  errorCode: values["error-code"] ?? null,
  type: values.type,
});

console.log(`POST ${values.url}\n${rawBody}`);
if (values["dry-run"]) {
  console.log("\nHeaders:", { ...headers, "X-Shopify-Hmac-Sha256": headers["X-Shopify-Hmac-Sha256"] });
  process.exit(0);
}

try {
  const response = await fetch(values.url, { method: "POST", headers, body: rawBody });
  console.log(`\n-> ${response.status} ${response.statusText}`);
  process.exit(response.ok ? 0 : 1);
} catch (error) {
  console.error(`\nRequest failed: ${error.message}. Is the dev server running at that URL?`);
  process.exit(1);
}
