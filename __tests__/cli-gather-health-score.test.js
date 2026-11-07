/**
 * cli-gather-health-score.test.js — `src/cli/gather-health-score.mjs`
 * (issue #561), imported directly.
 *
 * This module is the one place the health score's two surfaces meet:
 * `audit`'s findings, which the caller has already parsed and hands in, and
 * `lint`'s, which only `lint` ever emits because `audit` does not run that
 * surface by design. `verify`, `report`, `map` and the MCP server all reach
 * `computeHealthScore` through here, and nothing imported it.
 *
 * The two sides are driven differently on purpose. The audit payload is a
 * literal because the function never runs `audit` — it is handed the result,
 * so a literal IS the real input shape. The lint side is a real inner
 * `runLint` over a synthetic project, because the composition is the whole
 * of what this module does; a literal there would test nothing.
 *
 * The case that matters most is the last one. An inner `lint` run producing
 * unparseable output is swallowed and read as "no lint findings" — a
 * documented leniency, on the grounds that config is already known-valid by
 * the time this runs. Swallowed, the Consistency pillar's zero denominator
 * awards FULL marks, so a regression there does not fail: it reports a
 * healthier project. That result is pinned here against a genuinely clean
 * lint surface to show the two are indistinguishable.
 */

import { runLint } from "../src/cli/commands/lint.mjs"
import { gatherHealthScore, sink } from "../src/cli/gather-health-score.mjs"
import { PILLAR_MAX } from "../src/core/health-score.mjs"
import { createProgress } from "../src/core/progress.mjs"
import { createSyntheticProject } from "./helpers/synthetic-project.mjs"

// Governs `acme.color` with `fg`/`bg` only, so the fixture's third default
// token `acme.color.danger` is one real `lint/vocabulary-invalid` finding —
// the same shape `cli-lint.test.js` uses to get a violation out of the
// synthetic project.
const VIOLATING_VOCABULARY = {
  vocabularies: [{ paths: ["acme.color"], values: ["fg", "bg"] }],
}

// One audit-side finding, in the pillar no lint rule can reach
// (`styles/raw-value` is Value Discipline), plus census sizes that are all
// distinct and all small — small enough that each pillar's rounded value
// below is a different number from every other, so a pillar that quietly
// took its full marks cannot pass by coincidence.
const AUDIT_RESULT = {
  findings: [
    { ruleId: "styles/raw-value", severity: "warn", entity: "field.root" },
  ],
  counts: {
    styleDeclarations: 4,
    tokens: 3,
    components: 2,
    styleFiles: 2,
    anatomyComponents: 2,
  },
}

function capture() {
  const writes = []
  return { stream: { write: chunk => (writes.push(chunk), true) }, writes }
}

// The ctx `verify`/`report` pass, with both streams captured: `gatherHealth-
// Score` hands `io.stderr` to the inner run, so the broken-run case can read
// what that run said.
function ctxFor(configPath) {
  const stdout = capture()
  const stderr = capture()
  return {
    ctx: {
      io: { stdout: stdout.stream, stderr: stderr.stream },
      globalOpts: { config: configPath },
      bus: createProgress(),
    },
    stdout,
    stderr,
  }
}

async function inProject(project, fn) {
  const cwd = process.cwd()
  process.chdir(project.root)
  try {
    return await fn()
  } finally {
    process.chdir(cwd)
  }
}

describe("sink()", () => {
  it("captures writes in order and rejoins them", () => {
    const captured = sink()
    captured.stream.write('{"findings"')
    captured.stream.write(":[]")
    captured.stream.write("}\n")

    expect(captured.writes).toEqual(['{"findings"', ":[]", "}\n"])
    expect(captured.writes.join("")).toBe('{"findings":[]}\n')
  })

  it("returns true from write, as a real stream does", () => {
    const captured = sink()
    // A command writing through this sink may check the backpressure signal
    // a real `stream.write` returns; a sink that returned undefined would
    // read as "stop writing".
    expect(captured.stream.write("x")).toBe(true)
  })

  it("starts empty, and two sinks do not share state", () => {
    const first = sink()
    expect(first.writes).toEqual([])

    first.stream.write("first")
    const second = sink()
    expect(second.writes).toEqual([])
    expect(first.writes).toEqual(["first"])
  })
})

