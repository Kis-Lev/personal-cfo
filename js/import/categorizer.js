// Zero-AI categorization: a transaction is only auto-categorized when it matches
// a rule the user explicitly defined (or a rule auto-created from a previous
// manual classification of the same merchant) — never guessed. PRD section 3.3.
import { PENDING_CATEGORY_LABEL } from "../config/constants.js";

function ruleMatches(rule, merchant) {
  if (rule.match_type === "REGEX") {
    try {
      return new RegExp(rule.pattern, "i").test(merchant);
    } catch {
      return false; // an invalid regex the user typed should never crash import
    }
  }
  return merchant.toLowerCase().includes(rule.pattern.toLowerCase());
}

/** Returns {category, sub_category} for the first matching rule, or the pending label. */
export function categorizeTransaction(transaction, rules) {
  const match = rules.find((rule) => ruleMatches(rule, transaction.merchant));
  if (!match) {
    return { category: PENDING_CATEGORY_LABEL, sub_category: PENDING_CATEGORY_LABEL };
  }
  return { category: match.category, sub_category: match.sub_category };
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
