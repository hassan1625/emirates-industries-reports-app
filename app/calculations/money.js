// Shared money helpers for the calculation layer.

// Standard UAE VAT divisor used by the client's formulas (price incl. 5% VAT).
export const VAT_DIVISOR = 1.05;

// Round half away from zero to 2 decimals, tolerant of binary float error
// (e.g. 1.005 -> 1.01). Only use where the plan says ROUND(..., 2).
export function round2(value) {
  const sign = value < 0 ? -1 : 1;
  return (sign * Math.round((Math.abs(value) + Number.EPSILON) * 100)) / 100;
}
