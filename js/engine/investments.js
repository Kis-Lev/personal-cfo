// An investment portfolio as the app is willing to describe it: two facts the
// user supplies, and nothing invented in between. Pure, no I/O, no state.
//
// A deposit has a contractual rate, so its future value is arithmetic. A
// portfolio of shares has no such thing, and an app that quietly applied an
// assumed return would be putting a number on screen that looks like a promise
// and is not one. So nothing here projects: the portfolio is worth what the
// user last saw it was worth, and the only derived figure is the difference
// between that and what was put in, which already happened.
//
// What the app does insist on is saying how old that figure is. A valuation
// from eight months ago is not today's capital, and presenting it as such is
// the same kind of silent staleness as a loan balance that never amortizes.
import { INVESTMENT_VALUE_STALE_DAYS } from "../config/constants.js";

const MS_PER_DAY = 86400 * 1000;

function daysBetween(fromIso, toDate) {
  const from = new Date(`${fromIso}T00:00:00Z`);
  if (Number.isNaN(from.getTime())) return 0;
  return Math.max(0, Math.floor((toDate.getTime() - from.getTime()) / MS_PER_DAY));
}

/** Whole months from an ISO date to a moment, never negative. */
function monthsBetween(fromIso, toDate) {
  const from = new Date(`${fromIso}T00:00:00Z`);
  if (Number.isNaN(from.getTime())) return 0;
  const months = (toDate.getUTCFullYear() - from.getUTCFullYear()) * 12 + (toDate.getUTCMonth() - from.getUTCMonth());
  return Math.max(0, months - (toDate.getUTCDate() < from.getUTCDate() ? 1 : 0));
}

/**
 * @param {object} investment one entry from financial_instruments.investments
 * @param {Date} [today]
 * @returns {{
 *   currentValue: number, contributed: number, gain: number, gainPercent: number,
 *   valuationAgeDays: number, monthsSinceValuation: number, isStale: boolean
 * }}
 */
export function investmentState(investment, today = new Date()) {
  const currentValue = Number(investment.current_value) || 0;
  const contributed = Number(investment.contributed) || 0;
  const gain = currentValue - contributed;
  const valuationAgeDays = investment.value_as_of ? daysBetween(investment.value_as_of, today) : Infinity;

  return {
    currentValue,
    contributed,
    gain,
    gainPercent: contributed > 0 ? (gain / contributed) * 100 : 0,
    valuationAgeDays,
    monthsSinceValuation: investment.value_as_of ? monthsBetween(investment.value_as_of, today) : 0,
    isStale: valuationAgeDays > INVESTMENT_VALUE_STALE_DAYS,
  };
}

/**
 * @param {object[]} investments
 * @param {number} monthlyContribution total of the INVESTMENT standing orders
 * @param {Date} [today]
 * @returns {{value, contributed, gain, staleCount, contributedSinceValuation, monthsSinceOldestValuation}}
 *   contributedSinceValuation is what the standing orders have paid in since
 *   the OLDEST valuation — counted once for the household, not once per
 *   portfolio, since a standing order funds whichever account it funds. It is
 *   reported and never added to the value: the money is known to have gone in,
 *   but what it is worth now is exactly the thing nobody can say without
 *   looking.
 */
export function investmentTotals(investments = [], monthlyContribution = 0, today = new Date()) {
  const totals = investments.reduce(
    (acc, investment) => {
      const state = investmentState(investment, today);
      acc.value += state.currentValue;
      acc.contributed += state.contributed;
      acc.gain += state.gain;
      acc.monthsSinceOldestValuation = Math.max(acc.monthsSinceOldestValuation, state.monthsSinceValuation);
      if (state.isStale) acc.staleCount += 1;
      return acc;
    },
    { value: 0, contributed: 0, gain: 0, staleCount: 0, monthsSinceOldestValuation: 0 }
  );

  return { ...totals, contributedSinceValuation: totals.monthsSinceOldestValuation * monthlyContribution };
}
