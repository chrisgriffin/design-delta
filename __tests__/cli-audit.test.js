/**
 * cli-audit.test.js — the `design-delta audit` subcommand
 * (`src/cli/commands/audit.mjs`), driven through `main.mjs`'s `run` (matching
 * `cli-contracts.test.js`'s reasoning: the whole path a consumer actually
 * takes — global-flag extraction, dispatch, this subcommand's own flags, and
 * the exit code — is under test).
 *
 * Runs against `__tests__/helpers/synthetic-project.mjs`'s materialized
 * project — the fixture whose `badge` contract/component pair carries a
 * DELIBERATE, narrow drift (the contract's `size` enum includes "lg", the
 * code component does not) specifically so the components checker has
 * something to catch (see that file's docblock). The same fixture's
 * `tokens.json` carries its OWN deliberate gap for the tokens checker
 * (issue #102): `acme.color.danger` is declared as a token but never
 * declared or used anywhere in `src/ui` — the tokens surface's one clean,
 * justified finding. `audit` runs relative to `process.cwd()` (mirroring how
 * a consumer actually invokes it, from their project root), so these tests
 * `chdir` into the synthetic project for the duration of each case and always
 * restore the real cwd afterward, even on failure.
 *
 * `runAudit` is `async` (Phase 2a's tokens surface awaits `censusTokens`), so
 * every case here awaits `runCapture`/`withSyntheticProject` — this file
 * changed shape for that reason alone; no other behavior above was touched.
 */

import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { run } from "../src/cli/main.mjs"
import {
  createSyntheticProject,
  SYNTHETIC_CONVENTIONS,
  SYNTHETIC_FILE_KEYS,
  SYNTHETIC_PATHS,
} from "./helpers/synthetic-project.mjs"

function fakeStream() {
  const writes = []
  return { stream: { write: chunk => writes.push(chunk) }, writes }
}

async function runCapture(argv) {
  const { stream: stdout, writes: stdoutWrites } = fakeStream()
  const { stream: stderr, writes: stderrWrites } = fakeStream()
  const code = await run(argv, { stdout, stderr })
  return { code, stdout: stdoutWrites.join(""), stderr: stderrWrites.join("") }
}

// A single, self-contained component whose stylesheet DELIBERATELY binds a
// different token than its contract declares — a generic, in-repo fixture
// for exercising the styles surface's `token-mismatch` rule end to end
// through the CLI (never a stand-in for any specific consuming project).
function renderMismatchedTag() {
  const dir = `${SYNTHETIC_PATHS.componentsDir}/tag`
  return {
    name: "tag",
    tsx: `export type TagProps = {
  label: string
}

export function Tag({ label }: TagProps) {
  return <span className="acmeTag">{label}</span>
}
`,
    styles: `.acmeTag {
  color: var(--acme-color-danger);
}
`,
    contract: {
      id: "tag",
      title: "Tag",
      status: "published",
      sources: {
        code: {
          path: `${dir}/tag.tsx`,
          styles: `${dir}/tag${SYNTHETIC_CONVENTIONS.stylesSuffix}`,
        },
      },
      anatomy: {
        root: {
          type: "container",
          element: "span",
          content: { $prop: "label" },
        },
      },
      props: { label: { type: "string" } },
      // Declares "acme.color.fg" — the stylesheet above binds
      // "--acme-color-danger" instead, a deliberate token-mismatch.
      styles: {
        root: { base: { color: { token: "acme.color.fg" } } },
      },
    },
  }
}

// A single, self-contained component whose rendered JSX DELIBERATELY renders
// a different element than its contract's `anatomy.root.element` declares —
// a generic, in-repo fixture for exercising the anatomy surface's
// `element-mismatch` rule end to end through the CLI (issue #104).
function renderMismatchedAnatomyTag() {
  const fixture = renderMismatchedTag()
  return {
    ...fixture,
    tsx: `export type TagProps = {
  label: string
}

export function Tag({ label }: TagProps) {
  return <strong className="acmeTag">{label}</strong>
}
`,
  }
}

// A contracted component reached ONLY via a dynamic `import(...)` call from
// another contracted component in the same componentsDir tree — the
// next/dynamic/React.lazy code-splitting pattern issue #254 fixes false-
// positiving as `components/unused-component` (the static-import-only regex
// never saw it as used by anything).
function dynamicImportComponents() {
  const dir = SYNTHETIC_PATHS.componentsDir
  return [
    {
      name: "chart",
      dir: "chart",
      tsx: "export function Chart() { return null }\n",
      contract: {
        id: "chart",
        title: "Chart",
        sources: { code: { path: `${dir}/chart/chart.tsx` } },
      },
    },
    {
      name: "panel",
      dir: "panel",
      tsx: [
        'const Chart = () => import("../chart/chart")',
        "",
        "export function Panel() { return null }",
        "",
      ].join("\n"),
      contract: {
        id: "panel",
        title: "Panel",
        sources: { code: { path: `${dir}/panel/panel.tsx` } },
      },
    },
  ]
}

async function withSyntheticProject(fn, overrides) {
  const project = createSyntheticProject(overrides)
  const originalCwd = process.cwd()
  process.chdir(project.root)
  try {
    return await fn(project)
  } finally {
    process.chdir(originalCwd)
    project.cleanup()
  }
}

describe("design-delta audit — components surface, end to end", () => {
  it("finds exactly the badge size drift and nothing else", async () => {
    await withSyntheticProject(async project => {
      const { code, stdout } = await runCapture([
        "audit",
        "--components",
        "--json",
        "--config",
        project.configPath,
      ])
      expect(code).toBe(0) // no --check: audit never fails on its own
      const payload = JSON.parse(stdout)
      expect(payload.counts).toEqual({
        contracts: 2,
        components: 2,
        findings: 1,
        // Always present, never conditional — see `counts.exempted` in audit.mjs.
        exempted: 0,
      })
      expect(payload.findings).toHaveLength(1)
      expect(payload.findings[0]).toEqual(
        expect.objectContaining({
          ruleId: "components/enum-values-mismatch",
          entity: "badge",
          data: { prop: "size", added: [], removed: ["lg"] },
        }),
      )
    })
  })

  it("--check exits 1 when an error-severity finding exists", async () => {
    await withSyntheticProject(async project => {
      const { code } = await runCapture([
        "audit",
        "--check",
        "--config",
        project.configPath,
      ])
      // enum-values-mismatch defaults to "error" severity.
      expect(code).toBe(1)
    })
  })

  it("without --check, the same run exits 0 despite the error-severity finding", async () => {
    await withSyntheticProject(async project => {
      const { code } = await runCapture([
        "audit",
        "--config",
        project.configPath,
      ])
      expect(code).toBe(0)
    })
  })

  it("--check exits 0 once the drift is silenced via config", async () => {
    await withSyntheticProject(async project => {
      const config = JSON.parse(readFileSync(project.configPath, "utf8"))
      config.rules = { "components/enum-values-mismatch": "off" }
      writeFileSync(project.configPath, JSON.stringify(config))

      // Scoped to --components: this test is about the components rule's
      // "off" honoring config, not about the tokens surface's own (separate,
      // deliberate) finding — see the file docblock.
      const { code, stdout } = await runCapture([
        "audit",
        "--components",
        "--check",
        "--json",
        "--config",
        project.configPath,
      ])
      expect(code).toBe(0)
      expect(JSON.parse(stdout).findings).toEqual([])
    })
  })

  it("human output lists the finding under its component entity", async () => {
    await withSyntheticProject(async project => {
      const { stdout } = await runCapture([
        "audit",
        "--components",
        "--config",
        project.configPath,
      ])
      expect(stdout).toContain("badge")
      expect(stdout).toContain("components/enum-values-mismatch")
      expect(stdout).toContain("1 error(s), 0 warn(s), 0 review(s)")
    })
  })

  it("does not false-positive components/unused-component for a component reached only via dynamic import(...) (#254)", async () => {
    await withSyntheticProject(
      async project => {
        const { code, stdout } = await runCapture([
          "audit",
          "--components",
          "--json",
          "--config",
          project.configPath,
        ])
        expect(code).toBe(0)
        const payload = JSON.parse(stdout)
        // "panel" imports nothing and is imported by nothing itself, so it
        // LEGITIMATELY fires unused-component — the regression this guards
        // against is specifically "chart", which "panel" reaches only via a
        // dynamic import(...), previously invisible to the census.
        expect(payload.findings).toEqual([
          expect.objectContaining({
            ruleId: "components/unused-component",
            entity: "panel",
          }),
        ])
      },
      { components: dynamicImportComponents() },
    )
  })
})

