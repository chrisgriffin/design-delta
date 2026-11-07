/**
 * cli-staged.test.js — `--staged` incremental mode on `audit` and `verify`
 * (issue #220), driven through `main.mjs`'s `run` for the same reason
 * `cli-audit.test.js` is: the whole path a consumer actually takes.
 *
 * Runs against `__tests__/helpers/synthetic-project.mjs`, `git init`ed and
 * with specific files staged. A REAL git index rather than an injected file
 * list, deliberately: the thing under test is "does the engine agree with
 * git about what is staged", and a stubbed list would agree with itself no
 * matter what `git diff --staged --name-only --relative` actually prints.
 * Nothing is ever committed — `git diff --staged` reports against the empty
 * tree in a repo with no HEAD, which is exactly the pre-first-commit state a
 * pre-commit hook can encounter.
 *
 * THE CONTROL RUN IS THE POINT. "No finding appeared" is worthless on its own
 * — a broken scope produces it too. So every scoping case pairs the staged
 * run with the same project audited WITHOUT `--staged`, and asserts the
 * finding is there. The difference between the two runs is the assertion.
 */

import { execFileSync } from "node:child_process"
import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { run } from "../src/cli/main.mjs"
import {
  createSyntheticProject,
  SYNTHETIC_FILE_KEYS,
  SYNTHETIC_PATHS,
} from "./helpers/synthetic-project.mjs"

const SKIP_REASON =
  "requires full-codebase visibility, incompatible with --staged"

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

function git(root, args) {
  execFileSync("git", args, { cwd: root, stdio: "ignore" })
}

// `-f` bypasses any ignore rule a developer's GLOBAL gitconfig might apply to
// a temp directory — the fixture's own paths are never ignored by anything in
// the repo, and a machine-specific exclude silently emptying the scope would
// make this suite pass for the wrong reason.
function stage(root, ...paths) {
  git(root, ["add", "-f", "--", ...paths])
}

/**
 * A materialized synthetic project that is also a git repo. Mirrors
 * `cli-audit.test.js`'s `withSyntheticProject` — `audit` resolves every path
 * against `process.cwd()`, so the cwd is restored even on failure.
 */
async function withStagedProject(fn, overrides) {
  const project = createSyntheticProject(overrides)
  git(project.root, ["init", "-q"])
  const originalCwd = process.cwd()
  process.chdir(project.root)
  try {
    return await fn(project)
  } finally {
    process.chdir(originalCwd)
    project.cleanup()
  }
}

const ruleIds = payload => payload.findings.map(finding => finding.ruleId)

const entityFor = (payload, ruleId) =>
  payload.findings
    .filter(finding => finding.ruleId === ruleId)
    .map(f => f.entity)

// A component under `paths.componentsDir` that NO contract references — the
// exact condition `coverage/uncontracted-component` fires on. Written after
// materialization rather than through the harness's `components` override,
// which expects every entry to carry a contract.
function writeOrphanComponent(root) {
  const dir = join(root, SYNTHETIC_PATHS.componentsDir, "orphan")
  mkdirSync(dir, { recursive: true })
  writeFileSync(
    join(dir, "orphan.tsx"),
    `export type OrphanProps = {
  label: string
}

export function Orphan({ label }: OrphanProps) {
  return <em className="acmeOrphan">{label}</em>
}
`,
  )
  return `${SYNTHETIC_PATHS.componentsDir}/orphan/orphan.tsx`
}

