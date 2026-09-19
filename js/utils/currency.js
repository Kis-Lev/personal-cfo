// Single amount-parsing/formatting pair shared across the app.

// One number, with optional thousands separators and an optional decimal part.
// Matched globally so the parser can tell "this cell holds exactly one number"
// from "this cell holds a number plus something else numeric".
const NUMBER_TOKEN = /-?\d{1,3}(?:,\d{3})+(?:\.\d+)?|-?\d+(?:\.\d+)?/g;

/**
 * Turns one amount cell into a signed number, or null when the cell cannot be
 * read as exactly one amount.
 *
 * Stripping every non-digit and calling parseFloat on what's left is wrong in
 * both directions on real exports, so neither is done here:
 *  - a credit written "45.00-" (trailing minus) or "(45.00)" (accounting
 *    parentheses) came back POSITIVE, turning a refund into a charge;
 *  - a cell holding more than one number ("3 תשלומים 100.00") had its digits
 *    concatenated into a single invented figure (3100) that silently entered
 *    every total. Such a cell is ambiguous, so it returns null and the caller
 *    reports the row as unread rather than guessing at it.
 */
export function parseAmount(rawValue) {
  const text = String(rawValue ?? "").trim();
  if (text === "") return null;

  const tokens = text.match(NUMBER_TOKEN);
  if (!tokens || tokens.length !== 1) return null;

  const value = parseFloat(tokens[0].replace(/,/g, ""));
  if (!Number.isFinite(value)) return null;

  const isNegative = value < 0 || /-\s*$/.test(text) || /^\(.*\)$/.test(text);
  return isNegative ? -Math.abs(value) : value;
}

export function formatCurrency(amount, currency = "ILS") {
  return new Intl.NumberFormat("he-IL", { style: "currency", currency }).format(amount);
}
