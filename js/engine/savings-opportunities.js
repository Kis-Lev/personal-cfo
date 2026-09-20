// Where a household could spend less, and where it has started spending more.
// Pure analysis over the imported transactions — no I/O, no state.
//
// Both answers come from the same per-category monthly series, laid out on one
// shared axis so the categories stay comparable with each other and with the
// totals on the dashboard.
//
// The app deliberately makes no judgement about WHICH spending is worth having.
// It has no way to know that, and guessing would be both wrong and rude. What
// it can see is arithmetic: how much a category costs, and how far it swings.
// A category that costs the same every month is a commitment however it is
// labelled; one that swings has room in it. The user marks anything she does
// not want suggested, and that marking always wins.
import { variableTransactions, periodAxisOf, alignedMonthlySeries } from "./cashflow.js";
import { expenseCycleRange } from "./periods.js";
import {
  ONE_OFF_MEDIAN_MULTIPLE,
  ONE_OFF_MIN_EXCESS,
  SPENDING_RISE_MIN_PERCENT,
  SPENDING_RISE_MIN_AMOUNT,
} from "../config/constants.js";

function median(values) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

const mean = (values) => (values.length === 0 ? 0 : values.reduce((sum, v) => sum + v, 0) / values.length);

/**
 * Which periods of a category's series are one-offs — a holiday, a sofa —
 * rather than the level it usually runs at.
 *
 * Each period is judged against the median of the OTHERS, not against the whole
 * series: a single large month drags the mean and inflates the deviation, so a
 * spike measured against a series that contains it hides behind its own effect.
 * The excess must also be worth naming in shekels, or a ₪60 month against a ₪20
 * median would be reported as an extraordinary event.
 */
function oneOffPeriodIndexes(series) {
  return series
    .map((value, index) => {
      const others = series.filter((_, i) => i !== index);
      const baseline = median(others);
      const isSpike = value >= baseline * ONE_OFF_MEDIAN_MULTIPLE && value - baseline >= ONE_OFF_MIN_EXCESS;
      return isSpike ? index : -1;
    })
    .filter((index) => index !== -1);
}

/**
 * The periods whose cycle has already closed. The one in progress is excluded
 * from every comparison: it holds a few days of spending against other periods
 * that hold a full cycle, so it always looks like a collapse in spending and
 * would turn every "rise" into noise.
 */
function completePeriodCount(axis, today) {
  const todayIso = today.toISOString().slice(0, 10);
  let count = 0;
  for (const period of axis) {
    if (expenseCycleRange(period).end < todayIso) count += 1;
  }
  return count;
}

/**
 * Everything the dashboard needs to say about each variable category.
 *
 * @param {object[]} transactions
 * @param {{today?: Date, protectedCategories?: string[]}} [options]
 * @returns {{
 *   categories: Array<{
 *     category: string, series: number[], typical: number, cheapest: number,
 *     slack: number, oneOffs: Array<{period: string, amount: number}>,
 *     isProtected: boolean, latest: null | {period, amount, average, previous,
 *       vsAverage: number, vsAveragePercent: number, vsPrevious: number,
 *       vsPreviousPercent: number, isRising: boolean}
 *   }>,
 *   axis: string[],
 *   periodInProgress: string | null
 * }}
 */
