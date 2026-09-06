// Wires a category <select> to a dependent sub-category <select> from the
// taxonomy — shared by import-hub.js's quick-classify cards and
// fixed-manager.js's "add fixed rule" form so this logic exists exactly once.
export function wireCategoryCascade(categorySelect, subCategorySelect, taxonomy) {
  categorySelect.innerHTML = taxonomy.map((c) => `<option value="${c.category}">${c.icon} ${c.category}</option>`).join("");

  const fillSubCategories = () => {
    const cat = taxonomy.find((c) => c.category === categorySelect.value);
    subCategorySelect.innerHTML = (cat?.sub_categories || []).map((s) => `<option value="${s}">${s}</option>`).join("");
  };

  fillSubCategories();
  categorySelect.addEventListener("change", fillSubCategories);
}
