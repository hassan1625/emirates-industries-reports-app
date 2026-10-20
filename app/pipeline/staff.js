// POS staff, from ShopifyQL (the Admin API hides Order.staffMember on the Grow
// plan). Each page of up to 1000 (order, staff) pairs costs about 11 of a
// ShopifyQL budget of 1000 per time window, and Shopify answers 429 "Rate
// limited" once it is used up. A busy month fits in one window; a year of POS
// orders does not, so the lookup follows Shopify's own budget:
//   * after every page it reads `shopifyqlCost` and, when the budget is nearly
//     used, waits for `windowResetAt` BEFORE asking again;
//   * if it is rate limited anyway, it waits until `windowResetAt` and retries
//     the same page (up to MAX_RATE_LIMIT_WAIT_MS in total);
//   * network failures are retried a few times with a growing pause;
//   * anything else (a rejected query) is not retried.
// Reversal rows carry the same staff as their order.
const PAGE = 1000;
const MAX_PAGES = 400;
const MAX_ATTEMPTS = 5; // network failures, per page
const BASE_DELAY_MS = 2000;
const DEFAULT_WINDOW_WAIT_MS = 65 * 1000; // when Shopify does not say when the budget refills
const MAX_SINGLE_WAIT_MS = 5 * 60 * 1000;
const MAX_RATE_LIMIT_WAIT_MS = 20 * 60 * 1000; // total, per query
const WINDOW_MARGIN_MS = 1500;

const STAFF_QUERY = `#graphql
  query shopifyql($q: String!) { shopifyqlQuery(query: $q) { tableData { rows } parseErrors } }`;

const sleepFor = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const isRateLimited = (errors) => (errors ?? []).some((error) => error.extensions?.code === "THROTTLED" || /rate.?limit|throttl/i.test(error.message ?? ""));

// Milliseconds until the ShopifyQL budget refills, from a `shopifyqlCost` object.
export function waitUntilReset(cost, now = Date.now(), fallback = DEFAULT_WINDOW_WAIT_MS) {
  const resetAt = Date.parse(cost?.windowResetAt);
  const wait = Number.isFinite(resetAt) ? resetAt - now + WINDOW_MARGIN_MS : fallback;
  return Math.min(Math.max(wait, WINDOW_MARGIN_MS), MAX_SINGLE_WAIT_MS);
}

// Runs one ShopifyQL query and returns its rows.
// options: sleep(ms), now() for tests; onCost(cost) sees each response's budget;
//          onWait({ ms, reason }) is told before a long wait (for logging).
export async function runShopifyql(admin, query, { sleep = sleepFor, now = Date.now, attempts = MAX_ATTEMPTS, onCost, onWait } = {}) {
  let lastError;
  let failures = 0;
  let waited = 0;
  for (;;) {
    let cost;
    try {
      const response = await admin.graphql(STAFF_QUERY, { variables: { q: query } });
      const body = await response.json();
      cost = body.extensions?.shopifyqlCost;
      const parseErrors = body.data?.shopifyqlQuery?.parseErrors ?? [];
      if (isRateLimited(body.errors)) {
        const ms = waitUntilReset(cost, now());
        if (waited + ms > MAX_RATE_LIMIT_WAIT_MS) throw Object.assign(new Error(`Shopify is still rate limiting the staff lookup after waiting ${Math.round(waited / 1000)}s`), { permanent: true });
        onWait?.({ ms, reason: "Shopify's ShopifyQL budget is used up" });
        await sleep(ms);
        waited += ms;
        continue; // the same page again; rate limits do not count as failures
      }
      if (body.errors?.length || parseErrors.length) {
        throw Object.assign(new Error(`ShopifyQL rejected the query: ${JSON.stringify(body.errors ?? parseErrors)}`), { permanent: true });
      }
      onCost?.(cost);
      return body.data.shopifyqlQuery.tableData.rows;
    } catch (error) {
      if (error.permanent) throw error;
      lastError = error; // network failure: try again
    }
    failures += 1;
    if (failures >= attempts) throw new Error(`Could not read POS staff from Shopify after ${attempts} tries: ${lastError.message}`);
    await sleep(BASE_DELAY_MS * 2 ** (failures - 1));
  }
}

const pageQuery = (from, to, offset) =>
  `FROM sales SHOW orders GROUP BY order_name, staff_member_name WHERE sales_channel = 'Point of Sale' AND staff_member_name IS NOT NULL SINCE ${from} UNTIL ${to} ORDER BY order_name, staff_member_name LIMIT ${PAGE} OFFSET ${offset}`;

// Map(orderName -> staff name) for orders and returns dated from..to (store
// days, "YYYY-MM-DD"). When an order has several staff names the first wins.
export async function fetchStaffByOrder(admin, from, to, options = {}) {
  const { sleep = sleepFor, now = Date.now, log = console.log } = options;
  const staffByOrder = new Map();
  let lastCost;
  const started = now();
  for (let page = 0; page < MAX_PAGES; page += 1) {
    // Wait for the budget to refill before it runs out, not after the 429.
    if (lastCost && Number(lastCost.currentlyAvailable) < Number(lastCost.requestedQueryCost) * 2) {
      const ms = waitUntilReset(lastCost, now());
      log(`POS staff lookup: waiting ${Math.round(ms / 1000)}s for the ShopifyQL budget to refill (page ${page + 1})`);
      await sleep(ms);
      lastCost = undefined;
    }
    const rows = await runShopifyql(admin, pageQuery(from, to, page * PAGE), {
      ...options,
      onCost: (cost) => { lastCost = cost; },
      onWait: ({ ms }) => log(`POS staff lookup: rate limited, waiting ${Math.round(ms / 1000)}s (page ${page + 1})`),
    });
    for (const row of rows) if (!staffByOrder.has(row.order_name)) staffByOrder.set(row.order_name, row.staff_member_name);
    if ((page + 1) % 20 === 0) log(`POS staff lookup: ${page + 1} pages, ${staffByOrder.size} orders, ${Math.round((now() - started) / 1000)}s`);
    if (rows.length < PAGE) return staffByOrder;
  }
  throw new Error("Staff lookup returned more pages than expected");
}

// The distinct staff names that have sold at the POS from `since` ("YYYY-MM-DD")
// to `until`; the choices of the POS Staff filter.
export async function fetchStaffNames(admin, since, until, options = {}) {
  const rows = await runShopifyql(admin, `FROM sales SHOW orders GROUP BY staff_member_name WHERE sales_channel = 'Point of Sale' AND staff_member_name IS NOT NULL SINCE ${since} UNTIL ${until} ORDER BY staff_member_name LIMIT 1000`, options);
  return [...new Set(rows.map((row) => row.staff_member_name).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}