describe("design-delta audit — tokens surface, end to end (issue #102)", () => {
  it("finds exactly the unemitted 'danger' token and nothing else", async () => {
    await withSyntheticProject(async project => {
      const { code, stdout } = await runCapture([
        "audit",
        "--tokens",
        "--json",
        "--config",
        project.configPath,
      ])
      expect(code).toBe(0) // no --check: audit never fails on its own
      const payload = JSON.parse(stdout)
      expect(payload.counts).toEqual({
        tokens: 3,
        cssVars: 2,
        findings: 1,
        // Always present, never conditional — see `counts.exempted` in audit.mjs.
        exempted: 0,
      })
      expect(payload.findings).toEqual([
        expect.objectContaining({
          ruleId: "tokens/token-unreferenced",
          surface: "tokens",
          entity: "acme.color.danger",
          data: {
            token: "acme.color.danger",
            tokens: ["acme.color.danger"],
            expectedVar: "--acme-color-danger",
          },
        }),
      ])
    })
  })

  it("--check does not exit 1 on a warn-severity token finding", async () => {
    await withSyntheticProject(async project => {
      const { code } = await runCapture([
        "audit",
        "--tokens",
        "--check",
        "--config",
        project.configPath,
      ])
      // token-unreferenced defaults to "review" — --check only gates on error.
      expect(code).toBe(0)
    })
  })

  it("--check exits 0 once the finding is silenced via config", async () => {
    await withSyntheticProject(async project => {
      const config = JSON.parse(readFileSync(project.configPath, "utf8"))
      config.rules = { "tokens/token-unreferenced": "off" }
      writeFileSync(project.configPath, JSON.stringify(config))

      const { code, stdout } = await runCapture([
        "audit",
        "--tokens",
        "--check",
        "--json",
        "--config",
        project.configPath,
      ])
      expect(code).toBe(0)
      expect(JSON.parse(stdout).findings).toEqual([])
    })
  })
})

describe("design-delta audit — styles surface, end to end (issue #103)", () => {
  it("the default synthetic project's styles surface is clean", async () => {
    await withSyntheticProject(async project => {
      const { code, stdout } = await runCapture([
        "audit",
        "--styles",
        "--json",
        "--config",
        project.configPath,
      ])
      expect(code).toBe(0)
      const payload = JSON.parse(stdout)
      // field's root binds "color"/"background" and badge's root binds
      // "color" — both exactly matching their SCSS (see
      // synthetic-project.mjs); "root" maps via the sole-top-level-selector
      // convention since neither anatomy node carries a codeClass.
      expect(payload.counts).toEqual({
        contracts: 2,
        styleFiles: 2,
        styleDeclarations: 3,
        findings: 0,
        // Always present, never conditional — see `counts.exempted` in audit.mjs.
        exempted: 0,
      })
      expect(payload.findings).toEqual([])
    })
  })

  it("catches a deliberate token mismatch between the contract and the stylesheet", async () => {
    // Isolated in its own project (a single component) so this run's
    // findings are exactly the one deliberate mismatch — not mixed in with
    // the default fixture's unrelated components/tokens drift.
    await withSyntheticProject(
      async project => {
        const { code, stdout } = await runCapture([
          "audit",
          "--styles",
          "--json",
          "--config",
          project.configPath,
        ])
        expect(code).toBe(0) // no --check
        const payload = JSON.parse(stdout)
        expect(payload.findings).toEqual([
          expect.objectContaining({
            ruleId: "styles/token-mismatch",
            surface: "styles",
            entity: "tag.root",
            data: expect.objectContaining({
              element: "root",
              property: "color",
              mismatches: [
                expect.objectContaining({
                  tokenId: "acme.color.fg",
                  expectedVar: "--acme-color-fg",
                  foundVar: "--acme-color-danger",
                }),
              ],
            }),
          }),
        ])
      },
      { components: [renderMismatchedTag()] },
    )
  })

  it("--check exits 1 on the mismatch (error severity)", async () => {
    await withSyntheticProject(
      async project => {
        const { code } = await runCapture([
          "audit",
          "--styles",
          "--check",
          "--config",
          project.configPath,
        ])
        expect(code).toBe(1)
      },
      { components: [renderMismatchedTag()] },
    )
  })

  it("--check exits 0 once the mismatch is silenced via config", async () => {
    await withSyntheticProject(
      async project => {
        const config = JSON.parse(readFileSync(project.configPath, "utf8"))
        config.rules = { "styles/token-mismatch": "off" }
        writeFileSync(project.configPath, JSON.stringify(config))

        const { code, stdout } = await runCapture([
          "audit",
          "--styles",
          "--check",
          "--json",
          "--config",
          project.configPath,
        ])
        expect(code).toBe(0)
        expect(JSON.parse(stdout).findings).toEqual([])
      },
      { components: [renderMismatchedTag()] },
    )
  })
})

describe("design-delta audit — no scope flag runs every surface", () => {
  it("combines the components drift and the tokens finding in one findings list, and the styles/anatomy surfaces are clean", async () => {
    await withSyntheticProject(async project => {
      const { stdout } = await runCapture([
        "audit",
        "--json",
        "--config",
        project.configPath,
      ])
      const payload = JSON.parse(stdout)
      expect(payload.counts).toEqual({
        contracts: 2,
        components: 2,
        tokens: 3,
        cssVars: 2,
        styleFiles: 2,
        styleDeclarations: 3,
        anatomyComponents: 2,
        findings: 2,
        // Always present, never conditional — see `counts.exempted` in audit.mjs.
        exempted: 0,
      })
      // The synthetic project's field/badge components each render exactly
      // the single element their contract's `anatomy.root` declares, content
      // bound to the `label` prop (see synthetic-project.mjs) — the anatomy
      // surface (#104) is clean here, same as styles (#103), so only the
      // pre-existing components/tokens drift shows up.
      expect(payload.findings.map(f => f.ruleId).sort()).toEqual([
        "components/enum-values-mismatch",
        "tokens/token-unreferenced",
      ])
    })
  })
})

// ---------------------------------------------------------------------------
// coverage/unfinished-contract, through the CLI (issue #350).
//
// The unit suite builds contract entries in memory and so could never see
// this: `loadContract` strips every `^_` key, `_scaffold` included, which
// made the one rule that reads those markers unreachable from every real
// run. Only a case that goes through the loader proves it fires.
// ---------------------------------------------------------------------------

describe("design-delta audit — coverage/unfinished-contract (issue #350)", () => {
  function draftedComponent() {
    const dir = `${SYNTHETIC_PATHS.componentsDir}/tag`
    return [
      {
        name: "tag",
        tsx: "export type TagProps = {\n  label: string\n}\n\nexport function Tag({ label }: TagProps) {\n  return <span>{label}</span>\n}\n",
        contract: {
          id: "tag",
          title: "Tag",
          sources: { code: { path: `${dir}/tag.tsx` } },
          props: {
            label: {
              type: "string",
              _scaffold: { todo: "confirm this type" },
            },
          },
        },
      },
    ]
  }

  it("fires for a contract whose file still carries a _scaffold marker", async () => {
    await withSyntheticProject(
      async project => {
        const { code, stdout } = await runCapture([
          "audit",
          "--components",
          "--json",
          "--config",
          project.configPath,
        ])
        expect(code).toBe(0)
        const payload = JSON.parse(stdout)
        expect(
          payload.findings.filter(
            f => f.ruleId === "coverage/unfinished-contract",
          ),
        ).toEqual([
          expect.objectContaining({
            entity: "tag",
            data: { markers: ["/props/label/_scaffold"] },
          }),
        ])
      },
      { components: draftedComponent() },
    )
  })

  it("stays silent for a contract with no marker", async () => {
    await withSyntheticProject(async project => {
      const { stdout } = await runCapture([
        "audit",
        "--components",
        "--json",
        "--config",
        project.configPath,
      ])
      expect(
        JSON.parse(stdout).findings.some(
          f => f.ruleId === "coverage/unfinished-contract",
        ),
      ).toBe(false)
    })
  })
})