export function analyzeVariableCategories(transactions, { today = new Date(), protectedCategories = [] } = {}) {
  const variable = variableTransactions(transactions);
  const axis = periodAxisOf(variable);
  const complete = completePeriodCount(axis, today);
  const periodInProgress = complete < axis.length ? axis[axis.length - 1] : null;
  const protectedSet = new Set(protectedCategories);

  const byCategory = new Map();
  for (const tx of variable) {
    if (!byCategory.has(tx.category)) byCategory.set(tx.category, []);
    byCategory.get(tx.category).push(tx);
  }

  const categories = [...byCategory.entries()].map(([category, txs]) => {
    const series = alignedMonthlySeries(txs, axis);
    const oneOffIndexes = new Set(oneOffPeriodIndexes(series));
    const recurring = series.filter((_, i) => !oneOffIndexes.has(i));

    // What the category usually costs, and the least it has ever cost, with the
    // one-offs left out of both: a holiday is not a monthly saving waiting to
    // be made, and counting it would promise money that is not there.
    const typical = mean(recurring);
    const cheapest = recurring.length > 0 ? Math.min(...recurring) : 0;

    return {
      category,
      series,
      typical,
      cheapest,
      // How much more than its own cheapest month this category usually costs.
      // It answers "where is there room" without anyone deciding what is
      // worth having: the household itself has already run this category at
      // the lower figure.
      slack: Math.max(0, typical - cheapest),
      oneOffs: [...oneOffIndexes].sort((a, b) => a - b).map((i) => ({ period: axis[i], amount: series[i] })),
      isProtected: protectedSet.has(category),
      latest: latestComparison(series, axis, complete, oneOffIndexes),
    };
  });

  return { categories, axis, periodInProgress };
}

/** The last closed period against the category's own history and the period before it. */
function latestComparison(series, axis, complete, oneOffIndexes) {
  if (complete < 2) return null;
  const latestIndex = complete - 1;
  const amount = series[latestIndex];
  const previous = series[latestIndex - 1];

  // Averaged over what came BEFORE, so the month being judged is not part of
  // the yardstick it is judged against. One-offs are left out for the same
  // reason they are left out of `typical`.
  const earlier = series.slice(0, latestIndex).filter((_, i) => !oneOffIndexes.has(i));
  const average = mean(earlier);

  const vsAverage = amount - average;
  const vsPrevious = amount - previous;
  const percent = (diff, base) => (base > 0 ? (diff / base) * 100 : 0);
  const vsAveragePercent = percent(vsAverage, average);
  const vsPreviousPercent = percent(vsPrevious, previous);

  const worthReporting = (diff, pct) => diff >= SPENDING_RISE_MIN_AMOUNT && pct >= SPENDING_RISE_MIN_PERCENT;

  return {
    period: axis[latestIndex],
    amount,
    average,
    previous,
    vsAverage,
    vsAveragePercent,
    vsPrevious,
    vsPreviousPercent,
    isRising: worthReporting(vsAverage, vsAveragePercent) || worthReporting(vsPrevious, vsPreviousPercent),
  };
}

/**
 * Categories with room in them, most room first, for a user who needs to find
 * `monthlyGap` a month. No per-category target is suggested: the user asked to
 * be shown where the room is and to decide the amounts herself.
 *
 * `totalSlack` is what the app can honestly point at. When it falls short of
 * the gap, the caller says so rather than implying the goal is reachable by
 * trimming — the other levers (a later date, more starting capital) are then
 * the only real answers.
 */
export function savingsOpportunities(transactions, monthlyGap, options = {}) {
  const { categories, periodInProgress } = analyzeVariableCategories(transactions, options);
  const candidates = categories
    .filter((c) => !c.isProtected && c.slack > 0)
    .sort((a, b) => b.slack - a.slack);
  const totalSlack = candidates.reduce((sum, c) => sum + c.slack, 0);

  return {
    candidates,
    protectedCategories: categories.filter((c) => c.isProtected),
    totalSlack,
    monthlyGap,
    closesTheGap: totalSlack >= monthlyGap,
    periodInProgress,
  };
}

/** Categories spending meaningfully more in the last closed cycle. */
export function spendingRises(transactions, options = {}) {
  const { categories, periodInProgress } = analyzeVariableCategories(transactions, options);
  return {
    rises: categories
      .filter((c) => c.latest?.isRising)
      .sort((a, b) => b.latest.vsAverage - a.latest.vsAverage),
    periodInProgress,
  };
}
