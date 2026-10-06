// POS staff per order, from ShopifyQL (the Admin API hides Order.staffMember on
// the Grow plan). One query per page of up to 1000 (order, staff) pairs for
// the period; verified on the busiest day: 2 pages, about a second, cost 11 of
// a 1000 budget per page. Reversal rows carry the same staff as their order.
const PAGE = 1000;
const MAX_PAGES = 200;

const STAFF_QUERY = `#graphql
  query staffPage($q: String!) { shopifyqlQuery(query: $q) { tableData { rows } parseErrors } }`;

const pageQuery = (from, to, offset) =>
  `FROM sales SHOW orders GROUP BY order_name, staff_member_name WHERE sales_channel = 'Point of Sale' AND staff_member_name IS NOT NULL SINCE ${from} UNTIL ${to} ORDER BY order_name, staff_member_name LIMIT ${PAGE} OFFSET ${offset}`;

// Map(orderName -> staff name) for orders and returns dated from..to (store
// days, "YYYY-MM-DD"). When an order has several staff names the first wins.
export async function fetchStaffByOrder(admin, from, to) {
  const staffByOrder = new Map();
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const response = await admin.graphql(STAFF_QUERY, { variables: { q: pageQuery(from, to, page * PAGE) } });
    const body = await response.json();
    const parseErrors = body.data?.shopifyqlQuery?.parseErrors ?? [];
    if (body.errors?.length || parseErrors.length) throw new Error(`Staff lookup failed: ${JSON.stringify(body.errors ?? parseErrors)}`);
    const rows = body.data.shopifyqlQuery.tableData.rows;
    for (const row of rows) if (!staffByOrder.has(row.order_name)) staffByOrder.set(row.order_name, row.staff_member_name);
    if (rows.length < PAGE) return staffByOrder;
  }
  throw new Error("Staff lookup returned more pages than expected");
}
