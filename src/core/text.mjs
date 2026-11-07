/**
 * text.mjs — text formatting utilities for messages and findings.
 *
 * This module is `core/`: it imports nothing and touches no fs/network.
 */

/**
 * Format a list of items with proper conjunction handling for natural reading.
 * - 1 item: "a"
 * - 2 items: "a and b" (or "a or b" etc. with custom conjunction)
 * - 3+ items: "a, b and c" (with commas separating all but last, conjunction before last)
 *
 * @param {string[]} items the items to join
 * @param {string} [conjunction="and"] the word to use before the final item
 * @returns {string} the formatted list
 */
export function formatList(items, conjunction = "and") {
  if (items.length === 0) return ""
  if (items.length === 1) return items[0]
  if (items.length === 2) return `${items[0]} ${conjunction} ${items[1]}`
  return `${items.slice(0, -1).join(", ")} ${conjunction} ${items.at(-1)}`
}

/**
 * PascalCase/camelCase → kebab-case (`SampleButton` → `sample-button`).
 * A dash is inserted only before an uppercase letter that follows a
 * lowercase letter or digit, so a run of consecutive capitals (an acronym
 * like `APIButton`) is not segmented — the result stays a valid kebab-case
 * string either way, just not perfectly word-split for that edge case.
 *
 * @param {string} name
 * @returns {string}
 */
export function kebabCase(name) {
  return name.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase()
}

/** Plain code-unit string order — a deterministic sort comparator. */
export function compareStrings(a, b) {
  return a < b ? -1 : a > b ? 1 : 0
}