describe("audit --staged — what is in scope", () => {
  it("still reports a staged component's own findings", async () => {
    await withStagedProject(async project => {
      // `badge` carries the fixture's one deliberate code-side drift (its
      // contract declares a "lg" size the component does not ship).
      stage(project.root, `${SYNTHETIC_PATHS.componentsDir}/badge/badge.tsx`)

      const { code, stdout } = await runCapture([
        "audit",
        "--staged",
        "--json",
        "--config",
        project.configPath,
      ])

      expect(code).toBe(0)
      const payload = JSON.parse(stdout)
      expect(payload.counts.components).toBe(1)
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

  it("does not report an unstaged component's findings", async () => {
    await withStagedProject(async project => {
      // `field` is clean; `badge` is the one with drift. Staging only field
      // must leave badge's finding out of the report entirely.
      stage(project.root, `${SYNTHETIC_PATHS.componentsDir}/field/field.tsx`)

      const staged = JSON.parse(
        (
          await runCapture([
            "audit",
            "--staged",
            "--json",
            "--config",
            project.configPath,
          ])
        ).stdout,
      )
      const full = JSON.parse(
        (await runCapture(["audit", "--json", "--config", project.configPath]))
          .stdout,
      )

      // The control: without --staged, badge's drift IS reported.
      expect(entityFor(full, "components/enum-values-mismatch")).toEqual([
        "badge",
      ])
      expect(ruleIds(staged)).not.toContain("components/enum-values-mismatch")
      expect(staged.counts.components).toBe(1)
    })
  })

  it("checks a staged component against the FULL token census, not a staged one", async () => {
    await withStagedProject(async project => {
      // field's stylesheet USES `--acme-color-fg`/`--acme-color-bg` and
      // declares neither. Both are accounted for by tokens.json — which is
      // NOT staged. If the token census were staged-scoped along with the
      // code, it would be empty and both vars would fire
      // `tokens/var-unresolved` at ERROR severity (Done means #2).
      stage(
        project.root,
        `${SYNTHETIC_PATHS.componentsDir}/field/field.styles.scss`,
      )

      const { code, stdout } = await runCapture([
        "audit",
        "--staged",
        "--check",
        "--json",
        "--config",
        project.configPath,
      ])

      const payload = JSON.parse(stdout)
      expect(payload.counts.tokens).toBe(3) // the whole token file, unscoped
      expect(payload.counts.cssVars).toBe(2) // only the staged stylesheet's
      expect(ruleIds(payload)).not.toContain("tokens/var-unresolved")
      expect(code).toBe(0) // --check: no error-severity finding at all
    })
  })
})

describe("audit --staged — the rules it skips, and why", () => {
  it("skips coverage/contract-only rather than calling an unstaged component missing", async () => {
    await withStagedProject(async project => {
      stage(project.root, `${SYNTHETIC_PATHS.componentsDir}/badge/badge.tsx`)

      const payload = JSON.parse(
        (
          await runCapture([
            "audit",
            "--staged",
            "--json",
            "--config",
            project.configPath,
          ])
        ).stdout,
      )

      // Exactly the state the rule fires on: two contracts loaded, one
      // component censused — field's contract now points at code this run
      // never looked at.
      expect(payload.counts.contracts).toBe(2)
      expect(payload.counts.components).toBe(1)
      expect(ruleIds(payload)).not.toContain("coverage/contract-only")
      expect(payload.skipped["coverage/contract-only"]).toBe(SKIP_REASON)
    })
  })

  it("skips coverage/uncontracted-component, which a full run reports", async () => {
    await withStagedProject(async project => {
      const orphan = writeOrphanComponent(project.root)
      stage(project.root, orphan)

      const staged = JSON.parse(
        (
          await runCapture([
            "audit",
            "--staged",
            "--json",
            "--config",
            project.configPath,
          ])
        ).stdout,
      )
      const full = JSON.parse(
        (await runCapture(["audit", "--json", "--config", project.configPath]))
          .stdout,
      )

      // The control: the orphan IS reported when the whole tree is in scope.
      expect(entityFor(full, "coverage/uncontracted-component")).toEqual([
        orphan,
      ])
      // ...and the staged run censused it (so the rule had its input) and
      // still said nothing.
      expect(staged.counts.components).toBe(1)
      expect(ruleIds(staged)).not.toContain("coverage/uncontracted-component")
      expect(staged.skipped["coverage/uncontracted-component"]).toBe(
        SKIP_REASON,
      )
    })
  })

  it("skips coverage/design-only, which a full run reports (ADR-003 Phase 5.1)", async () => {
    await withStagedProject(
      async project => {
        stage(project.root, `${SYNTHETIC_PATHS.componentsDir}/badge/badge.tsx`)

        const staged = JSON.parse(
          (
            await runCapture([
              "audit",
              "--staged",
              "--components",
              "--json",
              "--config",
              project.configPath,
            ])
          ).stdout,
        )
        const full = JSON.parse(
          (
            await runCapture([
              "audit",
              "--components",
              "--json",
              "--config",
              project.configPath,
            ])
          ).stdout,
        )

        // The control: a full (unstaged) run reports the orphan design
        // component — a git diff never touches Figma, so `designCensus` is
        // never staged-scoped either way.
        expect(ruleIds(full)).toContain("coverage/design-only")
        expect(ruleIds(staged)).not.toContain("coverage/design-only")
        expect(staged.skipped["coverage/design-only"]).toBe(SKIP_REASON)
        expect(staged.skipped["coverage/design-missing"]).toBe(SKIP_REASON)
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

  it("skips tokens/design-value-untracked, which a full run reports (ADR-003 Phase 5.3)", async () => {
    await withStagedProject(
      async project => {
        stage(project.root, `${SYNTHETIC_PATHS.componentsDir}/badge/badge.tsx`)

        const staged = JSON.parse(
          (
            await runCapture([
              "audit",
              "--staged",
              "--tokens",
              "--json",
              "--config",
              project.configPath,
            ])
          ).stdout,
        )
        const full = JSON.parse(
          (
            await runCapture([
              "audit",
              "--tokens",
              "--json",
              "--config",
              project.configPath,
            ])
          ).stdout,
        )

        // The control: a full (unstaged) run reports the untracked design
        // value — a git diff never touches Figma, so `designTokenCensus` is
        // never staged-scoped either way.
        expect(ruleIds(full)).toContain("tokens/design-value-untracked")
        expect(ruleIds(staged)).not.toContain("tokens/design-value-untracked")
        expect(staged.skipped["tokens/design-value-untracked"]).toBe(
          SKIP_REASON,
        )
      },
      {
        design: { provider: "figma" },
        designTokens: { tokens: [{ name: "fg/orphan", value: "#fedcba" }] },
      },
    )
  })

  it("skips coverage/stale-exemption, which a full run reports", async () => {
    await withStagedProject(
      async project => {
        stage(project.root, `${SYNTHETIC_PATHS.componentsDir}/badge/badge.tsx`)

        const staged = JSON.parse(
          (
            await runCapture([
              "audit",
              "--staged",
              "--json",
              "--config",
              project.configPath,
            ])
          ).stdout,
        )
        const full = JSON.parse(
          (
            await runCapture([
              "audit",
              "--json",
              "--config",
              project.configPath,
            ])
          ).stdout,
        )

        expect(entityFor(full, "coverage/stale-exemption")).toEqual([
          "no-such-component",
        ])
        expect(ruleIds(staged)).not.toContain("coverage/stale-exemption")
        expect(staged.skipped["coverage/stale-exemption"]).toBe(SKIP_REASON)
      },
      {
        // A waiver pointing at an entity no rule will ever report — stale by
        // construction, so the full run has something to find.
        exemptions: {
          "components/prop-missing": ["no-such-component"],
        },
      },
    )
  })

  it("skips tokens/token-unreferenced, which a staged scope can only get wrong", async () => {
    await withStagedProject(async project => {
      stage(project.root, `${SYNTHETIC_PATHS.componentsDir}/badge/badge.tsx`)

      const staged = JSON.parse(
        (
          await runCapture([
            "audit",
            "--staged",
            "--json",
            "--config",
            project.configPath,
          ])
        ).stdout,
      )
      const full = JSON.parse(
        (await runCapture(["audit", "--json", "--config", project.configPath]))
          .stdout,
      )

      // The control: a FULL run reports exactly one genuinely unreferenced
      // token. Staging one component leaves the other two tokens' stylesheets
      // out of scope, which would report all three.
      expect(entityFor(full, "tokens/token-unreferenced")).toEqual([
        "acme.color.danger",
      ])
      expect(ruleIds(staged)).not.toContain("tokens/token-unreferenced")
      expect(staged.skipped["tokens/token-unreferenced"]).toBe(SKIP_REASON)
      // Its other half is the same codebase-wide claim (#562).
      expect(staged.skipped["tokens/token-unemitted"]).toBe(SKIP_REASON)
    })
  })

  it("names every skipped rule in the human report too", async () => {
    await withStagedProject(async project => {
      stage(project.root, `${SYNTHETIC_PATHS.componentsDir}/badge/badge.tsx`)

      const { stdout } = await runCapture([
        "audit",
        "--staged",
        "--config",
        project.configPath,
      ])

      for (const ruleId of [
        "coverage/uncontracted-component",
        "coverage/contract-only",
        "coverage/stale-exemption",
        "tokens/token-unreferenced",
      ]) {
        expect(stdout).toContain(`${ruleId} check skipped: ${SKIP_REASON}`)
      }
    })
  })

  it("skips the anatomy surface's DESIGN half, which a full run reports (issue #402)", async () => {
    // A SURFACE skip, not a rule skip: `anatomy/node-unexpected` is the code
    // side's rule id too, so skipping it by id would silence the half that
    // IS staged-scoped. Same reasoning as `coverage/design-only` above —
    // neither the design census nor the contract list is staged-scoped.
    await withStagedProject(
      async project => {
        stage(project.root, `${SYNTHETIC_PATHS.componentsDir}/badge/badge.tsx`)

        const auditAnatomy = async extra =>
          JSON.parse(
            (
              await runCapture([
                "audit",
                ...extra,
                "--anatomy",
                "--json",
                "--config",
                project.configPath,
              ])
            ).stdout,
          )
        const staged = await auditAnatomy(["--staged"])
        const full = await auditAnatomy([])

        const designSide = payload =>
          payload.findings.filter(f => f.side === "design")
        expect(designSide(full).map(f => f.ruleId)).toContain(
          "anatomy/node-unexpected",
        )
        expect(designSide(staged)).toEqual([])
        expect(staged.skipped.designAnatomy).toBe(SKIP_REASON)
        // The CODE half is untouched by the design half's skip.
        expect(staged.skipped.anatomy).toBeUndefined()
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
              // A variant set's children are its variants (issue #658).
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
})

describe("audit --staged — the edges", () => {
  it("an empty staged diff is a clean, empty scope — not an error, not a full run", async () => {
    await withStagedProject(async project => {
      // Nothing staged at all.
      const { code, stdout, stderr } = await runCapture([
        "audit",
        "--staged",
        "--check",
        "--json",
        "--config",
        project.configPath,
      ])

      expect(stderr).not.toContain("design-delta audit:")
      expect(code).toBe(0)
      const payload = JSON.parse(stdout)
      expect(payload.findings).toEqual([])
      expect(payload.counts.findings).toBe(0)
      // Empty SCOPE, not "the flag did nothing": every code-side census is
      // empty while the comparison targets are intact.
      expect(payload.counts.components).toBe(0)
      expect(payload.counts.anatomyComponents).toBe(0)
      expect(payload.counts.styleFiles).toBe(0)
      expect(payload.counts.cssVars).toBe(0)
      expect(payload.counts.contracts).toBe(2)
      expect(payload.counts.tokens).toBe(3)
    })
  })

  it("fails loudly when the staged list cannot be read at all", async () => {
    // No `git init` — "not a repository" is not the same answer as "nothing
    // is staged", and reporting a clean run over a scope that was never
    // established is the dishonest output D8 exists to prevent.
    const project = createSyntheticProject()
    const originalCwd = process.cwd()
    process.chdir(project.root)
    try {
      const { code, stderr } = await runCapture([
        "audit",
        "--staged",
        "--json",
        "--config",
        project.configPath,
      ])
      expect(code).toBe(1)
      expect(stderr).toContain("--staged: could not read the staged file list")
    } finally {
      process.chdir(originalCwd)
      project.cleanup()
    }
  })
})

describe("verify --staged", () => {
  it("gates on the staged scope, passing where a full run fails", async () => {
    await withStagedProject(async project => {
      // badge's enum drift is error-severity, so a full `verify` fails.
      // Staging only the clean component must leave the gate green.
      stage(project.root, `${SYNTHETIC_PATHS.componentsDir}/field/field.tsx`)

      const full = await runCapture([
        "verify",
        "--json",
        "--config",
        project.configPath,
      ])
      expect(full.code).toBe(1)
      expect(JSON.parse(full.stdout).ok).toBe(false)

      const staged = await runCapture([
        "verify",
        "--staged",
        "--json",
        "--config",
        project.configPath,
      ])
      expect(staged.code).toBe(0)
      expect(JSON.parse(staged.stdout).ok).toBe(true)
    })
  })

  it("still fails on the staged component's own drift", async () => {
    await withStagedProject(async project => {
      stage(project.root, `${SYNTHETIC_PATHS.componentsDir}/badge/badge.tsx`)

      const { code, stdout } = await runCapture([
        "verify",
        "--staged",
        "--json",
        "--config",
        project.configPath,
      ])

      expect(code).toBe(1)
      const payload = JSON.parse(stdout)
      expect(payload.ok).toBe(false)
      expect(payload.findings.counts.error).toBe(1)
    })
  })

  it("validates every contract regardless of what is staged", async () => {
    await withStagedProject(async project => {
      stage(project.root, `${SYNTHETIC_PATHS.componentsDir}/field/field.tsx`)

      const payload = JSON.parse(
        (
          await runCapture([
            "verify",
            "--staged",
            "--json",
            "--config",
            project.configPath,
          ])
        ).stdout,
      )

      // Contract validity is the fixed point every other check compares
      // against — never scoped by what a commit happens to touch.
      expect(payload.contracts.checked).toBe(2)
    })
  })

  it("computes no health score — Token Health's denominator and lint are never staged-scoped", async () => {
    await withStagedProject(async project => {
      stage(project.root, `${SYNTHETIC_PATHS.componentsDir}/field/field.tsx`)

      const { stdout } = await runCapture([
        "verify",
        "--staged",
        "--fail-on",
        "none",
        "--json",
        "--config",
        project.configPath,
      ])
      const payload = JSON.parse(stdout)
      expect(payload.healthScore).toBeNull()
      expect(payload.healthScorePillars).toBeNull()
    })
  })

  it("rejects --fail-below outright rather than gate on a score it cannot honestly compute", async () => {
    await withStagedProject(async project => {
      stage(project.root, `${SYNTHETIC_PATHS.componentsDir}/field/field.tsx`)

      const { code, stderr } = await runCapture([
        "verify",
        "--staged",
        "--fail-below",
        "85",
        "--config",
        project.configPath,
      ])
      expect(code).toBe(1)
      expect(stderr).toContain("--fail-below is not supported with --staged")
    })
  })
})
