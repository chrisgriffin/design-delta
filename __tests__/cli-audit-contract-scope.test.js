/**
 * cli-audit-contract-scope.test.js — `design-delta audit --contract <id>`:
 * the report scoped to one contract's component. The flag filters the
 * finished lists and nothing upstream, so every case here compares the
 * scoped run against the unscoped run of the same project.
 *
 * Runs against the synthetic project, whose `badge` contract carries one
 * deliberate drift, whose `field` contract is clean, and whose tokens carry
 * one finding that belongs to no component.
 */

import { contractScope } from "../src/cli/commands/audit.mjs"
import { run } from "../src/cli/main.mjs"
import { createSyntheticProject } from "./helpers/synthetic-project.mjs"

function fakeStream() {
  const writes = []
  return { stream: { write: chunk => writes.push(chunk) }, writes }
}

async function audit(project, ...flags) {
  const { stream: stdout, writes: out } = fakeStream()
  const { stream: stderr, writes: err } = fakeStream()
  const originalCwd = process.cwd()
  process.chdir(project.root)
  try {
    const code = await run(
      ["audit", ...flags, "--config", project.configPath],
      { stdout, stderr },
    )
    return { code, stdout: out.join(""), stderr: err.join("") }
  } finally {
    process.chdir(originalCwd)
  }
}

let project
afterEach(() => project?.cleanup())

const belongsTo = id => finding =>
  finding.entity === id || finding.entity.startsWith(`${id}.`)

describe("design-delta audit --contract <id>", () => {
  it("--json holds exactly the findings the unscoped run reports for that contract", async () => {
    project = createSyntheticProject()
    const full = JSON.parse((await audit(project, "--json")).stdout)
    const scoped = JSON.parse(
      (await audit(project, "--json", "--contract", "badge")).stdout,
    )

    const expected = full.findings.filter(belongsTo("badge"))
    expect(expected.length).toBeGreaterThan(0)
    expect(full.findings.length).toBeGreaterThan(expected.length)
    expect(scoped.findings).toEqual(expected)
    expect(scoped.counts.findings).toBe(expected.length)
    expect(scoped.scope).toEqual({
      contract: "badge",
      findings: full.findings.length,
      exempted: 0,
    })
  })

  it("changes nothing the audit computes", async () => {
    project = createSyntheticProject()
    const full = JSON.parse((await audit(project, "--json")).stdout)
    const scoped = JSON.parse(
      (await audit(project, "--json", "--contract", "badge")).stdout,
    )

    const { findings: _f, exempted: _e, ...fullCensus } = full.counts
    const { findings: _sf, exempted: _se, ...scopedCensus } = scoped.counts
    expect(scopedCensus).toEqual(fullCensus)
    expect(scoped.diagnostics).toEqual(full.diagnostics)
    expect(scoped.skipped).toEqual(full.skipped)
    expect(full.scope).toBeUndefined()
  })

  it("a contract with no findings reports none, and says the project has more", async () => {
    project = createSyntheticProject()
    const { code, stdout } = await audit(
      project,
      "--json",
      "--check",
      "--contract",
      "field",
    )
    const scoped = JSON.parse(stdout)
    expect(scoped.findings).toEqual([])
    expect(scoped.scope.findings).toBeGreaterThan(0)
    // The project has an error-severity finding, on another component.
    expect(code).toBe(0)
  })

  it("--check exits 1 when the scoped list holds an error-severity finding", async () => {
    project = createSyntheticProject()
    const { code } = await audit(project, "--check", "--contract", "badge")
    expect(code).toBe(1)
  })

  it("scopes `decided` too, and keeps `counts.exempted` equal to its length", async () => {
    project = createSyntheticProject()
    const before = JSON.parse((await audit(project, "--json")).stdout)
    const token = before.findings.find(f => f.surface === "tokens")
    project.cleanup()
    project = createSyntheticProject({
      exemptions: {
        "components/enum-values-mismatch": ["badge"],
        [token.ruleId]: [token.entity],
      },
    })

    const scoped = JSON.parse(
      (await audit(project, "--json", "--contract", "badge")).stdout,
    )
    expect(scoped.decided.map(f => f.entity)).toEqual(["badge"])
    expect(scoped.counts.exempted).toBe(1)
    expect(scoped.scope.exempted).toBe(2)
  })

  it("matches the id, its elements and the files its sources name, and nothing else", () => {
    const inScope = contractScope({
      id: "card",
      contract: {
        sources: {
          code: { path: "ui/card/card.tsx", styles: "ui/card/card.css" },
        },
      },
    })
    const matched = entity => inScope({ entity })
    expect(matched("card")).toBe(true)
    expect(matched("card.root")).toBe(true)
    expect(matched("ui/card/card.tsx")).toBe(true)
    expect(matched("ui/card/card.css")).toBe(true)
    expect(matched("card-header")).toBe(false)
    expect(matched("card-header.title")).toBe(false)
    expect(matched("ui/card/other.tsx")).toBe(false)
    expect(inScope({})).toBe(false)
  })

  it("human output shows only that contract's findings and both counts", async () => {
    project = createSyntheticProject()
    const full = JSON.parse((await audit(project, "--json")).stdout)
    const { stdout } = await audit(project, "--contract", "badge")
    expect(stdout).toContain("components/enum-values-mismatch")
    expect(stdout).not.toContain("tokens/")
    expect(stdout).toContain(
      `scoped to contract "badge": 1 of ${full.findings.length} finding(s), 0 of 0 exempted`,
    )
  })

  it("an id that is not a loaded contract exits 1, names the loaded ids and writes no report", async () => {
    project = createSyntheticProject()
    const { code, stdout, stderr } = await audit(
      project,
      "--json",
      "--contract",
      "bagde",
    )
    expect(code).toBe(1)
    expect(stdout).toBe("")
    expect(stderr).toContain('no contract with id "bagde"')
    expect(stderr).toContain("badge, field")
  })

  it("a run whose surfaces load no contracts refuses the flag", async () => {
    project = createSyntheticProject()
    const { code, stdout, stderr } = await audit(
      project,
      "--tokens",
      "--contract",
      "badge",
    )
    expect(code).toBe(1)
    expect(stdout).toBe("")
    expect(stderr).toContain("--contract")
    expect(stderr).toContain("--tokens")
  })

  it("--contract without a value is a flag error", async () => {
    project = createSyntheticProject()
    const { code, stderr } = await audit(project, "--contract")
    expect(code).toBe(1)
    expect(stderr).toContain("--contract")
  })
})
