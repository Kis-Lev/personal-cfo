import { getState, setState } from "../state/store.js";
import { escapeHtml } from "../utils/escape-html.js";
import { parseCsv } from "../import/csv-parser.js";
import { parseXlsx } from "../import/xlsx-parser.js";
import { normalizeRows } from "../import/tabular-parser.js";
import { loadBankPresets } from "../import/bank-presets.js";
import { filterNewTransactions } from "../import/dedup.js";
import { categorizeTransaction, createRuleFromManualAssignment } from "../import/categorizer.js";
import { loadTaxonomy } from "../utils/taxonomy.js";
import { wireCategoryCascade } from "./components/category-cascade.js";
import { formatCurrency } from "../utils/currency.js";
import { PENDING_CATEGORY_LABEL } from "../config/constants.js";
import { getAccessToken } from "../auth/google-auth.js";
import { getDriveContext } from "../storage/drive-context.js";
import { archiveImportFile } from "../storage/drive-client.js";
import { persistState } from "../storage/persist.js";

let pendingQueue = []; // transactions awaiting manual classification (not yet in the store)
let taxonomyCache = null;
let selectedPresetId = null;

async function readFileAsRows(file) {
  const isXlsx = /\.xlsx$/i.test(file.name);
  if (isXlsx) {
    return parseXlsx(await file.arrayBuffer());
  }
  return parseCsv(await file.text());
}

async function processFile(file, container) {
  const presets = await loadBankPresets();
  const preset = presets.find((p) => p.id === selectedPresetId) || presets[0];

  const rawRows = await readFileAsRows(file);
  const candidates = normalizeRows(rawRows, preset, `${preset.id}_import`);

  const state = getState();
  const deduped = await filterNewTransactions(candidates, state.parsed_transactions);

  const autoCategorized = [];
  for (const candidate of deduped) {
    const { category, sub_category } = categorizeTransaction(candidate, state.categorization_rules);
    const transaction = {
      tx_id: candidate.tx_id,
      date: candidate.date,
      merchant: candidate.merchant,
      amount: candidate.amount,
      category,
      sub_category,
      source: candidate.source,
    };
    if (category === PENDING_CATEGORY_LABEL) {
      pendingQueue.push(transaction);
    } else {
      autoCategorized.push(transaction);
    }
  }

  if (autoCategorized.length > 0) {
    setState((s) => ({ ...s, parsed_transactions: [...s.parsed_transactions, ...autoCategorized] }));
  }

  const { importsFolderId } = getDriveContext();
  await archiveImportFile(getAccessToken(), importsFolderId, file);
  await persistState();

  renderPendingQueue(container.querySelector("#pending-queue"));
  container.querySelector("#import-summary").textContent =
    `יובאו ${autoCategorized.length} תנועות באופן אוטומטי, ${deduped.length - autoCategorized.length} ממתינות לסיווג, ${candidates.length - deduped.length} כפילויות נחסמו.`;
}

function renderPendingQueue(listEl) {
  if (!listEl) return;
  if (pendingQueue.length === 0) {
    listEl.innerHTML = `<p>אין תנועות הממתינות לסיווג.</p>`;
    return;
  }

  listEl.innerHTML = pendingQueue
    .map(
      (tx, i) => `
      <div class="card pending-card" data-index="${i}">
        <p>${escapeHtml(tx.date)} · ${escapeHtml(tx.merchant)} · ${formatCurrency(tx.amount)}</p>
        <select class="category-select" tabindex="0"></select>
        <select class="subcategory-select" tabindex="0"></select>
        <button class="primary confirm-btn" tabindex="0">אשר (Enter)</button>
      </div>`
    )
    .join("");

  listEl.querySelectorAll(".pending-card").forEach((card) => {
    const categorySelect = card.querySelector(".category-select");
    const subCategorySelect = card.querySelector(".subcategory-select");
    wireCategoryCascade(categorySelect, subCategorySelect, taxonomyCache);

    const confirm = () => {
      const index = Number(card.dataset.index);
      const tx = pendingQueue[index];
      const category = categorySelect.value;
      const subCategory = subCategorySelect.value;
      const confirmed = { ...tx, category, sub_category: subCategory };
      const newRule = createRuleFromManualAssignment(tx.merchant, category, subCategory);

      setState((s) => ({
        ...s,
        parsed_transactions: [...s.parsed_transactions, confirmed],
        categorization_rules: [...s.categorization_rules, newRule],
      }));
      pendingQueue = pendingQueue.filter((_, i) => i !== index);
      persistState();
      renderPendingQueue(listEl);
    };

    card.querySelector(".confirm-btn").addEventListener("click", confirm);
    card.addEventListener("keydown", (e) => {
      if (e.key === "Enter") confirm();
    });
  });
}

export async function renderImportHub(container) {
  const presets = await loadBankPresets();
  taxonomyCache = taxonomyCache || (await loadTaxonomy());
  selectedPresetId = selectedPresetId || presets[0].id;

  container.innerHTML = `
    <div class="card">
      <label>פורמט קובץ המקור:
        <select id="preset-select">
          ${presets.map((p) => `<option value="${p.id}">${p.display_name}</option>`).join("")}
        </select>
      </label>
      <div class="dropzone" id="dropzone">גררי לכאן קובץ CSV/XLSX, או לחצי לבחירה</div>
      <input type="file" id="file-input" accept=".csv,.xlsx" hidden />
      <p id="import-summary"></p>
    </div>
    <div class="card">
      <h3>תנועות הממתינות לסיווג ידני</h3>
      <div id="pending-queue"></div>
    </div>
  `;

  container.querySelector("#preset-select").addEventListener("change", (e) => {
    selectedPresetId = e.target.value;
  });

  const dropzone = container.querySelector("#dropzone");
  const fileInput = container.querySelector("#file-input");

  dropzone.addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", (e) => {
    for (const file of e.target.files) processFile(file, container);
  });

  dropzone.addEventListener("dragover", (e) => {
    e.preventDefault();
    dropzone.classList.add("dragover");
  });
  dropzone.addEventListener("dragleave", () => dropzone.classList.remove("dragover"));
  dropzone.addEventListener("drop", (e) => {
    e.preventDefault();
    dropzone.classList.remove("dragover");
    for (const file of e.dataTransfer.files) processFile(file, container);
  });

  renderPendingQueue(container.querySelector("#pending-queue"));
}
