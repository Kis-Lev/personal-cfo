// Shared cash-flow/goal-progress calculations — used by both dashboard.js and
// simulator.js so the two screens can never drift into two different answers
// for "what is the user's current net capital / net monthly savings".
import { weightedMovingAverage } from "./forecasting.js";
import { FIXED_TREATMENT_CATEGORIES } from "../config/constants.js";

const fixedTreatmentCategories = new Set(FIXED_TREATMENT_CATEGORIES);

function isFixedTreatment(transaction) {
  return fixedTreatmentCategories.has(transaction.category);
}

/**
 * Whether deposits/loans (tracked separately in the fixed-manager screen)
 * count toward a goal's starting capital is the user's explicit per-goal
 * choice (goal.include_financial_instruments) — never assumed. When she
 * opts in, the baseline is every deposit's principal minus every loan's
 * remaining principal; otherwise the baseline is 0. The manual capital-
 * adjustment log always layers on top of that baseline, for a documented,
 * explained correction (e.g. cash the tracked instruments don't see).
 */
export function currentNetCapital(goal, capitalLog, financialInstruments) {
  let baseline = 0;
  if (goal.include_financial_instruments) {
    const depositsTotal = financialInstruments.deposits.reduce((sum, d) => sum + d.principal, 0);
    const loansTotal = financialInstruments.loans.reduce((sum, l) => sum + l.remaining_principal, 0);
    baseline = depositsTotal - loansTotal;
  }
  if (capitalLog.length === 0) return baseline;
  return capitalLog[capitalLog.length - 1].new_balance;
}

export function monthsRemaining(targetDateIso) {
  const today = new Date();
  const target = new Date(targetDateIso);
  return Math.max(0, (target.getFullYear() - today.getFullYear()) * 12 + (target.getMonth() - today.getMonth()));
}

export function sumFixedRulesMonthly(fixedRules, type) {
  return fixedRules.filter((r) => r.active && r.type === type).reduce((sum, r) => sum + r.amount, 0);
}

/**
 * What a transaction actually cost the user, which is not always what was
 * charged: a work expense paid from the personal account and then reimbursed
 * left the account, so it shows up on the statement, but it is not her money
 * and must not shape any forecast or average. The reimbursement is often
 * partial, so this is a percentage rather than a flag — reimbursed_percent
 * 100 removes the transaction from the maths entirely, 0 leaves it whole.
 *
 * Every spending calculation goes through monthlyExpenseSeries below, so
 * applying it there is what keeps this one definition of "cost" from having
 * to be repeated per calculation.
 */
export function effectiveAmount(transaction) {
  const reimbursed = Math.min(100, Math.max(0, Number(transaction.reimbursed_percent) || 0));
  return transaction.amount * (1 - reimbursed / 100);
}

function monthlyExpenseSeries(transactions) {
  const byMonth = new Map();
  for (const tx of transactions) {
    const monthKey = tx.date.slice(0, 7);
    byMonth.set(monthKey, (byMonth.get(monthKey) || 0) + effectiveAmount(tx));
  }
  return Array.from(byMonth.keys())
    .sort()
    .map((key) => byMonth.get(key));
}

export function monthlyVariableExpenseSeries(transactions) {
  return monthlyExpenseSeries(transactions.filter((tx) => !isFixedTreatment(tx)));
}

/**
 * Breaks the WMA-projected "variable expense" figure down by category, so the
 * dashboard never shows a single number with nothing behind it — every
 * category's own projected contribution is visible and sums back to the total.
 * @returns {Array<{category:string, projected:number}>} sorted highest-first
 */
export function variableExpenseBreakdownByCategory(transactions) {
  const variableTransactions = transactions.filter((tx) => !isFixedTreatment(tx));
  const byCategory = new Map();
  for (const tx of variableTransactions) {
    if (!byCategory.has(tx.category)) byCategory.set(tx.category, []);
    byCategory.get(tx.category).push(tx);
  }
  return [...byCategory.entries()]
    .map(([category, txs]) => ({ category, projected: weightedMovingAverage(monthlyExpenseSeries(txs)) }))
    .sort((a, b) => b.projected - a.projected);
}

/**
 * A real "average spending per category" report — the thing a spreadsheet
 * or bank app would show by default, distinct from the WMA-based forward
 * projection used for goal-feasibility math above. For every category that
 * appears anywhere (a fixed rule or a transaction), shows the plain
 * arithmetic monthly average, broken into its fixed and transaction-derived
 * parts so no number here is a blended black box.
 * @returns {{ rows: Array<{category, fixedMonthly, avgFromTransactions, monthsWithData, monthlyAverage}>, overallMonthlyAverage: number }}
 */
