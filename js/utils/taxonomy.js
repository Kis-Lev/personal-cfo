// Loads the standard category taxonomy from data/taxonomy.json (PRD section 5)
// so categories/subcategories/tooltips are configuration, never hardcoded in JS.
let cachedTaxonomy = null;

export async function loadTaxonomy() {
  if (!cachedTaxonomy) {
    const response = await fetch(new URL("../../data/taxonomy.json", import.meta.url));
    cachedTaxonomy = await response.json();
  }
  return cachedTaxonomy;
}
