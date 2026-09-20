// Normalizes and defends against a db.json that may have been hand-edited by the
// user in Drive — every load goes through here exactly once before entering the store.
import { DEFAULT_CURRENCY } from "../config/constants.js";

export function emptyDatabase() {
  return {
    user_profile: {
      currency: DEFAULT_CURRENCY,
      created_at: new Date().toISOString().slice(0, 10),
    },
    goals: [],
    capital_adjustments_log: [],
    financial_instruments: {
      deposits: [],
      loans: [],
      // A share portfolio: what was put in, and what it was last seen to be
      // worth. Never a rate — see engine/investments.js.
      investments: [],
    },
    fixed_rules: [],
    parsed_transactions: [],
    // Not part of the original PRD sample schema: required to back the Rules
    // Engine categorization approach (user-defined merchant match rules).
    categorization_rules: [],
    // User-defined column mappings for import file formats that don't match
    // any built-in preset — every bank/card issuer exports differently, so
    // these are taught once (via the manual mapping screen) and reused.
    import_presets: [],
    // One record per uploaded file: how many data rows it held and what became
    // of each of them. Kept so the dashboard can always answer "is this total
    // the whole file?" — without it, a row the parser couldn't read left no
    // trace anywhere once the import screen was closed.
    import_log: [],
    // Categories the user has marked as off-limits for the savings suggestions.
    // The app ranks where there is room to spend less, but it has no way to know
    // which spending is worth having — so anything marked here is never
    // suggested, whatever the arithmetic says.
    protected_categories: [],
  };
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

/** Fills in any missing top-level sections and coerces array fields, without touching valid data. */
export function validateAndNormalize(rawData) {
  const fallback = emptyDatabase();
  const data = rawData && typeof rawData === "object" ? rawData : {};

  return {
    user_profile: { ...fallback.user_profile, ...(data.user_profile || {}) },
    goals: asArray(data.goals),
    capital_adjustments_log: asArray(data.capital_adjustments_log),
    financial_instruments: {
      deposits: asArray(data.financial_instruments?.deposits),
      loans: asArray(data.financial_instruments?.loans),
      investments: asArray(data.financial_instruments?.investments),
    },
    fixed_rules: asArray(data.fixed_rules),
    parsed_transactions: asArray(data.parsed_transactions),
    categorization_rules: asArray(data.categorization_rules),
    import_presets: asArray(data.import_presets),
    import_log: asArray(data.import_log),
    protected_categories: asArray(data.protected_categories),
  };
}
