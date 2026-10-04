// TEMPORARY diagnostic page (Dev Plan validation). Remove before production.
// Runs the candidate bulk exports for all five reports against the installed
// store and shows aggregate summaries (counts only, never customer data), plus
// scope probes.
import { useState } from "react";
import { useFetcher, useLoaderData, useSearchParams } from "react-router";
import { authenticate } from "../shopify.server";
import { buildOrdersBulkQuery, buildOrdersSearchQuery } from "../pipeline/orders-bulk-query";
import { startBulkOperation } from "../pipeline/bulk";
import db from "../db.server";
import { startReportJob } from "../pipeline/start-job";
import { handleBulkOperationsFinish } from "../pipeline/bulk-finish";
import { advanceJob } from "../pipeline/job-chain";
import { STAGES } from "../pipeline/job-stages";
import { buildBulkOperationsFinishPayload } from "../testing/bulk-operations-finish";

const MAX_LINES = 1000000;

const bump = (map, key) => {
  map[key] = (map[key] ?? 0) + 1;
};

const MONEY = "shopMoney { amount currencyCode }";

// Candidate exports. `needsRange` kinds are scoped by the date inputs.
const KINDS = {
  orders: {
    label: "Orders + line items (Report 1 / 3 / 4 / 5 order side)",
    build: (range) => buildOrdersBulkQuery(range),
  },
  returnsRefunds: {
    label: "Returns + refund totals per order (Net Sales / Return Reason)",
    build: (range) => `{
  orders(query: ${JSON.stringify(buildOrdersSearchQuery(range))}, sortKey: CREATED_AT) {
    edges {
      node {
        id
        name
        createdAt
        totalRefundedSet { ${MONEY} }
        refunds {
          id
          createdAt
          totalRefundedSet { ${MONEY} }
        }
        lineItems {
          edges {
            node {
              id
              quantity
              currentQuantity
              discountedUnitPriceAfterAllDiscountsSet { ${MONEY} }
            }
          }
        }
        returns {
          edges {
            node {
              id
              status
              returnLineItems {
                edges {
                  node {
                    ... on ReturnLineItem {
                      id
                      quantity
                      returnReason
                      returnReasonDefinition { name handle }
                      fulfillmentLineItem { lineItem { id } }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
}`,
  },
  everything: {
    label: "FULL TEST: all of Report 1's order data in ONE query (exactly 5 connections)",
    build: (range) => `{
  orders(query: ${JSON.stringify(buildOrdersSearchQuery(range))}, sortKey: CREATED_AT) {
    edges {
      node {
        id
        name
        createdAt
        sourceName
        retailLocation { id name }
        paymentGatewayNames
        taxesIncluded
        totalShippingPriceSet { ${MONEY} }
        totalRefundedSet { ${MONEY} }
        refunds {
          id
          createdAt
          totalRefundedSet { ${MONEY} }
        }
        discountApplications {
          edges {
            node {
              __typename
              allocationMethod
              ... on DiscountCodeApplication { code }
              ... on ManualDiscountApplication { title description }
              ... on AutomaticDiscountApplication { title }
            }
          }
        }
        lineItems {
          edges {
            node {
              id
              title
              sku
              quantity
              currentQuantity
              originalUnitPriceSet { ${MONEY} }
              discountedUnitPriceAfterAllDiscountsSet { ${MONEY} }
              discountAllocations { allocatedAmountSet { ${MONEY} } }
              taxLines { title rate priceSet { ${MONEY} } }
              variant { id barcode }
              product { id }
            }
          }
        }
        returns {
          edges {
            node {
              id
              status
              returnLineItems {
                edges {
                  node {
                    ... on ReturnLineItem {
                      id
                      quantity
                      returnReason
                      returnReasonDefinition { name handle }
                      fulfillmentLineItem { lineItem { id } }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
}`,
  },
  products: {
    label: "Products + tags + collections + variants (Reports 1–5)",
    build: () => `{
  products {
    edges { node {
      id title status tags
      collections { edges { node { id title } } }
      variants { edges { node { id sku barcode title price inventoryItem { id } } } }
    } }
  }
}`,
  },
  inventory: {
    label: "Inventory levels (Report 2)",
    build: () => `{
  inventoryItems {
    edges { node {
      id sku variant { id product { id } }
      inventoryLevels { edges { node {
        id location { id name }
        quantities(names: ["available", "committed", "on_hand"]) { name quantity }
      } } }
    } }
  }
}`,
  },
};

