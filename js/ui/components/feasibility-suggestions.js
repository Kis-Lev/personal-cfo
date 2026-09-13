// Shared by dashboard.js and simulator.js so the "3 options when red" block
// is defined once — both screens must always show the exact same numbers.
import {
  requiredMonthlySavings,
  feasibilityGap,
  suggestExtendedTimeline,
  suggestVariableCategoryReduction,
  suggestAdditionalCapital,
} from "../../engine/goals.js";
import { formatCurrency } from "../../utils/currency.js";
import { TRACK_STATUS } from "../../config/constants.js";

/**
 * @returns {{status:string, gap:number, required:number, html:string}}
 */
export function buildFeasibilitySuggestions(targetAmount, currentCapital, remainingMonths, netMonthlySavings, currency) {
  const required = requiredMonthlySavings(targetAmount, currentCapital, remainingMonths);
  const { status, gap } = feasibilityGap(netMonthlySavings, required);

  if (status !== TRACK_STATUS.RED) {
    return {
      status,
      gap,
      required,
      html: `<p class="track-green">✅ במסלול הבטוח (עודף חודשי: ${formatCurrency(gap, currency)})</p>`,
    };
  }

  const extendedMonths = suggestExtendedTimeline(targetAmount, currentCapital, netMonthlySavings);
  const reduction = suggestVariableCategoryReduction(netMonthlySavings, required);
  const additionalCapital = suggestAdditionalCapital(targetAmount, currentCapital, remainingMonths, netMonthlySavings);

  const html = `
    <p class="track-red">⚠️ מתחת לקצב הנדרש (פער חודשי: ${formatCurrency(gap, currency)})</p>
    <ul>
      <li>הארכת תאריך היעד ל-${Number.isFinite(extendedMonths) ? extendedMonths.toFixed(0) : "∞"} חודשים מהיום</li>
      <li>הפחתה נדרשת בהוצאות משתנות: ${formatCurrency(reduction, currency)} לחודש</li>
      <li>תוספת הון התחלתי נדרשת: ${formatCurrency(additionalCapital, currency)}</li>
    </ul>
  `;
  return { status, gap, required, html };
}
