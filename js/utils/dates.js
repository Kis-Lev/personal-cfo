// Single date-normalization function shared by every import path.
// Accepts the common formats seen in exported bank/credit-card files and
// always returns an ISO "YYYY-MM-DD" string (or null if unparseable).
export function normalizeDateToIso(rawValue) {
  const value = String(rawValue).trim();
  if (value === "") return null;

  const isoMatch = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;

  const dmySlash = value.match(/^(\d{1,2})[/.](\d{1,2})[/.](\d{2,4})$/);
  if (dmySlash) {
    let [, day, month, year] = dmySlash;
    if (year.length === 2) year = `20${year}`;
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }

  return null;
}

export function yearsBetween(startIso, endIso) {
  const msPerYear = 365.25 * 24 * 60 * 60 * 1000;
  return (new Date(endIso) - new Date(startIso)) / msPerYear;
}
