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
  // Safe to assume here because normalizeDateToIso is only ever called on a
  // column the user already identified as the date column.
  const excelSerial = value.match(/^\d+(\.\d+)?$/);
  if (excelSerial) {
    const EXCEL_EPOCH_OFFSET_DAYS = 25569; // days between 1899-12-30 and 1970-01-01
    const MS_PER_DAY = 86400 * 1000;
    const date = new Date((parseFloat(value) - EXCEL_EPOCH_OFFSET_DAYS) * MS_PER_DAY);
    return date.toISOString().slice(0, 10);
  }

  return null;
}

export function yearsBetween(startIso, endIso) {
  const msPerYear = 365.25 * 24 * 60 * 60 * 1000;
  return (new Date(endIso) - new Date(startIso)) / msPerYear;
}
