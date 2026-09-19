import { getState, setState } from "../state/store.js";
import { persistState } from "../storage/persist.js";
import { escapeHtml } from "../utils/escape-html.js";
import { formatCurrency } from "../utils/currency.js";
import { loadTaxonomy } from "../utils/taxonomy.js";
import { wireCategoryCascade } from "./components/category-cascade.js";
import { createRuleFromManualAssignment } from "../import/categorizer.js";
import { effectiveAmount } from "../engine/cashflow.js";
import { PENDING_CATEGORY_LABEL } from "../config/constants.js";

let taxonomyCache = null;
let editingTxId = null;
let filterState = { category: "", search: "", dateFrom: "", dateTo: "" };
let sortState = { field: "date", direction: "desc" };

function filteredSortedTransactions(state) {
  let rows = state.parsed_transactions;
  if (filterState.category) rows = rows.filter((tx) => tx.category === filterState.category);
  if (filterState.search) {
    const query = filterState.search.toLowerCase();
    rows = rows.filter((tx) => tx.merchant.toLowerCase().includes(query));
  }
  if (filterState.dateFrom) rows = rows.filter((tx) => tx.date >= filterState.dateFrom);
  if (filterState.dateTo) rows = rows.filter((tx) => tx.date <= filterState.dateTo);

  const { field, direction } = sortState;
  const sign = direction === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    if (field === "amount") return (a.amount - b.amount) * sign;
    return String(a[field]).localeCompare(String(b[field])) * sign;
  });
}

function sortableHeader(field, label) {
  const isActive = sortState.field === field;
  const arrow = isActive ? (sortState.direction === "asc" ? " ▲" : " ▼") : "";
  return `<th><button type="button" class="sort-header" data-field="${field}" style="background:none; border:none; cursor:pointer; font:inherit; font-weight:bold; padding:0;">${label}${arrow}</button></th>`;
}

