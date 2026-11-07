/**
 * cli-map.test.js — `design-delta map` (`src/cli/commands/map.mjs`, issue
 * #259): the system-wide ownership overview.
 *
 * Uses the default synthetic fixture (`field` + `badge`, both contracted)
 * plus a third, contract-less "toolbar" component for `uncontracted`, then
 * deletes `badge`'s own `.tsx` on disk (mirroring `cli-audit.test.js`'s own
 * "a components directory with nothing in it" case) so its still-present
 * contract has no code to match — `contract-only`. The fixture's default
 * tokens (`acme.color.fg`/`bg`/`danger`) already carry a real
 * referenced/unreferenced split (`danger` is declared but never used) —
 * see `synthetic-project.mjs`'s own docblock — so no token override is
 * needed to exercise that half.
 *
 * Drives `runMap(cmdArgv, ctx)` directly, the same testable seam
 * `cli-movers.test.js`/`cli-impact.test.js` use.
 */

import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { runMap } from "../src/cli/commands/map.mjs"
import {
  createSyntheticProject,
  SYNTHETIC_PATHS,
} from "./helpers/synthetic-project.mjs"

function customComponents() {
  const dir = SYNTHETIC_PATHS.componentsDir
  return [
    {
      name: "field",
      tsx: `import type { HTMLAttributes } from "react"

export type FieldProps = {
  tone?: "neutral" | "danger"
  label: string
} & HTMLAttributes<HTMLDivElement>

export function Field({ tone = "neutral", label }: FieldProps) {
  return (
    <div className="acmeField" data-tone={tone}>
      {label}
    </div>
  )
}
`,
      styles: `.acmeField {
  color: var(--acme-color-fg);
  background-color: var(--acme-color-bg);
}
`,
      contract: {
        id: "field",
        title: "Field",
        status: "published",
        sources: {
          code: {
            path: `${dir}/field/field.tsx`,
            styles: `${dir}/field/field.styles.scss`,
          },
        },
        props: { label: { type: "string" } },
      },
    },
    {
      name: "badge",
      tsx: `export type BadgeProps = { label: string }

export function Badge({ label }: BadgeProps) {
  return <span className="acmeBadge">{label}</span>
}
`,
      styles: `.acmeBadge {
  color: var(--acme-color-fg);
}
`,
      contract: {
        id: "badge",
        title: "Badge",
        status: "published",
        sources: {
          code: {
            path: `${dir}/badge/badge.tsx`,
            styles: `${dir}/badge/badge.styles.scss`,
          },
        },
        props: { label: { type: "string" } },
      },
    },
    {
      name: "toolbar",
      // No `contract` key at all — never gets a *.spec.json, so this reads as
      // a component with no contract referencing it: `coverage/uncontracted-
      // component`.
      tsx: `export function Toolbar() {
  return null
}
`,
    },
  ]
}

function fakeStream() {
  const writes = []
  return { stream: { write: chunk => writes.push(chunk) }, writes }
}

async function runCapture(cmdArgv, { config } = {}) {
  const { stream: stdout, writes: stdoutWrites } = fakeStream()
  const { stream: stderr, writes: stderrWrites } = fakeStream()
  const code = await runMap(cmdArgv, {
    globalOpts: { config },
    io: { stdout, stderr },
    bus: undefined,
  })
  return { code, stdout: stdoutWrites.join(""), stderr: stderrWrites.join("") }
}

async function withSyntheticProject(fn) {
  const project = createSyntheticProject({ components: customComponents() })
  const originalCwd = process.cwd()
  process.chdir(project.root)
  try {
    return await fn(project)
  } finally {
    process.chdir(originalCwd)
    project.cleanup()
  }
}

