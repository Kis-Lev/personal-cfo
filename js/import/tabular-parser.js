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

function findHeaderRowIndex(rows, presetColumns) {
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
 * @returns {Array<{date:string, merchant:string, amount:number, accountId:string|null, source:string}>}
 */
export function normalizeRows(rows, preset, source, headerRowIndex = findHeaderRowIndex(rows, preset.columns)) {
  if (headerRowIndex === -1) return [];
  const headerRow = rows[headerRowIndex] || [];
  const columnIndex = buildColumnIndexMap(headerRow, preset.columns);
  const dataRows = rows.slice(headerRowIndex + 1);

  const candidates = [];
  for (const row of dataRows) {
    const date = columnIndex.date != null ? normalizeDateToIso(row[columnIndex.date]) : null;
    const merchant = columnIndex.merchant != null ? String(row[columnIndex.merchant] ?? "").trim() : "";
    const amount = columnIndex.amount != null ? parseAmount(row[columnIndex.amount]) : null;
    const accountId = columnIndex.account_id != null ? String(row[columnIndex.account_id] ?? "").trim() || null : null;

    if (!date || !merchant || amount == null) continue; // incomplete row, skip rather than guess
    candidates.push({ date, merchant, amount, accountId, source });
  }
  return candidates;
}
