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

/**
 * Filters out transactions already in the database, and any that repeat within
 * this same batch — a single file legitimately yields the same transaction
 * twice when two of its tabs overlap (e.g. a "current cycle" tab and a
 * "transactions for billing date" tab covering the same days), and those share
 * a hash, so keeping both would put two rows with an identical tx_id in the
 * store.
 */
export async function filterNewTransactions(candidates, existingTransactions) {
  const seenIds = new Set(existingTransactions.map((tx) => tx.tx_id));
  // Hashing is an async crypto call, so awaiting one per candidate in a loop
  // serializes the whole batch; they don't depend on each other.
  const hashes = await Promise.all(candidates.map(computeTransactionHash));

  const results = [];
  candidates.forEach((candidate, i) => {
    const hash = hashes[i];
    if (seenIds.has(hash)) return;
    seenIds.add(hash);
    results.push({ ...candidate, tx_id: hash });
  });
  return results;
}