describe("design-delta audit — anatomy surface, end to end (issue #104)", () => {
  it("the default synthetic project's anatomy surface is clean", async () => {
    await withSyntheticProject(async project => {
      const { code, stdout } = await runCapture([
        "audit",
        "--anatomy",
        "--json",
        "--config",
        project.configPath,
      ])
      expect(code).toBe(0)
      const payload = JSON.parse(stdout)
      expect(payload.counts).toEqual({
        contracts: 2,
        anatomyComponents: 2,
        findings: 0,
        // Always present, never conditional — see `counts.exempted` in audit.mjs.
        exempted: 0,
      })
      expect(payload.findings).toEqual([])
    })
  })

  it("catches a deliberate element mismatch between the contract and the rendered JSX", async () => {
    await withSyntheticProject(
      async project => {
        const { code, stdout } = await runCapture([
          "audit",
          "--anatomy",
          "--json",
          "--config",
          project.configPath,
        ])
        expect(code).toBe(0) // no --check
        const payload = JSON.parse(stdout)
        expect(payload.findings).toEqual([
          expect.objectContaining({
            ruleId: "anatomy/element-mismatch",
            surface: "anatomy",
            entity: "tag.root",
            data: { element: "root", expected: "span", found: "strong" },
          }),
        ])
      },
      { components: [renderMismatchedAnatomyTag()] },
    )
  })

  it("--check exits 1 on the mismatch (error severity)", async () => {
    await withSyntheticProject(
      async project => {
        const { code } = await runCapture([
          "audit",
          "--anatomy",
          "--check",
          "--config",
          project.configPath,
        ])
        expect(code).toBe(1)
      },
      { components: [renderMismatchedAnatomyTag()] },
    )
  })

  it("--check exits 0 once the mismatch is silenced via config", async () => {
    await withSyntheticProject(
      async project => {
        const config = JSON.parse(readFileSync(project.configPath, "utf8"))
        config.rules = { "anatomy/element-mismatch": "off" }
        writeFileSync(project.configPath, JSON.stringify(config))

        const { code, stdout } = await runCapture([
          "audit",
          "--anatomy",
          "--check",
          "--json",
          "--config",
          project.configPath,
        ])
        expect(code).toBe(0)
        expect(JSON.parse(stdout).findings).toEqual([])
      },
      { components: [renderMismatchedAnatomyTag()] },
    )
  })
})

describe("design-delta audit — stream/flag behavior (surface-agnostic)", () => {
  it("keeps stdout clean of progress under --json; progress goes only to stderr", async () => {
    await withSyntheticProject(async project => {
      const { stdout, stderr } = await runCapture([
        "audit",
        "--json",
        "--config",
        project.configPath,
      ])
      expect(() => JSON.parse(stdout)).not.toThrow()
      expect(stdout).not.toContain("[design-delta]")
      expect(stderr).toContain("[design-delta]")
    })
  })

  it("--quiet silences progress without changing stdout", async () => {
    await withSyntheticProject(async project => {
      const loud = await runCapture([
        "audit",
        "--json",
        "--config",
        project.configPath,
      ])
      const quiet = await runCapture([
        "audit",
        "--json",
        "--config",
        project.configPath,
        "--quiet",
      ])
      expect(quiet.stdout).toBe(loud.stdout)
      expect(quiet.stderr).toBe("")
    })
  })

  it("is deterministic — the same project audits to byte-identical JSON twice", async () => {
    await withSyntheticProject(async project => {
      const a = await runCapture([
        "audit",
        "--json",
        "--config",
        project.configPath,
      ])
      const b = await runCapture([
        "audit",
        "--json",
        "--config",
        project.configPath,
      ])
      expect(a.stdout).toBe(b.stdout)
    })
  })
})

describe("design-delta audit — flags and config", () => {
  it("rejects an unknown flag instead of running with defaults", async () => {
    const { code, stdout, stderr } = await runCapture(["audit", "--bogus"])
    expect(code).toBe(1)
    expect(stdout).toBe("")
    expect(stderr).toContain('Unknown argument "--bogus"')
  })

  it("errors when an explicitly-named --config does not exist", async () => {
    const { code, stderr } = await runCapture([
      "audit",
      "--config",
      "no-such.json",
    ])
    expect(code).toBe(1)
    expect(stderr).toContain("no config at no-such.json")
  })

  it("--code-only is accepted without error (a documented no-op through Phase 2)", async () => {
    await withSyntheticProject(async project => {
      const { code } = await runCapture([
        "audit",
        "--code-only",
        "--config",
        project.configPath,
      ])
      expect(code).toBe(0)
    })
  })
})

describe("design-delta audit — a components directory with nothing in it", () => {
  it("audits cleanly and reports contract-only coverage rather than crashing", async () => {
    // `typescript` itself missing is exercised directly at the module level
    // (`sources-extract.test.js`'s "typescript-not-installed" cases) — this
    // pins the adjacent, CLI-visible case: every contract's declared code
    // path resolves to nothing because the directory was emptied, and the
    // command still reports that honestly instead of throwing.
    await withSyntheticProject(async project => {
      rmSync(project.paths.componentsDir, { recursive: true, force: true })
      mkdirSync(project.paths.componentsDir, { recursive: true })

      const { code, stdout } = await runCapture([
        "audit",
        "--json",
        "--config",
        project.configPath,
      ])
      expect(code).toBe(0)
      const payload = JSON.parse(stdout)
      expect(payload.counts.components).toBe(0)
      expect(
        payload.findings.filter(f => f.ruleId === "coverage/contract-only"),
      ).toHaveLength(2)
    })
  })
})

// ---------------------------------------------------------------------------
// Exemptions, end to end (issue #181).
//
// The bug was NOT a broken implementation — it was a fully specified config
// block that nothing read. A unit-tested module that no command calls would
// reproduce that exactly, so this goes through the real `audit` path.
// ---------------------------------------------------------------------------

