import { getState, setState } from "../state/store.js";
import { persistState } from "../storage/persist.js";
import { renderEditableTable } from "./components/editable-table.js";
import { ruleMatches } from "../import/categorizer.js";
import { escapeHtml } from "../utils/escape-html.js";

const MATCH_TYPE_LABELS = { CONTAINS: "מכיל את הטקסט", REGEX: "ביטוי רגולרי" };

// A rule is created on every manual classification and every confirmation, so
// classifying the same merchant twice leaves two rules that do the same thing.
// Only the first one can ever fire, and the duplicates are pure noise in this
// list — worth pointing at, since deleting one of a pair changes nothing.
function duplicateKey(rule) {
  return `${rule.match_type}␟${rule.pattern}`;
}

function buildRows(state) {
  const seen = new Map();
  for (const rule of state.categorization_rules) {
    const key = duplicateKey(rule);
    seen.set(key, (seen.get(key) || 0) + 1);
  }

  return state.categorization_rules
    .map((rule, originalIndex) => ({
      ...rule,
      originalIndex,
      matchCount: state.parsed_transactions.filter((tx) => ruleMatches(rule, tx.merchant)).length,
      isDuplicated: seen.get(duplicateKey(rule)) > 1,
    }))
    .sort((a, b) => a.pattern.localeCompare(b.pattern));
}

export function renderRulesManager(container) {
  const state = getState();
  const rows = buildRows(state);

  container.innerHTML = `
    <div class="card">
      <h2>כללי סיווג שלמדתי (${rows.length})</h2>
      <p>כל פעם שאת מסווגת בית עסק ידנית, או מאשרת הצעת סיווג, נשמר כאן כלל כדי שלא תישאלי על אותו בית עסק שוב. הכללים האלה <strong>גוברים</strong> על ברירות המחדל המובנות של האפליקציה.</p>
      <p class="track-red">שימי לב: הכללים פועלים בזמן הייבוא בלבד. מחיקת כלל לא משנה תנועות שכבר יובאו וסווגו — היא משפיעה רק על ייבוא הבא.</p>
      <div id="rules-table"></div>
    </div>
  `;

  renderEditableTable(container.querySelector("#rules-table"), {
    title: "",
    emptyMessage: "עדיין לא למדתי אף כלל. כללים נוצרים כשמסווגים בית עסק ידנית.",
    columns: [
      {
        key: "pattern",
        label: "טקסט לזיהוי",
        format: (value, row) =>
          `${escapeHtml(value)}${row.isDuplicated ? ' <span class="track-red" title="קיים יותר מכלל אחד זהה — רק הראשון פועל">(כפול)</span>' : ""}`,
      },
      { key: "match_type", label: "סוג התאמה", format: (value) => MATCH_TYPE_LABELS[value] || value },
      { key: "category", label: "מסווג לקטגוריה" },
      { key: "sub_category", label: "תת-קטגוריה" },
      {
        key: "matchCount",
        label: "תנועות תואמות",
        format: (value) => (value === 0 ? '<span style="color:var(--muted)">0</span>' : String(value)),
      },
    ],
    rows,
    onDelete: (rowIndex) => {
      const rule = rows[rowIndex];
      if (!confirm(`למחוק את הכלל "${rule.pattern}" (${rule.category} / ${rule.sub_category})?\n\nתנועות שכבר סווגו לא ישתנו.`)) return;
      setState((s) => ({
        ...s,
        categorization_rules: s.categorization_rules.filter((_, i) => i !== rule.originalIndex),
      }));
      persistState();
      renderRulesManager(container);
    },
  });
}
