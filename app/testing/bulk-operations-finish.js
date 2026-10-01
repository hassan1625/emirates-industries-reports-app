// Helpers to simulate Shopify's bulk_operations/finish webhook locally
// (Dev Plan Step 12). Real delivery needs a public HTTPS endpoint; these build
// a correctly signed request so the real webhook route can be exercised
// without a tunnel, and a fake follow-up `node(id:)` result for handler tests.
import { createHmac } from "node:crypto";

export const TOPIC = "bulk_operations/finish";

// Payload per shopify.dev (bulk operations guide): note that `status` and
// `error_code` are LOWERCASE here, unlike the GraphQL BulkOperation object.
// The download URL is NOT in the payload.
export function buildBulkOperationsFinishPayload({
  id = "gid://shopify/BulkOperation/720918",
  status = "completed", // completed | failed | canceled | expired
  errorCode = null, // e.g. "access_denied" | "internal_server_error" | "timeout"
  type = "query",
  createdAt = "2026-01-01T10:00:00Z",
  completedAt = "2026-01-01T10:05:00Z",
} = {}) {
  return {
    admin_graphql_api_id: id,
    completed_at: completedAt,
    created_at: createdAt,
    error_code: errorCode,
    status,
    type,
  };
}

// Shopify signs the raw request body: base64(HMAC-SHA256(body, apiSecret)).
export function signWebhookBody(rawBody, secret) {
  return createHmac("sha256", secret).update(rawBody, "utf8").digest("base64");
}

// Headers Shopify sends, including a valid HMAC for `rawBody`.
export function buildWebhookHeaders({ rawBody, secret, shop, apiVersion = "2026-10", webhookId = crypto.randomUUID() }) {
  return {
    "Content-Type": "application/json",
    "X-Shopify-Topic": TOPIC,
    "X-Shopify-Shop-Domain": shop,
    "X-Shopify-API-Version": apiVersion,
    "X-Shopify-Webhook-Id": webhookId,
    "X-Shopify-Event-Id": webhookId,
    "X-Shopify-Hmac-Sha256": signWebhookBody(rawBody, secret),
  };
}

// What the follow-up `node(id:) { ... on BulkOperation {...} }` query returns.
// Inject this into the Step 14 handler instead of calling Shopify in tests.
export function buildBulkOperationNode({
  id = "gid://shopify/BulkOperation/720918",
  status = "COMPLETED", // GraphQL enum casing (uppercase)
  errorCode = null,
  url = "https://example.test/bulk-result.jsonl",
  partialDataUrl = null,
  objectCount = "0",
} = {}) {
  return { id, status, errorCode, url: status === "COMPLETED" ? url : null, partialDataUrl, objectCount };
}

// Builds the complete signed request (url-agnostic).
export function buildSimulatedRequest({ shop, secret, ...payloadOptions }) {
  const rawBody = JSON.stringify(buildBulkOperationsFinishPayload(payloadOptions));
  return { rawBody, headers: buildWebhookHeaders({ rawBody, secret, shop }) };
}
