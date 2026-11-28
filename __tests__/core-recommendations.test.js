/**
 * core-recommendations.test.js — every decision offers answers that can clear
 * its rule and recommends one of them (issue #62).
 */

import {
  ANSWERS,
  RECOMMENDATION_TABLES,
  recommendationFor,
} from "../src/core/recommendations.mjs"
import { PILES } from "../src/core/piles.mjs"
import { buildFullRuleRegistry } from "../src/cli/rule-registry.mjs"

const registry = buildFullRuleRegistry()

describe("recommendationFor", () => {
  it("gives every registered rule, in every pile, a recommendation it offers", () => {
    for (const ruleId of registry.ids())
      for (const pile of PILES) {
        const rec = recommendationFor(ruleId, pile)
        expect(rec.options.length).toBeGreaterThan(0)
        for (const option of rec.options) expect(ANSWERS).toContain(option)
        expect(rec.options).toContain(rec.recommended)
        expect(rec.reason).toMatch(/\.$/)
      }
  })

  it("overrides only rules the engine registers", () => {
    const ids = new Set(registry.ids())
    for (const ruleId of Object.keys(RECOMMENDATION_TABLES.RULE_OVERRIDES))
      expect(ids.has(ruleId)).toBe(true)
  })

  it("is fixed data: the same rule always gets the same answer", () => {
    expect(
      recommendationFor("tokens/token-unreferenced", "tokens-config"),
    ).toEqual(recommendationFor("tokens/token-unreferenced", "tokens-config"))
    expect(
      recommendationFor("tokens/token-unreferenced", "tokens-config")
        .recommended,
    ).toBe("accept")
    expect(
      recommendationFor("coverage/stale-exemption", "tokens-config").options,
    ).toEqual(["remove-exemption"])
  })
})
