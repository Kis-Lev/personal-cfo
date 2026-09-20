// The three cards built on the per-category spending analysis: what the
// variable spending is actually made of, where there is room to spend less, and
// where spending has started climbing.
//
// All three are deliberately descriptive. The app shows the arithmetic — what a
// category usually costs, the least it has ever cost, how the last closed cycle
// compares — and leaves every judgement to the user, including how much to cut
// and whether a category should be suggested at all.
import { getState, setState } from "../../state/store.js";
import { persistState } from "../../storage/persist.js";
import { escapeHtml } from "../../utils/escape-html.js";
import { formatCurrency } from "../../utils/currency.js";
import { renderChart, renderLegend } from "../charts.js";
import { variableExpenseBreakdownByCategory } from "../../engine/cashflow.js";
import { savingsOpportunities, spendingRises } from "../../engine/savings-opportunities.js";
import { expenseCycleLabel } from "../../engine/periods.js";

export function renderVariableBreakdownCard(state) {
  const currency = state.user_profile.currency;
  const breakdown = variableExpenseBreakdownByCategory(state.parsed_transactions);

  if (breakdown.length === 0) {
    return `<div class="card"><h3>פילוח ההוצאות המשתנות</h3><p>עדיין אין תנועות מיובאות.</p></div>`;
  }

  const series = breakdown.map((row) => ({ label: row.category, value: row.projected }));
  return `
    <div class="card">
      <h3>פילוח ההוצאות המשתנות</h3>
      <p style="color:var(--muted)">מתוך מה מורכב המספר "הוצאות משתנות" בתמונת התזרים. הקטגוריות כאן מסתכמות בדיוק לאותו סכום.</p>
      ${renderChart("donut", series, { width: 220, height: 220 })}
      ${renderLegend(series, currency)}
    </div>`;
}

function categoryRow(entry, currency) {
  const oneOffNote =
    entry.oneOffs.length === 0
      ? ""
      : `<div style="color:var(--muted)">הוצאה חד-פעמית שלא נספרה כמרווח חודשי: ${entry.oneOffs
          .map((o) => `${formatCurrency(o.amount, currency)} במחזור ${expenseCycleLabel(o.period)}`)
          .join(", ")}</div>`;

  return `
    <tr>
      <td>
        ${escapeHtml(entry.category)}
        ${oneOffNote}
      </td>
      <td>${formatCurrency(entry.typical, currency)}</td>
      <td>${formatCurrency(entry.cheapest, currency)}</td>
      <td><strong>${formatCurrency(entry.slack, currency)}</strong></td>
      <td>
        <label style="white-space:nowrap;">
          <input type="checkbox" class="protect-category" data-category="${escapeHtml(entry.category)}" ${entry.isProtected ? "checked" : ""} />
          לא לגעת
        </label>
      </td>
    </tr>`;
}

/**
 * @param {object} state
 * @param {number} monthlyGap how much a month is missing to reach the goal;
 *   0 or less when the goal is already on track
 */