// ---------------------------------------------------------------- summaries

// Counts which fields are populated, walking every object so it works whether
// or not Shopify nests children under their parent.
function summarizeOrders(lines) {
  const s = {
    lines: lines.length,
    orders: 0,
    dateRange: { first: null, last: null },
    sourceName: {},
    ordersWithRetailLocation: 0,
    retailLocations: {},
    lineItems: 0,
    lineItemsWithSku: 0,
    lineItemsWithBarcode: 0,
    discountApplications: {},
    discountCodes: 0,
    manualDiscounts: {},
    automaticDiscountTitles: {},
    shippingLines: 0,
    ordersWithShippingTotal: 0,
    ordersWithPaymentGateway: 0,
    firstLineKeys: lines.length ? Object.keys(lines[0]) : [],
  };

  const visit = (node) => {
    if (Array.isArray(node)) return node.forEach(visit);
    if (!node || typeof node !== "object") return;

    if ("sourceName" in node && "createdAt" in node) {
      s.orders += 1;
      if (!s.dateRange.first || node.createdAt < s.dateRange.first) s.dateRange.first = node.createdAt;
      if (!s.dateRange.last || node.createdAt > s.dateRange.last) s.dateRange.last = node.createdAt;
      bump(s.sourceName, node.sourceName ?? "null");
      if (node.retailLocation) {
        s.ordersWithRetailLocation += 1;
        bump(s.retailLocations, node.retailLocation.name);
      }
      if (node.paymentGatewayNames?.length) s.ordersWithPaymentGateway += 1;
      if (Number(node.totalShippingPriceSet?.shopMoney?.amount) > 0) s.ordersWithShippingTotal += 1;
    } else if ("originalUnitPriceSet" in node) {
      s.lineItems += 1;
      if (node.sku) s.lineItemsWithSku += 1;
      if (node.variant?.barcode) s.lineItemsWithBarcode += 1;
    } else if ("allocationMethod" in node) {
      bump(s.discountApplications, node.__typename);
      if (node.code) s.discountCodes += 1;
      if (node.__typename === "ManualDiscountApplication") {
        const label = `title="${node.title ?? ""}" description="${node.description ?? ""}"`;
        if (Object.keys(s.manualDiscounts).length < 25 || label in s.manualDiscounts) bump(s.manualDiscounts, label);
      }
      if (node.__typename === "AutomaticDiscountApplication" && node.title) bump(s.automaticDiscountTitles, node.title);
    } else if ("originalPriceSet" in node && "title" in node) {
      s.shippingLines += 1;
    }

    for (const value of Object.values(node)) if (value && typeof value === "object") visit(value);
  };

  lines.forEach(visit);
  return s;
}

const idType = (line) => line.id?.split("/")[3];

