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
 *
 *   A skip carries a `kind`, because the two kinds deserve very different
 *   attention. A row with none of the three fields readable is the statement's
 *   own furniture — a "סך הכל" line, a legal-terms paragraph — and flagging
 *   those in red on every import trains the reader to ignore the warning that
 *   matters. A row where SOME field read but another did not is the one that
 *   might be a real transaction whose money is now missing.
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
      // What separates a row that might be a lost transaction from the
      // statement's own furniture is whether anything IDENTIFIES it — a date or
      // a merchant. An amount on its own does not: every one of these exports
      // ends with its own total line ("סה\"כ לחיוב החודש בכרטיס בש\"ח | 2776.73"),
      // which carries a perfectly readable amount and nothing else, and
      // flagging that as missing money would put a red warning on every
      // correctly-read file there is.
      const identified = date != null || merchant !== "";
      skipped.push({
        kind: identified ? "unread" : "not_a_transaction",
        // +2: one for the header row itself, one for 1-based counting, so the
        // number matches the row gutter the user sees in Excel.
        rowNumber: headerRowIndex + i + 2,
        reason: problems.join(", "),
        amount,
        hasDate: date != null,
        preview: row
          .filter((cell) => String(cell).trim() !== "")
          .join(" | ")
          .slice(0, 120),
      });
      return;
    }
    candidates.push({ date, merchant, amount, accountId, source });
  });

  const statementTotal = findStatementTotalRow(skipped, candidates);
  return { candidates, skipped, dataRowCount: dataRows.length, statementTotal };
}

// Close enough to equal for money that has been through a rounding or two.
const RECONCILIATION_TOLERANCE = 0.005;

/**
 * Finds the statement's own total line among the rows that couldn't be read as
 * transactions, by arithmetic rather than by wording: a dateless row whose
 * amount equals the sum of everything read from this sheet IS that sum. Two
 * things follow from recognizing it. It stops being a false alarm — it is the
 * statement's summary, not a transaction whose money went missing. And it
 * becomes a free reconciliation check against the issuer's own figure, which
 * is a stronger statement about the import than any total the app computes
 * from its own reading.
 *
 * A total that does NOT match is left as a loud mismatch rather than quietly
 * reclassified: that is the case where rows really are missing.
 */
function findStatementTotalRow(skipped, candidates) {
  if (candidates.length === 0) return null;
  const readTotal = candidates.reduce((sum, candidate) => sum + candidate.amount, 0);

  for (const row of skipped) {
    // A transaction always carries a date; a summary line never does. So only a
    // dateless row with a readable amount can be the total — which is also the
    // shape that would otherwise be flagged as money we failed to read.
    if (row.amount == null || row.hasDate) continue;
    if (Math.abs(row.amount - readTotal) > RECONCILIATION_TOLERANCE) continue;
    row.kind = "statement_total";
    return { rowNumber: row.rowNumber, stated: row.amount, read: readTotal, matches: true };
  }
  return null;
}
