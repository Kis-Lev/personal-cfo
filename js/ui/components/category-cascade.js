// Wires a category <select> to a dependent sub-category <select> from the
// taxonomy — shared by import-hub.js's quick-classify cards and
// fixed-manager.js's "add fixed rule" form so this logic exists exactly once.
import { escapeHtml } from "../../utils/escape-html.js";
// Names go through escapeHtml because a taxonomy entry may legitimately contain
// a quote — "חופשות וחו\"ל" does. Unescaped, that quote closes the value
// attribute early, so the option ends up carrying a truncated value that no
// stored sub-category can ever match, and selecting it silently saves "".
export function wireCategoryCascade(categorySelect, subCategorySelect, taxonomy) {
  categorySelect.innerHTML = taxonomy
    .map((c) => `<option value="${escapeHtml(c.category)}">${escapeHtml(c.icon)} ${escapeHtml(c.category)}</option>`)
    .join("");

  const fillSubCategories = () => {
    const cat = taxonomy.find((c) => c.category === categorySelect.value);
    subCategorySelect.innerHTML = (cat?.sub_categories || [])
      .map((s) => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`)
      .join("");
  };

  fillSubCategories();
  categorySelect.addEventListener("change", fillSubCategories);
}