function summarizeReturnsRefunds(lines) {
  const s = {
    lines: lines.length,
    orders: 0,
    ordersWithRefunds: 0,
    ordersWithRefundTotal: 0,
    ordersWithReturns: 0,
    refunds: 0,
    refundLineItems: 0,
    refundLineItemsWithLineItemRef: 0,
    lineItems: 0,
    lineItemsWithReducedCurrentQuantity: 0,
    lineItemsFullyRemovedOrRefunded: 0,
    returns: 0,
    returnLineItems: 0,
    returnLineItemsWithLineItemRef: 0,
    returnReason: {},
    returnReasonDefinition: {},
    returnStatus: {},
    firstLineKeys: lines.length ? Object.keys(lines[0]) : [],
  };
  const refundedOrders = new Set();
  const returnedOrders = new Set();

  for (const line of lines) {
    switch (idType(line)) {
      case "Order":
        s.orders += 1;
        // `refunds` is a list field, so Shopify inlines it on the order line.
        if (line.refunds?.length) {
          s.refunds += line.refunds.length;
          refundedOrders.add(line.id);
        }
        if (Number(line.totalRefundedSet?.shopMoney?.amount) > 0) s.ordersWithRefundTotal += 1;
        break;
      case "Refund":
        s.refunds += 1;
        refundedOrders.add(line.__parentId);
        break;
      case "LineItem":
        s.lineItems += 1;
        if (line.currentQuantity < line.quantity) s.lineItemsWithReducedCurrentQuantity += 1;
        if (line.currentQuantity === 0) s.lineItemsFullyRemovedOrRefunded += 1;
        break;
      case "RefundLineItem":
        s.refundLineItems += 1;
        if (line.lineItem?.id) s.refundLineItemsWithLineItemRef += 1;
        break;
      case "Return":
        s.returns += 1;
        returnedOrders.add(line.__parentId);
        bump(s.returnStatus, line.status ?? "null");
        break;
      case "ReturnLineItem":
      case "UnverifiedReturnLineItem":
        s.returnLineItems += 1;
        if (line.fulfillmentLineItem?.lineItem?.id) s.returnLineItemsWithLineItemRef += 1;
        bump(s.returnReason, line.returnReason ?? "null");
        bump(s.returnReasonDefinition, line.returnReasonDefinition?.name ?? "null");
        break;
      default:
        break;
    }
  }
  s.ordersWithRefunds = refundedOrders.size;
  s.ordersWithReturns = returnedOrders.size;
  return s;
}

function summarizeProducts(lines) {
  const s = {
    lines: lines.length,
    products: 0,
    productStatus: {},
    productsWithTags: 0,
    distinctTags: {},
    collectionsPerProduct: {},
    distinctCollections: 0,
    variants: 0,
    variantsWithSku: 0,
    variantsWithoutSku: 0,
    variantsWithBarcode: 0,
    duplicateSkus: 0,
    duplicateSkuExamples: [],
    firstLineKeys: lines.length ? Object.keys(lines[0]) : [],
  };
  const collectionCount = new Map();
  const collectionIds = new Set();
  const skuCount = new Map();

  for (const line of lines) {
    switch (idType(line)) {
      case "Product":
        s.products += 1;
        collectionCount.set(line.id, collectionCount.get(line.id) ?? 0);
        bump(s.productStatus, line.status ?? "null");
        if (line.tags?.length) {
          s.productsWithTags += 1;
          for (const tag of line.tags) if (Object.keys(s.distinctTags).length < 30 || tag in s.distinctTags) bump(s.distinctTags, tag);
        }
        break;
      case "Collection":
        collectionIds.add(line.id);
        collectionCount.set(line.__parentId, (collectionCount.get(line.__parentId) ?? 0) + 1);
        break;
      case "ProductVariant":
        s.variants += 1;
        if (line.sku) {
          s.variantsWithSku += 1;
          skuCount.set(line.sku, (skuCount.get(line.sku) ?? 0) + 1);
        } else s.variantsWithoutSku += 1;
        if (line.barcode) s.variantsWithBarcode += 1;
        break;
      default:
        break;
    }
  }
  for (const count of collectionCount.values()) bump(s.collectionsPerProduct, count >= 3 ? "3+" : String(count));
  s.distinctCollections = collectionIds.size;
  for (const [sku, count] of skuCount) {
    if (count > 1) {
      s.duplicateSkus += 1;
      if (s.duplicateSkuExamples.length < 5) s.duplicateSkuExamples.push(`${sku} x${count}`);
    }
  }
  return s;
}

