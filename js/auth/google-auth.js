// Wraps Google Identity Services (the official Google-maintained OAuth script,
// loaded from Google's own CDN in index.html) for the SPA token flow.
// The access token lives only in this module's memory — never in localStorage,
// sessionStorage, or a cookie — so it disappears on refresh/close by design.
import { GOOGLE_CLIENT_ID } from "../config/google-client-id.js";
import { DRIVE_SCOPE } from "../config/constants.js";

let accessToken = null;
let tokenClient = null;

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

/** Prompts the user to sign in (if needed) and resolves with a fresh access token. */
export function requestAccessToken() {
  return new Promise((resolve, reject) => {
    const client = getTokenClient();
    client.callback = (response) => {
      if (response.error) {
        reject(new Error(response.error));
        return;
      }
      accessToken = response.access_token;
      resolve(accessToken);
    };
    client.requestAccessToken();
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
}
