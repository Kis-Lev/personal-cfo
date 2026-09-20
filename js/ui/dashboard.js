import { getState } from "../state/store.js";
import { currentNetCapital, monthsRemaining, computeNetMonthlySavings, categorySpendingSummary, filesByMonth, unreadRowsByFile } from "../engine/cashflow.js";
import { buildFeasibilitySuggestions } from "./components/feasibility-suggestions.js";
import { formatCurrency } from "../utils/currency.js";
import { renderChart, renderLegend } from "./charts.js";
import { escapeHtml } from "../utils/escape-html.js";
import { loadBankPresets } from "../import/bank-presets.js";
import { expenseCycleLabel, currentExpenseCycleKey } from "../engine/periods.js";

// Persists across re-renders of this screen (e.g. after picking a cycle),
// same pattern as the filter/sort state kept at module scope in transactions.js.
let selectedFilesMonth = null;

// Always spells out the days a cycle covers. "08/2026" alone reads as calendar
// August, and a cycle is exactly what a calendar month is not — the reader has
// to be able to see that this table's August ends on the 9th of September.
function monthLabel(cycleKey) {
  return expenseCycleLabel(cycleKey);
}

async function renderFilesByMonthSection(state) {
  const { months, rowsByMonth, totalsByMonth, recurringSources } = filesByMonth(state.parsed_transactions);
  const currency = state.user_profile.currency;
  const money = (amount) => formatCurrency(amount, currency);

  if (months.length === 0) {
    return `<div class="card"><h3>קבצים שהועלו לפי מחזור חיוב</h3><p>עדיין אין תנועות מיובאות.</p></div>`;
  }

  const currentMonth = currentExpenseCycleKey();
  if (!selectedFilesMonth || !months.includes(selectedFilesMonth)) {
    selectedFilesMonth = months.includes(currentMonth) ? currentMonth : months[months.length - 1];
  }

  const builtInPresets = await loadBankPresets();
  const presetNames = new Map([...builtInPresets, ...state.import_presets].map((p) => [p.id, p.display_name]));
  const sourceLabel = (source) => presetNames.get(source) || "פורמט מותאם (לא נשמר כפריסט)";

  const rows = rowsByMonth.get(selectedFilesMonth) || [];
  const totals = totalsByMonth.get(selectedFilesMonth) || { count: 0, charges: 0, credits: 0, total: 0, pendingCount: 0, pendingTotal: 0 };
  const unread = unreadRowsByFile(state.import_log);
  const presentSources = new Set(rows.map((r) => r.source));
  const missingSources = [...recurringSources].filter((s) => !presentSources.has(s));

  const rowsHtml =
    rows.length === 0
      ? `<tr><td colspan="6">לא הועלו קבצים בחודש זה.</td></tr>`
      : rows
          .map(
            (r) => `<tr>
              <td>${escapeHtml(r.sourceFile)}${
                unread.get(r.sourceFile)?.unreadRows > 0
                  ? ` <span class="track-red" title="${escapeHtml(unread.get(r.sourceFile).reasons.join(" · "))}">⚠ ${unread.get(r.sourceFile).unreadRows} שורות לא נקראו</span>`
                  : ""
              }</td>
              <td>${escapeHtml(sourceLabel(r.source))}</td>
              <td>${r.count}</td>
              <td>${money(r.charges)}</td>
              <td>${r.credits === 0 ? "—" : money(r.credits)}</td>
              <td>${money(r.total)}</td>
            </tr>`
          )
          .join("");

  const missingHtml =
    missingSources.length > 0
      ? `<p class="track-red">⚠ לא נמצא במחזור הזה קובץ עבור: ${missingSources.map((s) => escapeHtml(sourceLabel(s))).join(", ")} — מקורות שהופיעו במחזורים אחרים בעבר.</p>`
      : "";

  // A card's billing cycle closes mid-month, so part of a file's transactions
  // legitimately belong to the neighbouring month. Without saying so, this
  // month's total looks like a file that came up short against the statement.
  const straddling = rows.filter((r) => Math.abs(r.fileTotal - r.total) > 0.005);
  const straddlingHtml =
    straddling.length === 0
      ? ""
      : `<p style="color:var(--muted)">הקבצים הבאים פרוסים על יותר ממחזור אחד, ולכן מוצג כאן רק החלק ששייך למחזור ${monthLabel(selectedFilesMonth)}:</p>
         <ul style="color:var(--muted)">${straddling
           .map(
             (r) =>
               `<li>${escapeHtml(r.sourceFile)}: בקובץ כולו ${money(r.fileTotal)} ב-${r.fileCount} תנועות — מתוכן ${money(r.total)} במחזור זה ו-${money(r.fileTotal - r.total)} במחזורים אחרים.</li>`
           )
           .join("")}</ul>`;

  const pendingHtml =
    totals.pendingCount === 0
      ? ""
      : `<p style="color:var(--muted)">${totals.pendingCount} מהתנועות במחזור הזה (${money(totals.pendingTotal)}) עדיין ממתינות לסיווג ידני — הן כבר כלולות בסכומים כאן ובדשבורד, תחת "ממתין לסיווג ידני".</p>`;

  const unreadHtml = [...unread.entries()].filter(([fileName, info]) => info.unreadRows > 0 && rows.some((r) => r.sourceFile === fileName));
  const unreadSectionHtml =
    unreadHtml.length === 0
      ? ""
      : `<details class="track-red">
          <summary>שורות שלא נקראו מהקבצים האלה ולכן אינן בשום סכום — לחצי לפירוט</summary>
          <ul>${unreadHtml
            .map(([fileName, info]) => `<li>${escapeHtml(fileName)} — ${info.unreadRows} שורות:<ul>${info.reasons.map((r) => `<li>${escapeHtml(r)}</li>`).join("")}</ul></li>`)
            .join("")}</ul>
        </details>`;

  return `
    <div class="card">
      <h3>קבצים שהועלו לפי מחזור חיוב</h3>
      <p style="color:var(--muted)">מחזור חיוב נמשך מה-10 לחודש עד ה-10 בחודש שאחריו, ונקרא על שם החודש שבו הוא מתחיל — כך שחיוב מה-3 בספטמבר שייך למחזור אוגוסט.</p>
      <label>בחרי מחזור:
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
          <tr><th>קובץ</th><th>מקור</th><th>מס' תנועות</th><th>חיובים</th><th>זיכויים</th><th>סה"כ נטו</th></tr>
        </thead>
        <tbody>${rowsHtml}</tbody>
        ${
          rows.length > 0
            ? `<tfoot><tr>
                <td colspan="2"><strong>סה"כ מחזור ${monthLabel(selectedFilesMonth)}</strong></td>
                <td><strong>${totals.count}</strong></td>
                <td><strong>${money(totals.charges)}</strong></td>
                <td><strong>${totals.credits === 0 ? "—" : money(totals.credits)}</strong></td>
                <td><strong>${money(totals.total)}</strong></td>
              </tr></tfoot>`
            : ""
        }
      </table>
      ${pendingHtml}
      ${straddlingHtml}
      ${unreadSectionHtml}
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

  const {
    fixedIncome,
    fixedExpense,
    projectedFixedFromTransactions,
    projectedVariable,
    netMonthlySavings,
    monthlyAccumulation,
    investmentContributions,
    loanInterest,
    loanPrincipal,
    loanPayment,
    loansWithoutDate,
    committedSavings,
  } = computeNetMonthlySavings(state);

  const { required, html: suggestionsHtml } = buildFeasibilitySuggestions(
    goal.target_amount,
    netCapital,
    remaining,
    netMonthlySavings,
    state.user_profile.currency
  );

  // The leftover is split rather than shown as one slice: a standing order into
  // an investment account has already decided where part of it is going, and a
  // single "left to save" figure reads as money still free to use.
  const cashflowSeries = [
    { label: "קבועות", value: fixedExpense },
    { label: "משתנות", value: projectedVariable },
    ...(investmentContributions > 0 ? [{ label: "מופנה להשקעה", value: investmentContributions }] : []),
    ...(loanPrincipal > 0 ? [{ label: "פירעון קרן הלוואות", value: loanPrincipal }] : []),
    { label: committedSavings > 0 ? "יתרה חופשית" : "יתרה לחיסכון", value: Math.max(0, netMonthlySavings) },
  ];
  const donut = renderChart("donut", cashflowSeries, { width: 220, height: 220 });
  const legend = renderLegend(cashflowSeries, state.user_profile.currency);

  const { rows: categoryRows, overallMonthlyAverage, monthsCovered } = categorySpendingSummary(state);
  const currency = state.user_profile.currency;
  const categoryTableHtml =
    categoryRows.length === 0
      ? "<p>עדיין אין מספיק נתונים (לא קבועות ולא תנועות מיובאות) לפילוח לפי קטגוריה.</p>"
      : `<table>
          <thead>
            <tr><th>קטגוריה</th><th>קבוע חודשי</th><th>ממוצע מתנועות</th><th>סה"כ ממוצע חודשי</th><th>מחזורים עם נתונים</th></tr>
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
        <p>הוצאות קבועות: ${formatCurrency(fixedExpense, currency)}${
          projectedFixedFromTransactions > 0 || loanInterest > 0
            ? ` <span style="color:var(--muted)">(מתוכן ${[
                projectedFixedFromTransactions > 0 ? `${formatCurrency(projectedFixedFromTransactions, currency)} פיננסים/ביטוח ומנויים` : null,
                loanInterest > 0 ? `${formatCurrency(loanInterest, currency)} ריבית על הלוואות` : null,
              ]
                .filter(Boolean)
                .join(", ")})</span>`
            : ""
        }</p>
        <p>הוצאות משתנות (חזוי WMA): ${formatCurrency(projectedVariable, currency)}</p>
        ${loanPayment > 0 ? `<p>החזרי הלוואות: ${formatCurrency(loanPayment, currency)} <span style="color:var(--muted)">(${formatCurrency(loanInterest, currency)} ריבית + ${formatCurrency(loanPrincipal, currency)} קרן)</span></p>` : ""}
        <p>קצב חיסכון (פנוי): <strong>${formatCurrency(netMonthlySavings, currency)}</strong>${
          committedSavings > 0
            ? ` <span style="color:var(--muted)">— אחרי ${[
                investmentContributions > 0 ? `${formatCurrency(investmentContributions, currency)} להשקעה` : null,
                loanPrincipal > 0 ? `${formatCurrency(loanPrincipal, currency)} פירעון קרן` : null,
              ]
                .filter(Boolean)
                .join(" ו-")}. זהו המספר שחישובי היעד משתמשים בו.</span>`
            : ""
        }</p>
        ${
          committedSavings > 0
            ? `<p>סך צבירה חודשית: ${formatCurrency(monthlyAccumulation, currency)} <span style="color:var(--muted)">(היתרה החופשית בתוספת מה שמחויב להשקעה ולפירעון קרן — קצב גידול ההון, לא כסף פנוי)</span></p>`
            : ""
        }
        ${
          committedSavings > 0 && netMonthlySavings < 0
            ? `<p class="track-red">⚠ ההתחייבויות הקבועות (השקעה ופירעון קרן) גדולות ב-${formatCurrency(
                -netMonthlySavings,
                currency
              )} מהעודף החודשי — ההפרש מגיע מהיתרה הקיימת בחשבון, לא מההכנסה השוטפת.</p>`
            : ""
        }
        ${
          loansWithoutDate > 0
            ? `<p class="track-red">⚠ ל-${loansWithoutDate} הלוואות אין תאריך שאליו יתרת הקרן נכונה, ולכן הן מחושבות לפי היתרה כפי שהוזנה. עדכני אותו במסך "קבועות ומכשירים" כדי שהחישוב יתקדם עם הזמן.</p>`
            : ""
        }
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
      <p>ממוצע הוצאה חודשית כוללת (כל הקטגוריות): <strong>${formatCurrency(overallMonthlyAverage, currency)}</strong>
        <span style="color:var(--muted)">— סכום כל השורות בטבלה, כולן מחולקות באותם ${monthsCovered} מחזורי חיוב.</span></p>
      ${categoryTableHtml}
    </div>
    <div id="files-by-month">${await renderFilesByMonthSection(state)}</div>
  `;
  wireFilesByMonthSection(container);
}