function summarizeInventory(lines) {
  const s = {
    lines: lines.length,
    inventoryItems: 0,
    itemsWithSku: 0,
    levels: 0,
    locations: {},
    levelsPerItem: {},
    available: { negative: 0, zero: 0, between1and5: 0, above5: 0 },
    levelsWithCommitted: 0,
    levelsWhereOnHandNotEqualAvailablePlusCommitted: 0,
    firstLineKeys: lines.length ? Object.keys(lines[0]) : [],
  };
  const perItem = new Map();

  for (const line of lines) {
    switch (idType(line)) {
      case "InventoryItem":
        s.inventoryItems += 1;
        if (line.sku) s.itemsWithSku += 1;
        perItem.set(line.id, 0);
        break;
      case "InventoryLevel": {
        s.levels += 1;
        perItem.set(line.__parentId, (perItem.get(line.__parentId) ?? 0) + 1);
        bump(s.locations, line.location?.name ?? "null");
        const q = Object.fromEntries((line.quantities ?? []).map((x) => [x.name, x.quantity]));
        if (q.available < 0) s.available.negative += 1;
        else if (q.available === 0) s.available.zero += 1;
        else if (q.available <= 5) s.available.between1and5 += 1;
        else s.available.above5 += 1;
        if (q.committed > 0) s.levelsWithCommitted += 1;
        if (q.on_hand !== q.available + q.committed) s.levelsWhereOnHandNotEqualAvailablePlusCommitted += 1;
        break;
      }
      default:
        break;
    }
  }
  for (const count of perItem.values()) bump(s.levelsPerItem, String(count));
  return s;
}

const SUMMARIZERS = {
  orders: summarizeOrders,
  returnsRefunds: summarizeReturnsRefunds,
  everything: (lines) => ({ orderSide: summarizeOrders(lines), returnsAndRefunds: summarizeReturnsRefunds(lines) }),
  products: summarizeProducts,
  inventory: summarizeInventory,
};

// ------------------------------------------------------------------- probes

const order = (selection, args = "first: 1") => `query { orders(${args}) { edges { node { id ${selection} } } } }`;
const PROBES = [
  ["order basics (name, createdAt, sourceName, payment gateway, tags)", "R1", order("name createdAt sourceName paymentGatewayNames tags")],
  ["order.retailLocation (POS location)", "R1 R3 R4 R5", order("retailLocation { id name }")],
  ["order.staffMember (POS staff)", "R1", order("staffMember { id name }")],
  ["discount applications (code / manual description)", "R1", order("discountApplications(first: 1) { edges { node { __typename allocationMethod ... on DiscountCodeApplication { code } ... on ManualDiscountApplication { title description } } } }")],
  ["shipping lines", "R1", order("shippingLines(first: 1) { edges { node { id title originalPriceSet { shopMoney { amount } } } } }")],
  ["line items (sku, qty, price, taxes, discount allocations, barcode, product id)", "R1 R3 R4 R5", order("lineItems(first: 1) { edges { node { sku quantity currentQuantity originalUnitPriceSet { shopMoney { amount } } taxLines { title } discountAllocations { allocatedAmountSet { shopMoney { amount } } } variant { id barcode } product { id } } } }")],
  ["returns + return reason", "R1", order("returns(first: 1) { edges { node { id returnLineItems(first: 1) { edges { node { ... on ReturnLineItem { quantity returnReason } } } } } } }")],
  ["refunds (amounts)", "R1 R3 R4", order("refunds { id totalRefundedSet { shopMoney { amount } } refundLineItems(first: 1) { edges { node { quantity subtotalSet { shopMoney { amount } } } } } }")],
  ["orders older than 60 days (read_all_orders)", "R3 R5", `query { orders(first: 1, query: "created_at:<2026-06-01") { edges { node { id createdAt } } } }`],
  ["products + tags + collections", "R1 R2 R3 R4 R5", "query { products(first: 1) { edges { node { id title tags collections(first: 1) { edges { node { id title } } } } } } }"],
  ["product variants (sku, barcode, price, inventory item)", "R2 R5", "query { products(first: 1) { edges { node { id variants(first: 1) { edges { node { sku barcode price inventoryItem { id } } } } } } } }"],
  ["locations", "R1 R2 R3 R4 R5", "query { locations(first: 5) { edges { node { id name isActive } } } }"],
  ["inventory levels (on hand / committed / available)", "R2", `query { inventoryItems(first: 1) { edges { node { id sku inventoryLevels(first: 1) { edges { node { location { name } quantities(names: ["available", "committed", "on_hand"]) { name quantity } } } } } } } }`],
];

async function runProbes(admin) {
  const results = [];
  for (const [field, reports, query] of PROBES) {
    try {
      const response = await admin.graphql(query);
      const { errors } = await response.json();
      results.push({ field, reports, ok: !errors?.length, error: errors?.length ? errors.map((e) => e.message).join(" | ") : null });
    } catch (error) {
      results.push({ field, reports, ok: false, error: error.message });
    }
  }
  return results;
}

