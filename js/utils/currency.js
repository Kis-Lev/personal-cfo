// Single amount-parsing/formatting pair shared across the app.
export function parseAmount(rawValue) {
  const cleaned = String(rawValue).replace(/[^\d.\-]/g, "");
  const value = parseFloat(cleaned);
  return Number.isFinite(value) ? value : null;
}

export function formatCurrency(amount, currency = "ILS") {
  return new Intl.NumberFormat("he-IL", { style: "currency", currency }).format(amount);
}
