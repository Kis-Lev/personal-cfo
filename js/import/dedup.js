// Single hashing function used by every import path (Drag & Drop, Drive-linked file)
// so there is exactly one definition of what makes two transactions "the same".
// Hash = SHA256(date + merchant + amount + account/card id) — PRD section 3.2.

async function sha256Hex(text) {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function computeTransactionHash({ date, merchant, amount, accountId }) {
  return sha256Hex(`${date}|${merchant}|${amount}|${accountId ?? ""}`);
}

/** Filters out transactions whose hash already exists in the current database. */
export async function filterNewTransactions(candidates, existingTransactions) {
  const existingIds = new Set(existingTransactions.map((tx) => tx.tx_id));
  const results = [];
  for (const candidate of candidates) {
    const hash = await computeTransactionHash(candidate);
    if (!existingIds.has(hash)) {
      results.push({ ...candidate, tx_id: hash });
    }
  }
  return results;
}