// -------------------------------------------------------------- data checks

const monthStart = (offset) => {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - offset, 1));
};

async function runDataChecks(admin) {
  const gql = async (query) => {
    const response = await admin.graphql(query);
    const { data, errors } = await response.json();
    if (errors?.length) throw new Error(errors.map((e) => e.message).join(" | "));
    return data;
  };
  const out = {};

  try {
    // Orders per month for the last 30 months: history depth and seasonality.
    const months = Array.from({ length: 30 }, (_, i) => i);
    const fields = months
      .map((i) => {
        const from = monthStart(i).toISOString().slice(0, 10);
        const to = monthStart(i - 1).toISOString().slice(0, 10);
        return `m${i}: ordersCount(query: "created_at:>=${from} created_at:<${to}", limit: 200000) { count precision }`;
      })
      .join("\n");
    const data = await gql(`query { ${fields} }`);
    out.ordersPerMonth = Object.fromEntries(
      months.map((i) => [monthStart(i).toISOString().slice(0, 7), data[`m${i}`].count]),
    );
  } catch (error) {
    out.ordersPerMonth = { error: error.message };
  }

  try {
    // Does totalShippingPriceSet already net off the Free Shipping discount?
    const data = await gql(`query { orders(first: 100, query: "source_name:web OR source_name:304980787201", sortKey: CREATED_AT, reverse: true) { edges { node { totalShippingPriceSet { shopMoney { amount } } currentShippingPriceSet { shopMoney { amount } } shippingLines(first: 3) { edges { node { originalPriceSet { shopMoney { amount } } discountedPriceSet { shopMoney { amount } } } } } discountApplications(first: 5) { edges { node { __typename ... on AutomaticDiscountApplication { title } } } } } } } }`);
    const buckets = {};
    const samples = [];
    const amount = (set) => Number(set?.shopMoney?.amount ?? 0);
    for (const { node } of data.orders.edges) {
      const lines = node.shippingLines.edges.map((e) => e.node);
      const original = lines.reduce((sum, l) => sum + amount(l.originalPriceSet), 0);
      const discounted = lines.reduce((sum, l) => sum + amount(l.discountedPriceSet), 0);
      const total = amount(node.totalShippingPriceSet);
      const current = amount(node.currentShippingPriceSet);
      const freeShipping = node.discountApplications.edges.some((e) => e.node.__typename === "AutomaticDiscountApplication" && /free shipping/i.test(e.node.title ?? ""));
      bump(buckets, `freeShippingDiscount=${freeShipping} | lines.original>0=${original > 0} | lines.discounted>0=${discounted > 0} | totalShippingPriceSet>0=${total > 0} | currentShippingPriceSet>0=${current > 0}`);
      if (freeShipping && samples.length < 4) samples.push({ original, discounted, totalShippingPriceSet: total, currentShippingPriceSet: current });
    }
    out.shippingSemantics = { ordersChecked: data.orders.edges.length, buckets, freeShippingSamples: samples };
  } catch (error) {
    out.shippingSemantics = { error: error.message };
  }

  return out;
}

// ------------------------------------------------------------ route handlers

const CURRENT_OPERATION_QUERY = `#graphql
  query currentBulkOperation {
    currentBulkOperation(type: QUERY) {
      id status errorCode createdAt completedAt objectCount url
    }
  }`;

function notFoundInProduction() {
  // eslint-disable-next-line no-undef
  if (process.env.NODE_ENV === "production") throw new Response("Not found", { status: 404 });
}

const summaryCache = new Map();