describe("design-delta audit — exemptions are actually applied (#181)", () => {
  // Runs the REAL cli path: `createSyntheticProject` writes a config, and the
  // audit is driven through `run()` exactly as a consumer would.
  const auditJson = async project => {
    const cwd = process.cwd()
    process.chdir(project.root)
    try {
      const { stdout } = await runCapture([
        "--config",
        project.configPath,
        "audit",
        "--json",
        "--tokens",
      ])
      return JSON.parse(stdout)
    } finally {
      process.chdir(cwd)
    }
  }

  it("an exempted entity is filtered out of the report", async () => {
    const orphan = {
      color: { orphan: { $type: "color", $value: "#abcdef" } },
    }
    const before = createSyntheticProject({ tokens: orphan })
    let target
    try {
      const result = await auditJson(before)
      target = result.findings.find(
        f => f.ruleId === "tokens/token-unreferenced",
      )
      expect(target).toBeDefined() // the fixture must actually produce one
    } finally {
      before.cleanup()
    }

    const after = createSyntheticProject({
      tokens: orphan,
      exemptions: { "tokens/token-unreferenced": [target.entity] },
    })
    try {
      const result = await auditJson(after)
      expect(
        result.findings.filter(
          f =>
            f.ruleId === "tokens/token-unreferenced" &&
            f.entity === target.entity,
        ),
      ).toEqual([])
    } finally {
      after.cleanup()
    }
  })

  it("an exemption matching nothing is reported as stale", async () => {
    const project = createSyntheticProject({
      exemptions: {
        "tokens/token-unreferenced": ["definitely.not.a.real.token"],
      },
    })
    try {
      const result = await auditJson(project)
      const stale = result.findings.filter(
        f => f.ruleId === "coverage/stale-exemption",
      )
      expect(stale).toHaveLength(1)
      expect(stale[0].entity).toBe("definitely.not.a.real.token")
    } finally {
      project.cleanup()
    }
  })

  it("counts how many findings the exemptions hid", async () => {
    // `applyExemptions` always knew this number; nothing surfaced it, so a
    // report could go from N findings to zero with no line accounting for the
    // difference. For an engine whose product is honest output, a clean report
    // and no drift must not look identical.
    const orphan = { color: { orphan: { $type: "color", $value: "#abcdef" } } }
    const before = createSyntheticProject({ tokens: orphan })
    let target
    try {
      const result = await auditJson(before)
      target = result.findings.find(
        f => f.ruleId === "tokens/token-unreferenced",
      )
      expect(target).toBeDefined()
      expect(result.counts.exempted).toBe(0)
    } finally {
      before.cleanup()
    }

    const after = createSyntheticProject({
      tokens: orphan,
      exemptions: { "tokens/token-unreferenced": [target.entity] },
    })
    try {
      const result = await auditJson(after)
      expect(result.counts.exempted).toBe(1)
    } finally {
      after.cleanup()
    }
  })

  it("lists an exempted finding under `decided` with its decision (#565)", async () => {
    const orphan = { color: { orphan: { $type: "color", $value: "#abcdef" } } }
    const before = createSyntheticProject({ tokens: orphan })
    let baseline
    try {
      baseline = await auditJson(before)
    } finally {
      before.cleanup()
    }
    const target = baseline.findings.find(
      f => f.ruleId === "tokens/token-unreferenced",
    )

    const tracked = createSyntheticProject({
      tokens: orphan,
      exemptions: {
        "tokens/token-unreferenced": [
          {
            entity: target.entity,
            decision: "tracked",
            issue: "acme/app#12",
            reason: "pending rename",
          },
        ],
      },
    })
    try {
      const result = await auditJson(tracked)
      expect(result.findings).not.toContainEqual(
        expect.objectContaining({ entity: target.entity }),
      )
      expect(result.decided).toEqual([
        {
          ...target,
          decision: {
            kind: "tracked",
            reason: "pending rename",
            issue: "acme/app#12",
            exemption: target.entity,
          },
        },
      ])
      expect(result.counts.exempted).toBe(1)
    } finally {
      tracked.cleanup()
    }
  })

  it("always carries `decided`, empty when nothing is exempted (#565)", async () => {
    const project = createSyntheticProject({
      tokens: { color: { orphan: { $type: "color", $value: "#abcdef" } } },
    })
    try {
      expect((await auditJson(project)).decided).toEqual([])
    } finally {
      project.cleanup()
    }
  })

  it("says so in the human render when a waiver hid something", async () => {
    const orphan = { color: { orphan: { $type: "color", $value: "#abcdef" } } }
    const probe = createSyntheticProject({ tokens: orphan })
    let entity
    try {
      entity = (await auditJson(probe)).findings.find(
        f => f.ruleId === "tokens/token-unreferenced",
      ).entity
    } finally {
      probe.cleanup()
    }

    const project = createSyntheticProject({
      tokens: orphan,
      exemptions: { "tokens/token-unreferenced": [entity] },
    })
    const cwd = process.cwd()
    process.chdir(project.root)
    try {
      const { stdout } = await runCapture([
        "--config",
        project.configPath,
        "audit",
        "--tokens",
      ])
      expect(stdout).toContain("DECISIONS — 1")
      expect(stdout).toContain(
        `waived (1)\n    ${entity}  tokens/token-unreferenced`,
      )
      expect(stdout).not.toContain("hidden by `exemptions`")
    } finally {
      process.chdir(cwd)
      project.cleanup()
    }
  })

  it("does not report an exemption stale when its rule is turned off", async () => {
    // Every module returns early on a resolved severity of `"off"`, so a
    // disabled rule reports nothing no matter what the code looks like —
    // the same "no evidence" case as a surface that was scoped out.
    //
    // This sits directly on the migration path: a consumer moving
    // `rules: {"x": "off"}` onto `exemptions` has both set at once, and
    // without the filter every entry they migrate reads as stale on the
    // first run.
    const project = createSyntheticProject({
      rules: { "tokens/token-unreferenced": "off" },
      exemptions: {
        "tokens/token-unreferenced": ["definitely.not.a.real.token"],
      },
    })
    try {
      const result = await auditJson(project)
      expect(
        result.findings.filter(f => f.ruleId === "coverage/stale-exemption"),
      ).toEqual([])
    } finally {
      project.cleanup()
    }
  })
})

// ---------------------------------------------------------------------------
// Unknown rule ids fail loudly, in either `rules` or `exemptions` (#188).
//
// `validateRuleIds` existed already; nothing called it. A typo'd id read as a
// correct, disabled/exempted config with the real problem still fully live —
// through the real CLI path, since a unit-tested-but-uncalled function is
// exactly the bug this closes.
// ---------------------------------------------------------------------------

describe("design-delta audit — unknown rule ids fail loudly (#188)", () => {
  it("exits 1 on a typo'd id in `rules`, naming it on stderr", async () => {
    await withSyntheticProject(async project => {
      const config = JSON.parse(readFileSync(project.configPath, "utf8"))
      config.rules = { "components/enum-values-mismach": "off" }
      writeFileSync(project.configPath, JSON.stringify(config))

      const { code, stdout, stderr } = await runCapture([
        "audit",
        "--json",
        "--config",
        project.configPath,
      ])
      expect(code).toBe(1)
      expect(stdout).toBe("") // fails BEFORE any surface runs — no partial report
      expect(stderr).toMatch(
        /unknown rule id 'components\/enum-values-mismach' in rules/,
      )
      expect(stderr).toMatch(/did you mean 'components\/enum-values-mismatch'/)
    })
  })

  it("exits 1 on a typo'd id in `exemptions`, naming it on stderr", async () => {
    await withSyntheticProject(async project => {
      const config = JSON.parse(readFileSync(project.configPath, "utf8"))
      config.exemptions = {
        "tokens/token-unreferened": ["definitely.not.a.real.token"],
      }
      writeFileSync(project.configPath, JSON.stringify(config))

      const { code, stdout, stderr } = await runCapture([
        "audit",
        "--json",
        "--config",
        project.configPath,
      ])
      expect(code).toBe(1)
      expect(stdout).toBe("")
      expect(stderr).toMatch(
        /unknown rule id 'tokens\/token-unreferened' in exemptions/,
      )
    })
  })

  it("checks against the FULL engine registry, not only the surfaces this run selects", async () => {
    // `--components` alone still must reject a typo'd `lint/*` id — one
    // config drives every command, so a rule id's validity cannot depend on
    // which surface flag happened to be passed this run.
    await withSyntheticProject(async project => {
      const config = JSON.parse(readFileSync(project.configPath, "utf8"))
      config.rules = { "lint/component-dir-cse": "warn" }
      writeFileSync(project.configPath, JSON.stringify(config))

      const { code, stderr } = await runCapture([
        "audit",
        "--components",
        "--config",
        project.configPath,
      ])
      expect(code).toBe(1)
      expect(stderr).toMatch(/unknown rule id 'lint\/component-dir-cse'/)
    })
  })

  it("a valid rules/exemptions config is unaffected — no new output", async () => {
    await withSyntheticProject(async project => {
      const config = JSON.parse(readFileSync(project.configPath, "utf8"))
      config.rules = { "components/enum-values-mismatch": "warn" }
      config.exemptions = {
        "tokens/token-unreferenced": ["definitely.not.a.real.token"],
      }
      writeFileSync(project.configPath, JSON.stringify(config))

      const { code, stderr } = await runCapture([
        "audit",
        "--config",
        project.configPath,
      ])
      expect(code).toBe(0)
      // Progress legitimately writes to stderr (D8) — the assertion that
      // matters is that none of it is a rule-id validation error.
      expect(stderr).not.toMatch(/unknown rule id/)
    })
  })

  it("`_`-prefixed documentary keys in rules/exemptions are never reported as unknown ids", async () => {
    await withSyntheticProject(async project => {
      const config = JSON.parse(readFileSync(project.configPath, "utf8"))
      config.rules = { _doc: "why these are configured this way" }
      config.exemptions = { _doc: "why these are exempted" }
      writeFileSync(project.configPath, JSON.stringify(config))

      const { code, stderr } = await runCapture([
        "audit",
        "--config",
        project.configPath,
      ])
      expect(code).toBe(0)
      expect(stderr).not.toMatch(/unknown rule id/)
    })
  })
})

