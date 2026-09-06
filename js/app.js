import { requestAccessToken, signOut } from "./auth/google-auth.js";
import { ensureAppFolders, readDb } from "./storage/drive-client.js";
import { setDriveContext } from "./storage/drive-context.js";
import { validateAndNormalize, emptyDatabase } from "./storage/schema.js";
import { initStore } from "./state/store.js";
import { renderDashboard } from "./ui/dashboard.js";
import { renderImportHub } from "./ui/import-hub.js";
import { renderFixedManager } from "./ui/fixed-manager.js";
import { renderSimulator } from "./ui/simulator.js";

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
  document.getElementById("login-btn").addEventListener("click", handleLogin);
}

async function handleLogin() {
  try {
    const accessToken = await requestAccessToken();
    const { rootFolderId, importsFolderId } = await ensureAppFolders(accessToken);
    setDriveContext({ rootFolderId, importsFolderId });

    const rawDb = await readDb(accessToken, rootFolderId);
    initStore(validateAndNormalize(rawDb || emptyDatabase()));

    mainNav.hidden = false;
    navigate(location.hash.replace("#", "") || "dashboard");
  } catch (err) {
    appRoot.innerHTML = `<div class="card"><p>שגיאת התחברות: ${err.message}</p></div>`;
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

renderLoginScreen();
