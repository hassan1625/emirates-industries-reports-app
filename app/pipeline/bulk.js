// Generic bulk-query starter shared by every export in the pipeline.

export const RUN_BULK_QUERY_MUTATION = `#graphql
  mutation runBulkQuery($query: String!) {
    bulkOperationRunQuery(query: $query, groupObjects: true) {
      bulkOperation { id status }
      userErrors { field message code }
    }
  }`;

// Starts a bulk query. `admin` is the authenticated admin GraphQL client from
// authenticate.admin(). Returns { id, status } of the new operation; throws
// with Shopify's message if it refuses (for example an operation is already
// running, or the query breaks a bulk limit).
export async function startBulkOperation(admin, query, label = "bulk query") {
  const response = await admin.graphql(RUN_BULK_QUERY_MUTATION, { variables: { query } });
  const { data, errors } = await response.json();
  if (errors?.length) throw new Error(`${label} request failed: ${JSON.stringify(errors)}`);

  const { bulkOperation, userErrors } = data.bulkOperationRunQuery;
  if (userErrors?.length) {
    const detail = userErrors.map((e) => `${e.code ?? "ERROR"}: ${e.message}`).join("; ");
    throw new Error(`Shopify rejected the ${label}: ${detail}`);
  }
  return bulkOperation;
}
