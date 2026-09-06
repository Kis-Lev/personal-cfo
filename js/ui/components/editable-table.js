// One generic "list + add-form" table used by every section of fixed-manager.js
// (fixed rules, deposits, loans) instead of three near-duplicate implementations.
import { escapeHtml } from "../../utils/escape-html.js";

/**
 * @param {HTMLElement} container
 * @param {object} config
 * @param {string} config.title
 * @param {Array<{key:string, label:string, format?:(v:any,row:object)=>string}>} config.columns
 * @param {object[]} config.rows
 * @param {Array<{name:string, label:string, type?:string, step?:string, options?:string[]}>} config.formFields
 * @param {(formData:object)=>void} config.onAdd
 * @param {(rowIndex:number)=>void} config.onDelete
 * @param {Array<{label:string, onClick:(row:object, rowIndex:number)=>void}>} [config.rowActions]
 */
export function renderEditableTable(container, { title, columns, rows, formFields, onAdd, onDelete, rowActions = [] }) {
  const fieldHtml = (f) => {
    if (f.options) {
      const opts = f.options.map((o) => (typeof o === "string" ? { value: o, label: o } : o));
      return `<label>${f.label} <select name="${f.name}" required>${opts.map((o) => `<option value="${o.value}">${o.label}</option>`).join("")}</select></label>`;
    }
    return `<label>${f.label} <input name="${f.name}" type="${f.type || "text"}" ${f.step ? `step="${f.step}"` : ""} required /></label>`;
  };

  container.innerHTML = `
    <h3>${title}</h3>
    <table>
      <thead><tr>${columns.map((c) => `<th>${c.label}</th>`).join("")}<th></th></tr></thead>
      <tbody>
        ${rows
          .map(
            (row, i) => `
          <tr data-index="${i}">
            ${columns.map((c) => `<td>${c.format ? c.format(row[c.key], row) : escapeHtml(row[c.key] ?? "")}</td>`).join("")}
            <td>
              ${rowActions.map((a, ai) => `<button type="button" class="row-action-btn" data-action="${ai}">${a.label}</button>`).join("")}
              <button type="button" class="delete-btn">מחק</button>
            </td>
          </tr>`
          )
          .join("")}
      </tbody>
    </table>
    <form class="add-form form-grid">
      ${formFields.map(fieldHtml).join("")}
      <button type="submit" class="primary">הוסף</button>
    </form>
  `;

  container.querySelectorAll(".delete-btn").forEach((btn, i) => btn.addEventListener("click", () => onDelete(i)));
  container.querySelectorAll("tr[data-index]").forEach((tr) => {
    const index = Number(tr.dataset.index);
    tr.querySelectorAll(".row-action-btn").forEach((btn) => {
      const action = rowActions[Number(btn.dataset.action)];
      btn.addEventListener("click", () => action.onClick(rows[index], index));
    });
  });
  container.querySelector(".add-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.target).entries());
    onAdd(data);
    e.target.reset();
  });
}
