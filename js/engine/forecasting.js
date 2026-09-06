// Pure, deterministic historical-analysis math — PRD section 4.1. No I/O, no state.
import { WMA_WINDOW_MONTHS, Z_SCORE_OUTLIER_THRESHOLD, VOLATILITY_BUFFER_MULTIPLIER } from "../config/constants.js";

function mean(values) {
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

// Sample standard deviation (n-1 denominator); 0 when there isn't enough history to vary.
function stdDev(values) {
  if (values.length < 2) return 0;
  const avg = mean(values);
  const variance = values.reduce((sum, v) => sum + (v - avg) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

/**
 * Weighted Moving Average with linearly ascending weights (oldest -> newest),
 * so the most recent month always carries the highest weight.
 * WMA = sum(Expense_t * w_t) / sum(w_t)
 * @param {number[]} monthlyValues oldest-first array of monthly expense totals
 */
export function weightedMovingAverage(monthlyValues) {
  const window = monthlyValues.slice(-WMA_WINDOW_MONTHS);
  if (window.length === 0) return 0;
  let weightedSum = 0;
  let weightTotal = 0;
  window.forEach((value, index) => {
    const weight = index + 1; // oldest = 1 ... newest = window.length
    weightedSum += value * weight;
    weightTotal += weight;
  });
  return weightedSum / weightTotal;
}

/** Z-score of `value` against the historical `monthlyValues`. */
export function zScore(monthlyValues, value) {
  const sd = stdDev(monthlyValues);
  if (sd === 0) return 0;
  return (value - mean(monthlyValues)) / sd;
}

/** An expense is Non-Recurring when its z-score exceeds the configured threshold. */
export function isOutlier(monthlyValues, value) {
  return Math.abs(zScore(monthlyValues, value)) > Z_SCORE_OUTLIER_THRESHOLD;
}

/** Safety-margin coefficient to fold into goal planning when cash flow is volatile. */
export function volatilityBuffer(monthlyValues) {
  return stdDev(monthlyValues) * VOLATILITY_BUFFER_MULTIPLIER;
}
