// "Discount Code or Reason" for Report 1 (Dev Plan Step 18).
//
// OUTCOME of the Discount Reason investigation (client store, 12 months):
// the POS reason IS available. A POS custom discount comes back as a
// ManualDiscountApplication whose `title` is the text the cashier typed
// ("Teachers discount", "App10", ...); `description` is often the same text or
// empty, so it is only a fallback. Online/POS codes are DiscountCodeApplication
// `code`. Automatic discounts (product promotions) carry a `title`.
// Nothing here needed a new scope.
//
// The column is per LINE ITEM: a line's labels come from the discounts that
// actually reduced it (its discountAllocations), matched to the order's
// discount applications by `index`. That is why discounts that target
// shipping, such as the "Free Shipping" automatic discount, never label a
// product line.
//
// Whether automatic discount titles belong in this column is a pending client
// question; flip INCLUDE_AUTOMATIC_DISCOUNTS (or pass the option) to change it.

export const INCLUDE_AUTOMATIC_DISCOUNTS = true;

const clean = (text) => (typeof text === "string" ? text.trim() : "");

// The text one application contributes, or null.
export function discountLabel(application, { includeAutomatic = INCLUDE_AUTOMATIC_DISCOUNTS } = {}) {
  switch (application?.__typename) {
    case "DiscountCodeApplication":
      return clean(application.code) || null;
    case "ManualDiscountApplication":
      return clean(application.title) || clean(application.description) || null;
    case "AutomaticDiscountApplication":
      return includeAutomatic ? clean(application.title) || null : null;
    default:
      return null;
  }
}

// Map<index, application> for one order. Uses Shopify's own `index`, and the
// list position only for files exported before `index` was selected.
export function buildDiscountIndex(order) {
  const byIndex = new Map();
  (order.discountApplications ?? []).forEach((application, position) => {
    byIndex.set(application.index ?? position, application);
  });
  return byIndex;
}

// The cell for one line item: distinct labels joined with "; " in discount
// order, or null when nothing discounted the line.
export function discountCodeOrReason(line, discountIndex, options) {
  const labelsByIndex = new Map();
  for (const allocation of line.discountAllocations ?? []) {
    if (!(Number(allocation.allocatedAmountSet?.shopMoney?.amount) > 0)) continue;
    const index = allocation.discountApplication?.index;
    const label = discountLabel(discountIndex.get(index), options);
    if (label) labelsByIndex.set(index, label);
  }
  const labels = [...labelsByIndex.entries()].sort(([a], [b]) => a - b).map(([, label]) => label);
  const unique = [...new Set(labels)];
  return unique.length ? unique.join("; ") : null;
}

// Diagnostic over a stream of orders: how many discounted lines get a label,
// by kind, and whether any allocation points at a missing application.
// Counts only; no discount text is returned.
export async function summarizeDiscountLabels(orders, options) {
  const stats = {
    orders: 0,
    discountedLines: 0,
    labelled: 0,
    unlabelled: 0,
    allocationsWithUnknownIndex: 0,
    applicationsWithoutIndex: 0,
    indexNotEqualToPosition: 0,
    byKind: { code: 0, manual: 0, automatic: 0 },
    linesWithSeveralLabels: 0,
  };
  for await (const order of orders) {
    stats.orders += 1;
    (order.discountApplications ?? []).forEach((application, position) => {
      if (application.index === undefined) stats.applicationsWithoutIndex += 1;
      else if (application.index !== position) stats.indexNotEqualToPosition += 1;
    });
    const index = buildDiscountIndex(order);
    for (const line of order.lineItems ?? []) {
      const allocations = (line.discountAllocations ?? []).filter((a) => Number(a.allocatedAmountSet?.shopMoney?.amount) > 0);
      if (!allocations.length) continue;
      stats.discountedLines += 1;
      for (const allocation of allocations) {
        const application = index.get(allocation.discountApplication?.index);
        if (!application) {
          stats.allocationsWithUnknownIndex += 1;
          continue;
        }
        if (application.__typename === "DiscountCodeApplication") stats.byKind.code += 1;
        else if (application.__typename === "ManualDiscountApplication") stats.byKind.manual += 1;
        else if (application.__typename === "AutomaticDiscountApplication") stats.byKind.automatic += 1;
      }
      const label = discountCodeOrReason(line, index, options);
      if (label) {
        stats.labelled += 1;
        if (label.includes("; ")) stats.linesWithSeveralLabels += 1;
      } else stats.unlabelled += 1;
    }
  }
  return stats;
}
