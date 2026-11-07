/**
 * cli-verify.test.js — `design-delta verify`, the composed CI gate (#105).
 *
 * The behavior worth pinning is not "does it run" but WHAT IT FAILS ON, since
 * that is the entire contract a consuming project's pipeline depends on:
 * error-severity findings and invalid contracts fail; warn, review, and
 * diagnostics do not.
 */

import { runVerify } from "../src/cli/commands/verify.mjs"
import { createSyntheticProject } from "./helpers/synthetic-project.mjs"

function capture() {
  const out = []
  const err = []
  return {
    io: {
      stdout: { write: c => (out.push(c), true) },
      stderr: { write: c => (err.push(c), true) },
    },
    stdout: () => out.join(""),
    stderr: () => err.join(""),
  }
}

async function verifyIn(project, argv = []) {
  const cap = capture()
  const cwd = process.cwd()
  process.chdir(project.root)
  try {
    const code = await runVerify(argv, {
      io: cap.io,
      globalOpts: { config: project.configPath },
      bus: null,
    })
    return { code, stdout: cap.stdout(), stderr: cap.stderr() }
  } finally {
    process.chdir(cwd)
  }
}

describe("design-delta verify", () => {
  let project
  afterEach(() => {
    project?.cleanup()
    project = null
  })

  it("fails on an error-severity finding and names it", async () => {
    // The synthetic project carries one deliberate drift: badge's `size` enum
    // is missing a value the contract declares.
    project = createSyntheticProject()
    const { code, stdout } = await verifyIn(project)
    expect(code).toBe(1)
    expect(stdout).toContain("verify FAILED")
    expect(stdout).toContain("components/enum-values-mismatch")
  })

  it("does NOT fail on warn or review findings", async () => {
    // "reported, not gating" is the whole reason those severities exist —
    // if they gated, a consumer would turn the gate off entirely.
    project = createSyntheticProject()
    const { stdout } = await verifyIn(project)
    expect(stdout).toMatch(/reported, not gating/)
  })

  it("passes once the only error-severity finding is resolved", async () => {
    // Same project with the drift removed via a config rule override — proves
    // the gate tracks findings rather than always failing.
    project = createSyntheticProject({
      rules: { "components/enum-values-mismatch": "off" },
    })
    const { code, stdout } = await verifyIn(project)
    expect(code).toBe(0)
    expect(stdout).toContain("verify passed")
  })

  it("emits one JSON document with --json", async () => {
    project = createSyntheticProject()
    const { stdout } = await verifyIn(project, ["--json"])
    const parsed = JSON.parse(stdout)
    expect(parsed.ok).toBe(false)
    expect(parsed.contracts.ok).toBe(true)
    expect(parsed.findings.counts.error).toBeGreaterThan(0)
  })

  it("rejects an unknown flag rather than running", async () => {
    project = createSyntheticProject()
    const { code, stderr } = await verifyIn(project, ["--nope"])
    expect(code).toBe(1)
    expect(stderr).toContain("Unknown argument")
  })

  // issue #227: `--fail-on <severity>` gates on that severity or worse;
  // omitting the flag preserves the pre-#227 error-only default.
  it("--fail-on warn fails on a warn-severity finding, not just error", async () => {
    // Downgrade the same drift the other tests use from error to warn, so
    // the only gating-eligible finding left is warn-severity.
    project = createSyntheticProject({
      rules: { "components/enum-values-mismatch": "warn" },
    })
    const errorRun = await verifyIn(project)
    expect(errorRun.code).toBe(0)

    const warnRun = await verifyIn(project, ["--fail-on", "warn"])
    expect(warnRun.code).toBe(1)
    expect(warnRun.stdout).toContain("verify FAILED")
    expect(warnRun.stdout).toContain("components/enum-values-mismatch")
  })

  it("--fail-on review fails on a review-severity finding", async () => {
    // Same shape as the warn test above: downgrade the drift to review so a
    // review-severity finding is the ONLY gating-eligible one left. Asserting
    // the default run passes first is what proves `--fail-on review` is doing
    // the gating, rather than the error-severity default the fixture ships
    // with failing the run either way.
    project = createSyntheticProject({
      rules: { "components/enum-values-mismatch": "review" },
    })
    const errorRun = await verifyIn(project)
    expect(errorRun.code).toBe(0)

    const reviewRun = await verifyIn(project, ["--fail-on", "review"])
    expect(reviewRun.code).toBe(1)
    expect(reviewRun.stdout).toContain("verify FAILED")
    expect(reviewRun.stdout).toContain("components/enum-values-mismatch")
  })

  it("--fail-on none never fails on findings, only on an invalid contract", async () => {
    project = createSyntheticProject()
    const { code, stdout } = await verifyIn(project, ["--fail-on", "none"])
    expect(code).toBe(0)
    expect(stdout).toContain("verify passed")
  })

  it("omitting --fail-on keeps the default error-only gate", async () => {
    project = createSyntheticProject()
    const { code, stdout } = await verifyIn(project, ["--json"])
    const parsed = JSON.parse(stdout)
    expect(code).toBe(1)
    expect(parsed.failOn).toBe("error")
  })

  it("rejects an unrecognized --fail-on value", async () => {
    project = createSyntheticProject()
    const { code, stderr } = await verifyIn(project, ["--fail-on", "critical"])
    expect(code).toBe(1)
    expect(stderr).toContain('invalid --fail-on "critical"')
  })

  // issue #188: `verify` composes `audit` internally (see the module
  // docblock) rather than re-running the checks itself, so it inherits
  // audit's rule-id validation for free — this pins that the inheritance
  // actually holds, not just that the underlying function exists.
  it("fails on a typo'd rule id, the same as audit does", async () => {
    project = createSyntheticProject({
      rules: { "components/enum-values-mismach": "off" },
    })
    const { code, stdout, stderr } = await verifyIn(project)
    expect(code).toBe(1)
    expect(stdout).not.toContain("verify passed")
    expect(stderr).toMatch(
      /unknown rule id 'components\/enum-values-mismach' in rules/,
    )
  })

  // issue #219: `--fail-below` is a SEPARATE gate from `--fail-on`, composing
  // rather than replacing it — both are always computed, and either can fail
  // the run on its own.
  describe("--fail-below (health score gate, issue #219)", () => {
    it("--json always carries healthScore and healthScorePillars, even with no --fail-below", async () => {
      project = createSyntheticProject({
        rules: { "components/enum-values-mismatch": "off" },
      })
      const { stdout } = await verifyIn(project, ["--json"])
      const parsed = JSON.parse(stdout)
      expect(parsed.failBelow).toBeNull()
      expect(typeof parsed.healthScore).toBe("number")
      expect(parsed.healthScore).toBeGreaterThanOrEqual(0)
      expect(parsed.healthScore).toBeLessThanOrEqual(100)
      expect(parsed.healthScorePillars).toEqual({
        valueDiscipline: expect.any(Number),
        tokenHealth: expect.any(Number),
        consistency: expect.any(Number),
        criticalIssues: expect.any(Number),
      })
      // pillars always sum to the total — the two can never print disagreeing
      // numbers (see `core/health-score.mjs`'s own docblock).
      const sum = Object.values(parsed.healthScorePillars).reduce(
        (a, b) => a + b,
        0,
      )
      expect(sum).toBe(parsed.healthScore)
    })

    it("--fail-below fails the run on the score alone, independent of --fail-on", async () => {
      // The synthetic project's own remaining drift (its default rules,
      // `components/enum-values-mismatch` disabled so ONLY the score gate is
      // in play) is not perfectly clean, so its score is under 100 — read it
      // once via --json, then prove a threshold one point above it fails and
      // the score itself does not, without hardcoding the fixture's number.
      project = createSyntheticProject({
        rules: { "components/enum-values-mismatch": "off" },
      })
      const clean = await verifyIn(project, ["--fail-on", "none"])
      expect(clean.code).toBe(0)

      const { healthScore } = JSON.parse(
        (await verifyIn(project, ["--fail-on", "none", "--json"])).stdout,
      )
      expect(healthScore).toBeLessThan(100)

      const failing = await verifyIn(project, [
        "--fail-on",
        "none",
        "--fail-below",
        String(healthScore + 1),
      ])
      expect(failing.code).toBe(1)
      expect(failing.stdout).toContain("verify FAILED")
      expect(failing.stdout).toMatch(
        new RegExp(
          `health score ${healthScore} below --fail-below ${healthScore + 1}`,
        ),
      )

      const passing = await verifyIn(project, [
        "--fail-on",
        "none",
        "--fail-below",
        String(healthScore),
      ])
      expect(passing.code).toBe(0)
      expect(passing.stdout).toContain("verify passed")
    })

    it("--fail-below 0 never fails the score gate", async () => {
      project = createSyntheticProject()
      const { stdout } = await verifyIn(project, [
        "--fail-on",
        "none",
        "--fail-below",
        "0",
      ])
      expect(stdout).toMatch(/health score \d+ meets --fail-below 0/)
    })

    it("rejects a non-integer --fail-below value", async () => {
      project = createSyntheticProject()
      const { code, stderr } = await verifyIn(project, [
        "--fail-below",
        "not-a-number",
      ])
      expect(code).toBe(1)
      expect(stderr).toContain('invalid --fail-below "not-a-number"')
    })

    it("rejects a --fail-below value outside 0-100", async () => {
      project = createSyntheticProject()
      const { code, stderr } = await verifyIn(project, ["--fail-below", "150"])
      expect(code).toBe(1)
      expect(stderr).toContain('invalid --fail-below "150"')
    })
  })

  it('treats --config "" as a named-but-missing config, not the default', async () => {
    const cap = capture()
    const code = await runVerify([], {
      io: cap.io,
      globalOpts: { config: "" },
      bus: null,
    })
    expect(code).toBe(1)
    expect(cap.stderr()).toContain("design-delta verify: no config at ")
  })
})
