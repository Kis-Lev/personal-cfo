// Single escaping function used everywhere untrusted text (imported merchant
// names, user-typed titles/names, error messages) is inserted via innerHTML —
// so there is exactly one place responsible for preventing HTML/script injection.
export function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
