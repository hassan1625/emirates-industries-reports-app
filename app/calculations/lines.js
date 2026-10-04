// Line-level and order-level figures for Report 1 (Dev Plan Step 21), built on
// the standalone formulas in sales.js. Pure functions over an order as rebuilt
// by groupOrders() (+ the collection and location joins); no I/O.
//
// Model (the store sells VAT-INCLUSIVE; verified against the client's sheet):
//   original   = unit price x quantity                       (incl. VAT)
//   allocated  = sum of the line's discount allocations      (incl. VAT)
//   tax        = Shopify's tax on the line (taxLines)
//   net        = original - allocated - tax                  (ex VAT, before returns)
//   discounts  = allocated / (1 + rate)                      (ex VAT, shown negative)
//   gross      = net + discounts
//   returned share = (quantity - currentQuantity) / quantity; net and taxes
//   are reduced by that share, gross and discounts are not (a fully returned
//   line keeps its Gross but has Net 0, Taxes 0, Total 0, as in the sheet).
// Deriving Gross from Net + Discounts reproduces Shopify's own cents on
// discounted lines, where plain price x qty / 1.05 can be one cent out.
// Unit Price Before VAT stays the locked formula, price / 1.05, unrounded.
import { round2 } from "./money.js";
import { shippingExclVat, totalSales, unitPriceBeforeVat } from "./sales.js";

const amount = (set) => Number(set?.shopMoney?.amount ?? 0);
const sum = (items, pick) => (items ?? []).reduce((total, item) => total + pick(item), 0);
// Avoids -0 in sheets and test output.
const clean = (value) => (value === 0 ? 0 : value);

export function lineCalculation(line, { taxesIncluded = true } = {}) {
  const quantity = line.quantity ?? 0;
  const current = Math.min(line.currentQuantity ?? quantity, quantity);
  const unit = amount(line.originalUnitPriceSet);
  const original = unit * quantity;
  const allocated = sum(line.discountAllocations, (a) => amount(a.allocatedAmountSet));
  const tax = sum(line.taxLines, (t) => amount(t.priceSet));
  const rate = line.taxLines?.[0]?.rate ?? 0;

  // Prices that already include VAT: take the tax out. Otherwise they are net.
  const netBefore = taxesIncluded ? original - allocated - tax : original - allocated;
  const discountsEx = taxesIncluded ? allocated / (1 + rate) : allocated;

  const discounts = round2(discountsEx);
  const net = round2(netBefore);
  const gross = round2(net + discounts);

  const keep = quantity > 0 ? current / quantity : 0; // share still sold
  const netAfter = round2(netBefore * keep);
  const taxAfter = round2(tax * keep);

  return {
    variantPrice: unit,
    unitPriceBeforeVat: unitPriceBeforeVat(unit),
    netItemsSold: current,
    grossSales: gross,
    discounts: clean(-discounts), // the sheet shows discounts as negative numbers
    returnsAmount: round2(net - netAfter), // not a sheet column; Net = Gross + Discounts - Returns
    netSales: netAfter,
    taxes: taxAfter,
    totalSales: totalSales(netAfter, 0, taxAfter),
  };
}

// Shipping is charged once per ORDER. `incl` is what the customer paid (after
// shipping discounts such as Free Shipping); the report shows it excluding
// VAT, rounded to 2 decimals, and the VAT on it separately.
export function orderShipping(order) {
  const incl = amount(order.currentShippingPriceSet);
  const exVat = shippingExclVat(incl);
  return { shippingInclVat: incl, shippingExclVat: exVat, shippingTax: round2(incl - exVat) };
}

export function paymentMethod(order) {
  return (order.paymentGatewayNames ?? []).join(", ") || null;
}

// Every line of an order plus its shipping, and order totals. Order Total Sales
// = sum of line totals + shipping (Net + Shipping + Taxes, summed).
export function orderCalculation(order) {
  const taxesIncluded = order.taxesIncluded !== false;
  const lines = order.lineItems.map((line) => ({ line, ...lineCalculation(line, { taxesIncluded }) }));
  const shipping = orderShipping(order);
  const lineTotals = round2(sum(lines, (l) => l.totalSales));
  return {
    lines,
    shipping,
    paymentMethod: paymentMethod(order),
    totals: {
      netSales: round2(sum(lines, (l) => l.netSales)),
      taxes: round2(sum(lines, (l) => l.taxes)),
      totalSales: round2(lineTotals + shipping.shippingInclVat),
    },
  };
}
