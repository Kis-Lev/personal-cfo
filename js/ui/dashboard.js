import { getState } from "../state/store.js";
import { currentNetCapital, monthsRemaining, computeNetMonthlySavings, categorySpendingSummary, filesByMonth } from "../engine/cashflow.js";
import { buildFeasibilitySuggestions } from "./components/feasibility-suggestions.js";
import { formatCurrency } from "../utils/currency.js";
import { renderChart, renderLegend } from "./charts.js";
import { escapeHtml } from "../utils/escape-html.js";
import { loadBankPresets } from "../import/bank-presets.js";

// Persists across re-renders of this screen (e.g. after picking a month),
// same pattern as the filter/sort state kept at module scope in transactions.js.
let selectedFilesMonth = null;

function monthLabel(monthKey) {
  const [year, month] = monthKey.split("-");
  return `${month}/${year}`;
}

async function renderFilesByMonthSection(state) {
  const { months, rowsByMonth, recurringSources } = filesByMonth(state.parsed_transactions);
  const currency = state.user_profile.currency;

  if (months.length === 0) {
    return `<div class="card"><h3>קבצים שהועלו לפי חודש</h3><p>עדיין אין תנועות מיובאות.</p></div>`;
  }

  const currentMonth = new Date().toISOString().slice(0, 7);
  if (!selectedFilesMonth || !months.includes(selectedFilesMonth)) {
    selectedFilesMonth = months.includes(currentMonth) ? currentMonth : months[months.length - 1];
  }

  const builtInPresets = await loadBankPresets();
  const presetNames = new Map([...builtInPresets, ...state.import_presets].map((p) => [p.id, p.display_name]));
  const sourceLabel = (source) => presetNames.get(source) || "פורמט מותאם (לא נשמר כפריסט)";

  const rows = rowsByMonth.get(selectedFilesMonth) || [];
  const total = rows.reduce((sum, r) => sum + r.total, 0);
  const presentSources = new Set(rows.map((r) => r.source));
  const missingSources = [...recurringSources].filter((s) => !presentSources.has(s));

  const rowsHtml =
    rows.length === 0
      ? `<tr><td colspan="4">לא הועלו קבצים בחודש זה.</td></tr>`
      : rows
          .map(
            (r) => `<tr>
              <td>${escapeHtml(r.sourceFile)}</td>
              <td>${escapeHtml(sourceLabel(r.source))}</td>
              <td>${r.count}</td>
              <td>${formatCurrency(r.total, currency)}</td>
            </tr>`
          )
          .join("");

  const missingHtml =
    missingSources.length > 0
      ? `<p class="track-red">⚠ לא נמצא החודש קובץ עבור: ${missingSources.map((s) => escapeHtml(sourceLabel(s))).join(", ")} — מקורות שהועלו בחודשים אחרים בעבר.</p>`
      : "";

  return `
    <div class="card">
      <h3>קבצים שהועלו לפי חודש</h3>
      <label>בחרי חודש:
        <select id="files-month-select">
          ${months
            .slice()
            .reverse()
            .map((m) => `<option value="${m}" ${m === selectedFilesMonth ? "selected" : ""}>${monthLabel(m)}</option>`)
            .join("")}
        </select>
      </label>
      ${missingHtml}
      <table>
        <thead>
          <tr><th>קובץ</th><th>מקור</th><th>מס' תנועות</th><th>סה"כ הוצאה</th></tr>
        </thead>
        <tbody>${rowsHtml}</tbody>
        ${rows.length > 0 ? `<tfoot><tr><td colspan="3"><strong>סה"כ</strong></td><td><strong>${formatCurrency(total, currency)}</strong></td></tr></tfoot>` : ""}
      </table>
    </div>`;
}

// The month picker only affects this one card, so changing it re-renders just
// this card. Re-rendering the whole dashboard re-ran every cash-flow
// calculation and rebuilt both charts to update a single table, and threw away
// the page's scroll position with the old DOM.
async function refreshFilesByMonthSection(container) {
  const host = container.querySelector("#files-by-month");
  host.innerHTML = await renderFilesByMonthSection(getState());
  wireFilesByMonthSection(container);
}

function wireFilesByMonthSection(container) {
  container.querySelector("#files-month-select")?.addEventListener("change", (e) => {
    selectedFilesMonth = e.target.value;
    refreshFilesByMonthSection(container);
  });
}

export async function renderDashboard(container) {
  const state = getState();
  const goal = [...state.goals].sort((a, b) => a.priority - b.priority)[0];

  if (!goal) {
    container.innerHTML = `
      <div class="card"><p>אין עדיין יעד מוגדר. הוסיפי יעד במסך "סימולטור יעדים" כדי לראות את הדשבורד.</p></div>
      <div id="files-by-month">${await renderFilesByMonthSection(state)}</div>
    `;
    wireFilesByMonthSection(container);
    return;
  }

  const netCapital = currentNetCapital(goal, state.capital_adjustments_log, state.financial_instruments);
  const progressPct = Math.min(100, (netCapital / goal.target_amount) * 100);
  const remaining = monthsRemaining(goal.target_date);

  const { fixedIncome, fixedExpense, projectedFixedFromTransactions, projectedVariable, netMonthlySavings } = computeNetMonthlySavings(state);

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
        <p>הוצאות קבועות: ${formatCurrency(fixedExpense, currency)}${projectedFixedFromTransactions > 0 ? ` <span style="color:var(--muted)">(מתוכן ${formatCurrency(projectedFixedFromTransactions, currency)} פיננסים/ביטוח ומנויים)</span>` : ""}</p>
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
    <div id="files-by-month">${await renderFilesByMonthSection(state)}</div>
  `;
  wireFilesByMonthSection(container);
}