describe("design-delta map", () => {
  it("--json reports contracted/uncontracted/contract-only components and token coverage", async () => {
    await withSyntheticProject(async project => {
      // Badge's contract stays on disk; only the code it points at goes away
      // — a contract with no code, `coverage/contract-only`.
      rmSync(project.paths.components.badge.tsx)
      rmSync(project.paths.components.badge.styles)

      const { code, stdout } = await runCapture(["--json"], {
        config: project.configPath,
      })
      expect(code).toBe(0)
      expect(JSON.parse(stdout)).toEqual({
        command: "map",
        components: {
          contracted: 1,
          uncontracted: [
            `${SYNTHETIC_PATHS.componentsDir}/toolbar/toolbar.tsx`,
          ],
          contractOnly: ["badge"],
          draft: [],
        },
        tokens: { total: 3, referenced: 2, unreferenced: 1 },
        exempted: 0,
      })
    })
  })

  it("counts a token-unemitted token as unreferenced too (#562)", async () => {
    await withSyntheticProject(async project => {
      // The fixture's style root is absent by default, which keeps
      // `tokens/token-unemitted` silent. On disk and empty, it lets the engine
      // see that nothing declares `danger`'s var, so that token moves from
      // token-unreferenced to token-unemitted — and must still count here.
      mkdirSync(join(project.root, SYNTHETIC_PATHS.styleRoots[0]), {
        recursive: true,
      })

      const { code, stdout } = await runCapture(["--json"], {
        config: project.configPath,
      })
      expect(code).toBe(0)
      expect(JSON.parse(stdout).tokens).toEqual({
        total: 3,
        referenced: 2,
        unreferenced: 1,
      })
    })
  })

  it("non-JSON output names the counts and lists each entity", async () => {
    await withSyntheticProject(async project => {
      rmSync(project.paths.components.badge.tsx)
      rmSync(project.paths.components.badge.styles)

      const { code, stdout } = await runCapture([], {
        config: project.configPath,
      })
      expect(code).toBe(0)
      expect(stdout).toBe(
        [
          "1 contracted component(s), 1 uncontracted, 1 contract-only, 0 draft",
          `  uncontracted: ${SYNTHETIC_PATHS.componentsDir}/toolbar/toolbar.tsx`,
          "  contract-only: badge",
          "3 token(s) censused — 2 not flagged unreferenced, 1 unreferenced",
          "",
        ].join("\n"),
      )
    })
  })

  it("a fully contracted, fully referenced project reports zero unmanaged surface", async () => {
    await withSyntheticProject(async project => {
      // Removing only `toolbar` (never contracted) leaves field + badge, both
      // matched — nothing uncontracted, nothing contract-only.
      rmSync(`${project.paths.componentsDir}/toolbar`, {
        recursive: true,
        force: true,
      })

      const { code, stdout } = await runCapture(["--json"], {
        config: project.configPath,
      })
      expect(code).toBe(0)
      const payload = JSON.parse(stdout)
      expect(payload.components).toEqual({
        contracted: 2,
        uncontracted: [],
        contractOnly: [],
        draft: [],
      })
      expect(payload.exempted).toBe(0)
    })
  })

  it("surfaces exempted findings rather than silently counting them as contracted/referenced", async () => {
    await withSyntheticProject(async project => {
      // Badge's contract stays on disk, its code goes away (contract-only) —
      // but exempted this time, so `applyExemptions` drops the finding
      // before `map` ever sees it. `contracted` still reads 1 (badge folds
      // back in, indistinguishable from a genuinely contracted component at
      // this command's level) — `exempted` is the only signal a reader has
      // that one of these counts isn't fully confirmed.
      rmSync(project.paths.components.badge.tsx)
      rmSync(project.paths.components.badge.styles)

      const configWithExemption = JSON.parse(
        readFileSync(project.configPath, "utf8"),
      )
      configWithExemption.exemptions = {
        "coverage/contract-only": ["badge"],
      }
      writeFileSync(project.configPath, JSON.stringify(configWithExemption))

      const { code, stdout } = await runCapture(["--json"], {
        config: project.configPath,
      })
      expect(code).toBe(0)
      const payload = JSON.parse(stdout)
      expect(payload.components.contracted).toBe(2)
      expect(payload.components.contractOnly).toEqual([])
      expect(payload.exempted).toBe(1)
    })
  })

  it("gives a draft contract (no sources.code.path at all) its own bucket, never counted as contracted", async () => {
    await withSyntheticProject(async project => {
      // Neither coverage/uncontracted-component nor coverage/contract-only
      // ever fires for this — modules/components.mjs skips it silently, on
      // purpose, since there's nothing yet to compare against.
      writeFileSync(
        join(project.paths.contractsDir, "draft-widget.spec.json"),
        JSON.stringify({ id: "draft-widget", title: "DraftWidget" }),
      )

      const { code, stdout } = await runCapture(["--json"], {
        config: project.configPath,
      })
      expect(code).toBe(0)
      const payload = JSON.parse(stdout)
      expect(payload.components.draft).toEqual(["draft-widget"])
      // field + badge only — the draft contract never inflates `contracted`.
      expect(payload.components.contracted).toBe(2)
    })
  })

  it("reports tokens: null and surfaces the skip reason when the tokens census fails", async () => {
    await withSyntheticProject(async project => {
      writeFileSync(project.paths.tokensFile, "{ not valid json")

      const { code, stdout } = await runCapture(["--json"], {
        config: project.configPath,
      })
      expect(code).toBe(0)
      const payload = JSON.parse(stdout)
      expect(payload.tokens).toBeNull()
      expect(payload.skipped.tokens).toBeTruthy()
      // Components still ran — a skip on one surface must not blank the other.
      expect(payload.components).not.toBeNull()
    })
  })

  it("non-JSON output names a skipped surface instead of a confident zero", async () => {
    await withSyntheticProject(async project => {
      writeFileSync(project.paths.tokensFile, "{ not valid json")

      const { code, stdout } = await runCapture([], {
        config: project.configPath,
      })
      expect(code).toBe(0)
      expect(stdout).toContain("tokens: skipped —")
      expect(stdout).not.toContain("token(s) censused")
    })
  })

  it("rejects an unknown flag", async () => {
    await withSyntheticProject(async project => {
      const { code, stderr } = await runCapture(["--bogus"], {
        config: project.configPath,
      })
      expect(code).toBe(1)
      expect(stderr).toContain('Unknown argument "--bogus"')
    })
  })
})
