/**
 * token-folding.mjs — `tokenMapping.aliasFoldingRules`, applied (#569).
 *
 * A design tool and code often spell the same token differently:
 * `color/blue-vivid/50` in the design file is `color.vividBlue.50` in code.
 * A project states that convention once as ordered fold rules, grouped by the
 * design name's top-level segment. The first rule in the group whose `when`
 * matches renders its `template`; the result is `<group>.<rendered>`.
 *
 * `when` is `{index, equals}` or `{index, endsWith}` — `index` counts the
 * segments AFTER the group. Template placeholders:
 *
 *   {n}    segment n as written
 *   {n+}   segment n and every one after it, dot-joined
 *   {n^}   segment n camel-cased, first letter upper   (blue → Blue)
 *   {n^~}  as {n^}, after stripping the `endsWith` suffix the rule matched
 *          (blue-vivid under endsWith "-vivid" → Blue)
 *   {nc}   segment n camel-cased, first letter lower   (out-cubic → outCubic)
 *
 * An out-of-range segment renders "". A structurally invalid rule is skipped,
 * never thrown — the config schema is the loud gate for a typo.
 *
 * PURE: no fs, no config loading.
 */

function whenMatches(when, rest) {
  if (!when || !Number.isInteger(when.index) || when.index < 0) return false
  const segment = rest[when.index]
  if (typeof segment !== "string") return false
  if (typeof when.equals === "string") return segment === when.equals
  if (typeof when.endsWith === "string") return segment.endsWith(when.endsWith)
  return false
}

function upperCamel(segment) {
  const camel = segment.replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase())
  return camel.charAt(0).toUpperCase() + camel.slice(1)
}

function render(template, rest, when) {
  return template.replace(/\{(\d+)(\+|\^~|\^|c)?\}/g, (_, n, modifier) => {
    const index = Number(n)
    const segment = rest[index] ?? ""
    if (modifier === "+") return rest.slice(index).join(".")
    if (modifier === "^") return upperCamel(segment)
    if (modifier === "^~") {
      const suffix =
        when.index === index && typeof when.endsWith === "string"
          ? when.endsWith
          : ""
      return upperCamel(
        suffix && segment.endsWith(suffix)
          ? segment.slice(0, -suffix.length)
          : segment,
      )
    }
    if (modifier === "c") {
      const camel = upperCamel(segment)
      return camel.charAt(0).toLowerCase() + camel.slice(1)
    }
    return segment
  })
}

/**
 * Fold a design variable name into a dotted code token path.
 *
 * @param {string} name design variable name, `/`-separated
 * @param {{groups?: Record<string, object[]>}} [rules] `tokenMapping.aliasFoldingRules`
 * @returns {string|null} `<group>.<rendered>`, or `null` when no rule matches
 */
export function foldDesignName(name, rules) {
  const [group, ...rest] = String(name).split("/")
  const groupRules = rules?.groups?.[group]
  if (!Array.isArray(groupRules)) return null
  for (const rule of groupRules) {
    if (!rule || typeof rule.template !== "string") continue
    if (whenMatches(rule.when, rest))
      return `${group}.${render(rule.template, rest, rule.when)}`
  }
  return null
}
