// Central place for every numeric/config constant used by the engine and storage layers.
// Nothing here should be duplicated or re-hardcoded elsewhere in the codebase.

export const DEFAULT_CURRENCY = "ILS";

// Google Drive
export const DRIVE_FOLDER_NAME = "MyCFO_Data";
export const DRIVE_IMPORTS_FOLDER_NAME = "imports";
export const DB_FILE_NAME = "db.json";
export const CONFIG_FILE_NAME = "config.json";
export const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
export const DRIVE_API_BASE = "https://www.googleapis.com/drive/v3";
export const DRIVE_UPLOAD_API_BASE = "https://www.googleapis.com/upload/drive/v3";
// A silent (no-popup) re-auth attempt that goes unanswered (e.g. an invisible
// popup blocked by the browser) never rejects on its own — cap how long we wait
// before falling back to the interactive "Sign in" button.
export const SILENT_LOGIN_TIMEOUT_MS = 4000;
// Records only THAT this browser once completed the Google consent flow —
// never a token, and nothing about the account. Used to decide whether a
// silent re-auth is worth attempting at all.
export const PRIOR_CONSENT_STORAGE_KEY = "cfo_app_prior_google_consent";

// Monthly periods (see engine/periods.js)
// Spending is grouped by the credit-card billing cycle rather than the calendar
// month: a cycle runs from this day of one month to the same day of the next,
// and the day itself opens the new cycle. Income keeps the calendar month.
export const EXPENSE_CYCLE_START_DAY = 10;

// A bare number in a date column is an Excel date serial, but it is also what a
// row counter or a total line looks like. Serials outside this range are not
// dates in any statement — accepting them turned a trailing "60" into
// 1900-02-28 and would file a real charge under a nonsense month.
export const MIN_PLAUSIBLE_DATE_ISO = "2000-01-01";
export const MAX_PLAUSIBLE_DATE_ISO = "2100-01-01";

/**
 * The kinds of recurring monthly rule.
 *
 * INVESTMENT is deliberately not an EXPENSE. A standing order into a brokerage
 * account leaves the current account, so it is not money available to spend —
 * but it is still the user's money, and net worth does not change the moment it
 * moves. Filed as an expense it would collapse the savings rate on paper, make
 * the goal look unreachable, and enter the category averages and the spending
 * forecast as if it were consumption.
 */
export const FIXED_RULE_TYPE = Object.freeze({
  INCOME: "INCOME",
  EXPENSE: "EXPENSE",
  INVESTMENT: "INVESTMENT",
});

export const FIXED_RULE_TYPE_LABELS = Object.freeze({
  INCOME: "הכנסה",
  EXPENSE: "הוצאה",
  INVESTMENT: "הפניה להשקעה",
});

// Categorization
export const PENDING_CATEGORY_LABEL = "ממתין לסיווג ידני";

// Transactions in these categories are treated as fixed monthly cost in the
// dashboard/simulator cash-flow math (folded into "fixed expense", not the
// WMA-projected "variable expense") — the user's own categorization stays
// untouched, only which bucket the calculation puts it in changes. A monthly
// subscription qualifies for the same reason an insurance premium does: it is
// charged whether or not anything was used that month.
export const FIXED_TREATMENT_CATEGORIES = Object.freeze([
  "פיננסים, בריאות וביטוח",
  "מנויים ושירותים דיגיטליים",
]);

// Forecasting engine (WMA / outliers / volatility) — PRD section 4.1
export const WMA_WINDOW_MONTHS = 6;
// Z-score beyond this is treated as Non-Recurring and excluded from the regular forecast.
export const Z_SCORE_OUTLIER_THRESHOLD = 2.5;
// Safety-margin coefficient applied on top of std-dev when volatility is high.
export const VOLATILITY_BUFFER_MULTIPLIER = 1.0;

// Loan amortization types supported (PRD section 4.2)
export const AMORTIZATION_TYPE = Object.freeze({
  SPITZER: "SPITZER",
});

// Compounding frequencies supported for deposits (PRD section 2.2)
export const COMPOUNDING_FREQUENCY = Object.freeze({
  ANNUAL: 1,
  SEMI_ANNUAL: 2,
  QUARTERLY: 4,
  MONTHLY: 12,
});

// Feasibility gap analysis track status (PRD section 4.3)
export const TRACK_STATUS = Object.freeze({
  GREEN: "GREEN",
  RED: "RED",
});

// Spending analysis (engine/savings-opportunities.js)
// A period counts as a one-off for a category when it dwarfs that category's
// other periods AND the excess is worth naming — both are needed, or a month
// of ₪60 against a median of ₪20 reads as an extraordinary event.
export const ONE_OFF_MEDIAN_MULTIPLE = 2.5;
export const ONE_OFF_MIN_EXCESS = 500;
// A rise is only worth putting in front of the user when it is both a real
// proportion of the category and a real amount of money.
export const SPENDING_RISE_MIN_PERCENT = 15;
export const SPENDING_RISE_MIN_AMOUNT = 150;
