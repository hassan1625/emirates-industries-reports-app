import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { fetchStaffByOrder, fetchStaffNames, runShopifyql, waitUntilReset } from "../app/pipeline/staff.js";

const NOW = Date.parse("2026-10-13T10:00:00Z");
const cost = (over = {}) => ({ requestedQueryCost: 11, maximumAvailable: 1000, currentlyAvailable: 900, windowResetAt: new Date(NOW + 30_000).toISOString(), ...over });
const rows = (n, from = 0, staff = (i) => `Staff ${i % 5}`) => Array.from({ length: n }, (_, i) => ({ order_name: `#${from + i}`, staff_member_name: staff(from + i) }));
const page = (data, extensions = { shopifyqlCost: cost() }) => ({ data: { shopifyqlQuery: { tableData: { rows: data }, parseErrors: [] } }, extensions });
const rateLimited = (extensions) => ({ data: { shopifyqlQuery: null }, errors: [{ message: "Rate limited. Please retry later." }], extensions });

// An admin that answers from a script (a body, or an Error to throw) and records the queries.
function scripted(script) {
  const queries = [];
  return {
    queries,
    graphql: async (_q, { variables }) => {
      queries.push(variables.q);
      const next = script.shift();
      if (next instanceof Error) throw next;
      return { json: async () => next };
    },
  };
}
const clock = () => {
  const sleeps = [];
  return { sleeps, sleep: async (ms) => sleeps.push(ms), now: () => NOW, log: () => {} };
};

describe("waitUntilReset", () => {
  test("waits until the window resets, plus a small margin", () => {
    assert.equal(waitUntilReset({ windowResetAt: new Date(NOW + 20_000).toISOString() }, NOW), 21_500);
  });
  test("a reset time already past still waits the margin; a missing one waits about a minute; a far one is capped", () => {
    assert.equal(waitUntilReset({ windowResetAt: new Date(NOW - 5_000).toISOString() }, NOW), 1_500);
    assert.equal(waitUntilReset(undefined, NOW), 65_000);
    assert.equal(waitUntilReset({ windowResetAt: new Date(NOW + 3_600_000).toISOString() }, NOW), 300_000);
  });
});

describe("fetchStaffByOrder", () => {
  test("pages until a page comes back short, and the first staff name for an order wins", async () => {
    const duplicate = [{ order_name: "#0", staff_member_name: "Someone Else" }, ...rows(999, 1)];
    const admin = scripted([page(rows(1000)), page(duplicate), page(rows(10, 2000))]);
    const staff = await fetchStaffByOrder(admin, "2026-10-05", "2026-10-11", clock());
    assert.equal(admin.queries.length, 3);
    assert.match(admin.queries[0], /SINCE 2026-10-05 UNTIL 2026-10-11 .*LIMIT 1000 OFFSET 0$/);
    assert.match(admin.queries[1], /OFFSET 1000$/);
    assert.match(admin.queries[2], /OFFSET 2000$/);
    assert.equal(staff.size, 1010); // the second page repeats orders 0-999
    assert.equal(staff.get("#0"), "Staff 0"); // not "Someone Else"
  });

  test("when the budget is nearly used it waits for the window to reset BEFORE the next page, instead of hitting the limit", async () => {
    const low = { shopifyqlCost: cost({ currentlyAvailable: 15, windowResetAt: new Date(NOW + 40_000).toISOString() }) };
    const admin = scripted([page(rows(1000), low), page(rows(5, 1000))]);
    const c = clock();
    await fetchStaffByOrder(admin, "2026-01-01", "2026-12-31", c);
    assert.deepEqual(c.sleeps, [41_500]);
    assert.equal(admin.queries.length, 2);
  });

  test("a healthy budget is never waited on", async () => {
    const admin = scripted([page(rows(1000)), page(rows(1000, 1000)), page(rows(3, 2000))]);
    const c = clock();
    await fetchStaffByOrder(admin, "2026-01-01", "2026-12-31", c);
    assert.deepEqual(c.sleeps, []);
  });

  test("if Shopify rate limits anyway, it waits until the window resets and asks for the SAME page again", async () => {
    const limited = rateLimited({ shopifyqlCost: cost({ currentlyAvailable: 0, windowResetAt: new Date(NOW + 25_000).toISOString() }) });
    const admin = scripted([page(rows(1000)), limited, page(rows(7, 1000))]);
    const c = clock();
    const staff = await fetchStaffByOrder(admin, "2026-01-01", "2026-12-31", c);
    assert.deepEqual(c.sleeps, [26_500]);
    assert.equal(staff.size, 1007);
    assert.match(admin.queries[1], /OFFSET 1000$/);
    assert.match(admin.queries[2], /OFFSET 1000$/); // retried, not skipped
  });

  test("logs its waits and, every 20 pages, its progress", async () => {
    const script = [...Array.from({ length: 20 }, (_, i) => page(rows(1000, i * 1000))), page(rows(1, 20000))];
    const lines = [];
    await fetchStaffByOrder(scripted(script), "2026-01-01", "2026-12-31", { ...clock(), log: (line) => lines.push(line) });
    assert.ok(lines.some((line) => /20 pages, 20000 orders/.test(line)), lines.join("|"));
  });
});