// ---------------------------------------------------------------------------
// Design side (ADR-003 Phase 5.1) — coverage/design-only, coverage/design-
// missing, wired through `design-components.json` + the loaded provider.
// The synthetic fixture's field/badge contracts already declare
// `sources.design` addresses that exactly match the default designComponents
// snapshot (see synthetic-project.mjs) — a clean baseline to perturb from.
// ---------------------------------------------------------------------------

describe("design-delta audit — design-side coverage (ADR-003 Phase 5.1)", () => {
  it("no design.provider configured: design coverage stays silent even with a snapshot present", async () => {
    await withSyntheticProject(async project => {
      const { code, stdout } = await runCapture([
        "audit",
        "--components",
        "--json",
        "--config",
        project.configPath,
      ])
      expect(code).toBe(0)
      const payload = JSON.parse(stdout)
      const ruleIds = payload.findings.map(f => f.ruleId)
      expect(ruleIds).not.toContain("coverage/design-only")
      expect(ruleIds).not.toContain("coverage/design-missing")
    })
  })

  it("design.provider naming an UNKNOWN provider is a diagnostic, not silence (unlike genuinely unconfigured)", async () => {
    await withSyntheticProject(
      async project => {
        const { code, stdout } = await runCapture([
          "audit",
          "--components",
          "--json",
          "--config",
          project.configPath,
        ])
        expect(code).toBe(0)
        const payload = JSON.parse(stdout)
        expect(payload.skipped?.design).toMatch(/not a known provider/)
        expect(payload.diagnostics).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              code: "design-provider-invalid",
              message: expect.stringMatching(/not a known provider/),
            }),
          ]),
        )
        // No design coverage rule can have run without a resolved provider.
        const ruleIds = payload.findings.map(f => f.ruleId)
        expect(ruleIds).not.toContain("coverage/design-only")
        expect(ruleIds).not.toContain("coverage/design-missing")
      },
      { design: { provider: "acme-design-tool" } },
    )
  })

  it("provider configured, every contract's design address already resolves: zero design findings", async () => {
    await withSyntheticProject(
      async project => {
        const { code, stdout } = await runCapture([
          "audit",
          "--components",
          "--json",
          "--config",
          project.configPath,
        ])
        expect(code).toBe(0)
        const payload = JSON.parse(stdout)
        const ruleIds = payload.findings.map(f => f.ruleId)
        expect(ruleIds).not.toContain("coverage/design-only")
        expect(ruleIds).not.toContain("coverage/design-missing")
        // ADR-003 Phase 5.2: the default fixture's Field/Badge design
        // components match their contracts' props exactly — zero
        // side:"design" prop-parity findings either, not just zero coverage
        // findings.
        expect(payload.findings.filter(f => f.side === "design")).toEqual([])
      },
      { design: { provider: "figma" } },
    )
  })

  it('ADR-003 Phase 5.2: a design component\'s props that disagree with its contract produce a side:"design" prop-parity finding', async () => {
    await withSyntheticProject(
      async project => {
        const { stdout } = await runCapture([
          "audit",
          "--components",
          "--json",
          "--config",
          project.configPath,
        ])
        const payload = JSON.parse(stdout)
        const finding = payload.findings.find(
          f =>
            f.ruleId === "components/enum-values-mismatch" &&
            f.side === "design",
        )
        expect(finding).toEqual(
          expect.objectContaining({
            ruleId: "components/enum-values-mismatch",
            side: "design",
            entity: "field",
            data: { prop: "tone", added: [], removed: ["danger"] },
          }),
        )
      },
      {
        design: { provider: "figma" },
        // Field's contract declares tone: [neutral, danger]; this design
        // component only carries "neutral" — a genuine, deliberate drift.
        designComponents: {
          components: [
            {
              fileKey: SYNTHETIC_FILE_KEYS.components,
              nodeId: "10:20",
              name: "Field",
              type: "COMPONENT_SET",
              variantProperties: { tone: ["neutral"] },
              propertyDefinitions: {
                "label#1:0": { type: "TEXT", name: "label" },
              },
              treeHash: "field-drift-v1",
            },
          ],
        },
      },
    )
  })

  it("coverage/design-only: a design component no contract addresses", async () => {
    await withSyntheticProject(
      async project => {
        const { stdout } = await runCapture([
          "audit",
          "--components",
          "--json",
          "--config",
          project.configPath,
        ])
        const payload = JSON.parse(stdout)
        const finding = payload.findings.find(
          f => f.ruleId === "coverage/design-only",
        )
        expect(finding).toEqual(
          expect.objectContaining({
            ruleId: "coverage/design-only",
            surface: "coverage",
            side: "design",
            entity: `${SYNTHETIC_FILE_KEYS.components}:99:99`,
            data: { name: "Orphan" },
          }),
        )
      },
      {
        design: { provider: "figma" },
        designComponents: {
          components: [
            {
              fileKey: SYNTHETIC_FILE_KEYS.components,
              nodeId: "99:99",
              name: "Orphan",
              type: "COMPONENT",
              treeHash: "orphan-v1",
            },
          ],
        },
      },
    )
  })

  // Issue #460 — a private component (a `.`/`_`-prefixed name or path
  // segment) can never have a contract, so it is not missing one.
  it("coverage/design-only skips the provider's private components, reports the count once, and counts them on request", async () => {
    const privateAndPublic = {
      components: [
        {
          fileKey: SYNTHETIC_FILE_KEYS.components,
          nodeId: "99:99",
          name: "Orphan",
          type: "COMPONENT",
          treeHash: "orphan-v1",
        },
        {
          fileKey: SYNTHETIC_FILE_KEYS.components,
          nodeId: "99:1",
          name: ".Header",
          type: "COMPONENT",
          treeHash: "p1",
        },
        {
          fileKey: SYNTHETIC_FILE_KEYS.components,
          nodeId: "99:2",
          name: "Group / .Child",
          type: "COMPONENT_SET",
          treeHash: "p2",
        },
        {
          fileKey: SYNTHETIC_FILE_KEYS.components,
          nodeId: "99:3",
          name: "_helper",
          type: "COMPONENT",
          treeHash: "p3",
        },
      ],
    }
    const designOnly = payload =>
      payload.findings
        .filter(f => f.ruleId === "coverage/design-only")
        .map(f => f.data.name)
        .sort()
    await withSyntheticProject(
      async project => {
        const { stdout } = await runCapture([
          "audit",
          "--components",
          "--json",
          "--config",
          project.configPath,
        ])
        const payload = JSON.parse(stdout)
        expect(designOnly(payload)).toEqual(["Orphan"])
        expect(payload.diagnostics).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              code: "design-private-components-excluded",
              file: `${project.config.paths.snapshotDir}/design-components.json`,
              message: expect.stringMatching(/^3 private design component/),
            }),
          ]),
        )
      },
      { design: { provider: "figma" }, designComponents: privateAndPublic },
    )
    await withSyntheticProject(
      async project => {
        const { stdout } = await runCapture([
          "audit",
          "--components",
          "--json",
          "--config",
          project.configPath,
        ])
        const payload = JSON.parse(stdout)
        expect(designOnly(payload)).toEqual([
          ".Header",
          "Group / .Child",
          "Orphan",
          "_helper",
        ])
        expect(
          payload.diagnostics.some(
            d => d.code === "design-private-components-excluded",
          ),
        ).toBe(false)
      },
      {
        design: {
          provider: "figma",
          options: { includePrivateComponents: true },
        },
        designComponents: privateAndPublic,
      },
    )
  })

  it("coverage/design-missing: a contract's sources.design doesn't resolve against the census", async () => {
    await withSyntheticProject(
      async project => {
        const { stdout } = await runCapture([
          "audit",
          "--components",
          "--json",
          "--config",
          project.configPath,
        ])
        const payload = JSON.parse(stdout)
        const finding = payload.findings.find(
          f => f.ruleId === "coverage/design-missing",
        )
        expect(finding).toEqual(
          expect.objectContaining({
            ruleId: "coverage/design-missing",
            surface: "coverage",
            side: "spec",
            entity: "badge",
          }),
        )
      },
      {
        design: { provider: "figma" },
        // The badge component is dropped from the census entirely — field's
        // own address (10:20) survives, but the snapshot no longer has
        // ANYTHING at 30:40, so badge's contract can't resolve.
        designComponents: {
          components: [
            {
              fileKey: SYNTHETIC_FILE_KEYS.components,
              nodeId: "10:20",
              name: "Field",
              type: "COMPONENT_SET",
              treeHash: "field-v1",
            },
          ],
        },
      },
    )
  })

  it("--code-only suppresses design coverage even when the snapshot would otherwise flag something", async () => {
    await withSyntheticProject(
      async project => {
        const { stdout } = await runCapture([
          "audit",
          "--components",
          "--code-only",
          "--json",
          "--config",
          project.configPath,
        ])
        const payload = JSON.parse(stdout)
        const ruleIds = payload.findings.map(f => f.ruleId)
        expect(ruleIds).not.toContain("coverage/design-only")
        expect(ruleIds).not.toContain("coverage/design-missing")
      },
      {
        design: { provider: "figma" },
        designComponents: {
          components: [
            {
              fileKey: SYNTHETIC_FILE_KEYS.components,
              nodeId: "99:99",
              name: "Orphan",
              type: "COMPONENT",
              treeHash: "orphan-v1",
            },
          ],
        },
      },
    )
  })

  it("a contract with no sources.design at all stays silent, even with a snapshot present", async () => {
    await withSyntheticProject(
      async project => {
        const { stdout } = await runCapture([
          "audit",
          "--components",
          "--json",
          "--config",
          project.configPath,
        ])
        const payload = JSON.parse(stdout)
        // This component genuinely has no importer, so
        // `components/unused-component` legitimately fires for it — the
        // claim under test is narrower: no DESIGN-side rule fires for a
        // contract that never declared `sources.design` at all.
        const designFinding = payload.findings.find(
          f =>
            f.entity === "no-design-field" &&
            (f.ruleId === "coverage/design-missing" ||
              f.ruleId === "coverage/design-only"),
        )
        expect(designFinding).toBeUndefined()
      },
      {
        design: { provider: "figma" },
        components: [
          {
            name: "no-design-field",
            tsx: "export function NoDesignField() { return null }\n",
            contract: {
              id: "no-design-field",
              title: "NoDesignField",
              sources: {
                code: {
                  path: `${SYNTHETIC_PATHS.componentsDir}/no-design-field/no-design-field.tsx`,
                },
              },
            },
          },
        ],
      },
    )
  })
})

