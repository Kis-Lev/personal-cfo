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

// Categorization
export const PENDING_CATEGORY_LABEL = "ממתין לסיווג ידני";

// Transactions in this category are treated as fixed monthly cost in the
// dashboard/simulator cash-flow math (folded into "fixed expense", not the
// WMA-projected "variable expense") — the user's own categorization stays
// untouched, only which bucket the calculation puts it in changes.
export const FIXED_TREATMENT_CATEGORY = "פיננסים, בריאות וביטוח";

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
