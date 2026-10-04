import { test, describe } from "node:test";
import assert from "node:assert/strict";
import "@shopify/shopify-api/adapters/web-api";
import { shopifyApi, ApiVersion, WebhookValidationErrorReason } from "@shopify/shopify-api";
import { handleBulkOperationsFinish, fetchBulkOperation } from "../app/pipeline/bulk-finish.js";
import {
  buildBulkOperationsFinishPayload,
  buildBulkOperationNode,
  buildSimulatedRequest,
} from "../app/testing/bulk-operations-finish.js";

const SHOP = "demo.myshopify.com";
const ORDERS_ID = "gid://shopify/BulkOperation/111";
const PRODUCTS_ID = "gid://shopify/BulkOperation/222";

// Minimal in-memory stand-ins for Prisma and the admin client.
const fakeDb = (jobs) => ({
  reportJob: {
    findFirst: async ({ where }) =>
      jobs.find(
        (job) => job.shop === where.shop && where.OR.some((clause) => Object.entries(clause).every(([k, v]) => job[k] === v)),
      ) ?? null,
  },
});
const job = { id: "job1", shop: SHOP, ordersBulkOpId: ORDERS_ID, productsBulkOpId: PRODUCTS_ID };
const fakeAdmin = (node, calls = []) => ({
  graphql: async (query, options) => {
    calls.push({ query, options });
    return { json: async () => ({ data: { node } }) };
  },
});

describe("handleBulkOperationsFinish", () => {
  test("orders export finished: looks up the operation and reports which export it was", async () => {
    const calls = [];
    const node = buildBulkOperationNode({ id: ORDERS_ID });
    const payload = buildBulkOperationsFinishPayload({ id: ORDERS_ID });
    const result = await handleBulkOperationsFinish({ shop: SHOP, payload, admin: fakeAdmin(node, calls), db: fakeDb([job]) });

    assert.equal(result.handled, true);
    assert.equal(result.which, "orders");
    assert.equal(result.operation.status, "COMPLETED");
    assert.ok(result.operation.url);
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].options.variables, { id: ORDERS_ID });
  });

  test("products export is recognised too", async () => {
    const result = await handleBulkOperationsFinish({
      shop: SHOP,
      payload: buildBulkOperationsFinishPayload({ id: PRODUCTS_ID }),
      admin: fakeAdmin(buildBulkOperationNode({ id: PRODUCTS_ID })),
      db: fakeDb([job]),
    });
    assert.equal(result.which, "products");
  });

  test("failed operation is reported with its error code and no download URL", async () => {
    const node = buildBulkOperationNode({ id: ORDERS_ID, status: "FAILED", errorCode: "TIMEOUT" });
    const result = await handleBulkOperationsFinish({
      shop: SHOP,
      payload: buildBulkOperationsFinishPayload({ id: ORDERS_ID, status: "failed", errorCode: "timeout" }),
      admin: fakeAdmin(node),
      db: fakeDb([job]),
    });
    assert.equal(result.operation.status, "FAILED");
    assert.equal(result.operation.errorCode, "TIMEOUT");
    assert.equal(result.operation.url, null);
  });

  test("operation that is not one of our jobs is ignored without calling Shopify", async () => {
    const calls = [];
    const result = await handleBulkOperationsFinish({
      shop: SHOP,
      payload: buildBulkOperationsFinishPayload({ id: "gid://shopify/BulkOperation/999" }),
      admin: fakeAdmin(null, calls),
      db: fakeDb([job]),
    });
    assert.deepEqual(result, { handled: false, reason: "unknown-operation", id: "gid://shopify/BulkOperation/999" });
    assert.equal(calls.length, 0);
  });

  test("another shop's job is not matched", async () => {
    const result = await handleBulkOperationsFinish({
      shop: "other.myshopify.com",
      payload: buildBulkOperationsFinishPayload({ id: ORDERS_ID }),
      admin: fakeAdmin(null),
      db: fakeDb([job]),
    });
    assert.equal(result.handled, false);
  });

  test("payload without an id is ignored", async () => {
    const result = await handleBulkOperationsFinish({ shop: SHOP, payload: {}, admin: fakeAdmin(null), db: fakeDb([job]) });
    assert.deepEqual(result, { handled: false, reason: "missing-operation-id" });
  });

  test("Shopify not knowing the operation throws so the delivery is retried", async () => {
    await assert.rejects(
      handleBulkOperationsFinish({
        shop: SHOP,
        payload: buildBulkOperationsFinishPayload({ id: ORDERS_ID }),
        admin: fakeAdmin(null),
        db: fakeDb([job]),
      }),
      /no BulkOperation/,
    );
  });

  test("onFinished receives the result (hook for Step 15 job chaining)", async () => {
    let received;
    await handleBulkOperationsFinish({
      shop: SHOP,
      payload: buildBulkOperationsFinishPayload({ id: ORDERS_ID }),
      admin: fakeAdmin(buildBulkOperationNode({ id: ORDERS_ID })),
      db: fakeDb([job]),
      onFinished: async (result) => {
        received = result;
      },
    });
    assert.equal(received.which, "orders");
    assert.equal(received.job.id, "job1");
  });

  test("a duplicate delivery gives the same result (reads only)", async () => {
    const args = {
      shop: SHOP,
      payload: buildBulkOperationsFinishPayload({ id: ORDERS_ID }),
      admin: fakeAdmin(buildBulkOperationNode({ id: ORDERS_ID })),
      db: fakeDb([job]),
    };
    assert.deepEqual(await handleBulkOperationsFinish(args), await handleBulkOperationsFinish(args));
  });
});