// Shows what a reimbursed transaction still costs, next to what was charged —
// a percentage on its own makes the reader do the arithmetic to find the
// number the forecasts are actually built from.
function reimbursementCell(tx) {
  const percent = Number(tx.reimbursed_percent) || 0;
  if (percent === 0) return "<td></td>";
  const counted = effectiveAmount(tx);
  return `<td class="track-green">${percent}% הוחזר${
    counted > 0 ? `<br><span style="color:var(--muted)">נספר ${formatCurrency(counted)}</span>` : "<br><span style=\"color:var(--muted)\">לא נספר</span>"
  }</td>`;
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
        <td>
          <input class="reimbursed-input" type="number" min="0" max="100" step="5"
                 value="${Number(tx.reimbursed_percent) || 0}" style="width:5.5em;" />%
        </td>
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
      <td>${escapeHtml(tx.category)}${
        tx.needs_review
          ? ` <span class="track-red" title="נספרת בכל הסיכומים כבר עכשיו — הסיווג רק מעביר אותה לקטגוריה הנכונה">⏳ ממתינה לסיווג</span>`
          : ""
      }</td>
      <td>${escapeHtml(tx.sub_category)}</td>
      ${reimbursementCell(tx)}
      <td>${escapeHtml(tx.source_file || "")}</td>
      <td>
        <button type="button" class="edit-btn">ערוך</button>
        <button type="button" class="delete-btn">מחק</button>
      </td>
    </tr>`;
}

// A private, personal-merchant categorization rule (like a specific hair
// salon or a market with a family name in it) must never enter the app's
// public built-in rules file — this lets the user paste a batch of such
// rules once, saved only into her own categorization_rules in her own
// Drive, never touching any file that gets committed to the public repo.
function renderBulkRuleImport(container) {
  const section = container.querySelector("#bulk-rule-import");
  section.innerHTML = `
    <h3>ייבוא כללי סיווג פרטיים (בכמות)</h3>
    <p style="color:var(--muted)">מקום זה נשמר רק בדרייב הפרטי שלך — לעולם לא בקוד הציבורי. הדביקי רשימה בפורמט JSON: <code>[{"merchant":"...","category":"...","sub_category":"..."}]</code></p>
    <textarea id="bulk-rule-textarea" rows="6" style="width:100%; font-family:monospace; padding:8px; border:1px solid var(--border); border-radius:6px;"></textarea>
    <p id="bulk-rule-status"></p>
    <button type="button" id="bulk-rule-import-btn" class="primary">ייבא כללים</button>
  `;

  section.querySelector("#bulk-rule-import-btn").addEventListener("click", () => {
    const statusEl = section.querySelector("#bulk-rule-status");
    let entries;
    try {
      entries = JSON.parse(section.querySelector("#bulk-rule-textarea").value);
      if (!Array.isArray(entries)) throw new Error("expected an array");
    } catch (err) {
      statusEl.textContent = `שגיאה בפענוח ה-JSON: ${err.message}`;
      return;
    }

    const newRules = entries
      .filter((e) => e && e.merchant && e.category && e.sub_category)
      .map((e) => createRuleFromManualAssignment(e.merchant, e.category, e.sub_category));

    setState((s) => ({ ...s, categorization_rules: [...s.categorization_rules, ...newRules] }));
    persistState();
    statusEl.textContent = `נוספו ${newRules.length} כללי סיווג פרטיים.`;
    section.querySelector("#bulk-rule-textarea").value = "";
  });
}

export async function renderTransactions(container) {
  taxonomyCache = taxonomyCache || (await loadTaxonomy());
  const state = getState();
  const allCount = state.parsed_transactions.length;
  const transactions = filteredSortedTransactions(state);
  const isFiltered = transactions.length !== allCount;

  const pendingCount = state.parsed_transactions.filter((tx) => tx.needs_review).length;
  const categoryOptions =
    taxonomyCache
      .map((c) => `<option value="${escapeHtml(c.category)}" ${filterState.category === c.category ? "selected" : ""}>${c.icon} ${escapeHtml(c.category)}</option>`)
      .join("") +
    (pendingCount > 0
      ? `<option value="${escapeHtml(PENDING_CATEGORY_LABEL)}" ${filterState.category === PENDING_CATEGORY_LABEL ? "selected" : ""}>⏳ ${escapeHtml(PENDING_CATEGORY_LABEL)} (${pendingCount})</option>`
      : "");

  container.innerHTML = `
    <div class="card" id="bulk-rule-import"></div>
    <div class="card">
      <div style="display:flex; align-items:center; justify-content:space-between;">
        <h2>כל התנועות (${isFiltered ? `${transactions.length} מתוך ${allCount}` : allCount})</h2>
        ${allCount > 0 ? `<button type="button" id="reset-all-btn" class="delete-btn">אפס את כל התנועות</button>` : ""}
      </div>
      ${
        allCount === 0
          ? "<p>עדיין אין תנועות מיובאות.</p>"
          : `<div class="form-grid" style="margin-bottom:12px;">
        <label>סינון לפי קטגוריה
          <select id="filter-category"><option value="">כל הקטגוריות</option>${categoryOptions}</select>
        </label>
        <label>חיפוש בית עסק
          <input id="filter-search" type="text" value="${escapeHtml(filterState.search)}" placeholder="לדוגמה: וולט" />
        </label>
        <label>מתאריך
          <input id="filter-date-from" type="date" value="${filterState.dateFrom}" />
        </label>
        <label>עד תאריך
          <input id="filter-date-to" type="date" value="${filterState.dateTo}" />
        </label>
        <button type="button" id="clear-filters-btn">נקה סינון</button>
      </div>
      ${
        transactions.length === 0
          ? "<p>אין תנועות התואמות את הסינון הנוכחי.</p>"
          : `<table>
        <thead>
          <tr>${sortableHeader("date", "תאריך")}${sortableHeader("merchant", "בית עסק")}${sortableHeader("amount", "סכום")}${sortableHeader("category", "קטגוריה")}${sortableHeader("sub_category", "תת-קטגוריה")}<th title="אחוז מהתשלום שהוחזר לך (למשל מהעבודה) ולכן לא נספר בחישובים">הוחזר</th><th>קובץ מקור</th><th></th></tr>
        </thead>
        <tbody>${transactions.map(renderRow).join("")}</tbody>
      </table>`
      }`
      }
    </div>
  `;

  renderBulkRuleImport(container);

  if (allCount === 0) return;

  container.querySelector("#reset-all-btn").addEventListener("click", () => {
    const confirmed = confirm(
      `למחוק את כל ${allCount} התנועות המיובאות? זו פעולה בלתי הפיכה. הקבועות/הלוואות/פיקדונות וכללי הסיווג שלמדת יישארו.`
    );
    if (!confirmed) return;
    setState((s) => ({ ...s, parsed_transactions: [] }));
    persistState();
    renderTransactions(container);
  });

  container.querySelector("#filter-category").addEventListener("change", (e) => {
    filterState.category = e.target.value;
    renderTransactions(container);
  });
  container.querySelector("#filter-search").addEventListener("input", (e) => {
    filterState.search = e.target.value;
    renderTransactions(container);
  });
  container.querySelector("#filter-date-from").addEventListener("change", (e) => {
    filterState.dateFrom = e.target.value;
    renderTransactions(container);
  });
  container.querySelector("#filter-date-to").addEventListener("change", (e) => {
    filterState.dateTo = e.target.value;
    renderTransactions(container);
  });
  container.querySelector("#clear-filters-btn").addEventListener("click", () => {
    filterState = { category: "", search: "", dateFrom: "", dateTo: "" };
    renderTransactions(container);
  });

  container.querySelectorAll(".sort-header").forEach((btn) => {
    btn.addEventListener("click", () => {
      const field = btn.dataset.field;
      sortState =
        sortState.field === field ? { field, direction: sortState.direction === "asc" ? "desc" : "asc" } : { field, direction: "asc" };
      renderTransactions(container);
    });
  });

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
        const reimbursed_percent = Math.min(100, Math.max(0, Number(row.querySelector(".reimbursed-input").value) || 0));
        const newRule = createRuleFromManualAssignment(tx.merchant, category, sub_category);

        setState((s) => ({
          ...s,
          parsed_transactions: s.parsed_transactions.map((t) => {
            if (t.tx_id !== txId) return t;
            // Classifying it here answers the same question the import
            // screen's review queue asks, so it leaves that queue too.
            const { needs_review, suggested_category, suggested_sub_category, suggested_rule, ...rest } = t;
            return { ...rest, category, sub_category, reimbursed_percent };
          }),
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
