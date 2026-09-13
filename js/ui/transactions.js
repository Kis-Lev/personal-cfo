import { getState, setState } from "../state/store.js";
import { persistState } from "../storage/persist.js";
import { escapeHtml } from "../utils/escape-html.js";
import { formatCurrency } from "../utils/currency.js";
import { loadTaxonomy } from "../utils/taxonomy.js";
import { wireCategoryCascade } from "./components/category-cascade.js";
import { createRuleFromManualAssignment } from "../import/categorizer.js";

let taxonomyCache = null;
let editingTxId = null;

function sortedTransactions(state) {
  return [...state.parsed_transactions].sort((a, b) => b.date.localeCompare(a.date));
}

function renderRow(tx) {
  if (tx.tx_id === editingTxId) {
    return `
      <tr data-tx-id="${tx.tx_id}" class="editing-row">
        <td>${escapeHtml(tx.date)}</td>
        <td>${escapeHtml(tx.merchant)}</td>
        <td>${formatCurrency(tx.amount)}</td>
        <td><select class="category-select"></select></td>
        <td><select class="subcategory-select"></select></td>
        <td>${escapeHtml(tx.source_file || "")}</td>
        <td>
          <button type="button" class="primary save-btn">שמור</button>
          <button type="button" class="cancel-btn">בטל</button>
        </td>
      </tr>`;
  }
  return `
    <tr data-tx-id="${tx.tx_id}">
      <td>${escapeHtml(tx.date)}</td>
      <td>${escapeHtml(tx.merchant)}</td>
      <td>${formatCurrency(tx.amount)}</td>
      <td>${escapeHtml(tx.category)}</td>
      <td>${escapeHtml(tx.sub_category)}</td>
      <td>${escapeHtml(tx.source_file || "")}</td>
      <td>
        <button type="button" class="edit-btn">ערוך</button>
        <button type="button" class="delete-btn">מחק</button>
      </td>
    </tr>`;
}

export async function renderTransactions(container) {
  taxonomyCache = taxonomyCache || (await loadTaxonomy());
  const state = getState();
  const transactions = sortedTransactions(state);

  container.innerHTML = `
    <div class="card">
      <h2>כל התנועות (${transactions.length})</h2>
      ${
        transactions.length === 0
          ? "<p>עדיין אין תנועות מיובאות.</p>"
          : `<table>
        <thead>
          <tr><th>תאריך</th><th>בית עסק</th><th>סכום</th><th>קטגוריה</th><th>תת-קטגוריה</th><th>קובץ מקור</th><th></th></tr>
        </thead>
        <tbody>${transactions.map(renderRow).join("")}</tbody>
      </table>`
      }
    </div>
  `;

  if (transactions.length === 0) return;

  container.querySelectorAll("tr[data-tx-id]").forEach((row) => {
    const txId = row.dataset.txId;
    const tx = transactions.find((t) => t.tx_id === txId);

    const editBtn = row.querySelector(".edit-btn");
    if (editBtn) {
      editBtn.addEventListener("click", () => {
        editingTxId = txId;
        renderTransactions(container);
      });
    }

    const deleteBtn = row.querySelector(".delete-btn");
    if (deleteBtn) {
      deleteBtn.addEventListener("click", () => {
        if (!confirm(`למחוק את התנועה "${tx.merchant}" (${formatCurrency(tx.amount)})?`)) return;
        setState((s) => ({ ...s, parsed_transactions: s.parsed_transactions.filter((t) => t.tx_id !== txId) }));
        persistState();
        renderTransactions(container);
      });
    }

    const categorySelect = row.querySelector(".category-select");
    const subCategorySelect = row.querySelector(".subcategory-select");
    if (categorySelect && subCategorySelect) {
      wireCategoryCascade(categorySelect, subCategorySelect, taxonomyCache);
      categorySelect.value = tx.category;
      categorySelect.dispatchEvent(new Event("change"));
      subCategorySelect.value = tx.sub_category;

      row.querySelector(".save-btn").addEventListener("click", () => {
        const category = categorySelect.value;
        const sub_category = subCategorySelect.value;
        const newRule = createRuleFromManualAssignment(tx.merchant, category, sub_category);

        setState((s) => ({
          ...s,
          parsed_transactions: s.parsed_transactions.map((t) => (t.tx_id === txId ? { ...t, category, sub_category } : t)),
          categorization_rules: [...s.categorization_rules, newRule],
        }));
        editingTxId = null;
        persistState();
        renderTransactions(container);
      });

      row.querySelector(".cancel-btn").addEventListener("click", () => {
        editingTxId = null;
        renderTransactions(container);
      });
    }
  });
}
