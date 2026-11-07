/**
 * core-report-pr-comment.test.js — `renderFindingsPrComment`, the compact
 * markdown artifact sized for a single PR comment. Pins the size budget and
 * the truncation note, since a silently-dropped tail is the one failure mode
 * that reads as "clean" when it isn't.
 */

import {
  PR_COMMENT_MAX_LENGTH,
  renderFindingsPrComment,
} from "../src/core/report.mjs"
import { makeFinding } from "../src/core/findings.mjs"

function finding(overrides = {}) {
  return makeFinding({
    ruleId: "tokens/hardcoded-value",
    severity: "warn",
    surface: "tokens",
    side: "code",
    entity: "button/Button.tsx",
    message: "hardcoded value where a token was expected",
    ...overrides,
  })
}

describe("renderFindingsPrComment", () => {
  it("renders a summary line and no table when there are no findings", () => {
    const md = renderFindingsPrComment({ findings: [] })
    expect(md).toContain("## Design drift")
    expect(md).toContain("**0 finding(s)**")
    expect(md).not.toContain("| severity |")
  })

  it("renders one row per finding, worst-severity-first", () => {
    const findings = [
      finding({ severity: "review", entity: "b", ruleId: "z" }),
      finding({ severity: "error", entity: "a", ruleId: "y" }),
    ]
    const md = renderFindingsPrComment({ findings })
    const errorIndex = md.indexOf("| error |")
    const reviewIndex = md.indexOf("| review |")
    expect(errorIndex).toBeGreaterThan(-1)
    expect(reviewIndex).toBeGreaterThan(errorIndex)
  })

  it("stays under the default size budget on a large finding set", () => {
    const findings = Array.from({ length: 5000 }, (_, i) =>
      finding({
        entity: `component-${i}/File.tsx`,
        ruleId: `tokens/rule-${i}`,
        message: `finding number ${i} with a reasonably long message body`,
      }),
    )
    const md = renderFindingsPrComment({ findings })
    expect(md.length).toBeLessThanOrEqual(PR_COMMENT_MAX_LENGTH)
  })

  it("truncates with a stated count rather than silently dropping rows", () => {
    const findings = Array.from({ length: 5000 }, (_, i) =>
      finding({
        entity: `component-${i}/File.tsx`,
        ruleId: `tokens/rule-${i}`,
      }),
    )
    const md = renderFindingsPrComment({ findings })
    expect(md).toMatch(
      /_…\d+ more finding\(s\) not shown — see the full report\._/,
    )

    const shownRows = md
      .split("\n")
      .filter(
        line =>
          line.startsWith("| ") &&
          !line.startsWith("| severity") &&
          !line.startsWith("| ---"),
      )
    const match = md.match(/_…(\d+) more finding\(s\)/)
    const stated = Number(match[1])
    expect(shownRows.length + stated).toBe(findings.length)
  })

  it("honours a smaller explicit maxLength", () => {
    const findings = Array.from({ length: 50 }, (_, i) =>
      finding({
        entity: `component-${i}/File.tsx`,
        ruleId: `tokens/rule-${i}`,
      }),
    )
    const md = renderFindingsPrComment({ findings }, { maxLength: 800 })
    expect(md.length).toBeLessThanOrEqual(800)
    expect(md).toContain("more finding(s) not shown")
  })

  it("includes the generated timestamp only when passed", () => {
    const md = renderFindingsPrComment(
      { findings: [] },
      { generatedAt: "2026-08-12" },
    )
    expect(md).toContain("_Generated 2026-08-12_")
  })
})
