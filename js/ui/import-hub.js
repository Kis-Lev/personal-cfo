import { getState, setState } from "../state/store.js";
import { escapeHtml } from "../utils/escape-html.js";
import { parseCsv } from "../import/csv-parser.js";
import { parseXlsx } from "../import/xlsx-parser.js";
import { normalizeRows, detectMatchingPreset } from "../import/tabular-parser.js";
import { loadBankPresets } from "../import/bank-presets.js";
import { filterNewTransactions } from "../import/dedup.js";
import { categorizeTransaction, createRuleFromConfirmation } from "../import/categorizer.js";
import { loadDefaultCategorizationRules } from "../import/default-categorization-rules.js";
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
let defaultCategorizationRulesCache = [];

// The user's own learned rules (from manually classifying a merchant before)
// always take priority over the built-in keyword defaults — hers are a
// deliberate, specific correction; the defaults are just a generic fallback.
function allCategorizationRules() {
  return [...getState().categorization_rules, ...defaultCategorizationRulesCache];
}

// Every source ultimately becomes a list of row-grids (one per tab) so the
// rest of the import pipeline never special-cases "how many sheets does this
// file have" — a CSV is just a file with exactly one tab.
async function readFileAsSheets(file) {
  // .xlsm (macro-enabled Excel) is the same ZIP+XML container as .xlsx —
  // the parser needs no changes, only recognizing the extension here.
  const isExcelBinary = /\.xlsm$|\.xlsx$/i.test(file.name);
  if (isExcelBinary) {
    return parseXlsx(await file.arrayBuffer());
  }
  return [parseCsv(await file.text())];
}

function allPresets() {
  return [...builtInPresetsCache, ...getState().import_presets];
}

