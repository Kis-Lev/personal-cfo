// Loads the built-in keyword categorization rules (data/default-categorization-rules.json)
// — user-dictated keyword-to-category defaults, not AI/guessing: the mapping
// itself came from the user, this just loads it the same way bank-presets.js
// and taxonomy.js load their own configuration files.
let cachedRules = null;

export async function loadDefaultCategorizationRules() {
  if (!cachedRules) {
    const response = await fetch(new URL("../../data/default-categorization-rules.json", import.meta.url));
    cachedRules = await response.json();
  }
  return cachedRules;
}
