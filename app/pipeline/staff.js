// POS staff, from ShopifyQL (the Admin API hides Order.staffMember on the Grow
// plan). Verified on the busiest day: about a second per page of 1000 rows, cost
// 11 of a 1000 budget per page. Reversal rows carry the same staff as their
// order. A long range pages through many results, so each page is retried with
// a growing pause when Shopify throttles or the connection drops; anything else
// (a rejected query) is not retried.
const PAGE = 1000;
const MAX_PAGES = 400;
const MAX_ATTEMPTS = 5;
const BASE_DELAY_MS = 2000;

const STAFF_QUERY = `#graphql
  query shopifyql($q: String!) { shopifyqlQuery(query: $q) { tableData { rows } parseErrors } }`;

const sleepFor = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const isThrottled = (errors) => (errors ?? []).some((error) => error.extensions?.code === "THROTTLED" || /throttl|rate limit/i.test(error.message ?? ""));

// Runs one ShopifyQL query and returns its rows. Retries throttling and
// network failures; throws for anything else.
export async function runShopifyql(admin, query, { sleep = sleepFor, attempts = MAX_ATTEMPTS } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await admin.graphql(STAFF_QUERY, { variables: { q: query } });
      const body = await response.json();
      const parseErrors = body.data?.shopifyqlQuery?.parseErrors ?? [];
      if (isThrottled(body.errors)) {
        lastError = new Error("Shopify is limiting requests");
      } else if (body.errors?.length || parseErrors.length) {
        throw Object.assign(new Error(`ShopifyQL rejected the query: ${JSON.stringify(body.errors ?? parseErrors)}`), { permanent: true });
      } else {
        return body.data.shopifyqlQuery.tableData.rows;
      }
    } catch (error) {
      if (error.permanent) throw error;
      lastError = error; // network failure: try again
    }
    if (attempt < attempts) await sleep(BASE_DELAY_MS * 2 ** (attempt - 1));
  }
  throw new Error(`Could not read POS staff from Shopify after ${attempts} tries: ${lastError.message}`);
}

const pageQuery = (from, to, offset) =>
  `FROM sales SHOW orders GROUP BY order_name, staff_member_name WHERE sales_channel = 'Point of Sale' AND staff_member_name IS NOT NULL SINCE ${from} UNTIL ${to} ORDER BY order_name, staff_member_name LIMIT ${PAGE} OFFSET ${offset}`;

// Map(orderName -> staff name) for orders and returns dated from..to (store
// days, "YYYY-MM-DD"). When an order has several staff names the first wins.
export async function fetchStaffByOrder(admin, from, to, options = {}) {
  const staffByOrder = new Map();
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const rows = await runShopifyql(admin, pageQuery(from, to, page * PAGE), options);
    for (const row of rows) if (!staffByOrder.has(row.order_name)) staffByOrder.set(row.order_name, row.staff_member_name);
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
