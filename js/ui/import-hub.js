import { getState, setState } from "../state/store.js";
import { escapeHtml } from "../utils/escape-html.js";
import { parseCsv } from "../import/csv-parser.js";
import { parseXlsx } from "../import/xlsx-parser.js";
import { normalizeRows, detectMatchingPreset } from "../import/tabular-parser.js";
import { loadBankPresets } from "../import/bank-presets.js";
import { filterNewTransactions } from "../import/dedup.js";
import { categorizeTransaction, createRuleFromManualAssignment } from "../import/categorizer.js";
import { loadTaxonomy } from "../utils/taxonomy.js";
import { wireCategoryCascade } from "./components/category-cascade.js";
import { formatCurrency } from "../utils/currency.js";
import { createId } from "../utils/ids.js";
import { PENDING_CATEGORY_LABEL } from "../config/constants.js";
import { getAccessToken } from "../auth/google-auth.js";
import { getDriveContext } from "../storage/drive-context.js";
import { archiveImportFile } from "../storage/drive-client.js";
import { persistState } from "../storage/persist.js";

const AUTO_DETECT_ID = "__auto_detect__";
const MANUAL_MAPPING_ID = "__manual_mapping__";

let pendingQueue = []; // transactions awaiting manual classification (not yet in the store)
let taxonomyCache = null;
let selectedPresetId = null;
let builtInPresetsCache = [];

async function readFileAsRows(file) {
  // .xlsm (macro-enabled Excel) is the same ZIP+XML container as .xlsx —
  // the parser needs no changes, only recognizing the extension here.
  const isExcelBinary = /\.xlsm$|\.xlsx$/i.test(file.name);
  if (isExcelBinary) {
    return parseXlsx(await file.arrayBuffer());
  }
  return parseCsv(await file.text());
}

function allPresets() {
  return [...builtInPresetsCache, ...getState().import_presets];
}

// Shared tail of every import path (known preset OR freshly-mapped format):
// dedup -> categorize -> split auto/pending -> update UI -> archive+persist to Drive.
// The UI update happens BEFORE the Drive calls on purpose: a slow/failed Drive
// request must never hide the fact that parsing/categorizing already succeeded.
async function finishImport(candidates, sourceLabel, file, container, detectedLabel) {
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
      source: sourceLabel,
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

  renderPendingQueue(container.querySelector("#pending-queue"));
  const detectionNote = detectedLabel ? `זוהה פורמט: ${detectedLabel}. ` : "";
  container.querySelector("#import-summary").textContent =
    `${detectionNote}יובאו ${autoCategorized.length} תנועות באופן אוטומטי, ${deduped.length - autoCategorized.length} ממתינות לסיווג, ${candidates.length - deduped.length} כפילויות נחסמו.`;

  try {
    const { importsFolderId } = getDriveContext();
    await archiveImportFile(getAccessToken(), importsFolderId, file);
    await persistState();
  } catch (err) {
    console.error("Import succeeded locally but saving to Drive failed:", err);
  }
}

// Every bank/card issuer exports a different column layout, so instead of
// guessing formats we don't have real samples for, the user maps her actual
// file's columns once here — optionally saving it as a reusable preset.
function renderMappingForm(container, file, rawRows) {
  const mappingEl = container.querySelector("#mapping-form-area");
  const fieldDefs = [
    { key: "date", label: "עמודת תאריך", required: true },
    { key: "merchant", label: "עמודת בית עסק", required: true },
    { key: "amount", label: "עמודת סכום", required: true },
    { key: "account_id", label: "עמודת מזהה (אופציונלי)", required: false },
  ];

  function optionsForRow(headerRowIndex) {
    const headerRow = rawRows[headerRowIndex] || [];
    return headerRow.map((cell, i) => `<option value="${i}">${escapeHtml(String(cell))}</option>`).join("");
  }

  mappingEl.innerHTML = `
    <div class="card">
      <h3>מיפוי עמודות (פורמט לא מוכר)</h3>
      <p>לא זיהיתי פריסט מתאים ל"${escapeHtml(file.name)}". בחרי אילו עמודות בקובץ מייצגות כל שדה:</p>
      <form id="mapping-form" class="form-grid">
        <label>שורת הכותרות (1 = הראשונה)
          <input name="header_row" type="number" min="1" max="${rawRows.length}" value="1" />
        </label>
        ${fieldDefs
          .map(
            (f) => `
          <label>${f.label}
            <select name="${f.key}" ${f.required ? "required" : ""}>
              ${f.key === "account_id" ? '<option value="">ללא</option>' : ""}
              ${optionsForRow(0)}
            </select>
          </label>`
          )
          .join("")}
        <label>שם לשמירה כפריסט לפעם הבאה (אופציונלי)
          <input name="preset_name" type="text" placeholder="למשל: אשראי כאל" />
        </label>
        <button type="submit" class="primary">אשר וייבא</button>
      </form>
    </div>
  `;

  const form = mappingEl.querySelector("#mapping-form");
  const headerRowInput = form.querySelector('[name="header_row"]');
  const selects = fieldDefs.map((f) => form.querySelector(`[name="${f.key}"]`));

  headerRowInput.addEventListener("input", () => {
    const idx = Number(headerRowInput.value) - 1;
    selects.forEach((sel) => {
      const isAccount = sel.name === "account_id";
      sel.innerHTML = (isAccount ? '<option value="">ללא</option>' : "") + optionsForRow(idx);
    });
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(form).entries());
    const headerRowIndex = Number(data.header_row) - 1;
    const headerRow = rawRows[headerRowIndex] || [];

    const columnFor = (fieldKey) => {
      if (data[fieldKey] === "") return { header: null };
      return { header: String(headerRow[Number(data[fieldKey])]) };
    };

    const preset = {
      id: createId("preset"),
      display_name: data.preset_name?.trim() || `פורמט מותאם (${file.name})`,
      header_row_index: headerRowIndex,
      columns: {
        date: columnFor("date"),
        merchant: columnFor("merchant"),
        amount: columnFor("amount"),
        account_id: columnFor("account_id"),
      },
    };

    if (data.preset_name?.trim()) {
      setState((s) => ({ ...s, import_presets: [...s.import_presets, preset] }));
      persistState();
    }

    mappingEl.innerHTML = "";
    const candidates = normalizeRows(rawRows, preset, preset.id);
    await finishImport(candidates, preset.id, file, container, preset.display_name);
  });
}

