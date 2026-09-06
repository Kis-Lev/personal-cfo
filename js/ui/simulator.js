import { getState, setState } from "../state/store.js";
import { persistState } from "../storage/persist.js";
import { createId } from "../utils/ids.js";
import { formatCurrency } from "../utils/currency.js";
import { currentNetCapital, monthsRemaining, computeNetMonthlySavings } from "../engine/cashflow.js";
import {
  requiredMonthlySavings,
  feasibilityGap,
  suggestExtendedTimeline,
  suggestVariableCategoryReduction,
  suggestAdditionalCapital,
} from "../engine/goals.js";
import { TRACK_STATUS } from "../config/constants.js";

let selectedGoalId = null;

function renderGoalCreateForm(container, onChange) {
  container.innerHTML = `
    <h3>יעד חדש</h3>
    <form id="new-goal-form">
      <label>שם היעד <input name="title" required /></label>
      <label>סכום יעד <input name="target_amount" type="number" step="0.01" required /></label>
      <label>הון התחלתי <input name="initial_capital" type="number" step="0.01" required /></label>
      <label>תאריך יעד <input name="target_date" type="date" required /></label>
      <label>עדיפות <input name="priority" type="number" step="1" value="1" required /></label>
      <button type="submit" class="primary">צור יעד</button>
    </form>
  `;
  container.querySelector("#new-goal-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.target).entries());
    const newGoal = {
      goal_id: createId("goal"),
      title: data.title,
      target_amount: Number(data.target_amount),
      initial_capital: Number(data.initial_capital),
      target_date: data.target_date,
      priority: Number(data.priority),
      is_flexible_timeline: false,
    };
    setState((s) => ({ ...s, goals: [...s.goals, newGoal] }));
    selectedGoalId = newGoal.goal_id;
    persistState();
    onChange();
  });
}

function renderCapitalAdjustmentPanel(container, goal, onChange) {
  const state = getState();
  const netCapital = currentNetCapital(goal, state.capital_adjustments_log);

  container.innerHTML = `
    <h3>עדכון הון התחלתי</h3>
    <p>הון נוכחי: ${formatCurrency(netCapital, state.user_profile.currency)}</p>
    <form id="capital-adjustment-form">
      <label>הון חדש <input name="new_balance" type="number" step="0.01" value="${netCapital}" required /></label>
      <label>הסבר (חובה) <input name="explanation" required /></label>
      <button type="submit" class="primary">עדכן הון</button>
    </form>
  `;

  container.querySelector("#capital-adjustment-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.target).entries());
    const newBalance = Number(data.new_balance);
    const logEntry = {
      log_id: createId("cap"),
      timestamp: new Date().toISOString().slice(0, 10),
      amount_change: newBalance - netCapital,
      new_balance: newBalance,
      user_explanation: data.explanation,
    };
    setState((s) => ({ ...s, capital_adjustments_log: [...s.capital_adjustments_log, logEntry] }));
    persistState();
    onChange();
  });
}

function renderWhatIfPanel(container, goal, onChange) {
  const state = getState();
  const netCapital = currentNetCapital(goal, state.capital_adjustments_log);
  const { netMonthlySavings } = computeNetMonthlySavings(state);

  container.innerHTML = `
    <h3>סימולציית פרמטרים (בזמן אמת)</h3>
    <form id="whatif-form">
      <label>סכום יעד <input name="target_amount" type="number" step="0.01" value="${goal.target_amount}" /></label>
      <label>תאריך יעד <input name="target_date" type="date" value="${goal.target_date}" /></label>
    </form>
    <div id="whatif-results" class="card"></div>
    <button id="save-goal-btn" class="primary">שמור שינויים ליעד</button>
  `;

  const form = container.querySelector("#whatif-form");
  const resultsEl = container.querySelector("#whatif-results");

  function recompute() {
    const targetAmount = Number(form.target_amount.value);
    const targetDate = form.target_date.value;
    const remaining = monthsRemaining(targetDate);
    const required = requiredMonthlySavings(targetAmount, netCapital, remaining);
    const { status, gap } = feasibilityGap(netMonthlySavings, required);

    let suggestionsHtml = "";
    if (status === TRACK_STATUS.RED) {
      const extendedMonths = suggestExtendedTimeline(targetAmount, netCapital, netMonthlySavings);
      const reduction = suggestVariableCategoryReduction(netMonthlySavings, required);
      const additionalCapital = suggestAdditionalCapital(targetAmount, netCapital, remaining, netMonthlySavings);
      suggestionsHtml = `
        <p class="track-red">⚠️ מתחת לקצב הנדרש (פער חודשי: ${formatCurrency(gap, state.user_profile.currency)})</p>
        <ul>
          <li>הארכת תאריך היעד ל-${Number.isFinite(extendedMonths) ? extendedMonths.toFixed(0) : "∞"} חודשים מהיום</li>
          <li>הפחתה נדרשת בהוצאות משתנות: ${formatCurrency(reduction, state.user_profile.currency)} לחודש</li>
          <li>תוספת הון התחלתי נדרשת: ${formatCurrency(additionalCapital, state.user_profile.currency)}</li>
        </ul>
      `;
    } else {
      suggestionsHtml = `<p class="track-green">✅ במסלול הבטוח (עודף חודשי: ${formatCurrency(gap, state.user_profile.currency)})</p>`;
    }

    resultsEl.innerHTML = `
      <p>קצב חיסכון נדרש: ${formatCurrency(required, state.user_profile.currency)} לחודש</p>
      <p>קצב חיסכון נוכחי: ${formatCurrency(netMonthlySavings, state.user_profile.currency)} לחודש</p>
      ${suggestionsHtml}
    `;
  }

  form.addEventListener("input", recompute);
  recompute();

  container.querySelector("#save-goal-btn").addEventListener("click", () => {
    const targetAmount = Number(form.target_amount.value);
    const targetDate = form.target_date.value;
    setState((s) => ({
      ...s,
      goals: s.goals.map((g) => (g.goal_id === goal.goal_id ? { ...g, target_amount: targetAmount, target_date: targetDate } : g)),
    }));
    persistState();
    onChange();
  });
}

export function renderSimulator(container) {
  const onChange = () => renderSimulator(container);
  const state = getState();
  const goals = state.goals;

  if (!selectedGoalId && goals.length > 0) {
    selectedGoalId = [...goals].sort((a, b) => a.priority - b.priority)[0].goal_id;
  }
  const goal = goals.find((g) => g.goal_id === selectedGoalId) || null;

  container.innerHTML = `
    ${goals.length > 0 ? `<div class="card"><label>יעד לסימולציה: <select id="goal-select">${goals.map((g) => `<option value="${g.goal_id}" ${g.goal_id === selectedGoalId ? "selected" : ""}>${g.title}</option>`).join("")}</select></label></div>` : ""}
    <div class="card" id="goal-create-section"></div>
    ${goal ? `<div class="card" id="capital-adjustment-section"></div><div class="card" id="whatif-section"></div>` : ""}
  `;

  renderGoalCreateForm(container.querySelector("#goal-create-section"), onChange);

  if (goals.length > 0) {
    container.querySelector("#goal-select").addEventListener("change", (e) => {
      selectedGoalId = e.target.value;
      onChange();
    });
  }

  if (goal) {
    renderCapitalAdjustmentPanel(container.querySelector("#capital-adjustment-section"), goal, onChange);
    renderWhatIfPanel(container.querySelector("#whatif-section"), goal, onChange);
  }
}
