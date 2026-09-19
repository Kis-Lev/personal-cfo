// Zero-AI categorization: a transaction is only auto-categorized when it matches
// a rule the user explicitly defined (or a rule auto-created from a previous
// manual classification of the same merchant) — never guessed. PRD section 3.3.
import { PENDING_CATEGORY_LABEL } from "../config/constants.js";

/**
 * Exported so the rules screen can count which transactions a rule affects
 * using the very same test the import applies, rather than a second
 * implementation that could disagree with it.
 */
export function ruleMatches(rule, merchant) {
  if (rule.match_type === "REGEX") {
    try {
      return new RegExp(rule.pattern, "i").test(merchant);
    } catch {
      return false; // an invalid regex the user typed should never crash import
    }
  }
  return merchant.toLowerCase().includes(rule.pattern.toLowerCase());
}

/**
 * Returns {category, sub_category, needsConfirmation} for the first matching
 * rule, or the pending label if nothing matches. A rule with
 * confidence: "suggested" (the built-in keyword defaults, which can
 * mismatch on unrelated merchant names) is never applied silently — it's
 * returned with needsConfirmation: true so the caller still asks the user
 * to confirm before treating it as a real classification. The user's own
 * learned rules (from a previous manual classification) have no such flag
 * and are trusted directly.
 */
export function categorizeTransaction(transaction, rules) {
  const match = rules.find((rule) => ruleMatches(rule, transaction.merchant));
  if (!match) {
    return { category: PENDING_CATEGORY_LABEL, sub_category: PENDING_CATEGORY_LABEL, needsConfirmation: false };
  }
  const needsConfirmation = match.confidence === "suggested";
  return {
    category: match.category,
    sub_category: match.sub_category,
    needsConfirmation,
    // Only set when needsConfirmation is true: the keyword/regex pattern that produced
    // this suggestion, so a confirmation can promote that SAME pattern to a trusted rule
    // (see createRuleFromConfirmation) instead of one tied to this one row's exact merchant
    // text — real bank exports often append a per-row reference number/branch code to an
    // otherwise-repeating merchant name, so a full-text rule would never fire again.
    matchedRule: needsConfirmation ? { match_type: match.match_type, pattern: match.pattern } : null,
  };
}

/** Called when the user manually assigns a category — teaches the engine for next time. */
export function createRuleFromManualAssignment(merchant, category, subCategory) {
  return {
    rule_id: `rule_${crypto.randomUUID()}`,
    match_type: "CONTAINS",
    pattern: merchant,
    category,
    sub_category: subCategory,
  };
}

/**
 * Single place that decides how a confirmed classification becomes a trusted,
 * reusable rule. When the row being confirmed was a pre-filled suggestion from
 * a built-in keyword/regex rule, that same pattern is promoted directly — so
 * confirming it once trusts the pattern itself, and every future transaction
 * it matches (any merchant-text variant) is categorized with zero further
 * confirmation. Otherwise (no underlying pattern — a genuinely unrecognized
 * merchant the user classified from scratch) falls back to a rule tied to
 * this exact merchant text, as before.
 */
export function createRuleFromConfirmation(transaction, category, subCategory) {
  if (transaction.matchedRule) {
    return {
      rule_id: `rule_${crypto.randomUUID()}`,
      match_type: transaction.matchedRule.match_type,
      pattern: transaction.matchedRule.pattern,
      category,
      sub_category: subCategory,
    };
  }
  return createRuleFromManualAssignment(transaction.merchant, category, subCategory);
}
