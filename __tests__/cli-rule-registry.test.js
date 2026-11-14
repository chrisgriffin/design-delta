/**
 * cli-rule-registry.test.js — `src/cli/rule-registry.mjs` (issue #188).
 *
 * `buildFullRuleRegistry` is a hand-written union of every module's `RULES`
 * array — the same class of list `scripts/generate-rules-reference.mjs`
 * builds from `src/index.mjs`'s exports, kept honest by
 * `rules-reference.test.js`. This union can't reuse that one (a `cli/` file
 * importing `index.mjs` fails the layering guard), so it needs its OWN
 * completeness guard, cross-checked against `index.mjs`'s exports — which a
 * TEST file may import freely (only `src/` files are layered).
 *
 * THE EXPECTED SET IS FOUND BY SHAPE, never by a second hand-written import
 * list (Evaluator review on this PR, correctly rejecting the first version):
 * a literal list here mirrors the literal list `rule-registry.mjs` itself
 * imports, so a 7th module forgotten from BOTH would leave every assertion
 * below green while the real registry silently missed a whole surface —
 * exactly the "asking the generator what it renders and confirming it
 * rendered that" trap `rules-reference.test.js`'s own docblock names, one
 * file over. `ruleArraysOf` is that file's exact mechanism, shared through
 * `helpers/rule-arrays.mjs` (#12) — `Object.values(index)` is scanned for anything shaped like an array of
 * rule descriptors, so a new module's rules are found without either file
 * being told about it.
 */

import { buildFullRuleRegistry } from "../src/cli/rule-registry.mjs"
import {
  validateRuleIds,
  validateExemptionRuleIds,
} from "../src/core/rules.mjs"
import * as index from "../src/index.mjs"
import { ruleArraysOf } from "./helpers/rule-arrays.mjs"

const rulesFromIndex = ruleArraysOf(index).flat()

describe("buildFullRuleRegistry", () => {
  it("finds rules to check (negative control)", () => {
    // Vacuous otherwise — see rules-reference.test.js's identical reasoning,
    // the file this pattern is copied from.
    expect(rulesFromIndex.length).toBeGreaterThan(0)
  })

  it("contains every rule id the package's own public surface exports", () => {
    const registry = buildFullRuleRegistry()
    for (const rule of rulesFromIndex) {
      expect(registry.get(rule.id)).toBeDefined()
    }
  })

  it("contains no id beyond what the package's own public surface exports", () => {
    // The reverse direction — a registry with an EXTRA id nobody publishes
    // would validate configs against rules the engine cannot actually run.
    const registry = buildFullRuleRegistry()
    const fromIndex = new Set(rulesFromIndex.map(r => r.id))
    for (const id of registry.ids()) {
      expect(fromIndex.has(id)).toBe(true)
    }
  })

  it("resolves a real rule id from each surface", () => {
    const registry = buildFullRuleRegistry()
    expect(registry.get("tokens/var-unresolved")).toBeDefined()
    expect(registry.get("components/prop-missing")).toBeDefined()
    expect(registry.get("styles/binding-missing")).toBeDefined()
    expect(registry.get("anatomy/node-missing")).toBeDefined()
    expect(registry.get("lint/token-rule")).toBeDefined()
    expect(registry.get("coverage/stale-exemption")).toBeDefined()
  })

  it("works with validateRuleIds and validateExemptionRuleIds end to end", () => {
    const registry = buildFullRuleRegistry()
    expect(
      validateRuleIds({ "tokens/token-unreferenced": "off" }, registry),
    ).toEqual([])
    expect(
      validateRuleIds({ "tokens/token-unreferened": "off" }, registry),
    ).toHaveLength(1)
    expect(
      validateExemptionRuleIds(
        { "coverage/uncontracted-component": ["components/flex"] },
        registry,
      ),
    ).toEqual([])
    expect(
      validateExemptionRuleIds(
        { "coverage/uncontracted-componant": ["components/flex"] },
        registry,
      ),
    ).toHaveLength(1)
  })

  // Negative control for the shape-scan itself, mirroring
  // rules-reference.test.js's own — a scanner that matched everything (or
  // nothing) would make the completeness assertions above pass vacuously.
  it("the shape scan rejects a non-descriptor array and accepts a real registry", () => {
    expect(ruleArraysOf({ notRules: ["tokens", "components"] })).toEqual([])
    expect(
      ruleArraysOf({
        partial: [{ id: "a/b", surface: "tokens", defaultSeverity: "warn" }],
      }),
    ).toEqual([])
    expect(ruleArraysOf({ rules: index.tokensRules })).toEqual([
      index.tokensRules,
    ])
  })
})