test("fetchBulkOperation surfaces GraphQL errors", async () => {
  const admin = { graphql: async () => ({ json: async () => ({ errors: [{ message: "boom" }] }) }) };
  await assert.rejects(fetchBulkOperation(admin, ORDERS_ID), /boom/);
});

// The same library the app uses (authenticate.webhook -> api.webhooks.validate)
// must accept the simulator's signature, and reject a wrong secret.
describe("simulated webhook vs Shopify's own validator", () => {
  const api = shopifyApi({
    apiKey: "key",
    apiSecretKey: "s3cret",
    scopes: ["read_orders"],
    hostName: "localhost",
    apiVersion: ApiVersion.July26,
    isEmbeddedApp: true,
  });
  const toRequest = ({ rawBody, headers }) => new Request("http://localhost/webhooks/bulk-operations-finish", { method: "POST", headers, body: rawBody });

  test("valid signature is accepted and parsed as the right topic and shop", async () => {
    const sim = buildSimulatedRequest({ shop: SHOP, secret: "s3cret", id: ORDERS_ID });
    const check = await api.webhooks.validate({ rawBody: sim.rawBody, rawRequest: toRequest(sim) });
    assert.equal(check.valid, true);
    assert.equal(check.domain, SHOP);
    // The library normalises topics to the GraphQL enum form.
    assert.equal(check.topic, "BULK_OPERATIONS_FINISH");
  });

  test("signature made with the wrong secret is rejected as an invalid HMAC", async () => {
    const sim = buildSimulatedRequest({ shop: SHOP, secret: "wrong", id: ORDERS_ID });
    const check = await api.webhooks.validate({ rawBody: sim.rawBody, rawRequest: toRequest(sim) });
    assert.equal(check.valid, false);
    assert.equal(check.reason, WebhookValidationErrorReason.InvalidHmac);
  });

  test("tampered body is rejected", async () => {
    const sim = buildSimulatedRequest({ shop: SHOP, secret: "s3cret", id: ORDERS_ID });
    const check = await api.webhooks.validate({ rawBody: sim.rawBody.replace("completed", "failed!"), rawRequest: toRequest(sim) });
    assert.equal(check.valid, false);
  });
});
