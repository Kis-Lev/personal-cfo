// Loads the standard category taxonomy from data/taxonomy.json (PRD section 5)
// so categories/subcategories/tooltips are configuration, never hardcoded in JS.
import { loadJsonOnce } from "./load-json-once.js";

export function loadTaxonomy() {
  return loadJsonOnce(new URL("../../data/taxonomy.json", import.meta.url));
}
