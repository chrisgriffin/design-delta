/**
 * core-piles.test.js — `core/piles.mjs`, the one home of "who can clear this
 * finding" (issue #62). The resolve skill and `decide` both read it.
 */

import { PILES, PILE_RULES, pileOf } from "../src/core/piles.mjs"
import { buildFullRuleRegistry } from "../src/cli/rule-registry.mjs"

const finding = (ruleId, over = {}) => ({
  ruleId,
  severity: "warn",
  surface: ruleId.split("/")[0],
  side: "code",
  ...over,
})

describe("pileOf", () => {
  it("names only rules the engine registers, and only real piles", () => {
    const ids = new Set(buildFullRuleRegistry().ids())
    for (const [ruleId, pile] of Object.entries(PILE_RULES)) {
      expect(ids.has(ruleId)).toBe(true)
      expect(PILES).toContain(pile)
    }
  })

  it("lets a named rule win over its side", () => {
    // Each of these is side: "spec" in the engine, and none is a contract question.
    expect(pileOf(finding("coverage/design-missing", { side: "spec" }))).toBe(
      "design",
    )
    expect(pileOf(finding("coverage/stale-exemption", { side: "spec" }))).toBe(
      "tokens-config",
    )
    // side: "code", and no code change is the right fix for it.
    expect(
      pileOf(finding("tokens/token-unreferenced", { severity: "review" })),
    ).toBe("tokens-config")
    expect(
      pileOf(finding("tokens/var-unresolved", { severity: "error" })),
    ).toBe("code")
  })

  it("puts code-side error and warn findings on the code surfaces in the code pile", () => {
    for (const surface of ["components", "styles", "anatomy"])
      for (const severity of ["error", "warn"])
        expect(
          pileOf(finding(`${surface}/some-rule`, { surface, severity })),
        ).toBe("code")
  })

  it("never guesses code for a rule it does not name", () => {
    expect(
      pileOf(finding("components/some-rule", { severity: "review" })),
    ).toBe("review")
    expect(pileOf(finding("tokens/some-rule", { surface: "tokens" }))).toBe(
      "review",
    )
    expect(pileOf(finding("components/some-rule", { side: "both" }))).toBe(
      "review",
    )
  })

  it("sorts unnamed rules by family and side", () => {
    expect(pileOf(finding("lint/anything", { side: "spec" }))).toBe(
      "tokens-config",
    )
    expect(pileOf(finding("tokens/design-anything"))).toBe("design")
    expect(pileOf(finding("components/prop-missing", { side: "design" }))).toBe(
      "design",
    )
    expect(pileOf(finding("components/prop-missing", { side: "spec" }))).toBe(
      "contract",
    )
  })

  it("routes the lint rules that read a contract or the design file to that owner", () => {
    for (const ruleId of [
      "lint/contract-name-case",
      "lint/contract-enum-invalid",
    ])
      expect(pileOf(finding(ruleId, { surface: "lint", side: "spec" }))).toBe(
        "contract",
      )
    expect(
      pileOf(
        finding("lint/design-name-invalid", {
          surface: "lint",
          side: "design",
        }),
      ),
    ).toBe("design")
    expect(pileOf(finding("lint/token-rule", { surface: "lint" }))).toBe(
      "tokens-config",
    )
  })

  it("sends a code-side finding on a component whose contract is invalid to the contract pile", () => {
    const invalidContracts = {
      ids: ["badge"],
      files: ["specs/Badge.spec.json"],
    }
    const code = over =>
      finding("components/prop-missing", { severity: "error", ...over })
    for (const entity of ["badge", "badge.root", "specs/Badge.spec.json"])
      expect(pileOf(code({ entity }), { invalidContracts })).toBe("contract")
    // Another component, or a rule that was never code's, is unchanged.
    expect(pileOf(code({ entity: "badger" }), { invalidContracts })).toBe(
      "code",
    )
    expect(pileOf(code({ entity: "field" }), { invalidContracts })).toBe("code")
    expect(
      pileOf(finding("components/prop-type-unresolved", { entity: "badge" }), {
        invalidContracts,
      }),
    ).toBe("review")
  })

  it("places every registered rule in exactly one pile", () => {
    for (const ruleId of buildFullRuleRegistry().ids())
      expect(PILES).toContain(pileOf(finding(ruleId)))
  })
})
