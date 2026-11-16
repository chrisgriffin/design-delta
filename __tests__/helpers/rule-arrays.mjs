/**
 * rule-arrays.mjs — find every rule registry in a module namespace by SHAPE
 * (#12). `rules-reference.test.js`, `cli-rule-registry.test.js` and
 * `adr-citations.test.js` all need "every rule the package exports", and a
 * registry exported under a new name must reach all three, so none of them
 * picks registries by export name.
 */

/** A rule descriptor as `core/rules.mjs` validates it. */
export function isRuleDescriptor(value) {
  return (
    value != null &&
    typeof value === "object" &&
    typeof value.id === "string" &&
    typeof value.surface === "string" &&
    typeof value.defaultSeverity === "string" &&
    typeof value.description === "string"
  )
}

/** Every exported array of rule descriptors in a module namespace. */
export function ruleArraysOf(namespace) {
  return Object.values(namespace).filter(
    value =>
      Array.isArray(value) && value.length > 0 && value.every(isRuleDescriptor),
  )
}