// ---------------------------------------------------------------------------
// Variant combinations (issue #403) — the whole path, contract field through
// snapshot field to finding: `invalidVariantCombinations` on the fixture's
// `field` contract, `variantCombinations` on the same component's snapshot
// entry (what `ingest --bindings` would have merged), and the rule reading
// both through the provider.
// ---------------------------------------------------------------------------

describe("design-delta audit — components/variant-combinations-mismatch (#403)", () => {
  // The fixture's Field contract declares `tone: enum ["neutral", "danger"]`
  // and its snapshot entry the matching `variantProperties` — so the implied
  // set is exactly those two, and forbidding one of them makes the design's
  // publishing of it the drift.
  function withVariants(project, { forbidden, published }) {
    const contractPath = project.paths.components.field.contract
    const contract = JSON.parse(readFileSync(contractPath, "utf8"))
    contract.invalidVariantCombinations = forbidden
    writeFileSync(contractPath, JSON.stringify(contract, null, 2))

    const snapshot = JSON.parse(
      readFileSync(project.paths.designComponentsFile, "utf8"),
    )
    snapshot.components.find(c => c.nodeId === "10:20").variantCombinations =
      published
    writeFileSync(
      project.paths.designComponentsFile,
      JSON.stringify(snapshot, null, 2),
    )
  }

  async function auditFindings(project) {
    const { code, stdout } = await runCapture([
      "audit",
      "--components",
      "--json",
      "--config",
      project.configPath,
    ])
    expect(code).toBe(0)
    return JSON.parse(stdout).findings.filter(
      f => f.ruleId === "components/variant-combinations-mismatch",
    )
  }

  it("reports a published combination the contract forbids", async () => {
    await withSyntheticProject(
      async project => {
        withVariants(project, {
          forbidden: [{ tone: "danger" }],
          published: [{ tone: "neutral" }, { tone: "danger" }],
        })
        expect(await auditFindings(project)).toEqual([
          expect.objectContaining({
            entity: "field",
            side: "design",
            severity: "review",
            data: { invalid: [{ tone: "danger" }], missing: [] },
          }),
        ])
      },
      { design: { provider: "figma" } },
    )
  })

  it("stays silent when the design publishes exactly what the contract implies", async () => {
    await withSyntheticProject(
      async project => {
        withVariants(project, {
          forbidden: [{ tone: "danger" }],
          published: [{ tone: "neutral" }],
        })
        expect(await auditFindings(project)).toEqual([])
      },
      { design: { provider: "figma" } },
    )
  })

  it("stays silent on a snapshot with no variantCombinations at all — not gathered is not empty", async () => {
    await withSyntheticProject(
      async project => {
        const contractPath = project.paths.components.field.contract
        const contract = JSON.parse(readFileSync(contractPath, "utf8"))
        contract.invalidVariantCombinations = [{ tone: "danger" }]
        writeFileSync(contractPath, JSON.stringify(contract, null, 2))
        expect(await auditFindings(project)).toEqual([])
      },
      { design: { provider: "figma" } },
    )
  })
})

