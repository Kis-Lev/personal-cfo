// Pure, deterministic goal-optimization math — PRD section 4.3. No I/O, no state.
import { TRACK_STATUS } from "../config/constants.js";

/** Required_Monthly_Savings = (Target_Amount - Current_Net_Capital) / Remaining_Months */
export function requiredMonthlySavings(targetAmount, currentNetCapital, remainingMonths) {
  if (remainingMonths <= 0) return Infinity;
  return (targetAmount - currentNetCapital) / remainingMonths;
}

/** GREEN when net savings meet/exceed the required rate, RED otherwise. */
export function feasibilityGap(netMonthlySavings, requiredSavings) {
  const gap = netMonthlySavings - requiredSavings;
  return {
    status: gap >= 0 ? TRACK_STATUS.GREEN : TRACK_STATUS.RED,
    gap,
  };
}

/** Option 1: how many months are actually needed at the user's current savings rate. */
export function suggestExtendedTimeline(targetAmount, currentNetCapital, netMonthlySavings) {
  if (netMonthlySavings <= 0) return Infinity;
  return (targetAmount - currentNetCapital) / netMonthlySavings;
}

/** Option 2: monthly cut needed in variable spending to close the gap. */
export function suggestVariableCategoryReduction(netMonthlySavings, requiredSavings) {
  return Math.max(0, requiredSavings - netMonthlySavings);
}

/** Option 3: extra initial capital needed to hit the goal within the existing timeline. */
export function suggestAdditionalCapital(targetAmount, currentNetCapital, remainingMonths, netMonthlySavings) {
  return Math.max(0, targetAmount - currentNetCapital - remainingMonths * netMonthlySavings);
}
