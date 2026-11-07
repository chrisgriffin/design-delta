/**
 * cli-report.test.js — `design-delta report`, the artifact-exporting command.
 *
 * The command's whole value is that an artifact says the SAME thing the
 * terminal does, so these pin agreement between formats and determinism of the
 * bytes, not just "a file appeared".
 */

import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

import {
  renderDesignBasis,
  renderFindingsHuman,
  renderFindingsMarkdown,
  renderFindingsSarif,
} from "../src/core/report.mjs"
import { runReport } from "../src/cli/commands/report.mjs"
import { createSyntheticProject } from "./helpers/synthetic-project.mjs"

function io() {
  const out = []
  const err = []
  return {
    stdout: { write: c => (out.push(c), true) },
    stderr: { write: c => (err.push(c), true) },
    get stdout_() {
      return out.join("")
    },
    get stderr_() {
      return err.join("")
    },
  }
}

async function report(project, argv = []) {
  const streams = io()
  const cwd = process.cwd()
  process.chdir(project.root)
  try {
    const code = await runReport(argv, {
      io: streams,
      globalOpts: { config: project.configPath },
    })
    return { code, stdout: streams.stdout_, stderr: streams.stderr_ }
  } finally {
    process.chdir(cwd)
  }
}

describe("design-delta report — artifacts", () => {
  it("writes a markdown file and prints the terminal view by default", async () => {
    const project = createSyntheticProject()
    try {
      const { code, stdout, stderr } = await report(project, ["--no-timestamp"])
      expect(code).toBe(0)

      const artifact = join(
        project.root,
        project.config.paths.reportDir,
        "drift-report.md",
      )
      expect(existsSync(artifact)).toBe(true)
      expect(readFileSync(artifact, "utf8")).toContain("# Design drift report")

      // Both formats ran: the file exists AND stdout carries the terminal view.
      expect(stdout).toMatch(/error\(s\)|No findings\./)
      expect(stderr).toContain("wrote")
    } finally {
      project.cleanup()
    }
  })

  // issue #219: `report` has no `--json` flag (see the module docblock), so
  // the health score surfaces in its rendered artifacts instead.
  it("renders the health score in the markdown artifact, pr-comment, and terminal output", async () => {
    const project = createSyntheticProject()
    try {
      const { stdout } = await report(project, [
        "--format",
        "md,terminal,pr-comment",
        "--no-timestamp",
      ])
      const { reportDir } = project.config.paths
      const scoreLine = /Health score: \d+\/100 \(value discipline \d+\/60/

      const md = readFileSync(
        join(project.root, reportDir, "drift-report.md"),
        "utf8",
      )
      expect(md).toMatch(scoreLine)

      const prComment = readFileSync(
        join(project.root, reportDir, "drift-report-pr-comment.md"),
        "utf8",
      )
      expect(prComment).toMatch(scoreLine)

      expect(stdout).toMatch(scoreLine)
    } finally {
      project.cleanup()
    }
  })

  it("omits the health score under a scope flag — a scoped run's zero-denominator pillars would otherwise read as full marks", async () => {
    const project = createSyntheticProject()
    try {
      const { stdout } = await report(project, [
        "--format",
        "md,terminal,pr-comment",
        "--no-timestamp",
        "--components",
      ])
      const { reportDir } = project.config.paths
      const scoreLine = /Health score:/

      const md = readFileSync(
        join(project.root, reportDir, "drift-report.md"),
        "utf8",
      )
      expect(md).not.toMatch(scoreLine)

      const prComment = readFileSync(
        join(project.root, reportDir, "drift-report-pr-comment.md"),
        "utf8",
      )
      expect(prComment).not.toMatch(scoreLine)

      expect(stdout).not.toMatch(scoreLine)
    } finally {
      project.cleanup()
    }
  })

  it("honours --out for the artifact path", async () => {
    const project = createSyntheticProject()
    try {
      await report(project, [
        "--format",
        "md",
        "--out",
        "custom/here.md",
        "--no-timestamp",
      ])
      expect(existsSync(join(project.root, "custom/here.md"))).toBe(true)
    } finally {
      project.cleanup()
    }
  })

  it("--format terminal writes NO file", async () => {
    const project = createSyntheticProject()
    try {
      const { stdout } = await report(project, ["--format", "terminal"])
      const artifact = join(
        project.root,
        project.config.paths.reportDir,
        "drift-report.md",
      )
      expect(existsSync(artifact)).toBe(false)
      expect(stdout.length).toBeGreaterThan(0)
    } finally {
      project.cleanup()
    }
  })

  it("--format pr-comment writes the compact artifact", async () => {
    const project = createSyntheticProject()
    try {
      await report(project, [
        "--format",
        "pr-comment",
        "--out",
        "pr-comment.md",
        "--no-timestamp",
      ])
      const body = readFileSync(join(project.root, "pr-comment.md"), "utf8")
      expect(body).toContain("## Design drift")
      expect(body).toMatch(/error\(s\)|finding\(s\)/i)
      expect(body).not.toContain("### tokens")
    } finally {
      project.cleanup()
    }
  })

  it("rejects an unknown format by name, listing what it knows", async () => {
    const project = createSyntheticProject()
    try {
      const { code, stderr } = await report(project, ["--format", "pdf"])
      expect(code).toBe(1)
      expect(stderr).toContain("unknown format(s) pdf")
      expect(stderr).toContain("md")
    } finally {
      project.cleanup()
    }
  })

  it("is byte-identical across runs with --no-timestamp", async () => {
    // The determinism gate ADR-001 sets for every surface. The timestamp is
    // the only nondeterminism in this command, which is exactly why it is
    // isolated behind a flag rather than baked into the renderer.
    const project = createSyntheticProject()
    try {
      await report(project, [
        "--format",
        "md",
        "--out",
        "a.md",
        "--no-timestamp",
      ])
      await report(project, [
        "--format",
        "md",
        "--out",
        "b.md",
        "--no-timestamp",
      ])
      expect(readFileSync(join(project.root, "a.md"), "utf8")).toBe(
        readFileSync(join(project.root, "b.md"), "utf8"),
      )
    } finally {
      project.cleanup()
    }
  })

  it("includes a timestamp by default, and omits it on request", async () => {
    const project = createSyntheticProject()
    try {
      await report(project, ["--format", "md", "--out", "stamped.md"])
      await report(project, [
        "--format",
        "md",
        "--out",
        "bare.md",
        "--no-timestamp",
      ])
      expect(readFileSync(join(project.root, "stamped.md"), "utf8")).toContain(
        "_Generated ",
      )
      expect(readFileSync(join(project.root, "bare.md"), "utf8")).not.toContain(
        "_Generated ",
      )
    } finally {
      project.cleanup()
    }
  })

  it("always states what it could NOT check", async () => {
    // A report showing only findings reads as "this is everything". It is not,
    // when a surface was skipped — so the Diagnostics section is never omitted,
    // even when empty.
    const project = createSyntheticProject()
    try {
      await report(project, [
        "--format",
        "md",
        "--out",
        "r.md",
        "--no-timestamp",
      ])
      expect(readFileSync(join(project.root, "r.md"), "utf8")).toContain(
        "## Diagnostics",
      )
    } finally {
      project.cleanup()
    }
  })

  it("passes scope flags through to the audit it wraps", async () => {
    // `--tokens` narrows the run, so the censused counts must reflect only
    // that surface — proving the flag reached the audit rather than being
    // silently dropped, which is how the first version of this command failed.
    const project = createSyntheticProject()
    try {
      await report(project, [
        "--format",
        "md",
        "--tokens",
        "--out",
        "scoped.md",
        "--no-timestamp",
      ])
      const body = readFileSync(join(project.root, "scoped.md"), "utf8")
      expect(body).toMatch(/\| tokens\s+\|/)
      expect(body).not.toMatch(/\| anatomyComponents\s+\|/)
    } finally {
      project.cleanup()
    }
  })
})

// ---------------------------------------------------------------------------
// --format sarif — the CI/PR-annotation artifact (issue #224).
// ---------------------------------------------------------------------------

describe("design-delta report — sarif format", () => {
  it("writes a schema-shaped SARIF 2.1.0 log", async () => {
    const project = createSyntheticProject()
    try {
      const { code, stderr } = await report(project, [
        "--format",
        "sarif",
        "--no-timestamp",
      ])
      expect(code).toBe(0)

      const artifact = join(
        project.root,
        project.config.paths.reportDir,
        "drift-report.sarif",
      )
      expect(existsSync(artifact)).toBe(true)
      expect(stderr).toContain("wrote")

      const log = JSON.parse(readFileSync(artifact, "utf8"))
      expect(log.version).toBe("2.1.0")
      expect(log.runs).toHaveLength(1)
      expect(log.runs[0].tool.driver.name).toBe("design-delta")

      const result = log.runs[0].results.find(
        r => r.ruleId === "components/enum-values-mismatch",
      )
      expect(result).toBeDefined()
      expect(result.level).toBe("error")
      expect(typeof result.message.text).toBe("string")
      expect(result.locations[0].physicalLocation.artifactLocation.uri).toEqual(
        expect.any(String),
      )
    } finally {
      project.cleanup()
    }
  })

  it("--format sarif writes NO markdown file", async () => {
    const project = createSyntheticProject()
    try {
      await report(project, ["--format", "sarif", "--no-timestamp"])
      const md = join(
        project.root,
        project.config.paths.reportDir,
        "drift-report.md",
      )
      expect(existsSync(md)).toBe(false)
    } finally {
      project.cleanup()
    }
  })
})

describe("renderFindingsSarif", () => {
  const findings = [
    {
      ruleId: "tokens/token-unreferenced",
      severity: "error",
      surface: "tokens",
      side: "code",
      entity: "color.brand.500",
      message: "token unreferenced",
    },
    {
      ruleId: "lint/token-rule",
      severity: "warn",
      surface: "lint",
      side: "code",
      // A real lint finding's `entity` is the token id or, absent one, the
      // delegated rule id — NOT a path (`modules/lint.mjs`). The file the
      // line belongs to travels in `data.file`.
      entity: "core/valid-color",
      message: "lint violation",
      data: { file: "tokens/tokens.json", line: 42 },
    },
    {
      ruleId: "coverage/contract-only",
      severity: "review",
      surface: "coverage",
      side: "spec",
      entity: "Badge",
      message: "no component found",
    },
  ]

  it("maps severity to SARIF level per error->error, warn->warning, review->note", () => {
    const log = JSON.parse(renderFindingsSarif(findings))
    const byRule = Object.fromEntries(
      log.runs[0].results.map(r => [r.ruleId, r.level]),
    )
    expect(byRule["tokens/token-unreferenced"]).toBe("error")
    expect(byRule["lint/token-rule"]).toBe("warning")
    expect(byRule["coverage/contract-only"]).toBe("note")
  })

  it("uses data.file as the location uri and data.line as its region", () => {
    const log = JSON.parse(renderFindingsSarif(findings))
    const lintResult = log.runs[0].results.find(
      r => r.ruleId === "lint/token-rule",
    )
    expect(lintResult.locations[0].physicalLocation.artifactLocation.uri).toBe(
      "tokens/tokens.json",
    )
    expect(lintResult.locations[0].physicalLocation.region.startLine).toBe(42)
  })

  it("falls back to entity as the uri, with no region, when there is no file", () => {
    const log = JSON.parse(renderFindingsSarif(findings))
    const tokenResult = log.runs[0].results.find(
      r => r.ruleId === "tokens/token-unreferenced",
    )
    expect(tokenResult.locations[0].physicalLocation.artifactLocation.uri).toBe(
      "color.brand.500",
    )
    expect(tokenResult.locations[0].physicalLocation.region).toBeUndefined()
  })

  it("never attaches a line to a uri that is not a file", () => {
    // The regression: `data.line` with no `data.file` would otherwise put a
    // `region.startLine` under an `entity` uri (a token id, or the delegated
    // rule id) — a line number pointing into something that is not a file.
    const log = JSON.parse(
      renderFindingsSarif([
        {
          ruleId: "lint/token-rule",
          severity: "warn",
          surface: "lint",
          side: "code",
          entity: "core/valid-color",
          message: "lint violation",
          data: { line: 42 },
        },
      ]),
    )
    const { physicalLocation } = log.runs[0].results[0].locations[0]
    expect(physicalLocation.artifactLocation.uri).toBe("core/valid-color")
    expect(physicalLocation.region).toBeUndefined()
  })

  it("lists every ruleId once under tool.driver.rules", () => {
    const log = JSON.parse(renderFindingsSarif(findings))
    expect(log.runs[0].tool.driver.rules.map(r => r.id).sort()).toEqual([
      "coverage/contract-only",
      "lint/token-rule",
      "tokens/token-unreferenced",
    ])
  })
})

// ---------------------------------------------------------------------------
// report.actions — the one config key the markdown renderer reads.
//
// It was shipped unpinned, and that is exactly how the attribution bug got in:
// the action prose was taken from whichever finding sorted FIRST in a surface,
// and a surface can mix sides. `coverage` carries both `spec`
// (contract-only) and `code` (uncontracted-component), so a reader was told to
// fix spec rows in code.
// ---------------------------------------------------------------------------

describe("renderFindingsMarkdown — report.actions attribution", () => {
  const mixedSurface = {
    findings: [
      {
        severity: "warn",
        surface: "coverage",
        side: "code",
        entity: "b",
        ruleId: "coverage/uncontracted-component",
        message: "no contract",
      },
      {
        severity: "review",
        surface: "coverage",
        side: "spec",
        entity: "a",
        ruleId: "coverage/contract-only",
        message: "no component",
      },
    ],
    diagnostics: [],
  }

  it("renders an action line for EVERY side present, not just the first", () => {
    const md = renderFindingsMarkdown(mixedSurface, {
      actions: { code: "fix in code", spec: "fix in the contract" },
    })
    expect(md).toContain("**code** — fix in code")
    expect(md).toContain("**spec** — fix in the contract")
  })

  it("never attributes one side's advice to a mixed surface as a whole", () => {
    // Only `code` has prose. The spec rows must not sit under it unlabelled.
    const md = renderFindingsMarkdown(mixedSurface, {
      actions: { code: "fix in code" },
    })
    expect(md).toContain("**code** — fix in code")
    expect(md).not.toContain("**spec** —")
  })

  it("labels each row with its own side", () => {
    // The durable fix: prose above a table can only ever generalise, so the
    // row carries the fact.
    const md = renderFindingsMarkdown(mixedSurface, {})
    expect(md).toMatch(/\| side\s+\| entity\s+\| detail\s+\|/)
    expect(md).toMatch(/\| code\s+\| `b`\s+\|/)
    expect(md).toMatch(/\| spec\s+\| `a`\s+\|/)
  })

  it("groups by severity, then rule, worst first", () => {
    const md = renderFindingsMarkdown(mixedSurface, {})
    const warn = md.indexOf("### warn — 1")
    const review = md.indexOf("### review — 1")
    expect(warn).toBeGreaterThan(-1)
    expect(review).toBeGreaterThan(warn)
    expect(md).toContain("#### `coverage/uncontracted-component` (1)")
    expect(md).toContain("#### `coverage/contract-only` (1)")
    expect(md).not.toContain("### coverage")
  })

  it("emits no action block when none is configured", () => {
    const md = renderFindingsMarkdown(mixedSurface, {})
    expect(md).not.toContain("> **")
  })
})

// ---------------------------------------------------------------------------
// #369 — the report must be Prettier-stable, or every consumer that commits
// it and runs Prettier sees a whole-file repad instead of what changed.
// ---------------------------------------------------------------------------

describe("renderFindingsMarkdown — Prettier round-trip (#369)", () => {
  it("formats to itself byte-for-byte", async () => {
    const { format } = await import("prettier")
    const md = renderFindingsMarkdown(
      {
        counts: { contracts: 99, tokens: 1263, exempted: 0 },
        findings: [
          {
            severity: "warn",
            surface: "coverage",
            side: "code",
            entity: "b",
            ruleId: "coverage/uncontracted-component",
            message:
              "no contract — a long message | with a pipe, — dashes,  and a  whitespace run",
          },
          {
            severity: "review",
            surface: "coverage",
            side: "spec",
            entity: "a",
            ruleId: "coverage/contract-only",
            message: "no component",
          },
        ],
        diagnostics: [
          { code: "missing-style-file", message: "no style file at a/b.scss" },
        ],
      },
      { actions: { code: "fix in code" }, generatedAt: "2026-08-29, 10:00" },
    )
    // `report` writes `${body}\n` — the trailing newline is the writer's, so
    // the round-trip is asserted on what actually lands on disk.
    const onDisk = `${md}\n`
    expect(await format(onDisk, { parser: "markdown" })).toBe(onDisk)
  })
})

// ---------------------------------------------------------------------------
// Issue #389 — the design side's basis is stated, always.
// ---------------------------------------------------------------------------

describe("renderDesignBasis / the report's Design side line (#389)", () => {
  it("states no provider, no snapshot, an unknown date, and a gathered date — each plainly", () => {
    expect(renderDesignBasis(undefined)).toBe(
      "none — no design provider configured",
    )
    expect(
      renderDesignBasis({ designComponents: null, designTokens: null }),
    ).toBe("components: no snapshot; tokens: no snapshot")
    expect(renderDesignBasis({ notConsulted: "--code-only" })).toBe(
      "not consulted (--code-only) — a design provider is configured but this run did not read it",
    )
    expect(
      renderDesignBasis({ unavailable: 'design.provider "nope" is unknown' }),
    ).toBe('unavailable — design.provider "nope" is unknown')
    expect(renderDesignBasis({ designComponents: {} })).toBe(
      "components: committed snapshot, gather date unknown (ingested before provenance was recorded)",
    )
    expect(
      renderDesignBasis({
        designComponents: { gatheredAt: "2026-08-24T16:35:00.000Z" },
        designTokens: { gatheredAt: "2026-08-29T12:00:00.000Z" },
      }),
    ).toBe(
      "components gathered 2026-08-24T16:35:00.000Z; tokens gathered 2026-08-29T12:00:00.000Z",
    )
  })

  it("says when a snapshot's normalization is stale, on whichever phrase it decorates (#458)", () => {
    const stale = "design-tokens.json was normalized by design-delta 0.18.0 …"
    // Appended to the gathered-date phrase …
    expect(
      renderDesignBasis({
        designTokens: {
          gatheredAt: "2026-08-29T12:00:00.000Z",
          normalizationStale: stale,
        },
      }),
    ).toBe(
      "tokens gathered 2026-08-29T12:00:00.000Z — normalization stale, re-ingest (see diagnostics)",
    )
    // … and to the date-unknown phrase alike; a fresh snapshot gets no note.
    expect(
      renderDesignBasis({
        designComponents: {},
        designTokens: { normalizationStale: stale },
      }),
    ).toBe(
      "components: committed snapshot, gather date unknown (ingested before provenance was recorded); tokens: committed snapshot, gather date unknown (ingested before provenance was recorded) — normalization stale, re-ingest (see diagnostics)",
    )
    expect(
      renderDesignBasis({
        designTokens: { gatheredAt: "2026-08-29T12:00:00.000Z" },
      }),
    ).not.toMatch(/normalization stale/)
  })

  it("the markdown report carries the line unconditionally, right under the timestamp", () => {
    const md = renderFindingsMarkdown(
      { findings: [], diagnostics: [], provenance: { designTokens: null } },
      { generatedAt: "2026-08-29, 10:00" },
    )
    expect(md.split("\n").slice(0, 5)).toEqual([
      "# Design drift report",
      "",
      "_Generated 2026-08-29, 10:00_",
      "",
      "_Design side: tokens: no snapshot_",
    ])
    const none = renderFindingsMarkdown({ findings: [], diagnostics: [] }, {})
    expect(none).toContain(
      "_Design side: none — no design provider configured_",
    )
  })
})

describe("renderFindingsHuman — severity → rule → entity", () => {
  const findings = [
    {
      severity: "review",
      side: "code",
      entity: "z",
      ruleId: "tokens/b",
      message: "m1",
    },
    {
      severity: "error",
      side: "design",
      entity: "long-entity",
      ruleId: "components/a",
      message: "m2",
    },
    {
      severity: "error",
      side: "design",
      entity: "b",
      ruleId: "components/a",
      message: "m3",
    },
    {
      severity: "error",
      side: "code",
      entity: "c",
      ruleId: "styles/c",
      message: "m4",
    },
  ]

  it("renders worst severity first, biggest rule pile first, entities aligned", () => {
    const out = renderFindingsHuman(findings)
    expect(out.split("\n")).toEqual([
      "ERROR — 3",
      "  components/a (2)",
      "    b            [design]: m3",
      "    long-entity  [design]: m2",
      "  styles/c (1)",
      "    c  [code]: m4",
      "",
      "REVIEW — 1",
      "  tokens/b (1)",
      "    z  [code]: m1",
    ])
  })

  it("states an empty run rather than printing nothing", () => {
    expect(renderFindingsHuman([])).toBe("No findings.")
    expect(renderFindingsHuman([], { noneMessage: "clean" })).toBe("clean")
  })
})
