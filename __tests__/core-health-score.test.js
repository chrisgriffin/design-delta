/**
 * core-health-score.test.js — `core/health-score.mjs`'s `computeHealthScore`
 * (issue #219).
 *
 * Pure function, no fixture project needed: findings + counts in, a score
 * out. These pin the three behaviors the issue's "Done means" checklist names
 * explicitly (clean = 100, proportional findings score lower, size never
 * changes the score on its own), plus the boundary rules the formula depends
 * on to make those three hold at all.
 */

import {
  HEALTH_SCORE_MAX,
  PILLAR_MAX,
  computeHealthScore,
} from "../src/core/health-score.mjs"

function finding(ruleId, severity = "warn") {
  return {
    ruleId,
    severity,
    surface: ruleId.split("/")[0],
    side: "code",
    entity: "x",
    message: "x",
  }
}

const CENSUS = {
  tokens: 100,
  components: 40,
  styleFiles: 20,
  styleDeclarations: 200,
  anatomyComponents: 40,
}

describe("computeHealthScore", () => {
  it("PILLAR_MAX sums to 100 — the score's own contract", () => {
    expect(Object.values(PILLAR_MAX).reduce((a, b) => a + b, 0)).toBe(
      HEALTH_SCORE_MAX,
    )
    expect(HEALTH_SCORE_MAX).toBe(100)
  })

  it("a clean project (no findings) scores 100, every pillar at its max", () => {
    const { total, pillars } = computeHealthScore({
      findings: [],
      counts: CENSUS,
    })
    expect(total).toBe(100)
    expect(pillars).toEqual({
      valueDiscipline: 60,
      tokenHealth: 20,
      consistency: 10,
      criticalIssues: 10,
    })
  })

  it("a project with no census at all (every denominator 0) also scores 100", () => {
    // Nothing censused is "nothing to grade", not "everything is wrong" — see
    // the module docblock. A brand-new project with no surfaces wired up yet
    // must not be graded down for that.
    const { total } = computeHealthScore({ findings: [], counts: {} })
    expect(total).toBe(100)
  })

  it("findings in each pillar score it lower, proportionally to their density", () => {
    // 20 of the 200 censused style declarations are raw-value findings — a
    // 10% density, so Value Discipline should land at 90% of its 60 points.
    const findings = Array.from({ length: 20 }, () =>
      finding("styles/raw-value"),
    )
    const { pillars } = computeHealthScore({ findings, counts: CENSUS })
    expect(pillars.valueDiscipline).toBe(54) // 60 * (1 - 20/200)
  })

  it("counts token-unemitted under Token Health, like token-unreferenced (#562)", () => {
    const findings = Array.from({ length: 10 }, () =>
      finding("tokens/token-unemitted"),
    )
    const { pillars } = computeHealthScore({ findings, counts: CENSUS })
    expect(pillars.tokenHealth).toBe(18) // 20 * (1 - 10/100)
  })

  it("scores each pillar independently from its own findings and denominator", () => {
    const findings = [
      ...Array.from({ length: 10 }, () => finding("styles/raw-value")), // 10/200
      ...Array.from({ length: 10 }, () => finding("tokens/token-unreferenced")), // 10/100
      ...Array.from({ length: 1 }, () => finding("lint/vocabulary-invalid")), // 1/100
      ...Array.from({ length: 1 }, () =>
        finding("components/enum-values-mismatch", "error"),
      ),
    ]
    const { total, pillars } = computeHealthScore({ findings, counts: CENSUS })
    expect(pillars.valueDiscipline).toBe(57) // 60 * (1 - 10/200)
    expect(pillars.tokenHealth).toBe(18) // 20 * (1 - 10/100)
    expect(pillars.consistency).toBe(10) // 10 * (1 - 1/100), rounds back to 10
    // criticalIssues: 1 error / (40+100+20+40)=200 surface area
    expect(pillars.criticalIssues).toBe(10) // rounds to 10 at this density
    expect(total).toBe(
      pillars.valueDiscipline +
        pillars.tokenHealth +
        pillars.consistency +
        pillars.criticalIssues,
    )
  })

  it("density normalization: doubling the project at the same finding density scores the same", () => {
    const small = {
      findings: Array.from({ length: 10 }, () => finding("styles/raw-value")),
      counts: { ...CENSUS, styleDeclarations: 100 },
    }
    const large = {
      // Same 10% density, twice the census AND twice the findings.
      findings: Array.from({ length: 20 }, () => finding("styles/raw-value")),
      counts: {
        tokens: 200,
        components: 80,
        styleFiles: 40,
        styleDeclarations: 200,
        anatomyComponents: 80,
      },
    }
    expect(computeHealthScore(small)).toEqual(computeHealthScore(large))
  })

  it("clamps a pillar at 0 rather than going negative when findings exceed the census", () => {
    // Pathological input (more matching findings than the denominator) must
    // never produce a negative sub-score.
    const findings = Array.from({ length: 500 }, () =>
      finding("tokens/token-untracked"),
    )
    const { pillars } = computeHealthScore({
      findings,
      counts: { ...CENSUS, tokens: 10 },
    })
    expect(pillars.tokenHealth).toBe(0)
  })

  it("only counts a finding toward a pillar whose exact rule ids it names", () => {
    // `styles/binding-missing` is a real styles-surface finding, but it is
    // NOT `styles/raw-value` — Value
    // Discipline must stay untouched by it (its error severity still counts
    // toward Critical Issues, which is a different assertion).
    const findings = [finding("styles/binding-missing", "error")]
    const { pillars } = computeHealthScore({ findings, counts: CENSUS })
    expect(pillars.valueDiscipline).toBe(60)
  })
})