describe("design-delta audit — design token value coverage (ADR-003 Phase 5.3)", () => {
  it("no design.provider configured: design token coverage stays silent even with a snapshot present", async () => {
    await withSyntheticProject(async project => {
      const { code, stdout } = await runCapture([
        "audit",
        "--tokens",
        "--json",
        "--config",
        project.configPath,
      ])
      expect(code).toBe(0)
      const payload = JSON.parse(stdout)
      const ruleIds = payload.findings.map(f => f.ruleId)
      expect(ruleIds).not.toContain("tokens/design-value-untracked")
    })
  })

  it("design.provider naming an UNKNOWN provider is a diagnostic, not silence (unlike genuinely unconfigured)", async () => {
    await withSyntheticProject(
      async project => {
        const { code, stdout } = await runCapture([
          "audit",
          "--tokens",
          "--json",
          "--config",
          project.configPath,
        ])
        expect(code).toBe(0)
        const payload = JSON.parse(stdout)
        expect(payload.skipped?.design).toMatch(/not a known provider/)
        expect(payload.diagnostics).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              code: "design-provider-invalid",
              message: expect.stringMatching(/not a known provider/),
            }),
          ]),
        )
        const ruleIds = payload.findings.map(f => f.ruleId)
        expect(ruleIds).not.toContain("tokens/design-value-untracked")
      },
      { design: { provider: "acme-design-tool" } },
    )
  })

  it("provider configured, the default fixture's design values all match a code token: zero design-value-untracked findings", async () => {
    await withSyntheticProject(
      async project => {
        const { code, stdout } = await runCapture([
          "audit",
          "--tokens",
          "--json",
          "--config",
          project.configPath,
        ])
        expect(code).toBe(0)
        const payload = JSON.parse(stdout)
        const ruleIds = payload.findings.map(f => f.ruleId)
        expect(ruleIds).not.toContain("tokens/design-value-untracked")
      },
      { design: { provider: "figma" } },
    )
  })

  it("token parity (#566): one design-only and one code-only token, with counts.tokenParity", async () => {
    await withSyntheticProject(
      async project => {
        const { stdout } = await runCapture([
          "audit",
          "--tokens",
          "--json",
          "--config",
          project.configPath,
        ])
        const payload = JSON.parse(stdout)
        const parity = payload.findings
          .filter(f =>
            [
              "tokens/design-token-unmatched",
              "tokens/code-token-undesigned",
            ].includes(f.ruleId),
          )
          .map(f => [f.ruleId, f.entity])
        expect(parity).toEqual([
          ["tokens/code-token-undesigned", "acme.color.danger"],
          ["tokens/design-token-unmatched", "brand/ink"],
        ])
        expect(payload.counts.tokenParity).toEqual({
          matched: 1,
          mismatched: 1,
          ambiguous: 0,
          designOnly: 1,
          codeOnly: 1,
        })
      },
      {
        design: { provider: "figma" },
        designTokens: {
          tokens: [
            { name: "color/fg", value: "#111111" },
            { name: "color/bg", value: "#000000" },
            { name: "brand/ink", value: "#111111" },
          ],
        },
      },
    )
  })

  it("tokenMapping (#569): a fold rule and collection prefix pair a vivid ramp", async () => {
    await withSyntheticProject(
      async project => {
        const { stdout } = await runCapture([
          "audit",
          "--tokens",
          "--json",
          "--config",
          project.configPath,
        ])
        const payload = JSON.parse(stdout)
        const touching = payload.findings
          .filter(f =>
            [
              "tokens/design-token-unmatched",
              "tokens/code-token-undesigned",
              "tokens/design-token-mismatch",
            ].includes(f.ruleId),
          )
          .map(f => [f.ruleId, f.entity])
        // Only the fixture's own unpaired defaults remain; neither side of
        // the vivid pair, and nothing from the prefix: null icons collection.
        expect(touching).toEqual([
          ["tokens/code-token-undesigned", "acme.color.bg"],
          ["tokens/code-token-undesigned", "acme.color.danger"],
        ])
        expect(payload.counts.tokenParity).toEqual({
          matched: 2,
          mismatched: 0,
          ambiguous: 0,
          designOnly: 0,
          codeOnly: 2,
        })
      },
      {
        design: { provider: "figma" },
        tokens: {
          acme: {
            color: {
              vividBlue: { 50: { $type: "color", $value: "#eaeffb" } },
            },
          },
        },
        tokenMapping: {
          collections: {
            global: { collection: "base", prefix: "acme" },
            icons: { collection: "icons", prefix: null },
          },
          aliasFoldingRules: {
            groups: {
              color: [
                {
                  when: { index: 0, endsWith: "-vivid" },
                  template: "vivid{0^~}.{1+}",
                },
              ],
            },
          },
        },
        designTokens: {
          tokens: [
            { name: "color/fg", value: "#111111", collection: "base" },
            {
              name: "color/blue-vivid/50",
              value: "#EAEFFB",
              collection: "base",
            },
            { name: "brand/icon", value: "#123456", collection: "icons" },
          ],
        },
      },
    )
  })

  it("tokens/design-value-untracked: a design token's value matches no code token anywhere", async () => {
    await withSyntheticProject(
      async project => {
        const { stdout } = await runCapture([
          "audit",
          "--tokens",
          "--json",
          "--config",
          project.configPath,
        ])
        const payload = JSON.parse(stdout)
        const finding = payload.findings.find(
          f => f.ruleId === "tokens/design-value-untracked",
        )
        expect(finding).toEqual(
          expect.objectContaining({
            ruleId: "tokens/design-value-untracked",
            surface: "tokens",
            side: "design",
            entity: "fg/orphan",
            data: { name: "fg/orphan", value: "#fedcba" },
          }),
        )
      },
      {
        design: { provider: "figma" },
        designTokens: { tokens: [{ name: "fg/orphan", value: "#fedcba" }] },
      },
    )
  })

  it("--code-only suppresses design token coverage even when the snapshot would otherwise flag something", async () => {
    await withSyntheticProject(
      async project => {
        const { stdout } = await runCapture([
          "audit",
          "--tokens",
          "--code-only",
          "--json",
          "--config",
          project.configPath,
        ])
        const payload = JSON.parse(stdout)
        const ruleIds = payload.findings.map(f => f.ruleId)
        expect(ruleIds).not.toContain("tokens/design-value-untracked")
      },
      {
        design: { provider: "figma" },
        designTokens: { tokens: [{ name: "fg/orphan", value: "#fedcba" }] },
      },
    )
  })

  it("an invalid design.options block is a diagnostic, not a crash, and the tokens surface still runs as if it were absent (#280)", async () => {
    await withSyntheticProject(
      async project => {
        const { code, stdout } = await runCapture([
          "audit",
          "--json",
          "--config",
          project.configPath,
        ])
        expect(code).toBe(0)
        const payload = JSON.parse(stdout)
        expect(payload.diagnostics).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              code: "design-options-invalid",
              message: expect.stringMatching(/tokenmap|additional/i),
            }),
          ]),
        )
        // The block was NOT applied: the orphan value is still reported,
        // which a working `ignoreVariables` would have suppressed.
        const ruleIds = payload.findings.map(f => f.ruleId)
        expect(ruleIds).toContain("tokens/design-value-untracked")
      },
      {
        design: {
          provider: "figma",
          options: { tokenmap: {}, ignoreVariables: ["fg/orphan"] },
        },
        designTokens: { tokens: [{ name: "fg/orphan", value: "#fedcba" }] },
      },
    )
  })

  it("a structured text-style entry reaches the field-level compare end to end (#380 part 2)", async () => {
    await withSyntheticProject(
      async project => {
        const { stdout } = await runCapture([
          "audit",
          "--tokens",
          "--json",
          "--config",
          project.configPath,
        ])
        const payload = JSON.parse(stdout)
        const mismatch = payload.findings.find(
          f => f.ruleId === "tokens/design-token-mismatch",
        )
        expect(mismatch).toBeDefined()
        expect(mismatch.entity).toBe("Heading/h1")
        expect(mismatch.data.fields).toEqual([
          { field: "fontWeight", design: 700, code: 600 },
        ])
      },
      {
        design: { provider: "figma" },
        tokens: {
          acme: {
            typography: {
              heading: {
                h1: {
                  $type: "typography",
                  $value: {
                    fontFamily: ["Instrument Sans"],
                    fontWeight: 600,
                    fontSize: { value: 34, unit: "px" },
                    lineHeight: 1.25,
                    letterSpacing: { value: -0.02, unit: "em" },
                  },
                },
              },
            },
          },
        },
        designTokens: {
          tokens: [
            {
              name: "Heading/h1",
              kind: "textStyle",
              value: "Font(…)",
              style: {
                fontFamily: "Instrument Sans",
                fontStyle: "Bold",
                fontSize: 34,
                lineHeight: { value: 42.5, unit: "PIXELS" },
                letterSpacing: { value: -2, unit: "PERCENT" },
              },
            },
          ],
        },
      },
    )
  })

  it("audit --json carries each design snapshot's provenance; {} for one that predates it, null for one that is absent (#389)", async () => {
    await withSyntheticProject(
      async project => {
        const { stdout } = await runCapture([
          "audit",
          "--json",
          "--config",
          project.configPath,
        ])
        const payload = JSON.parse(stdout)
        // The synthetic snapshots are written without provenance, and hold
        // nothing the provider's `staleShape` would call stale (issue #458).
        expect(payload.provenance).toEqual({
          designComponents: {},
          designTokens: {},
        })
      },
      { design: { provider: "figma" } },
    )
    await withSyntheticProject(async project => {
      const { stdout } = await runCapture([
        "audit",
        "--json",
        "--config",
        project.configPath,
      ])
      expect(JSON.parse(stdout).provenance).toBeUndefined()
    }, {})
  })

  it("a configured provider the run did not read, or could not load, is stated as such — never as absent (#389)", async () => {
    const provenanceOf = async (project, flags) => {
      const { stdout } = await runCapture([
        "audit",
        ...flags,
        "--json",
        "--config",
        project.configPath,
      ])
      return JSON.parse(stdout).provenance
    }
    await withSyntheticProject(
      async project => {
        expect(await provenanceOf(project, ["--code-only"])).toEqual({
          notConsulted: "--code-only",
        })
        // A scope with neither components nor tokens never loads the provider
        // either — the other door the same fact walks through.
        expect(await provenanceOf(project, ["--styles"])).toEqual({
          notConsulted:
            "the run's scope includes neither components nor tokens",
        })
      },
      { design: { provider: "figma" } },
    )
    await withSyntheticProject(
      async project => {
        expect(await provenanceOf(project, [])).toEqual({
          unavailable: expect.stringMatching(/not a known provider/),
        })
      },
      { design: { provider: "nope" } },
    )
  })

  // Issue #458 — a snapshot normalized by an engine older than the rules
  // reading it is a diagnostic, never a silent wrong comparison.
  it("a tokens snapshot ingested before the provider's normalizationSince is reported stale; a current one is not", async () => {
    const tokensWith = (provenance, value = "0.15") =>
      JSON.stringify({
        tokens: [{ name: "duration/fast", value, resolvedType: "TIMING" }],
        ...(provenance ? { provenance } : {}),
      })
    const auditWith = async (project, provenance, value) => {
      writeFileSync(
        join(
          project.root,
          project.config.paths.snapshotDir,
          "design-tokens.json",
        ),
        tokensWith(provenance, value),
      )
      const { stdout } = await runCapture([
        "audit",
        "--json",
        "--tokens",
        "--config",
        project.configPath,
      ])
      return JSON.parse(stdout)
    }
    await withSyntheticProject(
      async project => {
        for (const provenance of [
          undefined,
          { files: 1, engineVersion: "0.18.0" },
        ]) {
          const payload = await auditWith(project, provenance)
          expect(payload.diagnostics).toEqual(
            expect.arrayContaining([
              expect.objectContaining({
                code: "design-token-snapshot-normalization-stale",
                file: `${project.config.paths.snapshotDir}/design-tokens.json`,
                message: expect.stringMatching(/changed in 0\.18\.1/),
              }),
            ]),
          )
          expect(payload.provenance.designTokens.normalizationStale).toMatch(
            /re-run `gather --tokens` then `ingest --tokens`/,
          )
        }
        const current = await auditWith(project, {
          files: 1,
          engineVersion: "0.18.1",
        })
        expect(
          current.diagnostics.some(d => /normalization-stale/.test(d.code)),
        ).toBe(false)
        expect(
          current.provenance.designTokens.normalizationStale,
        ).toBeUndefined()
        // No version at all, but the values are already in the current form
        // — what 0.18.1 itself wrote (it stamped nothing). Measured on a real
        // census: a version-only rule called this stale, wrongly.
        const unstamped = await auditWith(project, undefined, "0.15s")
        expect(
          unstamped.diagnostics.some(d => /normalization-stale/.test(d.code)),
        ).toBe(false)
        expect(unstamped.provenance.designTokens).toEqual({})
      },
      { design: { provider: "figma" } },
    )
  })

  it("a design-tokens.json that fails schema validation is a diagnostic, not silence, and independent of design-components.json's own validity", async () => {
    await withSyntheticProject(
      async project => {
        writeFileSync(
          join(
            project.root,
            project.config.paths.snapshotDir,
            "design-tokens.json",
          ),
          JSON.stringify({ tokens: [{ name: "no value at all" }] }),
        )
        const { stdout } = await runCapture([
          "audit",
          "--json",
          "--config",
          project.configPath,
        ])
        const payload = JSON.parse(stdout)
        expect(payload.skipped?.designTokens).toMatch(
          /failed schema validation/,
        )
        expect(payload.diagnostics).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              code: "design-token-snapshot-invalid",
              file: `${project.config.paths.snapshotDir}/design-tokens.json`,
              message: expect.stringMatching(/failed schema validation/),
            }),
          ]),
        )
        // design-components.json is untouched by this override and still
        // valid — the components surface is unaffected by the tokens
        // snapshot's own failure (the two D7 files are independent).
        expect(payload.skipped?.design).toBeUndefined()
        const ruleIds = payload.findings.map(f => f.ruleId)
        expect(ruleIds).not.toContain("coverage/design-only")
      },
      { design: { provider: "figma" } },
    )
  })
})

