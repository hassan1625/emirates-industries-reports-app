import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { buildReturnIndex, returnReasonFor, returnedQuantityFor, reconcileReturnQuantities, COUNTED_RETURN_STATUSES } from "../app/pipeline/returns.js";
import { groupOrders } from "../app/pipeline/bulk-file.js";

const L1 = "gid://shopify/LineItem/1";
const L2 = "gid://shopify/LineItem/2";
const returnLine = (lineItemId, quantity, reason) => ({
  id: `gid://shopify/ReturnLineItem/${Math.random()}`,
  quantity,
  returnReasonDefinition: reason ? { name: reason, handle: reason.toLowerCase() } : null,
  fulfillmentLineItem: { lineItem: { id: lineItemId } },
});
const ret = (status, ...returnLineItems) => ({ id: `gid://shopify/Return/${Math.random()}`, status, returnLineItems });

describe("buildReturnIndex", () => {
  test("maps a return to its line item with quantity and readable reason", () => {
    const index = buildReturnIndex({ returns: [ret("CLOSED", returnLine(L1, 2, "Too small"))] });
    assert.deepEqual(index.get(L1), { quantity: 2, reasons: ["Too small"] });
    assert.equal(returnReasonFor(L1, index), "Too small");
    assert.equal(returnedQuantityFor(L1, index), 2);
  });

  test("canceled, declined and requested returns are ignored", () => {
    for (const status of ["CANCELED", "DECLINED", "REQUESTED"]) {
      assert.equal(buildReturnIndex({ returns: [ret(status, returnLine(L1, 1, "Color"))] }).size, 0, status);
    }
    assert.deepEqual(COUNTED_RETURN_STATUSES, ["OPEN", "CLOSED"]);
  });

  test("open returns count", () => {
    assert.equal(buildReturnIndex({ returns: [ret("OPEN", returnLine(L1, 1, "Style"))] }).size, 1);
  });

  test("a line returned twice combines quantities and keeps distinct reasons once", () => {
    const index = buildReturnIndex({
      returns: [ret("CLOSED", returnLine(L1, 1, "Too small")), ret("CLOSED", returnLine(L1, 2, "Too small")), ret("CLOSED", returnLine(L1, 1, "Color"))],
    });
    assert.equal(index.get(L1).quantity, 4);
    assert.equal(returnReasonFor(L1, index), "Too small; Color");
  });

  test("a canceled return does not leak into a counted return of the same line", () => {
    const index = buildReturnIndex({ returns: [ret("CANCELED", returnLine(L1, 5, "Color")), ret("CLOSED", returnLine(L1, 1, "Too big"))] });
    assert.equal(index.get(L1).quantity, 1);
    assert.equal(returnReasonFor(L1, index), "Too big");
  });

  test("a return line not tied to a sold line is skipped", () => {
    const orphan = { quantity: 1, returnReasonDefinition: { name: "Other" }, fulfillmentLineItem: null };
    assert.equal(buildReturnIndex({ returns: [ret("CLOSED", orphan)] }).size, 0);
  });

  test("Shopify's 'Unknown' reason is passed through unchanged", () => {
    assert.equal(returnReasonFor(L1, buildReturnIndex({ returns: [ret("CLOSED", returnLine(L1, 1, "Unknown"))] })), "Unknown");
  });

  test("a return with no reason still counts the quantity but gives no reason text", () => {
    const index = buildReturnIndex({ returns: [ret("CLOSED", returnLine(L1, 1, null))] });
    assert.equal(returnedQuantityFor(L1, index), 1);
    assert.equal(returnReasonFor(L1, index), null);
  });

  test("an order without returns gives an empty index; unreturned lines give null/0", () => {
    const index = buildReturnIndex({ returns: [] });
    assert.equal(index.size, 0);
    assert.equal(returnReasonFor(L2, index), null);
    assert.equal(returnedQuantityFor(L2, index), 0);
    assert.equal(buildReturnIndex({}).size, 0);
  });
});

describe("reconcileReturnQuantities", () => {
  async function* orders(list) {
    yield* list;
  }

  test("counts agreement between returns and quantity - currentQuantity", async () => {
    const stats = await reconcileReturnQuantities(
      orders([
        { id: "O1", returns: [ret("CLOSED", returnLine(L1, 2, "Too small"))], lineItems: [{ id: L1, quantity: 3, currentQuantity: 1 }, { id: L2, quantity: 1, currentQuantity: 1 }] },
        { id: "O2", returns: [ret("CLOSED", returnLine(L1, 1, "Color"))], lineItems: [{ id: L1, quantity: 1, currentQuantity: 1 }] },
        { id: "O3", returns: [], lineItems: [{ id: L1, quantity: 2, currentQuantity: 0 }] },
      ]),
    );
    assert.equal(stats.lineItems, 4);
    assert.equal(stats.agree, 2);
    assert.equal(stats.withReasonButNoReduction, 1);
    assert.equal(stats.reducedButNoReturn, 1);
    assert.equal(stats.sampleDisagreements.length, 2);
  });
});

describe("with the real grouped shape", () => {
  test("a return line nested under its return resolves to the right line item", async () => {
    const lines = [
      { id: "gid://shopify/Order/1", status: null },
      { id: L1, quantity: 2, currentQuantity: 1, __parentId: "gid://shopify/Order/1" },
      { id: "gid://shopify/Return/9", status: "CLOSED", __parentId: "gid://shopify/Order/1" },
      { id: "gid://shopify/ReturnLineItem/8", quantity: 1, returnReasonDefinition: { name: "Too big" }, fulfillmentLineItem: { lineItem: { id: L1 } }, __parentId: "gid://shopify/Return/9" },
      { __parentId: "gid://shopify/Return/9" }, // bare line from an unselected return type
    ];
    const [order] = await (async () => {
      const out = [];
      for await (const o of groupOrders(lines)) out.push(o);
      return out;
    })();
    const index = buildReturnIndex(order);
    assert.equal(returnReasonFor(L1, index), "Too big");
    assert.equal(order.returns[0].returnLineItems.length, 1); // bare line skipped
  });
});
