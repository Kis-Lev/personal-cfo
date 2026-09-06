// Loads column-mapping presets from data/bank-presets.json so provider layouts
// are configuration, never hardcoded inside the parsing logic.
let cachedPresets = null;

export async function loadBankPresets() {
  if (!cachedPresets) {
    const response = await fetch(new URL("../../data/bank-presets.json", import.meta.url));
    cachedPresets = await response.json();
  }
  return cachedPresets;
}

export async function getBankPresetById(id) {
  const presets = await loadBankPresets();
  return presets.find((preset) => preset.id === id) || null;
}
