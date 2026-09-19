// Loads column-mapping presets from data/bank-presets.json so provider layouts
// are configuration, never hardcoded inside the parsing logic.
import { loadJsonOnce } from "../utils/load-json-once.js";

export function loadBankPresets() {
  return loadJsonOnce(new URL("../../data/bank-presets.json", import.meta.url));
}

export async function getBankPresetById(id) {
  const presets = await loadBankPresets();
  return presets.find((preset) => preset.id === id) || null;
}
