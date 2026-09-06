import { requestAccessToken, signOut } from "./auth/google-auth.js";
import { ensureAppFolders, readDb } from "./storage/drive-client.js";
import { setDriveContext } from "./storage/drive-context.js";
import { validateAndNormalize, emptyDatabase } from "./storage/schema.js";
import { initStore } from "./state/store.js";
import { renderDashboard } from "./ui/dashboard.js";
import { renderImportHub } from "./ui/import-hub.js";
import { renderFixedManager } from "./ui/fixed-manager.js";
import { renderSimulator } from "./ui/simulator.js";
import { escapeHtml } from "./utils/escape-html.js";

const appRoot = document.getElementById("app-root");
const mainNav = document.getElementById("main-nav");

const routes = {
  dashboard: renderDashboard,
  import: renderImportHub,
  manager: renderFixedManager,
  simulator: renderSimulator,
};

function navigate(route) {
  location.hash = route;
  routes[route]?.(appRoot);
}

function renderLoginScreen() {
  appRoot.innerHTML = `
    <div class="card">
      <p>כדי להתחיל, התחברי עם חשבון Google כדי לגשת ל-Google Drive הפרטי שלך (תיקיית MyCFO_Data).</p>
      <button id="login-btn" class="primary">התחברות עם Google</button>
    </div>
  `;
  document.getElementById("login-btn").addEventListener("click", () => handleLogin({ silent: false }));
}

// Shared by both the silent auto-login attempt and the explicit "Sign in" click,
// so there is exactly one place that turns an access token into a loaded app.
async function completeLogin(accessToken) {
  const { rootFolderId, importsFolderId } = await ensureAppFolders(accessToken);
  setDriveContext({ rootFolderId, importsFolderId });

  const rawDb = await readDb(accessToken, rootFolderId);
  initStore(validateAndNormalize(rawDb || emptyDatabase()));

  mainNav.hidden = false;
  navigate(location.hash.replace("#", "") || "dashboard");
}

async function handleLogin({ silent }) {
  try {
    const accessToken = await requestAccessToken({ silent });
    await completeLogin(accessToken);
  } catch (err) {
    if (silent) {
      renderLoginScreen(); // no active Google session to reuse — ask the user to click
      return;
    }
    appRoot.innerHTML = `<div class="card"><p>שגיאת התחברות: ${escapeHtml(err.message)}</p></div>`;
    console.error(err);
  }
}

mainNav.querySelectorAll("button[data-route]").forEach((btn) => {
  btn.addEventListener("click", () => navigate(btn.dataset.route));
});

document.getElementById("sign-out-btn").addEventListener("click", () => {
  signOut();
  mainNav.hidden = true;
  renderLoginScreen();
});

handleLogin({ silent: true });
