import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import {
  buildBulkOperationsFinishPayload,
  signWebhookBody,
  buildSimulatedRequest,
  buildBulkOperationNode,
  TOPIC,
} from "../app/testing/bulk-operations-finish.js";

test("payload has exactly the documented fields, lowercase status", () => {
  const payload = buildBulkOperationsFinishPayload();
  assert.deepEqual(Object.keys(payload).sort(), ["admin_graphql_api_id", "completed_at", "created_at", "error_code", "status", "type"]);
  assert.equal(payload.status, "completed");
  assert.equal(payload.error_code, null);
  assert.ok(!("url" in payload), "download URL is not part of the webhook payload");
});

test("failed operation carries a lowercase error code", () => {
  const payload = buildBulkOperationsFinishPayload({ status: "failed", errorCode: "timeout" });
  assert.equal(payload.status, "failed");
  assert.equal(payload.error_code, "timeout");
});

test("HMAC is base64 HMAC-SHA256 of the raw body (matches Shopify's scheme)", () => {
  const body = '{"a":1}';
  const expected = createHmac("sha256", "s3cret").update(body).digest("base64");
  assert.equal(signWebhookBody(body, "s3cret"), expected);
  assert.notEqual(signWebhookBody(body, "other"), expected);
  assert.notEqual(signWebhookBody(body + " ", "s3cret"), expected);
});

test("simulated request is signed over the exact body it sends", () => {
  const { rawBody, headers } = buildSimulatedRequest({ shop: "x.myshopify.com", secret: "s3cret", id: "gid://shopify/BulkOperation/1" });
  assert.equal(headers["X-Shopify-Hmac-Sha256"], signWebhookBody(rawBody, "s3cret"));
  assert.equal(headers["X-Shopify-Topic"], TOPIC);
  assert.equal(headers["X-Shopify-Shop-Domain"], "x.myshopify.com");
  assert.equal(JSON.parse(rawBody).admin_graphql_api_id, "gid://shopify/BulkOperation/1");
});

test("node lookup fake: url only present when COMPLETED", () => {
  assert.ok(buildBulkOperationNode({ status: "COMPLETED" }).url);
  assert.equal(buildBulkOperationNode({ status: "FAILED", errorCode: "TIMEOUT" }).url, null);
});