export const loader = async ({ request }) => {
  notFoundInProduction();
  const { admin } = await authenticate.admin(request);
  const params = new URL(request.url).searchParams;
  const kind = params.get("kind") ?? "orders";
  const wantSummary = params.get("summarize") === "1";
  const jobs = await db.reportJob.findMany({
    orderBy: { createdAt: "desc" },
    take: 5,
    select: { id: true, stage: true, error: true, ordersBulkOpId: true, productsBulkOpId: true, ordersFile: true, productsFile: true, updatedAt: true },
  });

  try {
    const response = await admin.graphql(CURRENT_OPERATION_QUERY);
    const { data, errors } = await response.json();
    if (errors?.length) return { error: JSON.stringify(errors), operation: null, summary: null, kind, jobs };

    const operation = data.currentBulkOperation;
    if (operation?.completedAt) {
      operation.durationSeconds = Math.round((new Date(operation.completedAt) - new Date(operation.createdAt)) / 1000);
    }
    const safeOperation = operation && { ...operation, url: operation.url ? "(download url hidden)" : null };

    let summary = null;
    if (wantSummary && operation?.status === "COMPLETED" && operation.url && SUMMARIZERS[kind]) {
      const cacheKey = `${operation.id}:${kind}`;
      if (!summaryCache.has(cacheKey)) {
        const file = await fetch(operation.url);
        const text = await file.text();
        const lines = text.split("\n").filter(Boolean).slice(0, MAX_LINES).map((line) => JSON.parse(line));
        summaryCache.set(cacheKey, SUMMARIZERS[kind](lines));
      }
      summary = summaryCache.get(cacheKey);
    }
    return { error: null, operation: safeOperation, summary, kind, jobs };
  } catch (error) {
    return { error: `Loader failed: ${error.message}`, operation: null, summary: null, kind, jobs };
  }
};

export const action = async ({ request }) => {
  notFoundInProduction();
  const { admin, session } = await authenticate.admin(request);
  const form = await request.formData();

  if (form.get("intent") === "startJob") {
    try {
      const range = { start: new Date(`${form.get("start")}T00:00:00Z`), end: new Date(`${form.get("end")}T23:59:59Z`) };
      const job = await startReportJob({ db, admin, shop: session.shop, reportType: "debugPipeline", range });
      return { jobStarted: { id: job.id, stage: job.stage }, error: null };
    } catch (error) {
      return { jobStarted: null, error: error.message };
    }
  }

  // Stands in for Shopify's finish webhook: looks the real operation up at
  // Shopify and runs the real chain (download, parse, start products export).
  if (form.get("intent") === "simulateFinish") {
    try {
      const job = await db.reportJob.findUnique({ where: { id: form.get("jobId") } });
      const operationId = job?.stage === STAGES.ORDERS_RUNNING ? job.ordersBulkOpId : job?.stage === STAGES.PRODUCTS_RUNNING ? job.productsBulkOpId : null;
      if (!operationId) return { error: `Job is ${job?.stage ?? "missing"}; nothing is running to finish.` };

      const result = await handleBulkOperationsFinish({
        shop: session.shop,
        payload: buildBulkOperationsFinishPayload({ id: operationId }),
        admin,
        db,
        onFinished: (finished) => {
          if (finished.operation.status === "RUNNING" || finished.operation.status === "CREATED") return;
          advanceJob({ db, admin, result: finished }).then((o) => console.log(`Job ${job.id}: ${o.action}`)).catch((e) => console.error(e));
        },
      });
      return { simulated: { operationStatus: result.operation?.status ?? null, note: result.operation && ["RUNNING", "CREATED"].includes(result.operation.status) ? "Still running at Shopify; try again shortly." : "Chain started in the background; refresh the job list." }, error: null };
    } catch (error) {
      return { simulated: null, error: error.message };
    }
  }

  if (form.get("intent") === "checks") {
    try {
      return { checks: await runDataChecks(admin), error: null };
    } catch (error) {
      return { checks: null, error: error.message };
    }
  }

  if (form.get("intent") === "probe") {
    try {
      return { probes: await runProbes(admin), error: null };
    } catch (error) {
      return { probes: null, error: error.message };
    }
  }

  const kind = KINDS[form.get("kind")];
  if (!kind) return { started: null, error: "Unknown export kind" };
  try {
    const range = {
      start: new Date(`${form.get("start")}T00:00:00Z`),
      end: new Date(`${form.get("end")}T23:59:59Z`),
    };
    const operation = await startBulkOperation(admin, kind.build(range), form.get("kind"));
    return { started: operation, error: null };
  } catch (error) {
    return { started: null, error: error.message };
  }
};

const day = (offset) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);

