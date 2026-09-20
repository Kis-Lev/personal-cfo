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
 * Filters out transactions already in the database, and any that repeat across
 * the tabs of this same batch — a single file legitimately yields the same
 * transaction twice when two of its tabs overlap (e.g. a "current cycle" tab
 * and a "transactions for billing date" tab covering the same days).
 *
 * What it must NOT do is treat a repeat WITHIN one tab as a duplicate: two
 * coffees at the same café on the same day for the same price are two real
 * charges that hash identically, and collapsing them quietly deleted one of
 * them from every total. So the identity of a transaction is its hash plus
 * how many times that hash has already appeared in its own tab — the second
 * identical row of a tab is a different transaction from the first, while the
 * second tab's copies line up one-for-one with the first tab's and collapse
 * as before.
 *
 * Re-importing a file the user already imported is not a no-op and must not be
 * treated as one. The rows are the same transactions, but the app's reading of
 * them improves over time — a field the file is the authority on can be
 * computed better today than it was when those rows were first stored. So a
 * candidate that matches something already stored is returned as `known`
 * rather than silently dropped, and the caller refreshes the fields the file
 * owns while leaving everything the user owns alone.
 *
 * Only a repeat WITHIN this batch is a true duplicate to discard.
 *
 * @param {Array<{sheetIndex?: number}>} candidates rows from one uploaded file
 * @param {Array<{tx_id: string}>} existingTransactions everything already stored
 * @returns {{fresh: object[], known: object[], batchDuplicates: number}}
 */
export async function splitCandidatesAgainstStored(candidates, existingTransactions) {
  const storedIds = new Set(existingTransactions.map((tx) => tx.tx_id));
  // Hashing is an async crypto call, so awaiting one per candidate in a loop
  // serializes the whole batch; they don't depend on each other.
  const hashes = await Promise.all(candidates.map(computeTransactionHash));

  const occurrencesInSheet = new Map();
  const seenInBatch = new Set();
  const fresh = [];
  const known = [];
  let batchDuplicates = 0;

  candidates.forEach((candidate, i) => {
    const hash = hashes[i];
    const sheetKey = `${candidate.sheetIndex ?? 0}|${hash}`;
    const occurrence = (occurrencesInSheet.get(sheetKey) || 0) + 1;
    occurrencesInSheet.set(sheetKey, occurrence);

    // The first occurrence keeps the bare hash, so ids already stored from
    // earlier imports still match and a re-import lines up with them.
    const txId = occurrence === 1 ? hash : `${hash}#${occurrence}`;
    if (seenInBatch.has(txId)) {
      batchDuplicates++;
      return;
    }
    seenInBatch.add(txId);
    (storedIds.has(txId) ? known : fresh).push({ ...candidate, tx_id: txId });
  });

  return { fresh, known, batchDuplicates };
}
