// Shared cash-flow/goal-progress calculations — used by both dashboard.js and
// simulator.js so the two screens can never drift into two different answers
// for "what is the user's current net capital / net monthly savings".
import { weightedMovingAverage } from "./forecasting.js";
import { FIXED_TREATMENT_CATEGORY } from "../config/constants.js";

export function currentNetCapital(goal, capitalLog) {
  if (capitalLog.length === 0) return goal.initial_capital;
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

function monthlyExpenseSeries(transactions) {
  const byMonth = new Map();
  for (const tx of transactions) {
    const monthKey = tx.date.slice(0, 7);
    byMonth.set(monthKey, (byMonth.get(monthKey) || 0) + tx.amount);
  }
  return Array.from(byMonth.keys())
    .sort()
    .map((key) => byMonth.get(key));
}

export function monthlyVariableExpenseSeries(transactions) {
  return monthlyExpenseSeries(transactions.filter((tx) => tx.category !== FIXED_TREATMENT_CATEGORY));
}

/**
 * Breaks the WMA-projected "variable expense" figure down by category, so the
 * dashboard never shows a single number with nothing behind it — every
 * category's own projected contribution is visible and sums back to the total.
 * @returns {Array<{category:string, projected:number}>} sorted highest-first
 */
export function variableExpenseBreakdownByCategory(transactions) {
  const variableTransactions = transactions.filter((tx) => tx.category !== FIXED_TREATMENT_CATEGORY);
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
 * Net monthly savings = fixed income
 *   - (fixed expenses from fixed_rules + projected "פיננסים, בריאות וביטוח" spending)
 *   - projected (WMA) variable expenses (everything else).
 */
export function computeNetMonthlySavings(state) {
  const fixedIncome = sumFixedRulesMonthly(state.fixed_rules, "INCOME");
  const fixedExpenseFromRules = sumFixedRulesMonthly(state.fixed_rules, "EXPENSE");

  const financeInsuranceTransactions = state.parsed_transactions.filter((tx) => tx.category === FIXED_TREATMENT_CATEGORY);
  const projectedFinanceInsurance = weightedMovingAverage(monthlyExpenseSeries(financeInsuranceTransactions));
  const fixedExpense = fixedExpenseFromRules + projectedFinanceInsurance;

  const projectedVariable = weightedMovingAverage(monthlyVariableExpenseSeries(state.parsed_transactions));

  return {
    fixedIncome,
    fixedExpense,
    projectedFinanceInsurance,
    projectedVariable,
    netMonthlySavings: fixedIncome - fixedExpense - projectedVariable,
  };
}
