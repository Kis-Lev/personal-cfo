import { getState, setState } from "../state/store.js";
import { persistState } from "../storage/persist.js";
import { renderEditableTable } from "./components/editable-table.js";
import { wireCategoryCascade } from "./components/category-cascade.js";
import { loadTaxonomy } from "../utils/taxonomy.js";
import { formatCurrency } from "../utils/currency.js";
import { yearsBetween } from "../utils/dates.js";
import { createId } from "../utils/ids.js";
import { spitzerPayment, compoundInterest } from "../engine/interest.js";
import { loanStateToday } from "../engine/loans.js";
import { COMPOUNDING_FREQUENCY, AMORTIZATION_TYPE, FIXED_RULE_TYPE, FIXED_RULE_TYPE_LABELS } from "../config/constants.js";

function renderFixedRulesSection(container, taxonomy) {
  const state = getState();

  renderEditableTable(container, {
    title: "הכנסות, הוצאות והפניות קבועות",
    columns: [
      { key: "type", label: "סוג", format: (v) => FIXED_RULE_TYPE_LABELS[v] ?? FIXED_RULE_TYPE_LABELS.EXPENSE },
      { key: "category", label: "קטגוריה" },
      { key: "sub_category", label: "תת-קטגוריה" },
      { key: "amount", label: "סכום", format: (v) => formatCurrency(v, state.user_profile.currency) },
      { key: "day_of_month", label: "יום בחודש" },
      { key: "active", label: "סטטוס", format: (v) => (v ? "פעיל" : "מושהה") },
    ],
    rows: state.fixed_rules,
    formFields: [
      {
        name: "type",
        label: "סוג",
        options: Object.values(FIXED_RULE_TYPE).map((value) => ({ value, label: FIXED_RULE_TYPE_LABELS[value] })),
      },
      { name: "category", label: "קטגוריה", options: [""] }, // replaced below by wireCategoryCascade
      { name: "sub_category", label: "תת-קטגוריה", options: [""] },
      { name: "amount", label: "סכום", type: "number", step: "0.01" },
      { name: "day_of_month", label: "יום בחודש", type: "number", step: "1" },
    ],
    rowActions: [
      {
        label: "השהה/הפעל",
        onClick: (row) => {
          setState((s) => ({
            ...s,
            fixed_rules: s.fixed_rules.map((r) => (r.rule_id === row.rule_id ? { ...r, active: !r.active } : r)),
          }));
          persistState();
          renderFixedRulesSection(container, taxonomy);
        },
      },
    ],
    onAdd: (data) => {
      const newRule = {
        rule_id: createId("fix"),
        type: data.type,
        category: data.category,
        sub_category: data.sub_category,
        amount: Number(data.amount),
        day_of_month: Number(data.day_of_month),
        active: true,
      };
      setState((s) => ({ ...s, fixed_rules: [...s.fixed_rules, newRule] }));
      persistState();
      renderFixedRulesSection(container, taxonomy);
    },
    onDelete: (index) => {
      setState((s) => ({ ...s, fixed_rules: s.fixed_rules.filter((_, i) => i !== index) }));
      persistState();
      renderFixedRulesSection(container, taxonomy);
    },
  });

  const categorySelect = container.querySelector('select[name="category"]');
  const subCategorySelect = container.querySelector('select[name="sub_category"]');
  wireCategoryCascade(categorySelect, subCategorySelect, taxonomy);
}

function renderDepositsSection(container) {
  const state = getState();

  renderEditableTable(container, {
    title: "פיקדונות",
    columns: [
      { key: "name", label: "שם" },
      { key: "principal", label: "קרן", format: (v) => formatCurrency(v, state.user_profile.currency) },
      { key: "annual_interest_rate", label: "ריבית שנתית", format: (v) => `${(v * 100).toFixed(2)}%` },
      { key: "maturity_date", label: "תאריך פדיון" },
      {
        key: "_maturity_value",
        label: "ערך צפוי בפדיון",
        format: (_v, row) => {
          const years = yearsBetween(row.start_date, row.maturity_date);
          const n = COMPOUNDING_FREQUENCY[row.compounding_frequency] || 1;
          return formatCurrency(compoundInterest(row.principal, row.annual_interest_rate, n, years), state.user_profile.currency);
        },
      },
    ],
    rows: state.financial_instruments.deposits,
    formFields: [
      { name: "name", label: "שם הפיקדון" },
      { name: "principal", label: "קרן", type: "number", step: "0.01" },
      { name: "annual_interest_rate", label: "ריבית שנתית (לדוגמה 0.04 = 4%)", type: "number", step: "0.0001" },
      { name: "compounding_frequency", label: "תדירות חישוב ריבית", options: Object.keys(COMPOUNDING_FREQUENCY) },
      { name: "start_date", label: "תאריך התחלה", type: "date" },
      { name: "maturity_date", label: "תאריך פדיון", type: "date" },
    ],
    onAdd: (data) => {
      const newDeposit = {
        deposit_id: createId("dep"),
        name: data.name,
        principal: Number(data.principal),
        annual_interest_rate: Number(data.annual_interest_rate),
        compounding_frequency: data.compounding_frequency,
        start_date: data.start_date,
        maturity_date: data.maturity_date,
      };
      setState((s) => ({
        ...s,
        financial_instruments: { ...s.financial_instruments, deposits: [...s.financial_instruments.deposits, newDeposit] },
      }));
      persistState();
      renderDepositsSection(container);
    },
    onDelete: (index) => {
      setState((s) => ({
        ...s,
        financial_instruments: {
          ...s.financial_instruments,
          deposits: s.financial_instruments.deposits.filter((_, i) => i !== index),
        },
      }));
      persistState();
      renderDepositsSection(container);
    },
  });
}