export function renderSavingsOpportunitiesCard(state, monthlyGap) {
  const currency = state.user_profile.currency;
  const { candidates, protectedCategories, totalSlack, closesTheGap, periodInProgress } = savingsOpportunities(
    state.parsed_transactions,
    monthlyGap,
    { protectedCategories: state.protected_categories }
  );

  if (candidates.length === 0 && protectedCategories.length === 0) {
    return `<div id="savings-advice" class="card"><h3>איפה יש מרווח לחיסכון</h3><p>עדיין אין מספיק היסטוריה כדי להשוות חודשים.</p></div>`;
  }

  const gapLine =
    monthlyGap <= 0
      ? `<p class="track-green">את כבר בקצב הנדרש ליעד. הרשימה כאן היא בכל זאת המקומות עם הכי הרבה מרווח, אם תרצי להאיץ.</p>`
      : closesTheGap
        ? `<p>חסרים ${formatCurrency(monthlyGap, currency)} לחודש כדי להגיע ליעד. בקטגוריות הבאות יש יחד מרווח של ${formatCurrency(
            totalSlack,
            currency
          )} לחודש — כלומר הפער ניתן לסגירה מכאן.</p>`
        : `<p class="track-red">חסרים ${formatCurrency(monthlyGap, currency)} לחודש, אבל סך המרווח בכל הקטגוריות המשתנות הוא ${formatCurrency(
            totalSlack,
            currency
          )}. גם קיצוץ מלא לא יסגור את הפער — צריך גם לדחות את תאריך היעד או להוסיף הון התחלתי.</p>`;

  const openCycleNote = periodInProgress
    ? `<p style="color:var(--muted)">מחזור ${expenseCycleLabel(periodInProgress)} עדיין פתוח ולכן אינו נכלל בהשוואות.</p>`
    : "";

  const protectedNote =
    protectedCategories.length === 0
      ? ""
      : `<p style="color:var(--muted)">לא מוצעות לקיצוץ לפי בקשתך: ${protectedCategories
          .map((c) => escapeHtml(c.category))
          .join(", ")}.</p>`;

  return `
    <div id="savings-advice" class="card">
      <h3>איפה יש מרווח לחיסכון</h3>
      ${gapLine}
      <p style="color:var(--muted)">"מרווח" הוא כמה הקטגוריה עולה בדרך כלל מעבר לחודש הזול ביותר שלה — כלומר סכום שכבר הוצאת פחות ממנו בעבר. הסכום לקיצוץ נתון להחלטתך.</p>
      <table>
        <thead>
          <tr><th>קטגוריה</th><th>בדרך כלל לחודש</th><th>החודש הזול ביותר</th><th>מרווח</th><th></th></tr>
        </thead>
        <tbody>
          ${[...candidates, ...protectedCategories].map((entry) => categoryRow(entry, currency)).join("")}
        </tbody>
      </table>
      ${protectedNote}
      ${openCycleNote}
    </div>`;
}

export function renderSpendingRisesCard(state) {
  const currency = state.user_profile.currency;
  const { rises, periodInProgress } = spendingRises(state.parsed_transactions);

  if (rises.length === 0) return "";

  const arrow = (diff, percent) =>
    `${formatCurrency(Math.abs(diff), currency)} (${Math.abs(percent).toFixed(0)}%) ${diff >= 0 ? "יותר" : "פחות"}`;

  return `
    <div class="card">
      <h3>עלייה בהוצאות</h3>
      <p style="color:var(--muted)">מחזור ${expenseCycleLabel(rises[0].latest.period)} לעומת הממוצע של המחזורים שלפניו ולעומת המחזור הקודם.${
        periodInProgress ? ` מחזור ${expenseCycleLabel(periodInProgress)} עדיין פתוח ולכן אינו מושווה.` : ""
      }</p>
      <ul>
        ${rises
          .map(
            (entry) => `<li>
              <strong>${escapeHtml(entry.category)}</strong>: ${formatCurrency(entry.latest.amount, currency)} —
              ${arrow(entry.latest.vsAverage, entry.latest.vsAveragePercent)} מהממוצע (${formatCurrency(entry.latest.average, currency)}),
              ${arrow(entry.latest.vsPrevious, entry.latest.vsPreviousPercent)} מהמחזור הקודם (${formatCurrency(entry.latest.previous, currency)}).
              ${
                entry.oneOffs.some((o) => o.period === entry.latest.period)
                  ? `<span style="color:var(--muted)">כולל הוצאה חד-פעמית חריגה.</span>`
                  : ""
              }
            </li>`
          )
          .join("")}
      </ul>
    </div>`;
}

/**
 * Wires the "don't touch" checkboxes. Re-renders only this card, the same way
 * the files-by-month picker does — a whole-dashboard re-render would re-run
 * every cash-flow calculation and rebuild both charts to tick one box.
 */
export function wireSavingsAdvice(container, monthlyGap) {
  container.querySelectorAll(".protect-category").forEach((box) => {
    box.addEventListener("change", () => {
      const category = box.dataset.category;
      setState((s) => ({
        ...s,
        protected_categories: box.checked
          ? [...s.protected_categories, category]
          : s.protected_categories.filter((c) => c !== category),
      }));
      persistState();
      const host = container.querySelector("#savings-advice");
      host.outerHTML = renderSavingsOpportunitiesCard(getState(), monthlyGap);
      wireSavingsAdvice(container, monthlyGap);
    });
  });
}
