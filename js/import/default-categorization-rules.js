// Loads the built-in keyword categorization rules (data/default-categorization-rules.json)
// — user-dictated keyword-to-category defaults, not AI/guessing: the mapping
// itself came from the user, this just loads it the same way bank-presets.js
// and taxonomy.js load their own configuration files.
import { loadJsonOnce } from "../utils/load-json-once.js";

export function loadDefaultCategorizationRules() {
  return loadJsonOnce(new URL("../../data/default-categorization-rules.json", import.meta.url));
}
