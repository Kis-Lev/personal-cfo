import { getState } from "../state/store.js";
import { currentNetCapital, monthsRemaining, computeNetMonthlySavings } from "../engine/cashflow.js";
import { buildFeasibilitySuggestions } from "./components/feasibility-suggestions.js";
import { formatCurrency } from "../utils/currency.js";
import { renderChart } from "./charts.js";
import { escapeHtml } from "../utils/escape-html.js";

export function renderDashboard(container) {
  const state = getState();
  const goal = [...state.goals].sort((a, b) => a.priority - b.priority)[0];

  if (!goal) {
    container.innerHTML = `<div class="card"><p>אין עדיין יעד מוגדר. הוסיפי יעד במסך "סימולטור יעדים" כדי לראות את הדשבורד.</p></div>`;
    return;
  }

  const netCapital = currentNetCapital(goal, state.capital_adjustments_log);
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

  const donut = renderChart(
    "donut",
    [
      { label: "קבועות", value: fixedExpense },
      { label: "משתנות", value: projectedVariable },
      { label: "יתרה לחיסכון", value: Math.max(0, netMonthlySavings) },
    ],
    { width: 220, height: 220 }
  );

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
        <p>הכנסות קבועות: ${formatCurrency(fixedIncome, state.user_profile.currency)}</p>
        <p>הוצאות קבועות: ${formatCurrency(fixedExpense, state.user_profile.currency)}${projectedFinanceInsurance > 0 ? ` <span style="color:var(--muted)">(מתוכן ${formatCurrency(projectedFinanceInsurance, state.user_profile.currency)} פיננסים/ביטוח)</span>` : ""}</p>
        <p>הוצאות משתנות (חזוי WMA): ${formatCurrency(projectedVariable, state.user_profile.currency)}</p>
        <p>קצב חיסכון נדרש: ${formatCurrency(required, state.user_profile.currency)}</p>
      </div>
      <div class="card">
        <h3>פילוח תזרימי</h3>
        ${donut}
      </div>
    </div>
  `;
}