export function categorySpendingSummary(state) {
  // Bucketed in one pass over each list rather than re-filtering the whole
  // transaction history once per category, which re-read every transaction as
  // many times as there are categories.
  const fixedByCategory = new Map();
  for (const rule of state.fixed_rules) {
    if (!rule.active || rule.type !== "EXPENSE") continue;
    fixedByCategory.set(rule.category, (fixedByCategory.get(rule.category) || 0) + rule.amount);
  }

  const transactionsByCategory = new Map();
  for (const tx of state.parsed_transactions) {
    if (!transactionsByCategory.has(tx.category)) transactionsByCategory.set(tx.category, []);
    transactionsByCategory.get(tx.category).push(tx);
  }

  const categories = new Set([...fixedByCategory.keys(), ...transactionsByCategory.keys()]);

  const rows = [...categories]
    .map((category) => {
      const fixedMonthly = fixedByCategory.get(category) || 0;
      const monthlyTotals = monthlyExpenseSeries(transactionsByCategory.get(category) || []);
      const monthsWithData = monthlyTotals.length;
      const avgFromTransactions = monthsWithData > 0 ? monthlyTotals.reduce((a, b) => a + b, 0) / monthsWithData : 0;
      return {
        category,
        fixedMonthly,
        avgFromTransactions,
        monthsWithData,
        monthlyAverage: fixedMonthly + avgFromTransactions,
      };
    })
    .sort((a, b) => b.monthlyAverage - a.monthlyAverage);

  const overallMonthlyAverage = rows.reduce((sum, r) => sum + r.monthlyAverage, 0);
  return { rows, overallMonthlyAverage };
}

/**
 * Groups imported transactions by (billing month, source file) so the
 * dashboard can show, for any month, exactly which files were imported and
 * how much each contributed. A file's transactions can straddle a month
 * boundary (e.g. a billing cycle closing mid-month), so a file appears once
 * per month it actually has transactions in, rather than forced into a
 * single "file month".
 * @returns {{
 *   months: string[],
 *   rowsByMonth: Map<string, Array<{sourceFile:string, source:string, count:number, total:number}>>,
 *   recurringSources: Set<string>
 * }}
 */
export function filesByMonth(transactions) {
  const groups = new Map();
  const sourceMonths = new Map(); // source -> Set of months it has ever appeared in

  for (const tx of transactions) {
    const month = tx.date.slice(0, 7);
    const sourceFile = tx.source_file || "—";
    // JSON-encoded rather than concatenated with a separator character: a file
    // name can contain any character, so no literal separator is safe from
    // colliding two different (month, file) pairs onto one key.
    const key = JSON.stringify([month, sourceFile]);
    if (!groups.has(key)) groups.set(key, { month, sourceFile, source: tx.source, count: 0, total: 0 });
    const group = groups.get(key);
    group.count += 1;
    // Deliberately the amount as charged, not effectiveAmount: this table is
    // for checking a file against the statement it came from, and a total that
    // quietly netted off reimbursements would no longer reconcile.
    group.total += tx.amount;

    if (!sourceMonths.has(tx.source)) sourceMonths.set(tx.source, new Set());
    sourceMonths.get(tx.source).add(month);
  }

  const rowsByMonth = new Map();
  for (const group of groups.values()) {
    if (!rowsByMonth.has(group.month)) rowsByMonth.set(group.month, []);
    rowsByMonth.get(group.month).push(group);
  }
  for (const rows of rowsByMonth.values()) rows.sort((a, b) => b.total - a.total);

  // A source that only ever showed up once (e.g. a one-off manually-mapped
  // file that wasn't saved as a preset) isn't an "expected every month"
  // source, so it's excluded from the missing-sources check below to avoid
  // false alarms.
  const recurringSources = new Set([...sourceMonths.entries()].filter(([, months]) => months.size >= 2).map(([source]) => source));

  return { months: [...rowsByMonth.keys()].sort(), rowsByMonth, recurringSources };
}

/**
 * Net monthly savings = fixed income
 *   - (fixed expenses from fixed_rules + projected spending in the
 *      fixed-treatment categories)
 *   - projected (WMA) variable expenses (everything else).
 */
export function computeNetMonthlySavings(state) {
  const fixedIncome = sumFixedRulesMonthly(state.fixed_rules, "INCOME");
  const fixedExpenseFromRules = sumFixedRulesMonthly(state.fixed_rules, "EXPENSE");

  const fixedTreatmentTransactions = state.parsed_transactions.filter(isFixedTreatment);
  const projectedFixedFromTransactions = weightedMovingAverage(monthlyExpenseSeries(fixedTreatmentTransactions));
  const fixedExpense = fixedExpenseFromRules + projectedFixedFromTransactions;

  const projectedVariable = weightedMovingAverage(monthlyVariableExpenseSeries(state.parsed_transactions));

  return {
    fixedIncome,
    fixedExpense,
    projectedFixedFromTransactions,
    projectedVariable,
    netMonthlySavings: fixedIncome - fixedExpense - projectedVariable,
  };
}
