/**
 * scripts/ci/check-ruleset.mjs compares the pinned required-check record
 * (scripts/ci/required-checks.mjs) against the live branch rulesets (#607).
 * The network call is the script's thin wrapper; these tests drive the pure
 * comparison with plain data, so they need no token and no network.
 */
import { diffRulesets, requiredContexts } from "../scripts/ci/check-ruleset.mjs"

const BOTH = {
  id: 1,
  name: "Require CI + Evaluator to pass",
  contexts: ["checks / ci", "test_22 / ci", "Evaluator"],
}
const MAIN = {
  id: 2,
  name: "Require CI to pass (main)",
  contexts: ["checks / ci", "test_22 / ci"],
}
const PINNED = ["checks / ci", "test_22 / ci", "Evaluator"]

describe("diffRulesets", () => {
  it("agrees when every required context is pinned and every pinned one required — a subset ruleset is not a disagreement", () => {
    expect(diffRulesets(PINNED, [BOTH, MAIN])).toEqual([])
  })

  it("names a required context the pin lacks, and the ruleset it came from", () => {
    const live = { ...BOTH, contexts: [...BOTH.contexts, "lint / ci"] }
    expect(diffRulesets(PINNED, [live, MAIN])).toEqual([
      { context: "lint / ci", direction: "unpinned", rulesets: [live] },
    ])
  })

  it("names one unpinned context once, with every ruleset that requires it", () => {
    const a = { ...BOTH, contexts: [...BOTH.contexts, "lint / ci"] }
    const b = { ...MAIN, contexts: [...MAIN.contexts, "lint / ci"] }
    expect(diffRulesets(PINNED, [a, b])).toEqual([
      { context: "lint / ci", direction: "unpinned", rulesets: [a, b] },
    ])
  })

  it("names a pinned context no ruleset requires any more", () => {
    expect(diffRulesets(PINNED, [MAIN])).toEqual([
      { context: "Evaluator", direction: "stale", rulesets: [MAIN] },
    ])
  })

  it("reports both directions at once", () => {
    const live = { ...MAIN, contexts: ["checks / ci", "test_24 / ci"] }
    expect(diffRulesets(PINNED, [live])).toEqual([
      { context: "test_24 / ci", direction: "unpinned", rulesets: [live] },
      { context: "test_22 / ci", direction: "stale", rulesets: [live] },
      { context: "Evaluator", direction: "stale", rulesets: [live] },
    ])
  })
})

describe("requiredContexts", () => {
  it("reads the contexts off a ruleset's required_status_checks rules", () => {
    expect(
      requiredContexts({
        rules: [
          { type: "deletion" },
          {
            type: "required_status_checks",
            parameters: {
              required_status_checks: [
                { context: "checks / ci" },
                { context: "Evaluator", integration_id: 15368 },
              ],
            },
          },
        ],
      }),
    ).toEqual(["checks / ci", "Evaluator"])
  })

  it("returns nothing for a ruleset with no required-checks rule", () => {
    expect(requiredContexts({ rules: [{ type: "deletion" }] })).toEqual([])
    expect(requiredContexts({})).toEqual([])
  })
})