describe("gatherHealthScore — both surfaces reach the score (#561)", () => {
  it("counts an audit finding and a lint finding, each in its own pillar", async () => {
    const project = createSyntheticProject({ lint: VIOLATING_VOCABULARY })
    try {
      await inProject(project, async () => {
        // Precondition: the inner lint surface really does emit the one
        // finding. A merge that passed because lint emitted nothing would
        // prove nothing about the merge.
        const probe = sink()
        const code = await runLint(["--json"], {
          io: { stdout: probe.stream, stderr: capture().stream },
          globalOpts: { config: project.configPath },
          bus: createProgress(),
        })
        expect(code).toBe(0)
        expect(
          JSON.parse(probe.writes.join("")).findings.map(f => f.ruleId),
        ).toEqual(["lint/vocabulary-invalid"])

        const { ctx } = ctxFor(project.configPath)
        const score = await gatherHealthScore(AUDIT_RESULT, ctx)

        expect(score).toEqual({
          total: 82,
          pillars: {
            // The AUDIT finding arrived, and so did `counts`: 1
            // `styles/raw-value` over 4 style declarations is a quarter of
            // the surface, so 60 → 45. Without `counts.styleDeclarations`
            // the zero denominator would award the full 60.
            valueDiscipline: 45,
            // No token-health finding on either side.
            tokenHealth: PILLAR_MAX.tokenHealth,
            // The LINT finding arrived: 1 `lint/vocabulary-invalid` over 3
            // tokens, so 10 → 7. This is the pillar `audit` alone can never
            // move, which is why this module exists.
            consistency: 7,
            // Neither finding is error-severity.
            criticalIssues: PILLAR_MAX.criticalIssues,
          },
        })
      })
    } finally {
      project.cleanup()
    }
  })

  it("does not let the inner lint run's own report reach the caller's stdout", async () => {
    // The sink is the reason the module captures the inner rendering: a
    // caller composing this into its own report must not find lint's JSON
    // interleaved with it.
    const project = createSyntheticProject({ lint: VIOLATING_VOCABULARY })
    try {
      await inProject(project, async () => {
        const { ctx, stdout } = ctxFor(project.configPath)
        await gatherHealthScore(AUDIT_RESULT, ctx)
        expect(stdout.writes).toEqual([])
      })
    } finally {
      project.cleanup()
    }
  })
})

describe("gatherHealthScore — an unparseable lint run is swallowed (#561)", () => {
  // The inner run is broken for real rather than stubbed: a `--config` that
  // names a file which does not exist makes `runLint` fail before it writes
  // anything, so the captured stdout is "" and `JSON.parse` throws — the
  // exact path the module's `catch` covers.
  const MISSING_CONFIG = "no-such-design-delta.json"

  it("returns the audit-only score instead of throwing", async () => {
    const project = createSyntheticProject({ lint: VIOLATING_VOCABULARY })
    try {
      await inProject(project, async () => {
        const { ctx, stderr } = ctxFor(MISSING_CONFIG)
        const score = await gatherHealthScore(AUDIT_RESULT, ctx)

        // The inner run really was broken — it said so on the stderr this
        // module passed through. Without this the case could pass against a
        // lint run that simply succeeded and found nothing.
        expect(stderr.writes.join("")).toMatch(
          /design-delta lint: no config at /,
        )

        expect(score).toEqual({
          total: 85,
          pillars: {
            // Unchanged: the audit side is untouched by the inner failure.
            valueDiscipline: 45,
            tokenHealth: PILLAR_MAX.tokenHealth,
            // THE HAZARD. No lint findings means a zero numerator, which
            // `pillarScore` reads as "nothing to grade" and awards in full —
            // so the pillar reports BETTER than the 7 the same project
            // scores when its lint surface is actually read.
            consistency: PILLAR_MAX.consistency,
            criticalIssues: PILLAR_MAX.criticalIssues,
          },
        })
      })
    } finally {
      project.cleanup()
    }
  })

  it("is indistinguishable from a genuinely clean lint surface", async () => {
    // Why the leniency needs a test and not just a comment: the degraded
    // result carries no marker at all, so a caller cannot tell a lint
    // surface that came back clean from one that never parsed.
    const violating = createSyntheticProject({ lint: VIOLATING_VOCABULARY })
    const clean = createSyntheticProject()
    try {
      const degraded = await inProject(violating, () =>
        gatherHealthScore(AUDIT_RESULT, ctxFor(MISSING_CONFIG).ctx),
      )
      const genuinelyClean = await inProject(clean, () =>
        gatherHealthScore(AUDIT_RESULT, ctxFor(clean.configPath).ctx),
      )

      expect(degraded).toEqual(genuinelyClean)
    } finally {
      violating.cleanup()
      clean.cleanup()
    }
  })
})
