// The single owner of the question "which month does this transaction belong
// to". There are two different answers, and conflating them is what this module
// exists to prevent.
//
// Spending is billed on a credit-card cycle that runs from the 10th of one
// month to the 10th of the next, so the cycle — not the calendar — is what
// decides when money left the account. A charge on the 3rd of September was
// paid as part of August's bill and belongs to August.
//
// Income does not work that way: a salary paid on the 3rd of August is August's
// income, full stop. So income keeps the calendar month.
//
// Both answers are a "YYYY-MM" key, which keeps every caller's grouping,
// sorting and map-keying identical to what it was when everything used
// date.slice(0, 7) — only the meaning of the key changes.
import { EXPENSE_CYCLE_START_DAY } from "../config/constants.js";

/** Calendar month of an ISO date — the period income belongs to. */
export function calendarMonthKey(isoDate) {
  return isoDate.slice(0, 7);
}

/**
 * Billing cycle of an ISO date — the period spending belongs to. A cycle is
 * named after the month it STARTS in, and the start day itself opens the new
 * cycle: cycle "2026-08" runs from 2026-08-10 through 2026-09-09.
 */
export function expenseCycleKey(isoDate) {
  const [year, month, day] = isoDate.split("-").map(Number);
  if (day >= EXPENSE_CYCLE_START_DAY) return `${year}-${String(month).padStart(2, "0")}`;
  const previousMonth = month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 };
  return `${previousMonth.year}-${String(previousMonth.month).padStart(2, "0")}`;
}

/**
 * The cycle a bill belongs to, from the day it was charged. A bill CLOSES a
 * cycle rather than opening one: the statement charged on 10 September is the
 * bill for everything bought between 10 August and 9 September, which is cycle
 * August. So the cycle is the one containing the day before the charge.
 */
export function cycleOfBillingDate(billingDateIso) {
  const dayBefore = new Date(`${billingDateIso}T00:00:00Z`);
  dayBefore.setUTCDate(dayBefore.getUTCDate() - 1);
  return expenseCycleKey(dayBefore.toISOString().slice(0, 10));
}

/**
 * Income is recognised only where a transaction says so explicitly. Nothing in
 * the import pipeline sets this today — income currently reaches the app as
 * dated-less monthly amounts in fixed_rules, which need no period at all — so
 * this is the seam a future bank-account import plugs into rather than a
 * guess about which of today's rows might be income. A negative amount is NOT
 * income: on a card statement that is a refund of a charge, and it belongs to
 * the cycle it was credited in.
 */
export function isIncomeTransaction(transaction) {
  return transaction.type === "INCOME";
}

/**
 * The period key for a transaction, picking the rule that applies to it.
 *
 * A charge belongs to the cycle it was BILLED in, not the one it was bought in,
 * and those differ whenever a purchase is paid in instalments: the same
 * purchase date appears on several consecutive statements, one instalment each.
 * Grouping by purchase date piled every instalment into the month of the
 * purchase, so a cycle showed money that had not left the account yet.
 *
 * billing_cycle is worked out at import time (see tabular-parser.js), because
 * it can take the whole file to know it: some statements carry a billing date
 * per row, while others are a single bill whose date is stated nowhere in the
 * rows themselves. Transactions imported before this existed have no
 * billing_cycle, and fall back to the purchase date rather than being wrong in
 * a new way.
 */
export function periodKeyFor(transaction) {
  if (isIncomeTransaction(transaction)) return calendarMonthKey(transaction.date);
  return transaction.billing_cycle || expenseCycleKey(transaction.date);
}

/** First and last day (inclusive, ISO) covered by an expense cycle key. */
export function expenseCycleRange(cycleKey) {
  const [year, month] = cycleKey.split("-").map(Number);
  const start = new Date(Date.UTC(year, month - 1, EXPENSE_CYCLE_START_DAY));
  const end = new Date(Date.UTC(year, month, EXPENSE_CYCLE_START_DAY - 1));
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

/**
 * How a cycle is written for the user. The dates are part of the label on
 * purpose: "08/2026" on its own reads as calendar August, and the whole point
 * of the cycle is that it is not.
 */
export function expenseCycleLabel(cycleKey) {
  const [year, month] = cycleKey.split("-");
  const { start, end } = expenseCycleRange(cycleKey);
  const dayMonth = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
  return `${month}/${year} (${dayMonth(start)}–${dayMonth(end)})`;
}

/** The cycle a given date falls in — used for "which cycle are we in now". */
export function currentExpenseCycleKey(today = new Date()) {
  return expenseCycleKey(today.toISOString().slice(0, 10));
}
