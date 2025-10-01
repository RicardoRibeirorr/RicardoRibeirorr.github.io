// priceFormat.js - shared display formatting for coin prices
// Rules:
//  - If value >= 1: show exactly 2 decimals.
//  - If value < 1: show between 2 and 8 decimals; allow up to first 8, trim trailing zeros but keep at least 2.
//  - If value is extremely small (< 1e-8), fall back to scientific with 2 significant non-zero digits.

export function formatDisplayPrice(v) {
  if (v == null || !isFinite(v)) return '—';
  const abs = Math.abs(v);
  if (abs === 0) return '0.00';
  if (abs >= 1) return Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (abs < 1e-8) {
    // show scientific notation with 2 significant decimals
    const expStr = v.toExponential(2);
    return expStr.replace('e-','×10⁻');
  }
  // value between 0 and 1
  let out = Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 8 });
  // remove grouping separators to safely regex then re-add formatting without grouping on decimals portion
  // Some locales insert comma/space. We'll standardize by building manually.
  // Simpler: build from fixed(8) then trim.
  const fixed = Math.abs(v).toFixed(8); // '0.xyz...'
  // Trim trailing zeros but keep at least 2 decimals
  let trimmed = fixed.replace(/0+$/,'');
  if (trimmed.endsWith('.')) trimmed += '00';
  const decPart = trimmed.split('.')[1] || '';
  if (decPart.length < 2) trimmed = trimmed + '0'.repeat(2 - decPart.length);
  // Use trimmed (no grouping) for sub-unit values; preserve sign
  if (v < 0) trimmed = '-' + trimmed;
  return trimmed;
}
