// Handles a bulk_operations/finish webhook (Dev Plan Step 14).
//
// The webhook payload only identifies the operation (`admin_graphql_api_id`);
// the download URL and the authoritative status must be fetched with a
// follow-up `node(id:)` query. Webhooks can be duplicated or dropped, so this
// handler is idempotent in the sense that it only reads, and the job-state
// chaining that reacts to it (Step 15) must tolerate repeats. A polling
// fallback (Step 16) covers dropped deliveries.

export const BULK_OPERATION_QUERY = `#graphql
  query bulkOperationById($id: ID!) {
    node(id: $id) {
      ... on BulkOperation {
        id
        type
        status
        errorCode
        createdAt
        completedAt
        objectCount
        fileSize
        url
        partialDataUrl
      }
    }
  }`;

// Returns the BulkOperation, or null if Shopify does not know the id.
export async function fetchBulkOperation(admin, id) {
  const response = await admin.graphql(BULK_OPERATION_QUERY, { variables: { id } });
  const { data, errors } = await response.json();
  if (errors?.length) throw new Error(`Bulk operation lookup failed: ${JSON.stringify(errors)}`);
  return data?.node ?? null;
}

// `db` is the Prisma client, `admin` the authenticated admin client for `shop`,
// and `onFinished` an optional callback (Step 15 plugs job chaining in here).
//
// Resolves to { handled: false, reason } when the operation is not one of our
// jobs, otherwise { handled: true, job, which, operation }, where `which` says
// whether it was the orders or the products export. Throws on a failed lookup
// so the route answers 5xx and Shopify retries the delivery.
export async function handleBulkOperationsFinish({ shop, payload, admin, db, onFinished }) {
  const id = payload?.admin_graphql_api_id;
  if (!id) return { handled: false, reason: "missing-operation-id" };

  const job = await db.reportJob.findFirst({
    where: { shop, OR: [{ ordersBulkOpId: id }, { productsBulkOpId: id }] },
  });
  if (!job) return { handled: false, reason: "unknown-operation", id };

  const operation = await fetchBulkOperation(admin, id);
  if (!operation) throw new Error(`Shopify returned no BulkOperation for ${id}`);

  const result = { handled: true, job, which: job.ordersBulkOpId === id ? "orders" : "products", operation };
  if (onFinished) await onFinished(result);
  return result;
}
