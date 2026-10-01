// Shared by Report 3 (sales) and Report 5 (quantity). Dev Plan §4a.
// value   = current − previous
// percent = value ÷ previous × 100, or null when previous is 0 (undefined).
// Values are returned unrounded; rounding is a formatting concern.
export function difference(current, previous) {
  const value = current - previous;
  const percent = previous === 0 ? null : (value / previous) * 100;
  return { value, percent };
}