describe("runShopifyql", () => {
  test("rate limits do not count as failures: many of them, then success", async () => {
    const limited = rateLimited({ shopifyqlCost: cost({ windowResetAt: new Date(NOW + 10_000).toISOString() }) });
    const admin = scripted([limited, limited, limited, limited, limited, limited, page(rows(2))]);
    const result = await runShopifyql(admin, "q", clock());
    assert.equal(result.length, 2);
    assert.equal(admin.queries.length, 7);
  });

  test("without any cost information a rate limit waits about a minute", async () => {
    const admin = scripted([rateLimited(undefined), page(rows(1))]);
    const c = clock();
    await runShopifyql(admin, "q", c);
    assert.deepEqual(c.sleeps, [65_000]);
  });

  test("it gives up, with a clear message, when the limit persists past the total wait allowed", async () => {
    const limited = rateLimited(undefined);
    const admin = scripted(Array.from({ length: 40 }, () => limited));
    await assert.rejects(runShopifyql(admin, "q", clock()), /still rate limiting the staff lookup after waiting \d+s/);
  });

  test("network failures are retried with a growing pause, then reported", async () => {
    const admin = scripted(Array.from({ length: 5 }, () => new Error("fetch failed")));
    const c = clock();
    await assert.rejects(runShopifyql(admin, "q", c), /Could not read POS staff from Shopify after 5 tries: fetch failed/);
    assert.deepEqual(c.sleeps, [2000, 4000, 8000, 16000]);
  });

  test("a network failure that recovers is invisible", async () => {
    const admin = scripted([new Error("fetch failed"), page(rows(3))]);
    assert.equal((await runShopifyql(admin, "q", clock())).length, 3);
  });

  test("a rejected query is not retried", async () => {
    const admin = scripted([{ data: { shopifyqlQuery: { tableData: null, parseErrors: ["Column Not Found"] } } }]);
    await assert.rejects(runShopifyql(admin, "q", clock()), /rejected the query.*Column Not Found/);
    assert.equal(admin.queries.length, 1);
  });

  test("access and other GraphQL errors are not retried either", async () => {
    const admin = scripted([{ data: null, errors: [{ message: "Access denied", extensions: { code: "ACCESS_DENIED" } }] }]);
    await assert.rejects(runShopifyql(admin, "q", clock()), /Access denied/);
    assert.equal(admin.queries.length, 1);
  });

  test("it reports each response's budget to the caller", async () => {
    const seen = [];
    await runShopifyql(scripted([page(rows(1), { shopifyqlCost: cost({ currentlyAvailable: 321 }) })]), "q", { ...clock(), onCost: (c) => seen.push(c.currentlyAvailable) });
    assert.deepEqual(seen, [321]);
  });
});

describe("fetchStaffNames", () => {
  test("returns the distinct names, sorted", async () => {
    const admin = scripted([page([{ staff_member_name: "Sara" }, { staff_member_name: "Ahmed" }, { staff_member_name: "Sara" }, { staff_member_name: null }])]);
    assert.deepEqual(await fetchStaffNames(admin, "2025-09-01", "2026-10-13", clock()), ["Ahmed", "Sara"]);
  });
});
