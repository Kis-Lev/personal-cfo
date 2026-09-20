import { getState, setState } from "../state/store.js";
import { escapeHtml } from "../utils/escape-html.js";
import { parseCsv } from "../import/csv-parser.js";
import { parseXlsx } from "../import/xlsx-parser.js";
import { normalizeRows, detectMatchingPreset, findHeaderRowIndex } from "../import/tabular-parser.js";
import { loadBankPresets } from "../import/bank-presets.js";
import { splitCandidatesAgainstStored } from "../import/dedup.js";
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

// Every sheet of an uploaded file goes through here, whichever path chose the
// preset (auto-detection, an explicitly picked preset, or a freshly-taught
// manual mapping), so all three report the same way: which tab used which
// format, how many rows each tab yielded, and — the part that used to be
// invisible — which rows could not be read at all.
// `resolve(rows, sheetIndex)` returns {preset, headerRowIndex} or null.
// A skipped row is only an alarm when it might have been a transaction.
// "not_a_transaction" (a header, a legal-terms paragraph) and "statement_total"
// (the file's own summary line, recognized by matching the sum) are both rows
// we are right to leave out.
const isUnreadRow = (row) => row.kind === "unread";

function normalizeSheets(sheets, resolve) {
  const candidates = [];
  const skipped = [];
  const unreadableSheets = [];
  const perSheetBreakdown = [];
  const detectedNames = new Set();
  let dataRowCount = 0;

  sheets.forEach((rows, i) => {
    const resolved = resolve(rows, i);
    if (!resolved || resolved.headerRowIndex === -1) {
      // The tab's rows are real rows that nobody read. Counted and named here
      // rather than passed over in silence, so "0 שורות" can never be mistaken
      // for "this tab was empty".
      unreadableSheets.push({ sheetIndex: i, rowCount: rows.length });
      perSheetBreakdown.push(`טאב ${i + 1}: לא זוהה פורמט — ${rows.length} שורות לא נקראו`);
      return;
    }
    const sheet = normalizeRows(rows, resolved.preset, resolved.preset.id, resolved.headerRowIndex);
    // Tagged with the tab it came from: two tabs of one file often repeat the
    // same transaction, while a repeat inside a single tab is a second real
    // charge — dedup needs to tell those apart (see splitCandidatesAgainstStored).
    candidates.push(...sheet.candidates.map((c) => ({ ...c, sheetIndex: i })));
    skipped.push(...sheet.skipped.map((row) => ({ ...row, sheetIndex: i })));
    dataRowCount += sheet.dataRowCount;
    detectedNames.add(resolved.preset.display_name);
    const unreadInSheet = sheet.skipped.filter(isUnreadRow).length;
    perSheetBreakdown.push(
      `טאב ${i + 1}: ${resolved.preset.display_name} (${sheet.candidates.length} שורות${unreadInSheet > 0 ? `, ${unreadInSheet} לא נקראו` : ""})`
    );
  });

  return { candidates, skipped, unreadableSheets, dataRowCount, perSheetBreakdown, detectedNames };
}

// The strongest check the app can show: the issuer's own stated total for the
// file, next to the total the app read from it. Silence would waste a figure
// the file is already carrying.
function statementTotalHtml(statementTotal) {
  if (!statementTotal) return "";
  return ` <span class="track-green">סיכום הקובץ עצמו (${formatCurrency(statementTotal.stated)}) תואם למה שנקרא ✓</span>`;
}

function skipLabel(row) {
  if (row.kind === "statement_total") return `<span class="track-green">שורת הסיכום של הקובץ ✓</span> — `;
  if (row.kind === "not_a_transaction") return `<span style="color:var(--muted)">שורה שאינה תנועה</span> — `;
  return "";
}

function skippedRowsHtml(skipped) {
  if (skipped.length === 0) return "";
  const unread = skipped.filter(isUnreadRow);
  return `
    <details class="${unread.length > 0 ? "track-red" : ""}" style="margin-top:8px;">
      <summary>${unread.length} שורות שלא נקראו ולא נכנסו לאף חישוב, ו-${skipped.length - unread.length} שורות שאינן תנועות (כותרות/סיכומים) — לחצי לפירוט</summary>
      <ul>
        ${skipped
          .map(
            (row) =>
              `<li>${skipLabel(row)}שורה ${row.rowNumber}: ${escapeHtml(row.reason)} — <span style="color:var(--muted)">${escapeHtml(row.preview)}</span></li>`
          )
          .join("")}
      </ul>
    </details>`;
}

