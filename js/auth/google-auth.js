// Wraps Google Identity Services (the official Google-maintained OAuth script,
// loaded from Google's own CDN in index.html) for the SPA token flow.
// The access token lives only in this module's memory — never in localStorage,
// sessionStorage, or a cookie — so it disappears on refresh/close by design.
import { GOOGLE_CLIENT_ID } from "../config/google-client-id.js";
import { DRIVE_SCOPE, PRIOR_CONSENT_STORAGE_KEY } from "../config/constants.js";

let accessToken = null;
let tokenClient = null;

/**
 * Whether this browser has ever completed the consent flow. A silent re-auth
 * opens a Google popup, and Google leaves that popup sitting on the sign-in
 * page when there's no session to reuse — the window belongs to the Identity
 * Services script, so nothing here can close it again. Asking first means a
 * browser that has never consented (where the attempt is certain to fail)
 * never opens one at all.
 */
export function hasPriorConsent() {
  // Reading storage throws outright when the browser is set to block site
  // data; treat that as "no record" rather than failing to start.
  try {
    return localStorage.getItem(PRIOR_CONSENT_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function rememberConsent() {
  try {
    localStorage.setItem(PRIOR_CONSENT_STORAGE_KEY, "1");
  } catch {
    // Storage unavailable only costs a click on the next visit.
  }
}

function getTokenClient() {
  if (!tokenClient) {
    if (!window.google?.accounts?.oauth2) {
      throw new Error("Google Identity Services script not loaded (check index.html).");
    }
    tokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: DRIVE_SCOPE,
      callback: () => {}, // overridden per-call in requestAccessToken()
    });
  }
  return tokenClient;
}

/**
 * Requests a fresh access token. With { silent: true }, asks Google to reuse
 * the browser's existing Google session with no popup/click — this fails fast
 * (rejects) if there's no active Google session or consent was never granted,
 * so callers should fall back to an interactive requestAccessToken() call.
 */
export function requestAccessToken({ silent = false } = {}) {
  return new Promise((resolve, reject) => {
    const client = getTokenClient();
    client.callback = (response) => {
      if (response.error) {
        reject(new Error(response.error));
        return;
      }
      accessToken = response.access_token;
      rememberConsent();
      resolve(accessToken);
    };
    // A popup that can't open, or that the user dismisses, reports itself here
    // and nowhere else — without this the promise simply never settles and the
    // caller is left waiting out its timeout.
    client.error_callback = (error) => reject(new Error(error?.type || "popup_failed"));
    client.requestAccessToken(silent ? { prompt: "none" } : {});
  });
}

export function getAccessToken() {
  return accessToken;
}

export function signOut() {
  if (accessToken && window.google?.accounts?.oauth2) {
    window.google.accounts.oauth2.revoke(accessToken, () => {});
  }
  accessToken = null;
  // Consent was just revoked, so the next silent attempt would be guaranteed
  // to fail and strand a popup.
  try {
    localStorage.removeItem(PRIOR_CONSENT_STORAGE_KEY);
  } catch {
    // Nothing was stored in the first place.
  }
}
