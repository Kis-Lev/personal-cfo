// Shared normalization core: both csv-parser.js and xlsx-parser.js only need to
// produce a raw string[][] grid; everything about matching a bank preset's
// column headers and turning rows into transaction candidates lives here once,
// so CSV and XLSX never duplicate this logic between them.
import { normalizeDateToIso } from "../utils/dates.js";
import { parseAmount } from "../utils/currency.js";

function buildColumnIndexMap(headerRow, presetColumns) {
  const normalizedHeaders = headerRow.map((h) => String(h).trim());
  const indexMap = {};
  for (const [key, def] of Object.entries(presetColumns)) {
    const idx = normalizedHeaders.findIndex((h) => h === def.header);
    indexMap[key] = idx === -1 ? null : idx;
  }
  return indexMap;
}

/**
 * @param {string[][]} rows   raw grid, as produced by parseCsv() or parseXlsx()
 * @param {object} preset     one entry from data/bank-presets.json
 * @param {string} source     e.g. "credit_card_export", used as parsed_transactions.source
 * @returns {Array<{date:string, merchant:string, amount:number, accountId:string|null, source:string}>}
 */
export function normalizeRows(rows, preset, source) {
  const headerRow = rows[preset.header_row_index] || [];
  const columnIndex = buildColumnIndexMap(headerRow, preset.columns);
  const dataRows = rows.slice(preset.header_row_index + 1);

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