// The fields the FILE is the authority on, and the only ones a re-import is
// allowed to touch on a transaction that is already stored. Everything else on
// a stored transaction belongs to the user — the category she chose, the
// reimbursement percentage she set, whether it still awaits review — and a
// re-import must never quietly undo that work.
//
// billing_cycle is here because it is derived from the statement as a whole,
// which means rows imported before the app knew how to work it out cannot be
// corrected from the row alone; re-uploading the file is what fixes them.
const REFRESHABLE_FIELDS = ["billing_cycle"];

function buildRefreshPatches(known, storedTransactions) {
  const storedById = new Map(storedTransactions.map((tx) => [tx.tx_id, tx]));
  const patches = new Map();

  for (const candidate of known) {
    const stored = storedById.get(candidate.tx_id);
    if (!stored) continue;
    const patch = {};
    for (const field of REFRESHABLE_FIELDS) {
      if (candidate[field] !== undefined && candidate[field] !== stored[field]) patch[field] = candidate[field];
    }
    if (Object.keys(patch).length > 0) patches.set(candidate.tx_id, patch);
  }
  return patches;
}

/**
 * Transactions stored from this same file that the file no longer produces.
 *
 * A re-import lines rows up by a hash of date, merchant, amount and slip
 * number, so a row whose AMOUNT the app once read wrongly — a credit read as a
 * charge before trailing minus signs were understood, say — now hashes
 * differently: it comes back as a new transaction while the old, wrong one
 * stays in the store forever, and the file's total quietly counts twice.
 *
 * They are reported, never deleted: only the user can say whether a row that
 * stopped matching is a mistake to remove or a transaction she edited.
 */
function findOrphanedTransactions(parsed, fileName, known, storedTransactions) {
  if (parsed.candidates.length === 0) return [];
  const matched = new Set(known.map((candidate) => candidate.tx_id));
  return storedTransactions.filter((tx) => tx.source_file === fileName && !matched.has(tx.tx_id));
}

function orphanHtml(orphans) {
  if (orphans.length === 0) return "";
  return `
    <details class="track-red" style="margin-top:8px;">
      <summary>${orphans.length} תנועות שנשמרו בעבר מהקובץ הזה כבר לא מופיעות בקריאה הנוכחית — לחצי לפירוט</summary>
      <p style="color:var(--muted)">קרוב לוודאי שהן נקראו בעבר בצורה שגויה (למשל זיכוי שנקרא כחיוב) ולכן נוצרו מחדש כתנועות נכונות. הן לא נמחקו — אפשר למחוק אותן ממסך התנועות אם הן אכן מיותרות.</p>
      <ul>
        ${orphans
          .map((tx) => `<li>${escapeHtml(tx.date)} · ${escapeHtml(tx.merchant)} · ${formatCurrency(tx.amount)}</li>`)
          .join("")}
      </ul>
    </details>`;
}

