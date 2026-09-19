// Shared normalization core: both csv-parser.js and xlsx-parser.js only need to
// produce a raw string[][] grid; everything about matching a bank preset's
// column headers and turning rows into transaction candidates lives here once,
// so CSV and XLSX never duplicate this logic between them.
import { normalizeDateToIso } from "../utils/dates.js";
import { parseAmount } from "../utils/currency.js";

const REQUIRED_COLUMN_KEYS = ["date", "merchant", "amount"];

// Real bank/card exports don't reliably put the header on a fixed row — the
// exact same export template can carry a different number of leading
// logo/title rows from one statement to the next (observed directly: two
// monthly exports from the same card, identical column headers, header row
// at position 1 in one file and position 10 in the other). So instead of
// trusting a stored row index, every preset's header row is located by
// scanning for the first row whose content actually satisfies it.
const MAX_HEADER_SEARCH_ROWS = 30;

function buildColumnIndexMap(headerRow, presetColumns) {
  const normalizedHeaders = headerRow.map((h) => String(h).trim());
  const indexMap = {};
  for (const [key, def] of Object.entries(presetColumns)) {
    const idx = normalizedHeaders.findIndex((h) => h === def.header);
    indexMap[key] = idx === -1 ? null : idx;
  }
  return indexMap;
}

export function findHeaderRowIndex(rows, presetColumns) {
  const limit = Math.min(rows.length, MAX_HEADER_SEARCH_ROWS);
  for (let i = 0; i < limit; i++) {
    const columnIndex = buildColumnIndexMap(rows[i] || [], presetColumns);
    if (REQUIRED_COLUMN_KEYS.every((key) => columnIndex[key] != null)) return i;
  }
  return -1;
}

/**
 * Finds the first known preset (built-in or user-taught) whose expected header
 * texts actually appear somewhere in this file — so the file's own content
 * decides the format instead of the user picking one from a list every time.
 * @param {string[][]} rows
 * @param {object[]} presets
 * @returns {{preset: object, headerRowIndex: number}|null} the matching preset
 *   and the row it was actually found on, or null if none of them fit
 */
export function detectMatchingPreset(rows, presets) {
  for (const preset of presets) {
    const headerRowIndex = findHeaderRowIndex(rows, preset.columns);
    if (headerRowIndex !== -1) return { preset, headerRowIndex };
  }
  return null;
}

/**
 * @param {string[][]} rows   raw grid, as produced by parseCsv() or parseXlsx()
 * @param {object} preset     one entry from data/bank-presets.json
 * @param {string} source     e.g. "credit_card_export", used as parsed_transactions.source
 * @param {number} [headerRowIndex] pass the value already found by detectMatchingPreset
 *   to avoid re-scanning; otherwise it's located fresh (e.g. when the user picked
 *   the preset explicitly from the dropdown instead of via auto-detect).
 * @returns {{
 *   candidates: Array<{date:string, merchant:string, amount:number, accountId:string|null, source:string}>,
 *   skipped: Array<{rowNumber:number, reason:string, preview:string}>,
 *   dataRowCount: number
 * }}
 *   Every data row lands in exactly one of `candidates` or `skipped`, so the two
 *   always add back up to `dataRowCount`. A row that couldn't be read used to be
 *   dropped with a bare `continue` — the money on it then went missing from every
 *   total in the app, with no trace anywhere that a row had been left out at all.
 *   Reporting it is what lets the import screen and the dashboard say out loud
 *   that a file was only partly read.
 */
export function normalizeRows(rows, preset, source, headerRowIndex = findHeaderRowIndex(rows, preset.columns)) {
  if (headerRowIndex === -1) return { candidates: [], skipped: [], dataRowCount: 0 };
  const headerRow = rows[headerRowIndex] || [];
  const columnIndex = buildColumnIndexMap(headerRow, preset.columns);
  const dataRows = rows.slice(headerRowIndex + 1);

  const candidates = [];
  const skipped = [];
  dataRows.forEach((row, i) => {
    const rawCell = (key) => String(row[columnIndex[key]] ?? "").trim();
    const date = columnIndex.date != null ? normalizeDateToIso(row[columnIndex.date]) : null;
    const merchant = columnIndex.merchant != null ? rawCell("merchant") : "";
    const amount = columnIndex.amount != null ? parseAmount(row[columnIndex.amount]) : null;
    const accountId = columnIndex.account_id != null ? rawCell("account_id") || null : null;

    const problems = [];
    if (!date) problems.push(`תאריך לא קריא ("${rawCell("date")}")`);
    if (!merchant) problems.push("שם בית עסק חסר");
    if (amount == null) problems.push(`סכום לא קריא ("${rawCell("amount")}")`);

    if (problems.length > 0) {
      skipped.push({
        // +2: one for the header row itself, one for 1-based counting, so the
        // number matches the row gutter the user sees in Excel.
        rowNumber: headerRowIndex + i + 2,
        reason: problems.join(", "),
        preview: row
          .filter((cell) => String(cell).trim() !== "")
          .join(" | ")
          .slice(0, 120),
      });
      return;
    }
    candidates.push({ date, merchant, amount, accountId, source });
  });

  return { candidates, skipped, dataRowCount: dataRows.length };
}
