import { getState, setState } from "../state/store.js";
import { persistState } from "../storage/persist.js";
import { renderEditableTable } from "./components/editable-table.js";
import { wireCategoryCascade } from "./components/category-cascade.js";
import { loadTaxonomy } from "../utils/taxonomy.js";
import { formatCurrency } from "../utils/currency.js";
import { yearsBetween } from "../utils/dates.js";
import { createId } from "../utils/ids.js";
import { spitzerPayment, compoundInterest } from "../engine/interest.js";
import { COMPOUNDING_FREQUENCY, AMORTIZATION_TYPE } from "../config/constants.js";

function renderFixedRulesSection(container, taxonomy) {
  const state = getState();

  renderEditableTable(container, {
    title: "הכנסות והוצאות קבועות",
    columns: [
      { key: "type", label: "סוג", format: (v) => (v === "INCOME" ? "הכנסה" : "הוצאה") },
      { key: "category", label: "קטגוריה" },
      { key: "sub_category", label: "תת-קטגוריה" },
      { key: "amount", label: "סכום", format: (v) => formatCurrency(v, state.user_profile.currency) },
      { key: "day_of_month", label: "יום בחודש" },
      { key: "active", label: "סטטוס", format: (v) => (v ? "פעיל" : "מושהה") },
    ],
    rows: state.fixed_rules,
    formFields: [
      { name: "type", label: "סוג", options: [{ value: "EXPENSE", label: "הוצאה" }, { value: "INCOME", label: "הכנסה" }] },
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

  renderEditableTable(container, {
    title: "הלוואות",
    columns: [
      { key: "name", label: "שם" },
      { key: "remaining_principal", label: "יתרת קרן", format: (v) => formatCurrency(v, state.user_profile.currency) },
      { key: "annual_interest_rate", label: "ריבית שנתית", format: (v) => `${(v * 100).toFixed(2)}%` },
      { key: "term_months", label: "מספר תשלומים" },
      {
        key: "monthly_payment",
        label: "החזר חודשי (מחושב)",
        format: (_v, row) => formatCurrency(spitzerPayment(row.remaining_principal, row.annual_interest_rate, row.term_months), state.user_profile.currency),
      },
    ],
    rows: state.financial_instruments.loans,
    formFields: [
      { name: "name", label: "שם ההלוואה" },
      { name: "remaining_principal", label: "יתרת קרן", type: "number", step: "0.01" },
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