function renderLoansSection(container) {
  const state = getState();
  const note = `<p style="color:var(--muted)">ההחזר החודשי נלקח מכאן אוטומטית לתמונת התזרים בדשבורד — הריבית כהוצאה והקרן כפירעון שמגדיל הון. אם יש לך גם הוצאה קבועה ידנית על אותה הלוואה, מחקי אותה כדי לא לספור פעמיים.</p>`;

  renderEditableTable(container, {
    title: "הלוואות",
    // Every derived column is read from loanStateToday rather than from the
    // stored figures, so this table shows the loan as it stands now — the same
    // numbers the dashboard's cash flow is built from, and never a split frozen
    // on the day the loan was entered.
    columns: [
      { key: "name", label: "שם" },
      {
        key: "remaining_principal",
        label: "יתרת קרן היום",
        format: (v, row) => {
          const loan = loanStateToday(row);
          const current = formatCurrency(loan.remainingPrincipal, state.user_profile.currency);
          if (!loan.isDated) return `${current} <span style="color:var(--muted)">(כפי שהוזנה)</span>`;
          return `${current} <span style="color:var(--muted)">(הוזן ${formatCurrency(v, state.user_profile.currency)} ב-${row.principal_as_of})</span>`;
        },
      },
      { key: "annual_interest_rate", label: "ריבית שנתית", format: (v) => `${(v * 100).toFixed(2)}%` },
      { key: "term_months", label: "תשלומים שנותרו", format: (_v, row) => loanStateToday(row).paymentsRemaining },
      {
        key: "monthly_payment",
        label: "החזר חודשי (ריבית + קרן)",
        format: (_v, row) => {
          const loan = loanStateToday(row);
          if (loan.isSettled) return "נפרעה";
          return `${formatCurrency(loan.monthlyPayment, state.user_profile.currency)} <span style="color:var(--muted)">(${formatCurrency(
            loan.monthlyInterest,
            state.user_profile.currency
          )} + ${formatCurrency(loan.monthlyPrincipal, state.user_profile.currency)})</span>`;
        },
      },
    ],
    rows: state.financial_instruments.loans,
    note,
    formFields: [
      { name: "name", label: "שם ההלוואה" },
      { name: "remaining_principal", label: "יתרת קרן", type: "number", step: "0.01" },
      // Without a date the balance is a number with no point in time attached,
      // and there is no way to tell how much of it has since been repaid.
      { name: "principal_as_of", label: "היתרה נכונה לתאריך", type: "date" },
      { name: "annual_interest_rate", label: "ריבית שנתית (לדוגמה 0.055 = 5.5%)", type: "number", step: "0.0001" },
      { name: "term_months", label: "מספר תשלומים נותרים", type: "number", step: "1" },
      { name: "amortization_type", label: "סוג לוח סילוקין", options: Object.keys(AMORTIZATION_TYPE) },
    ],
    onAdd: (data) => {
      const remainingPrincipal = Number(data.remaining_principal);
      const annualInterestRate = Number(data.annual_interest_rate);
      const termMonths = Number(data.term_months);
      const newLoan = {
        loan_id: createId("loan"),
        name: data.name,
        remaining_principal: remainingPrincipal,
        principal_as_of: data.principal_as_of || new Date().toISOString().slice(0, 10),
        annual_interest_rate: annualInterestRate,
        term_months: termMonths,
        monthly_payment: spitzerPayment(remainingPrincipal, annualInterestRate, termMonths),
        amortization_type: data.amortization_type,
      };
      setState((s) => ({
        ...s,
        financial_instruments: { ...s.financial_instruments, loans: [...s.financial_instruments.loans, newLoan] },
      }));
      persistState();
      renderLoansSection(container);
    },
    onDelete: (index) => {
      setState((s) => ({
        ...s,
        financial_instruments: {
          ...s.financial_instruments,
          loans: s.financial_instruments.loans.filter((_, i) => i !== index),
        },
      }));
      persistState();
      renderLoansSection(container);
    },
  });
}

export async function renderFixedManager(container) {
  const taxonomy = await loadTaxonomy();
  container.innerHTML = `
    <div class="card" id="fixed-rules-section"></div>
    <div class="card" id="deposits-section"></div>
    <div class="card" id="loans-section"></div>
  `;
  renderFixedRulesSection(container.querySelector("#fixed-rules-section"), taxonomy);
  renderDepositsSection(container.querySelector("#deposits-section"));
  renderLoansSection(container.querySelector("#loans-section"));
}
