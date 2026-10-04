import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { discountLabel, buildDiscountIndex, discountCodeOrReason, summarizeDiscountLabels, INCLUDE_AUTOMATIC_DISCOUNTS } from "../app/pipeline/discounts.js";

const code = (index, value) => ({ __typename: "DiscountCodeApplication", index, code: value });
const manual = (index, title, description = null) => ({ __typename: "ManualDiscountApplication", index, title, description });
const automatic = (index, title) => ({ __typename: "AutomaticDiscountApplication", index, title });
const allocation = (index, amount) => ({ allocatedAmountSet: { shopMoney: { amount: String(amount) } }, discountApplication: { index } });
const line = (...allocations) => ({ id: "L", discountAllocations: allocations });

describe("discountLabel", () => {
  test("a code application gives its code", () => assert.equal(discountLabel(code(0, " SAVE10 ")), "SAVE10"));

  test("a manual POS discount gives the cashier's typed reason (title)", () => {
    assert.equal(discountLabel(manual(0, "Teachers discount", "Teachers discount")), "Teachers discount");
    assert.equal(discountLabel(manual(0, "Teacher #547", null)), "Teacher #547");
  });

  test("manual falls back to description when the title is empty", () => {
    assert.equal(discountLabel(manual(0, "", "Staff")), "Staff");
    assert.equal(discountLabel(manual(0, null, null)), null);
  });

  test("automatic titles can be switched off (pending client decision)", () => {
    assert.equal(INCLUDE_AUTOMATIC_DISCOUNTS, true);
    assert.equal(discountLabel(automatic(0, "Maid Uniform 10%")), "Maid Uniform 10%");
    assert.equal(discountLabel(automatic(0, "Maid Uniform 10%"), { includeAutomatic: false }), null);
  });

  test("unknown or missing applications give null", () => {
    assert.equal(discountLabel(undefined), null);
    assert.equal(discountLabel({ __typename: "ScriptDiscountApplication", title: "x" }), null);
  });
});

describe("discountCodeOrReason (per line item)", () => {
  const order = { discountApplications: [code(0, "SAVE10"), manual(1, "Teachers discount"), automatic(2, "Free Shipping")] };
  const index = buildDiscountIndex(order);

  test("labels come from the discounts that reduced this line", () => {
    assert.equal(discountCodeOrReason(line(allocation(0, 5)), index), "SAVE10");
    assert.equal(discountCodeOrReason(line(allocation(1, 5)), index), "Teachers discount");
  });

  test("a line with no discount is null", () => {
    assert.equal(discountCodeOrReason(line(), index), null);
    assert.equal(discountCodeOrReason({ id: "L" }, index), null);
  });

  test("a zero-amount allocation does not label the line", () => {
    assert.equal(discountCodeOrReason(line(allocation(0, 0)), index), null);
  });

  test("an order-wide discount only labels lines it actually touched", () => {
    assert.equal(discountCodeOrReason(line(allocation(1, 3)), index), "Teachers discount");
    assert.equal(discountCodeOrReason(line(), index), null);
  });

  test("several discounts on one line are joined in discount order, without duplicates", () => {
    assert.equal(discountCodeOrReason(line(allocation(1, 2), allocation(0, 3)), index), "SAVE10; Teachers discount");
    assert.equal(discountCodeOrReason(line(allocation(0, 1), allocation(0, 2)), index), "SAVE10");
  });

  test("a shipping-targeting automatic discount never labels a product line (no allocation to it)", () => {
    assert.equal(discountCodeOrReason(line(allocation(0, 5)), index), "SAVE10");
  });

  test("an allocation pointing at an unknown application is ignored", () => {
    assert.equal(discountCodeOrReason(line(allocation(9, 5)), index), null);
  });

  test("honours includeAutomatic", () => {
    const withAuto = buildDiscountIndex({ discountApplications: [automatic(0, "Maid Uniform 10%")] });
    assert.equal(discountCodeOrReason(line(allocation(0, 5)), withAuto), "Maid Uniform 10%");
    assert.equal(discountCodeOrReason(line(allocation(0, 5)), withAuto, { includeAutomatic: false }), null);
  });
});

describe("buildDiscountIndex", () => {
  test("uses Shopify's index, not list position", () => {
    const index = buildDiscountIndex({ discountApplications: [manual(3, "A"), code(1, "B")] });
    assert.equal(index.get(3).title, "A");
    assert.equal(index.get(1).code, "B");
  });

  test("falls back to list position for files exported before `index` was selected", () => {
    const index = buildDiscountIndex({ discountApplications: [{ __typename: "DiscountCodeApplication", code: "A" }, { __typename: "DiscountCodeApplication", code: "B" }] });
    assert.equal(index.get(1).code, "B");
  });

  test("an order with no applications gives an empty map", () => {
    assert.equal(buildDiscountIndex({}).size, 0);
  });
});

describe("summarizeDiscountLabels", () => {
  async function* orders(list) {
    yield* list;
  }

  test("counts lines, labels, kinds and index mismatches", async () => {
    const stats = await summarizeDiscountLabels(
      orders([
        { discountApplications: [code(0, "A"), manual(1, "Reason")], lineItems: [line(allocation(0, 1)), line(allocation(0, 1), allocation(1, 1)), line()] },
        { discountApplications: [manual(2, "Odd")], lineItems: [line(allocation(2, 1))] },
      ]),
    );
    assert.equal(stats.discountedLines, 3);
    assert.equal(stats.labelled, 3);
    assert.equal(stats.linesWithSeveralLabels, 1);
    assert.deepEqual(stats.byKind, { code: 2, manual: 2, automatic: 0 });
    assert.equal(stats.indexNotEqualToPosition, 1); // index 2 at position 0
    assert.equal(stats.allocationsWithUnknownIndex, 0);
  });
});