// ---------------------------------------------------------------------------
// The anatomy surface's DESIGN half (issue #402) — the wiring, not the
// comparison. `modules-anatomy.test.js` owns what the comparison decides;
// these prove that `audit --anatomy` reaches `design-components.json` at all
// (before #402 only `--components` did), hands the layer tree to the same
// three rules, and states a reason when there is nothing to compare.
// ---------------------------------------------------------------------------

describe("audit --anatomy — the design side (issue #402)", () => {
  it("fires with side:\"design\" against the design component's layer tree, compared through a variant set's variant", async () => {
    await withSyntheticProject(
      async project => {
        const { stdout } = await runCapture([
          "audit",
          "--anatomy",
          "--json",
          "--config",
          project.configPath,
        ])
        const payload = JSON.parse(stdout)
        const design = payload.findings.filter(f => f.side === "design")

        // The component is a variant set, so `audit` carries `unit:
        // "variant-set"` onto its census entry (issue #658) and `root` is
        // compared against its variant, which carries a layer no anatomy
        // node declares. Without that field the variant itself would be
        // reported as the unexpected layer.
        expect(design).toEqual([
          expect.objectContaining({
            ruleId: "anatomy/node-unexpected",
            side: "design",
            entity: "field.root",
            data: { parent: "root", found: "Ghost" },
          }),
        ])
        expect(payload.skipped?.designAnatomy).toBeUndefined()
      },
      {
        design: { provider: "figma" },
        designComponents: {
          components: [
            {
              fileKey: SYNTHETIC_FILE_KEYS.components,
              nodeId: "10:20",
              name: "Field",
              type: "COMPONENT_SET",
              treeHash: "field-layers-v1",
              layers: {
                name: "Field",
                type: "container",
                children: [
                  {
                    name: "tone=neutral",
                    type: "container",
                    children: [{ name: "Ghost", type: "text" }],
                  },
                ],
              },
            },
          ],
        },
      },
    )
  })

  it("a snapshot gathered before the layer census asserts nothing, and says so", async () => {
    // The DEFAULT fixture — a components-only gather, which is every project
    // that has not run `gather --bindings`. Absent data is never drift, but a
    // silent pass would be indistinguishable from a clean one, so the reason
    // is stated on the `skipped` channel instead.
    await withSyntheticProject(
      async project => {
        const { stdout } = await runCapture([
          "audit",
          "--anatomy",
          "--json",
          "--config",
          project.configPath,
        ])
        const payload = JSON.parse(stdout)
        expect(payload.findings.filter(f => f.side === "design")).toEqual([])
        expect(payload.skipped.designAnatomy).toMatch(
          /no component in `design-components\.json` carries a layer tree/,
        )
      },
      { design: { provider: "figma" } },
    )
  })

  it("no provider configured: the design half is silent, exactly as every other design-side check is", async () => {
    await withSyntheticProject(async project => {
      const { stdout } = await runCapture([
        "audit",
        "--anatomy",
        "--json",
        "--config",
        project.configPath,
      ])
      const payload = JSON.parse(stdout)
      expect(payload.findings.filter(f => f.side === "design")).toEqual([])
      expect(payload.skipped?.designAnatomy).toBeUndefined()
    })
  })
})
