import { getState } from "../state/store.js";
import { currentNetCapital, monthsRemaining, computeNetMonthlySavings, categorySpendingSummary } from "../engine/cashflow.js";
import { buildFeasibilitySuggestions } from "./components/feasibility-suggestions.js";
import { formatCurrency } from "../utils/currency.js";
import { renderChart, renderLegend } from "./charts.js";
import { escapeHtml } from "../utils/escape-html.js";

export function renderDashboard(container) {
  const state = getState();
  const goal = [...state.goals].sort((a, b) => a.priority - b.priority)[0];

  if (!goal) {
    container.innerHTML = `<div class="card"><p>אין עדיין יעד מוגדר. הוסיפי יעד במסך "סימולטור יעדים" כדי לראות את הדשבורד.</p></div>`;
    return;
  }

  const netCapital = currentNetCapital(goal, state.capital_adjustments_log, state.financial_instruments);
  const progressPct = Math.min(100, (netCapital / goal.target_amount) * 100);
  const remaining = monthsRemaining(goal.target_date);

  const { fixedIncome, fixedExpense, projectedFinanceInsurance, projectedVariable, netMonthlySavings } = computeNetMonthlySavings(state);

  const { required, html: suggestionsHtml } = buildFeasibilitySuggestions(
    goal.target_amount,
    netCapital,
    remaining,
    netMonthlySavings,
    state.user_profile.currency
  );

  const cashflowSeries = [
    { label: "קבועות", value: fixedExpense },
    { label: "משתנות", value: projectedVariable },
    { label: "יתרה לחיסכון", value: Math.max(0, netMonthlySavings) },
  ];
  const donut = renderChart("donut", cashflowSeries, { width: 220, height: 220 });
  const legend = renderLegend(cashflowSeries, state.user_profile.currency);

  const { rows: categoryRows, overallMonthlyAverage } = categorySpendingSummary(state);
  const currency = state.user_profile.currency;
  const categoryTableHtml =
    categoryRows.length === 0
      ? "<p>עדיין אין מספיק נתונים (לא קבועות ולא תנועות מיובאות) לפילוח לפי קטגוריה.</p>"
      : `<table>
          <thead>
            <tr><th>קטגוריה</th><th>קבוע חודשי</th><th>ממוצע מתנועות</th><th>סה"כ ממוצע חודשי</th><th>חודשים עם נתונים</th></tr>
          </thead>
          <tbody>
            ${categoryRows
              .map(
                (r) => `<tr>
                  <td>${escapeHtml(r.category)}</td>
                  <td>${formatCurrency(r.fixedMonthly, currency)}</td>
                  <td>${formatCurrency(r.avgFromTransactions, currency)}</td>
                  <td><strong>${formatCurrency(r.monthlyAverage, currency)}</strong></td>
                  <td>${r.monthsWithData}</td>
                </tr>`
              )
              .join("")}
          </tbody>
        </table>`;

  container.innerHTML = `
    <div class="card">
      <h2>${escapeHtml(goal.title)}</h2>
      <div style="background:var(--border); border-radius:6px; overflow:hidden; height:20px;">
        <div style="width:${progressPct.toFixed(1)}%; background:var(--primary); height:100%;"></div>
      </div>
      <p>${formatCurrency(netCapital, state.user_profile.currency)} מתוך ${formatCurrency(goal.target_amount, state.user_profile.currency)} (${progressPct.toFixed(1)}%)</p>
      <p>תאריך יעד: ${goal.target_date} · נותרו ${remaining} חודשים</p>
      ${suggestionsHtml}
    </div>
    <div class="grid-2">
      <div class="card">
        <h3>תמונת תזרים חודשית</h3>
        <p>הכנסות קבועות: ${formatCurrency(fixedIncome, currency)}</p>
        <p>הוצאות קבועות: ${formatCurrency(fixedExpense, currency)}${projectedFinanceInsurance > 0 ? ` <span style="color:var(--muted)">(מתוכן ${formatCurrency(projectedFinanceInsurance, currency)} פיננסים/ביטוח)</span>` : ""}</p>
        <p>הוצאות משתנות (חזוי WMA): ${formatCurrency(projectedVariable, currency)}</p>
        <p>קצב חיסכון נדרש: ${formatCurrency(required, currency)}</p>
      </div>
      <div class="card">
        <h3>פילוח תזרימי</h3>
        ${donut}
        ${legend}
      </div>
    </div>
    <div class="card">
      <h3>ממוצע הוצאה חודשית לפי קטגוריה</h3>
      <p>ממוצע הוצאה חודשית כוללת (כל הקטגוריות): <strong>${formatCurrency(overallMonthlyAverage, currency)}</strong></p>
      ${categoryTableHtml}
    </div>
  `;
}