async function processFile(file, container) {
  const rawRows = await readFileAsRows(file);

  if (selectedPresetId === MANUAL_MAPPING_ID) {
    renderMappingForm(container, file, rawRows);
    return;
  }

  if (selectedPresetId === AUTO_DETECT_ID) {
    const detected = detectMatchingPreset(rawRows, allPresets());
    if (!detected) {
      renderMappingForm(container, file, rawRows); // genuinely new format — teach it once
      return;
    }
    const candidates = normalizeRows(rawRows, detected, detected.id);
    await finishImport(candidates, detected.id, file, container, detected.display_name);
    return;
  }

  // An explicit preset chosen from the dropdown overrides auto-detection.
  const preset = allPresets().find((p) => p.id === selectedPresetId) || allPresets()[0];
  const candidates = normalizeRows(rawRows, preset, preset.id);
  await finishImport(candidates, preset.id, file, container);
}

// Groups pending transactions by merchant so the user classifies each
// distinct merchant ONCE — not once per transaction. Real transaction
// history is full of repeat merchants (same supermarket, same gas station),
// so this is usually a large real reduction in manual work, with no
// guessing involved: it's the same exact-merchant rule the engine already
// creates, just applied to every matching row in the current batch at once.
function groupPendingByMerchant() {
  const groups = new Map();
  for (const tx of pendingQueue) {
    if (!groups.has(tx.merchant)) groups.set(tx.merchant, []);
    groups.get(tx.merchant).push(tx);
  }
  return [...groups.entries()].map(([merchant, transactions]) => ({ merchant, transactions }));
}

function renderPendingQueue(listEl) {
  if (!listEl) return;
  if (pendingQueue.length === 0) {
    listEl.innerHTML = `<p>אין תנועות הממתינות לסיווג.</p>`;
    return;
  }

  const groups = groupPendingByMerchant();
  listEl.innerHTML =
    `<p>${pendingQueue.length} תנועות מ-${groups.length} בתי עסק שונים ממתינות — סווגי כל בית עסק פעם אחת.</p>` +
    groups
      .map(
        (group, i) => `
      <div class="card pending-card" data-index="${i}">
        <p>${escapeHtml(group.merchant)} <span style="color:var(--muted)">(${group.transactions.length} תנועות, לדוגמה ${escapeHtml(group.transactions[0].date)} · ${formatCurrency(group.transactions[0].amount)})</span></p>
        <select class="category-select" tabindex="0"></select>
        <select class="subcategory-select" tabindex="0"></select>
        <button class="primary confirm-btn" tabindex="0">אשר הכל (Enter)</button>
      </div>`
      )
      .join("");

  listEl.querySelectorAll(".pending-card").forEach((card) => {
    const categorySelect = card.querySelector(".category-select");
    const subCategorySelect = card.querySelector(".subcategory-select");
    wireCategoryCascade(categorySelect, subCategorySelect, taxonomyCache);

    const confirm = () => {
      const index = Number(card.dataset.index);
      const group = groups[index];
      const category = categorySelect.value;
      const subCategory = subCategorySelect.value;
      const confirmedTransactions = group.transactions.map((tx) => ({ ...tx, category, sub_category: subCategory }));
      const newRule = createRuleFromManualAssignment(group.merchant, category, subCategory);

      setState((s) => ({
        ...s,
        parsed_transactions: [...s.parsed_transactions, ...confirmedTransactions],
        categorization_rules: [...s.categorization_rules, newRule],
      }));
      pendingQueue = pendingQueue.filter((tx) => tx.merchant !== group.merchant);
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
  const builtInPresets = await loadBankPresets();
  builtInPresetsCache = builtInPresets; // lets allPresets() combine these with saved custom ones
  taxonomyCache = taxonomyCache || (await loadTaxonomy());
  selectedPresetId = selectedPresetId || AUTO_DETECT_ID;

  const customPresets = getState().import_presets;

  container.innerHTML = `
    <div class="card">
      <label>פורמט קובץ המקור:
        <select id="preset-select">
          <option value="${AUTO_DETECT_ID}">זיהוי אוטומטי לפי כותרות הקובץ (מומלץ)</option>
          ${builtInPresets.map((p) => `<option value="${p.id}">${p.display_name}</option>`).join("")}
          ${customPresets.map((p) => `<option value="${p.id}">${escapeHtml(p.display_name)} (שמור)</option>`).join("")}
          <option value="${MANUAL_MAPPING_ID}">כפה מיפוי עמודות ידני</option>
        </select>
      </label>
      <div class="dropzone" id="dropzone">גררי לכאן קובץ CSV/XLSX/XLSM, או לחצי לבחירה</div>
      <input type="file" id="file-input" accept=".csv,.xlsx,.xlsm" hidden />
      <div id="mapping-form-area"></div>
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
