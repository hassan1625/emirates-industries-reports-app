// Return extraction for Report 1 (Dev Plan Step 17).
//
// Works on orders rebuilt by groupOrders(): order.returns[].returnLineItems[],
// each return line pointing at the order line item it returns through
// fulfillmentLineItem.lineItem.id.
//
// Rules, verified on the client store:
//   * only returns that are really in progress or finished count: OPEN and
//     CLOSED. CANCELED (about 1.5% of returns), DECLINED and REQUESTED do not;
//   * the reason is returnReasonDefinition.name ("Too small", "Changed my
//     mind", ...). The older `returnReason` enum is deprecated and coarser
//     (Material / Too long collapse into OTHER);
//   * about half of return lines carry Shopify's own "Unknown" reason. It is
//     reported as Shopify names it; the report layer decides how to show it.

export const COUNTED_RETURN_STATUSES = Object.freeze(["OPEN", "CLOSED"]);

// Map<lineItemId, { quantity, reasons: string[] }> for one order. A line item
// returned several times (or under different reasons) is combined.
export function buildReturnIndex(order) {
  const index = new Map();
  for (const ret of order.returns ?? []) {
    if (!COUNTED_RETURN_STATUSES.includes(ret.status)) continue;
    for (const returnLine of ret.returnLineItems ?? []) {
      const lineItemId = returnLine.fulfillmentLineItem?.lineItem?.id;
      if (!lineItemId) continue; // cannot be tied to a sold line
      const entry = index.get(lineItemId) ?? { quantity: 0, reasons: [] };
      entry.quantity += returnLine.quantity ?? 0;
      const reason = returnLine.returnReasonDefinition?.name;
      if (reason && !entry.reasons.includes(reason)) entry.reasons.push(reason);
      index.set(lineItemId, entry);
    }
  }
  return index;
}

// The Return Reason cell for one line item: reasons joined with "; ", or null
// when the line was not returned.
export function returnReasonFor(lineItemId, index) {
  const entry = index.get(lineItemId);
  return entry && entry.reasons.length ? entry.reasons.join("; ") : null;
}

export function returnedQuantityFor(lineItemId, index) {
  return index.get(lineItemId)?.quantity ?? 0;
}

// Diagnostic for Milestone 3: does "quantity returned" from the returns agree
// with quantity - currentQuantity (the Net Items Sold source)? Counts only.
export async function reconcileReturnQuantities(orders) {
  const stats = {
    orders: 0,
    lineItems: 0,
    lineItemsWithCountedReturn: 0,
    lineItemsWithReducedQuantity: 0,
    agree: 0,
    returnsExceedReduction: 0,
    reductionExceedsReturns: 0,
    withReasonButNoReduction: 0,
    reducedButNoReturn: 0,
    sampleDisagreements: [],
  };
  for await (const order of orders) {
    stats.orders += 1;
    const index = buildReturnIndex(order);
    for (const line of order.lineItems) {
      stats.lineItems += 1;
      const returned = returnedQuantityFor(line.id, index);
      const reduction = line.quantity - line.currentQuantity;
      if (returned > 0) stats.lineItemsWithCountedReturn += 1;
      if (reduction > 0) stats.lineItemsWithReducedQuantity += 1;
      if (returned === reduction) {
        stats.agree += 1;
        continue;
      }
      if (returned > reduction) {
        stats.returnsExceedReduction += 1;
        if (reduction === 0) stats.withReasonButNoReduction += 1;
      } else {
        stats.reductionExceedsReturns += 1;
        if (returned === 0) stats.reducedButNoReturn += 1;
      }
      if (stats.sampleDisagreements.length < 5) stats.sampleDisagreements.push({ orderId: order.id, lineItemId: line.id, quantity: line.quantity, currentQuantity: line.currentQuantity, returned });
    }
  }
  return stats;
}