// Shared tail of every import path (known preset OR freshly-mapped format):
// dedup -> categorize -> store -> update UI -> archive+persist to Drive.
// The UI update happens BEFORE the Drive calls on purpose: a slow/failed Drive
// request must never hide the fact that parsing/categorizing already succeeded.
async function finishImport(parsed, file, container, detectedLabel) {
  const state = getState();
  const { fresh, known, batchDuplicates } = await splitCandidatesAgainstStored(parsed.candidates, state.parsed_transactions);

  let autoCategorizedCount = 0;
  const imported = fresh.map((candidate) => {
    const { category, sub_category, needsConfirmation, matchedRule } = categorizeTransaction(candidate, allCategorizationRules());
    const transaction = {
      tx_id: candidate.tx_id,
      date: candidate.date,
      // Which statement actually paid for this — worked out at parse time,
      // because for a single-bill file it takes the whole file to know.
      billing_cycle: candidate.billing_cycle,
      merchant: candidate.merchant,
      amount: candidate.amount,
      // Each candidate already carries the id of whichever preset actually
      // matched IT (see normalizeRows) — that can differ row-to-row when a
      // file's tabs use different column templates, so it's used as-is
      // rather than one label forced onto the whole batch.
      source: candidate.source,
      source_file: file.name,
    };

    if (category !== PENDING_CATEGORY_LABEL && !needsConfirmation) {
      autoCategorizedCount++;
      return { ...transaction, category, sub_category };
    }

    // Awaiting review, and stored anyway. Holding these in a module-scope
    // array instead meant the money on them was in no total on any screen
    // until the user got round to classifying them — and was lost outright
    // on the next page reload, with the import summary still claiming they
    // had been imported. Stored, they count everywhere from the moment they
    // arrive; the category stays the pending label, so nothing is silently
    // classified — a keyword guess rides along as a suggestion only.
    return {
      ...transaction,
      category: PENDING_CATEGORY_LABEL,
      sub_category: PENDING_CATEGORY_LABEL,
      needs_review: true,
      suggested_category: needsConfirmation ? category : null,
      suggested_sub_category: needsConfirmation ? sub_category : null,
      suggested_rule: matchedRule,
    };
  });

  const refreshes = buildRefreshPatches(known, state.parsed_transactions);
  const orphans = findOrphanedTransactions(parsed, file.name, known, state.parsed_transactions);

  const importRecord = {
    import_id: createId("import"),
    file_name: file.name,
    imported_at: new Date().toISOString(),
    data_rows: parsed.dataRowCount,
    imported: imported.length,
    already_stored: known.length,
    refreshed: refreshes.size,
    duplicates: batchDuplicates,
    orphaned: orphans.map((tx) => ({ tx_id: tx.tx_id, date: tx.date, merchant: tx.merchant, amount: tx.amount })),
    skipped: parsed.skipped,
    unreadable_sheets: parsed.unreadableSheets,
  };

  setState((s) => ({
    ...s,
    parsed_transactions: [
      ...s.parsed_transactions.map((tx) => (refreshes.has(tx.tx_id) ? { ...tx, ...refreshes.get(tx.tx_id) } : tx)),
      ...imported,
    ],
    import_log: [...s.import_log, importRecord],
  }));

  renderPendingQueue(container.querySelector("#pending-queue"));

  const pendingCount = imported.length - autoCategorizedCount;
  const detectionNote = detectedLabel ? `זוהה פורמט: ${detectedLabel}. ` : "";
  // Spelled out as an equation that closes: every data row in the file is in
  // exactly one of these buckets, so the user can check the count against the
  // file itself instead of taking a single "imported N" on trust.
  const unreadableRows = parsed.unreadableSheets.reduce((sum, sheet) => sum + sheet.rowCount, 0);
  container.querySelector("#import-summary").innerHTML =
    `${escapeHtml(detectionNote)}${parsed.dataRowCount} שורות נתונים בקובץ = ` +
    `${autoCategorizedCount} סווגו אוטומטית + ${pendingCount} ממתינות לסיווג (ונספרות כבר עכשיו) + ` +
    `${known.length} כבר היו במאגר${refreshes.size > 0 ? ` (${refreshes.size} עודכנו)` : ""} + ` +
    `${batchDuplicates} כפילויות בתוך הקובץ + ${parsed.skipped.filter(isUnreadRow).length} לא נקראו + ` +
    `${parsed.skipped.filter((row) => !isUnreadRow(row)).length} שורות שאינן תנועות (כותרות/סיכומים).` +
    statementTotalHtml(parsed.statementTotal) +
    (unreadableRows > 0
      ? ` <span class="track-red">בנוסף, ${unreadableRows} שורות ב-${parsed.unreadableSheets.length} טאבים שלא זוהה בהם פורמט לא נקראו כלל.</span>`
      : "") +
    orphanHtml(orphans) +
    skippedRowsHtml(parsed.skipped);

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
    const parsed = normalizeSheets(sheets, (rows) => ({ preset, headerRowIndex: findHeaderRowIndex(rows, preset.columns) }));
    await finishImport(parsed, file, container, preset.display_name);
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
    const parsed = normalizeSheets(sheets, (rows) => detectMatchingPreset(rows, allPresets()));

    if (parsed.detectedNames.size === 0) {
      renderMappingForm(container, file, sheets); // genuinely new format — teach it once
      return;
    }

    const detectedLabel = sheets.length > 1 ? parsed.perSheetBreakdown.join(" | ") : [...parsed.detectedNames][0];
    await finishImport(parsed, file, container, detectedLabel);
    return;
  }

  // An explicit preset chosen from the dropdown overrides auto-detection.
  const preset = allPresets().find((p) => p.id === selectedPresetId) || allPresets()[0];
  const parsed = normalizeSheets(sheets, (rows) => ({ preset, headerRowIndex: findHeaderRowIndex(rows, preset.columns) }));
  await finishImport(parsed, file, container, preset.display_name);
}

// The transactions still waiting to be classified. They live in the store like
// any other imported transaction (see finishImport) — this is a view over it,
// not a separate holding pen — so the money on them is already inside every
// total while the user works through the queue, and closing the tab mid-way
// loses nothing.
function pendingTransactions() {
  return getState().parsed_transactions.filter((tx) => tx.needs_review);
}

