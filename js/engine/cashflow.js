// Shared cash-flow/goal-progress calculations — used by both dashboard.js and
// simulator.js so the two screens can never drift into two different answers
// for "what is the user's current net capital / net monthly savings".
import { weightedMovingAverage } from "./forecasting.js";

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

export function monthlyVariableExpenseSeries(transactions) {
  const byMonth = new Map();
  for (const tx of transactions) {
    const monthKey = tx.date.slice(0, 7);
    byMonth.set(monthKey, (byMonth.get(monthKey) || 0) + tx.amount);
  }
  return Array.from(byMonth.keys())
    .sort()
    .map((key) => byMonth.get(key));
}

/** Net monthly savings = fixed income - fixed expenses - projected (WMA) variable expenses. */
export function computeNetMonthlySavings(state) {
  const fixedIncome = sumFixedRulesMonthly(state.fixed_rules, "INCOME");
  const fixedExpense = sumFixedRulesMonthly(state.fixed_rules, "EXPENSE");
  const projectedVariable = weightedMovingAverage(monthlyVariableExpenseSeries(state.parsed_transactions));
  return { fixedIncome, fixedExpense, projectedVariable, netMonthlySavings: fixedIncome - fixedExpense - projectedVariable };
}
