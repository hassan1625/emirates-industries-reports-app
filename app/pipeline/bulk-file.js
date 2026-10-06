// Streaming helpers for Shopify bulk-operation result files (JSONL).
//
// Facts verified on the client store (about 235,000 lines for a year):
//   * the file is FLAT: every nested object is its own line pointing at its
//     parent through `__parentId`, even with groupObjects: true;
//   * groupObjects: true keeps each parent's children directly after it, so a
//     parent and all its descendants can be rebuilt in one pass without ever
//     holding the whole file in memory;
//   * list fields (e.g. `refunds`) and single objects (e.g. `retailLocation`)
//     stay inlined on their parent line;
//   * DiscountApplication nodes have no `id`; they are recognised by __typename.
import { createReadStream, createWriteStream } from "node:fs";
import { writeFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { ensureParentDir } from "./storage.js";

// Streams `url` to `destination` without buffering it. A completed operation
// with no results has no URL: an empty file is written so later steps can read
// it uniformly. `fetchImpl` is injectable for tests.
export async function downloadBulkFile(url, destination, fetchImpl = fetch) {
  await ensureParentDir(destination);
  if (!url) {
    await writeFile(destination, "");
    return { bytes: 0, empty: true };
  }
  const response = await fetchImpl(url);
  if (!response.ok || !response.body) throw new Error(`Bulk file download failed: HTTP ${response.status}`);

  const output = createWriteStream(destination);
  await pipeline(Readable.fromWeb(response.body), output);
  return { bytes: output.bytesWritten, empty: false };
}

// Yields one parsed object per non-empty line.
export async function* readJsonl(filePath) {
  const lines = createInterface({ input: createReadStream(filePath, { encoding: "utf8" }), crlfDelay: Infinity });
  let lineNumber = 0;
  for await (const line of lines) {
    lineNumber += 1;
    if (!line.trim()) continue;
    try {
      yield JSON.parse(line);
    } catch (error) {
      throw new Error(`Invalid JSON on line ${lineNumber} of ${filePath}: ${error.message}`);
    }
  }
}

// Rebuilds parent objects with their children attached, one parent at a time.
//   lines     async/sync iterable of parsed JSONL objects
//   childKey  (line) => name of the array on the parent, e.g. "lineItems";
//             null to skip a line on purpose
//   defaults  { [childArrayName]: [] } arrays every parent starts with
// A child whose parent is not in the current group means the adjacency
// guarantee was violated; that throws instead of silently dropping data.
export async function* groupBulkLines(lines, { childKey, rootDefaults = {}, childDefaults = {} }) {
  let current = null;
  let index = new Map();
  const fresh = (line, defaults) => {
    const copy = { ...line };
    delete copy.__parentId;
    for (const [key, value] of Object.entries(defaults)) copy[key] = Array.isArray(value) ? [] : value;
    return copy;
  };

  for await (const line of lines) {
    if (!line.__parentId) {
      if (current) yield current;
      current = fresh(line, rootDefaults);
      index = new Map(current.id ? [[current.id, current]] : []);
      continue;
    }

    const parent = index.get(line.__parentId);
    if (!parent) throw new Error(`Orphan bulk line ${line.id ?? "(no id)"}: parent ${line.__parentId} is not in the current group`);
    const key = childKey(line);
    if (key === null) continue; // a line we deliberately ignore
    const child = fresh(line, childDefaults[key] ?? {});
    (parent[key] ??= []).push(child);
    if (child.id) index.set(child.id, child);
  }
  if (current) yield current;
}

const gidType = (id) => id?.split("/")[3];

const ORDER_CHILDREN = { LineItem: "lineItems", Return: "returns", ReturnLineItem: "returnLineItems", UnverifiedReturnLineItem: "returnLineItems" };
export function orderChildKey(line) {
  // Return line items of a type we do not select (e.g. unverified ones, which
  // the `... on ReturnLineItem` fragment leaves empty) arrive as a bare
  // `{ __parentId }`. They carry no data, so skip them rather than fail a job.
  if (Object.keys(line).length === 1 && line.__parentId) return null;
  // DiscountCodeApplication, ManualDiscountApplication, AutomaticDiscountApplication, ...
  if (!line.id && /^\w*Discount\w*Application$/.test(line.__typename ?? "")) return "discountApplications";
  const key = ORDER_CHILDREN[gidType(line.id)];
  if (!key) throw new Error(`Unexpected order child line: ${JSON.stringify(Object.keys(line))}`);
  return key;
}

const PRODUCT_CHILDREN = { Collection: "collections", ProductVariant: "variants" };
export function productChildKey(line) {
  const key = PRODUCT_CHILDREN[gidType(line.id)];
  if (!key) throw new Error(`Unexpected product child line: ${line.id}`);
  return key;
}

// Orders with lineItems, discountApplications and returns (each return with its
// returnLineItems) attached. Always present as arrays, possibly empty.
export function groupOrders(lines) {
  return groupBulkLines(lines, {
    childKey: orderChildKey,
    rootDefaults: { lineItems: [], discountApplications: [], returns: [] },
    childDefaults: { returns: { returnLineItems: [] } },
  });
}

// Orders with their dated agreements, each with its sales (see ledger-queries.js).
// Told apart by shape: an agreement has `happenedAt`, a sale has `actionType`.
export function agreementChildKey(line) {
  if (line.happenedAt) return "agreements";
  if (line.actionType) return "sales";
  if (Object.keys(line).length === 1 && line.__parentId) return null;
  throw new Error(`Unexpected agreement child line: ${JSON.stringify(Object.keys(line))}`);
}

export function groupAgreementOrders(lines) {
  return groupBulkLines(lines, {
    childKey: agreementChildKey,
    rootDefaults: { agreements: [] },
    childDefaults: { agreements: { sales: [] } },
  });
}

export function groupProducts(lines) {
  return groupBulkLines(lines, { childKey: productChildKey, rootDefaults: { collections: [], variants: [] } });
}

// Streams a file through the grouper and counts what it finds. Used to confirm
// a download is structurally sound before the job moves on.
export async function verifyOrdersFile(filePath) {
  const stats = { orders: 0, lineItems: 0, returns: 0, returnLineItems: 0, discountApplications: 0 };
  for await (const order of groupOrders(readJsonl(filePath))) {
    stats.orders += 1;
    stats.lineItems += order.lineItems.length;
    stats.discountApplications += order.discountApplications.length;
    stats.returns += order.returns.length;
    for (const ret of order.returns) stats.returnLineItems += ret.returnLineItems.length;
  }
  return stats;
}

export async function verifyProductsFile(filePath) {
  const stats = { products: 0, variants: 0, collections: 0 };
  for await (const product of groupProducts(readJsonl(filePath))) {
    stats.products += 1;
    stats.variants += product.variants.length;
    stats.collections += product.collections.length;
  }
  return stats;
}