// Groups pending transactions so the user classifies each distinct THING
// ONCE — not once per transaction and not once per merchant-text variant.
// A row with a pre-filled suggestion (tx.suggested_rule) is grouped by that
// underlying keyword/regex pattern, not by its literal merchant text: real
// bank/card exports often append a per-row reference number or branch code
// to an otherwise-repeating merchant name (e.g. "סונול כביש 6 מסוף 00234"),
// so two rows from the same real merchant can have different exact text
// while still being caught by the same pattern — grouping by the pattern
// collapses them into one confirmation instead of many. Rows with no
// suggestion (nothing matched at all) have no pattern to group by, so they
// still fall back to grouping by literal merchant text.
function pendingGroupKey(tx) {
  return tx.suggested_rule ? `rule:${tx.suggested_rule.match_type}:${tx.suggested_rule.pattern}` : `merchant:${tx.merchant}`;
}

function groupPendingByMerchant(pending) {
  const groups = new Map();
  for (const tx of pending) {
    const key = pendingGroupKey(tx);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(tx);
  }
  return [...groups.entries()].map(([key, transactions]) => ({ key, transactions }));
}

function renderPendingQueue(listEl) {
  if (!listEl) return;
  const pending = pendingTransactions();
  if (pending.length === 0) {
    listEl.innerHTML = `<p>אין תנועות הממתינות לסיווג.</p>`;
    return;
  }

  const groups = groupPendingByMerchant(pending);
  const pendingTotal = pending.reduce((sum, tx) => sum + tx.amount, 0);
  listEl.innerHTML =
    `<p>${pending.length} תנועות ב-${groups.length} קבוצות ממתינות — סווגי כל קבוצה פעם אחת.</p>` +
    `<p style="color:var(--muted)">סה"כ ${formatCurrency(pendingTotal)} — כבר נספר בכל הסיכומים בדשבורד, תחת "${escapeHtml(PENDING_CATEGORY_LABEL)}". הסיווג כאן רק מעביר אותן לקטגוריה הנכונה.</p>` +
    groups
      .map((group, i) => {
        const first = group.transactions[0];
        const distinctMerchants = new Set(group.transactions.map((tx) => tx.merchant));
        const groupTotal = group.transactions.reduce((sum, tx) => sum + tx.amount, 0);
        const suggestion = first.suggested_category
          ? `<p class="track-green">💡 הצעה: ${escapeHtml(first.suggested_category)} / ${escapeHtml(first.suggested_sub_category)} — אשרי אם נכון, או בחרי אחר. אישור כאן ייכנס אוטומטית לתוקף לכל תנועה עתידית מסוג זה, בלי לשאול שוב.</p>`
          : "";
        const label =
          distinctMerchants.size > 1
            ? `${escapeHtml(first.merchant)} <span style="color:var(--muted)">(וכן ${distinctMerchants.size - 1} וריאציות נוספות של אותו בית עסק)</span>`
            : escapeHtml(first.merchant);
        return `
      <div class="card pending-card" data-index="${i}">
        <p>${label} <span style="color:var(--muted)">(${group.transactions.length} תנועות, סה"כ ${formatCurrency(groupTotal)}, לדוגמה ${escapeHtml(first.date)} · ${formatCurrency(first.amount)})</span></p>
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

    const first = groups[i].transactions[0];
    if (first.suggested_category) {
      categorySelect.value = first.suggested_category;
      categorySelect.dispatchEvent(new Event("change"));
      subCategorySelect.value = first.suggested_sub_category;
    }

    const confirm = () => {
      const group = groups[Number(card.dataset.index)];
      const category = categorySelect.value;
      const subCategory = subCategorySelect.value;
      const confirmedIds = new Set(group.transactions.map((tx) => tx.tx_id));
      const newRule = createRuleFromConfirmation(group.transactions[0], category, subCategory);

      setState((s) => ({
        ...s,
        // Updated in place rather than appended: these transactions are
        // already in the store, so adding them again would count every
        // classified shekel twice.
        parsed_transactions: s.parsed_transactions.map((tx) => {
          if (!confirmedIds.has(tx.tx_id)) return tx;
          const { needs_review, suggested_category, suggested_sub_category, suggested_rule, ...rest } = tx;
          return { ...rest, category, sub_category: subCategory };
        }),
        categorization_rules: [...s.categorization_rules, newRule],
      }));
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
