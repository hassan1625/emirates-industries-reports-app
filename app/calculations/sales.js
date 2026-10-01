// Report 1 calculation layer (Dev Plan §3). Pure functions, no I/O.
// Do not reimplement these in report-specific code; Reports 3 and 4 call
// totalSales() from here.
//
// Sign convention: `discounts` and `returns` are passed as POSITIVE amounts
// (the plan's "Gross − Discounts − Returns"). The exported sheet shows
// discounts as negative numbers; that is a display concern.
import { round2, VAT_DIVISOR } from "./money.js";

// Unit Price Before VAT = Variant Price ÷ 1.05 — unrounded.
export function unitPriceBeforeVat(variantPrice) {
  return variantPrice / VAT_DIVISOR;
}

// Shipping Charges (excl. VAT) = ROUND(Shipping ÷ 1.05, 2). Rounding applies
// only here, not to the unit price.
export function shippingExclVat(shippingInclVat) {
  return round2(shippingInclVat / VAT_DIVISOR);
}

// Gross Sales for one line, VAT-exclusive, as in the client's sample sheet
// (e.g. 91.35 × 1 → 87; 0.25 × 2 → 0.48). Shopify backs discounted lines out
// per allocation, so it can differ from this by ±0.01 on discounted lines.
export function grossSales(variantPrice, quantity) {
  return round2((variantPrice * quantity) / VAT_DIVISOR);
}

// Net Sales = Gross Sales − Discounts − Returns.
export function netSales(gross, discounts = 0, returns = 0) {
  return round2(gross - discounts - returns);
}

// Net Items Sold = quantity ordered − quantity returned.
export function netItemsSold(quantityOrdered, quantityReturned = 0) {
  return quantityOrdered - quantityReturned;
}

// Total Sales = Net Sales + Shipping + Taxes. `shipping` is the VAT-exclusive
// figure from shippingExclVat().
export function totalSales(net, shipping = 0, taxes = 0) {
  return round2(net + shipping + taxes);
}
