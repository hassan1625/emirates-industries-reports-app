import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { channelOptions, toOptions, allowedValues, loadFilterOptions } from "../app/pipeline/filter-options.js";

describe("channelOptions", () => {
  test("lists every configured channel by its source name, sorted by label", () => {
    assert.deepEqual(channelOptions(), [
      { value: "shopify_draft_order", label: "Draft Orders" },
      { value: "304980787201", label: "Mobile App" },
      { value: "web", label: "Online Store" },
      { value: "pos", label: "Point of Sale" },
    ]);
  });
});

describe("toOptions", () => {
  const locations = [
    { id: "gid://shopify/Location/2", name: "Emirates Industries L.L.C,  Head office", isActive: true }, // Shopify's double space
    { id: "gid://shopify/Location/1", name: "Al Ain", isActive: true },
    { id: "gid://shopify/Location/3", name: "Closed Branch", isActive: false },
  ];
  const collections = [{ id: "c1", title: "Boys" }, { id: "c2", title: "Girls" }, { id: "c3", title: "Boys" }];
  const options = toOptions({ locations, collections });

  test("locations are keyed by id, tidied for display, inactive ones marked, sorted", () => {
    assert.deepEqual(options.posLocation, [
      { value: "gid://shopify/Location/1", label: "Al Ain" },
      { value: "gid://shopify/Location/3", label: "Closed Branch (inactive)" },
      { value: "gid://shopify/Location/2", label: "Emirates Industries L.L.C, Head office" },
    ]);
  });

  test("collections are keyed by title and de-duplicated", () => {
    assert.deepEqual(options.collection, [{ value: "Boys", label: "Boys" }, { value: "Girls", label: "Girls" }]);
  });

  test("allowedValues feeds server-side validation", () => {
    assert.deepEqual(allowedValues(options).collection, ["Boys", "Girls"]);
    assert.equal(allowedValues(options).posLocation.length, 3);
  });
});

test("loadFilterOptions reads locations and collections and adds the channels", async () => {
  const admin = {
    graphql: async () => ({
      json: async () => ({
        data: {
          locations: { edges: [{ node: { id: "L1", name: "Al Ain", isActive: true } }] },
          collections: { edges: [{ node: { id: "C1", title: "Boys" } }] },
        },
      }),
    }),
  };
  const options = await loadFilterOptions(admin);
  assert.deepEqual(Object.keys(options).sort(), ["collection", "posLocation", "salesChannel"]);
  assert.equal(options.salesChannel.length, 4);
  assert.deepEqual(options.posLocation, [{ value: "L1", label: "Al Ain" }]);
});

test("loadFilterOptions surfaces GraphQL errors", async () => {
  const admin = { graphql: async () => ({ json: async () => ({ errors: [{ message: "boom" }] }) }) };
  await assert.rejects(loadFilterOptions(admin), /boom/);
});