// Shared tail of every import path (known preset OR freshly-mapped format):
// dedup -> categorize -> split auto/pending -> update UI -> archive+persist to Drive.
// The UI update happens BEFORE the Drive calls on purpose: a slow/failed Drive
// request must never hide the fact that parsing/categorizing already succeeded.
async function finishImport(candidates, file, container, detectedLabel) {
  const state = getState();
  const deduped = await filterNewTransactions(candidates, state.parsed_transactions);

  const autoCategorized = [];
  let suggestedCount = 0;
  for (const candidate of deduped) {
    const { category, sub_category, needsConfirmation, matchedRule } = categorizeTransaction(candidate, allCategorizationRules());
    const transaction = {
      tx_id: candidate.tx_id,
      date: candidate.date,
      merchant: candidate.merchant,
      amount: candidate.amount,
      category,
      sub_category,
      // Each candidate already carries the id of whichever preset actually
      // matched IT (see normalizeRows) — that can differ row-to-row when a
      // file's tabs use different column templates, so it's used as-is
      // rather than one label forced onto the whole batch.
      source: candidate.source,
      source_file: file.name,
    };
    if (category === PENDING_CATEGORY_LABEL) {
      pendingQueue.push(transaction);
    } else if (needsConfirmation) {
      // A keyword-based guess, not a rule the user actually taught — never
      // applied silently. Goes to the same review queue, pre-filled with the
      // suggestion so confirming it is a single click, but she still sees it.
      // Carries matchedRule so confirming promotes that keyword pattern itself
      // (see groupPendingByRule/confirm below), not just this one row's exact text.
      pendingQueue.push({ ...transaction, suggested: true, matchedRule });
      suggestedCount++;
    } else {
      autoCategorized.push(transaction);
    }
  }

  if (autoCategorized.length > 0) {
    setState((s) => ({ ...s, parsed_transactions: [...s.parsed_transactions, ...autoCategorized] }));
  }

  renderPendingQueue(container.querySelector("#pending-queue"));
  const detectionNote = detectedLabel ? `זוהה פורמט: ${detectedLabel}. ` : "";
  const unclassifiedCount = deduped.length - autoCategorized.length - suggestedCount;
  container.querySelector("#import-summary").textContent =
    `${detectionNote}יובאו ${autoCategorized.length} תנועות באופן אוטומטי, ${suggestedCount} עם הצעת סיווג לאישור, ${unclassifiedCount} ללא סיווג, ${candidates.length - deduped.length} כפילויות נחסמו.`;

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
// `sheets` is every tab in the uploaded file; the mapping UI is built from
// just the first one (sheets[0]), but the resulting preset's column headers
// are matched by their actual text (see normalizeRows/findHeaderRowIndex),
// so applying it to every other tab on submit re-locates each tab's own
// header row automatically rather than assuming they all share one position.
function renderMappingForm(container, file, sheets) {
  const mappingEl = container.querySelector("#mapping-form-area");
  const firstSheetRows = sheets[0];
  const fieldDefs = [
    { key: "date", label: "עמודת תאריך", required: true },
    { key: "merchant", label: "עמודת בית עסק", required: true },
    { key: "amount", label: "עמודת סכום", required: true },
    { key: "account_id", label: "עמודת מזהה (אופציונלי)", required: false },
  ];

  function optionsForRow(headerRowIndex) {
    const headerRow = firstSheetRows[headerRowIndex] || [];
    return headerRow.map((cell, i) => `<option value="${i}">${escapeHtml(String(cell))}</option>`).join("");
  }

  mappingEl.innerHTML = `
    <div class="card">
      <h3>מיפוי עמודות (פורמט לא מוכר)</h3>
      <p>לא זיהיתי פריסט מתאים ל"${escapeHtml(file.name)}". בחרי אילו עמודות בקובץ מייצגות כל שדה (לפי הטאב הראשון)${
        sheets.length > 1 ? ` — המיפוי יוחל אוטומטית על כל ${sheets.length} הטאבים בקובץ` : ""
      }:</p>
      <form id="mapping-form" class="form-grid">
        <label>שורת הכותרות (1 = הראשונה)
          <input name="header_row" type="number" min="1" max="${firstSheetRows.length}" value="1" />
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
    const headerRow = firstSheetRows[headerRowIndex] || [];

    const columnFor = (fieldKey) => {
      if (data[fieldKey] === "") return { header: null };
      return { header: String(headerRow[Number(data[fieldKey])]) };
    };

    const preset = {
      id: createId("preset"),
      display_name: data.preset_name?.trim() || `פורמט מותאם (${file.name})`,
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
    const candidates = sheets.flatMap((rows) => normalizeRows(rows, preset, preset.id));
    await finishImport(candidates, file, container, preset.display_name);
  });
}

async function processFile(file, container) {
  const sheets = await readFileAsSheets(file);

  if (selectedPresetId === MANUAL_MAPPING_ID) {
    renderMappingForm(container, file, sheets);
    return;
  }

  if (selectedPresetId === AUTO_DETECT_ID) {
    // Different tabs in the same file can use different column templates —
    // e.g. domestic vs. foreign-currency transactions, or current vs.
    // next-month billing, each with its own header wording — so every tab's
    // format is detected on its own instead of assuming one preset fits all
    // of them just because it matched the first tab. When there's more than
    // one tab, the summary spells out per-tab what was found (rather than
    // just one combined count), so a tab that silently contributed 0 rows
    // is visible instead of invisibly folded into the total.
    const candidates = [];
    const detectedNames = new Set();
    const perSheetBreakdown = [];
    sheets.forEach((rows, i) => {
      const detected = detectMatchingPreset(rows, allPresets());
      if (!detected) {
        perSheetBreakdown.push(`טאב ${i + 1}: לא זוהה פורמט (0 שורות)`);
        return;
      }
      const sheetCandidates = normalizeRows(rows, detected.preset, detected.preset.id, detected.headerRowIndex);
      candidates.push(...sheetCandidates);
      detectedNames.add(detected.preset.display_name);
      perSheetBreakdown.push(`טאב ${i + 1}: ${detected.preset.display_name} (${sheetCandidates.length} שורות)`);
    });

    if (detectedNames.size === 0) {
      renderMappingForm(container, file, sheets); // genuinely new format — teach it once
      return;
    }

    const detectedLabel = sheets.length > 1 ? perSheetBreakdown.join(" | ") : [...detectedNames][0];
    await finishImport(candidates, file, container, detectedLabel);
    return;
  }

  // An explicit preset chosen from the dropdown overrides auto-detection.
  const preset = allPresets().find((p) => p.id === selectedPresetId) || allPresets()[0];
  const candidates = sheets.flatMap((rows) => normalizeRows(rows, preset, preset.id));
  await finishImport(candidates, file, container);
}

// Groups pending transactions so the user classifies each distinct THING
// ONCE — not once per transaction and not once per merchant-text variant.
// A row with a pre-filled suggestion (tx.matchedRule) is grouped by that
// underlying keyword/regex pattern, not by its literal merchant text: real
// bank/card exports often append a per-row reference number or branch code
// to an otherwise-repeating merchant name (e.g. "סונול כביש 6 מסוף 00234"),
// so two rows from the same real merchant can have different exact text
// while still being caught by the same pattern — grouping by the pattern
// collapses them into one confirmation instead of many. Rows with no
// suggestion (nothing matched at all) have no pattern to group by, so they
// still fall back to grouping by literal merchant text.
function pendingGroupKey(tx) {
  return tx.matchedRule ? `rule:${tx.matchedRule.match_type}:${tx.matchedRule.pattern}` : `merchant:${tx.merchant}`;
}

function groupPendingByMerchant() {
  const groups = new Map();
  for (const tx of pendingQueue) {
    const key = pendingGroupKey(tx);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(tx);
  }
  return [...groups.entries()].map(([key, transactions]) => ({ key, transactions }));
}

function renderPendingQueue(listEl) {
  if (!listEl) return;
  if (pendingQueue.length === 0) {
    listEl.innerHTML = `<p>אין תנועות הממתינות לסיווג.</p>`;
    return;
  }

  const groups = groupPendingByMerchant();
  listEl.innerHTML =
    `<p>${pendingQueue.length} תנועות ב-${groups.length} קבוצות ממתינות — סווגי כל קבוצה פעם אחת.</p>` +
    groups
      .map((group, i) => {
        const first = group.transactions[0];
        const distinctMerchants = new Set(group.transactions.map((tx) => tx.merchant));
        const suggestion = first.suggested
          ? `<p class="track-green">💡 הצעה: ${escapeHtml(first.category)} / ${escapeHtml(first.sub_category)} — אשרי אם נכון, או בחרי אחר. אישור כאן ייכנס אוטומטית לתוקף לכל תנועה עתידית מסוג זה, בלי לשאול שוב.</p>`
          : "";
        const label =
          distinctMerchants.size > 1
            ? `${escapeHtml(first.merchant)} <span style="color:var(--muted)">(וכן ${distinctMerchants.size - 1} וריאציות נוספות של אותו בית עסק)</span>`
            : escapeHtml(first.merchant);
        return `
      <div class="card pending-card" data-index="${i}">
        <p>${label} <span style="color:var(--muted)">(${group.transactions.length} תנועות, לדוגמה ${escapeHtml(first.date)} · ${formatCurrency(first.amount)})</span></p>
        ${suggestion}
        <select class="category-select" tabindex="0"></select>
        <select class="subcategory-select" tabindex="0"></select>
        <button class="primary confirm-btn" tabindex="0">אשר הכל (Enter)</button>
      </div>`;
      })
      .join("");

  listEl.querySelectorAll(".pending-card").forEach((card, i) => {
    const categorySelect = card.querySelector(".category-select");
    const subCategorySelect = card.querySelector(".subcategory-select");
    wireCategoryCascade(categorySelect, subCategorySelect, taxonomyCache);

    const suggested = groups[i].transactions[0];
    if (suggested.suggested) {
      categorySelect.value = suggested.category;
      categorySelect.dispatchEvent(new Event("change"));
      subCategorySelect.value = suggested.sub_category;
    }

    const confirm = () => {
      const index = Number(card.dataset.index);
      const group = groups[index];
      const category = categorySelect.value;
      const subCategory = subCategorySelect.value;
      const confirmedTransactions = group.transactions.map(({ suggested, matchedRule, ...tx }) => ({ ...tx, category, sub_category: subCategory }));
      const newRule = createRuleFromConfirmation(group.transactions[0], category, subCategory);

      setState((s) => ({
        ...s,
        parsed_transactions: [...s.parsed_transactions, ...confirmedTransactions],
        categorization_rules: [...s.categorization_rules, newRule],
      }));
      pendingQueue = pendingQueue.filter((tx) => pendingGroupKey(tx) !== group.key);
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
  defaultCategorizationRulesCache = await loadDefaultCategorizationRules();
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
