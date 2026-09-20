import { MIN_PLAUSIBLE_DATE_ISO, MAX_PLAUSIBLE_DATE_ISO } from "../config/constants.js";

// Single date-normalization function shared by every import path.
// Accepts the common formats seen in exported bank/credit-card files and
// always returns an ISO "YYYY-MM-DD" string (or null if unparseable).
export function normalizeDateToIso(rawValue) {
  const value = String(rawValue).trim();
  if (value === "") return null;

  const isoMatch = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;

  const dmySlash = value.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/);
  if (dmySlash) {
    let [, day, month, year] = dmySlash;
    if (year.length === 2) year = `20${year}`;
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }

  // Excel stores dates as a plain serial number of days since 1899-12-30
  // (day 0) when the "date" formatting is just a cell style, not real text.
  // A bare number in the date column is not always a date, though: statements
  // end with rows like ["60", "", "", "7393.0"] where the number is a counter
  // or a total, and read as a serial that becomes 1900-02-28. Only a serial
  // that lands in a range a statement could plausibly cover is treated as a
  // date; anything else is left unparseable, so the row is reported instead of
  // being filed under a nonsense month.
  const excelSerial = value.match(/^\d+(\.\d+)?$/);
  if (excelSerial) {
    const EXCEL_EPOCH_OFFSET_DAYS = 25569; // days between 1899-12-30 and 1970-01-01
    const MS_PER_DAY = 86400 * 1000;
    const date = new Date((parseFloat(value) - EXCEL_EPOCH_OFFSET_DAYS) * MS_PER_DAY);
    if (Number.isNaN(date.getTime())) return null;
    const iso = date.toISOString().slice(0, 10);
    return iso >= MIN_PLAUSIBLE_DATE_ISO && iso < MAX_PLAUSIBLE_DATE_ISO ? iso : null;
  }

  return null;
}

export function yearsBetween(startIso, endIso) {
  const msPerYear = 365.25 * 24 * 60 * 60 * 1000;
  return (new Date(endIso) - new Date(startIso)) / msPerYear;
}