export default function DebugBulk() {
  const { error, operation, summary, kind: loadedKind, jobs } = useLoaderData();
  const [searchParams, setSearchParams] = useSearchParams();
  const [kind, setKind] = useState(searchParams.get("kind") ?? loadedKind ?? "orders");
  const fetcher = useFetcher();
  const result = fetcher.data;
  const busy = fetcher.state !== "idle";

  return (
    <s-page heading="Debug: bulk export validation">
      <s-section heading="Start export">
        <fetcher.Form method="post">
          <p>
            <select name="kind" value={kind} onChange={(e) => setKind(e.target.value)}>
              {Object.entries(KINDS).map(([key, value]) => (
                <option key={key} value={key}>
                  {value.label}
                </option>
              ))}
            </select>
          </p>
          <p>
            <label>
              From <input type="date" name="start" defaultValue={day(-60)} />
            </label>{" "}
            <label>
              To <input type="date" name="end" defaultValue={day(0)} />
            </label>{" "}
            (date range is ignored for products and inventory)
          </p>
          <button type="submit" name="intent" value="start" disabled={busy}>
            Run selected bulk query
          </button>{" "}
          <button type="submit" name="intent" value="probe" disabled={busy}>
            Probe each field group
          </button>{" "}
          <button type="submit" name="intent" value="checks" disabled={busy}>
            Run data checks
          </button>{" "}
          <button type="submit" name="intent" value="startJob" disabled={busy}>
            Start pipeline job (orders, then products)
          </button>
        </fetcher.Form>
        {result?.error && <pre style={{ color: "crimson", whiteSpace: "pre-wrap" }}>{result.error}</pre>}
        {result?.checks && <pre style={{ whiteSpace: "pre-wrap" }}>{JSON.stringify(result.checks, null, 2)}</pre>}
        {result?.probes && (
          <table>
            <tbody>
              {result.probes.map((probe) => (
                <tr key={probe.field}>
                  <td>{probe.ok ? "OK" : "FAIL"}</td>
                  <td>{probe.field}</td>
                  <td>{probe.reports}</td>
                  <td style={{ color: "crimson" }}>{probe.error}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {result?.jobStarted && <pre>{JSON.stringify(result.jobStarted, null, 2)}</pre>}
        {result?.simulated && <pre>{JSON.stringify(result.simulated, null, 2)}</pre>}
        {result?.started && <pre>{JSON.stringify(result.started, null, 2)}</pre>}
        <p>
          <button type="button" onClick={() => setSearchParams({ kind })}>
            Refresh status
          </button>{" "}
          (click until status is COMPLETED), then{" "}
          <button type="button" onClick={() => setSearchParams({ kind, summarize: "1" })}>
            Load summary for &quot;{kind}&quot;
          </button>{" "}
          (large exports can take about a minute)
        </p>
      </s-section>

      <s-section heading="Pipeline jobs (latest 5)">
        {jobs.length === 0 && <p>No jobs yet.</p>}
        {jobs.map((job) => (
          <fetcher.Form method="post" key={job.id} style={{ marginBottom: 12 }}>
            <input type="hidden" name="jobId" value={job.id} />
            <pre style={{ whiteSpace: "pre-wrap" }}>
              {JSON.stringify({ id: job.id, stage: job.stage, error: job.error, ordersFile: job.ordersFile, productsFile: job.productsFile, updatedAt: job.updatedAt }, null, 2)}
            </pre>
            {(job.stage === "ORDERS_RUNNING" || job.stage === "PRODUCTS_RUNNING") && (
              <button type="submit" name="intent" value="simulateFinish" disabled={busy}>
                Simulate finish webhook for this job
              </button>
            )}
          </fetcher.Form>
        ))}
        <button type="button" onClick={() => setSearchParams({ kind })}>
          Refresh jobs
        </button>
      </s-section>

      <s-section heading="Current operation">
        {error && <pre style={{ color: "crimson", whiteSpace: "pre-wrap" }}>{error}</pre>}
        <pre>{JSON.stringify(operation, null, 2)}</pre>
      </s-section>

      {summary && (
        <s-section heading={`Result summary: ${loadedKind} (counts only)`}>
          <pre>{JSON.stringify(summary, null, 2)}</pre>
        </s-section>
      )}
    </s-page>
  );
}
