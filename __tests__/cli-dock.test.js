/**
 * cli-dock.test.js — `design-delta dock` (`src/cli/commands/dock.mjs`),
 * issue #221: scaffolds a generic Claude Code hook + skill wrapping
 * `verify`/`lint --json` for agent self-correction.
 *
 * Real temp directories for the fs side, same convention `cli-init.test.js`
 * uses — `runDock` takes an injectable `root`, production omitting it and
 * getting `process.cwd()`.
 */

import { spawnSync } from "node:child_process"
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

import {
  GENERATED_MARKER,
  renderHookTemplate,
  renderSkillStubTemplate,
  renderSkillTemplate,
  runDock,
} from "../src/cli/commands/dock.mjs"

let root

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "design-delta-dock-cmd-"))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

function fakeIo() {
  const out = []
  const err = []
  return {
    io: {
      stdout: { write: chunk => out.push(chunk) },
      stderr: { write: chunk => err.push(chunk) },
    },
    out: () => out.join(""),
    err: () => err.join(""),
  }
}

function ctx(overrides = {}) {
  const { io } = fakeIo()
  return { globalOpts: {}, io, root, ...overrides }
}

// ---------------------------------------------------------------------------
// Writes the two templates, under the default dir and a custom one.
// ---------------------------------------------------------------------------

describe("runDock", () => {
  it("writes the hook and both skills under the default .claude dir", () => {
    const code = runDock([], ctx())
    expect(code).toBe(0)
    expect(
      existsSync(join(root, ".claude/hooks/design-delta-verify.mjs")),
    ).toBe(true)
    expect(
      existsSync(join(root, ".claude/skills/design-delta-verify/SKILL.md")),
    ).toBe(true)
    expect(existsSync(join(root, ".claude/skills/design-delta/SKILL.md"))).toBe(
      true,
    )
  })

  it("honors --dir", () => {
    const code = runDock(["--dir", "agent-config"], ctx())
    expect(code).toBe(0)
    expect(
      existsSync(join(root, "agent-config/hooks/design-delta-verify.mjs")),
    ).toBe(true)
    expect(
      existsSync(
        join(root, "agent-config/skills/design-delta-verify/SKILL.md"),
      ),
    ).toBe(true)
    expect(
      existsSync(join(root, "agent-config/skills/design-delta/SKILL.md")),
    ).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// The --json payload shape, driven through the real io capture helper.
// ---------------------------------------------------------------------------

function runJson(argv, extraCtx = {}) {
  const out = []
  const err = []
  const io = {
    stdout: { write: chunk => out.push(chunk) },
    stderr: { write: chunk => err.push(chunk) },
  }
  const code = runDock(argv, { globalOpts: {}, io, root, ...extraCtx })
  return { code, out: out.join(""), err: err.join("") }
}

describe("runDock --json", () => {
  it("reports action 'wrote' for a fresh dir and 'up-to-date' on a rerun", () => {
    const firstRun = runJson(["--json"])
    expect(firstRun.code).toBe(0)
    const firstPayload = JSON.parse(firstRun.out)
    expect(firstPayload.command).toBe("dock")
    expect(firstPayload.dir).toBe(".claude")
    expect(firstPayload.files).toEqual([
      { path: ".claude/hooks/design-delta-verify.mjs", action: "wrote" },
      {
        path: ".claude/skills/design-delta-verify/SKILL.md",
        action: "wrote",
      },
      { path: ".claude/skills/design-delta/SKILL.md", action: "wrote" },
    ])

    const secondRun = runJson(["--json"])
    const secondPayload = JSON.parse(secondRun.out)
    expect(secondPayload.files).toEqual([
      { path: ".claude/hooks/design-delta-verify.mjs", action: "up-to-date" },
      {
        path: ".claude/skills/design-delta-verify/SKILL.md",
        action: "up-to-date",
      },
      {
        path: ".claude/skills/design-delta/SKILL.md",
        action: "up-to-date",
      },
    ])
  })

  it("--dir is reflected verbatim in the payload's paths", () => {
    const { out } = runJson(["--json", "--dir", "agent-config"])
    const payload = JSON.parse(out)
    expect(payload.dir).toBe("agent-config")
    expect(payload.files.map(f => f.path)).toEqual([
      "agent-config/hooks/design-delta-verify.mjs",
      "agent-config/skills/design-delta-verify/SKILL.md",
      "agent-config/skills/design-delta/SKILL.md",
    ])
  })

  it("an unknown flag is a parse error, exit 1, nothing written", () => {
    const { code, err } = runJson(["--bogus"])
    expect(code).toBe(1)
    expect(err).toContain('Unknown argument "--bogus"')
    expect(existsSync(join(root, ".claude"))).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Done means #4: the generated files are syntactically valid and free of
// hardcoded consumer specifics.
// ---------------------------------------------------------------------------

describe("generated template validity", () => {
  it("the hook is syntactically valid ESM", () => {
    runDock([], ctx())
    const hookPath = join(root, ".claude/hooks/design-delta-verify.mjs")
    const check = spawnSync(process.execPath, ["--check", hookPath], {
      encoding: "utf8",
    })
    expect(check.status).toBe(0)
  })

  it("the hook shells out to the design-delta CLI itself, not a project-specific path", () => {
    const hook = renderHookTemplate()
    expect(hook).toContain('"design-delta", "verify", "--json"')
  })

  it("the hook's wiring comment points at the dir the hook was written into", () => {
    expect(renderHookTemplate()).toContain(
      '"command": "node .claude/hooks/design-delta-verify.mjs"',
    )

    runDock(["--dir", "agent-config"], ctx())
    const hook = readFileSync(
      join(root, "agent-config/hooks/design-delta-verify.mjs"),
      "utf8",
    )
    expect(hook).toContain(
      '"command": "node agent-config/hooks/design-delta-verify.mjs"',
    )
    expect(hook).not.toContain(".claude/hooks/design-delta-verify.mjs")
  })

  it("the hook's failure message reports no finding count", () => {
    // `verify --json`'s `findings.total` counts every severity, not just the
    // gating ones, and contract diagnostics fail a run with no findings —
    // so the hook names the gate it failed and never a number.
    const hook = renderHookTemplate()
    expect(hook).toContain('did not pass its "${report.failOn}" gate')
    expect(hook).not.toContain("report.findings")
    expect(hook).not.toMatch(/finding\(s\)/)
  })

  it("the skill declares valid frontmatter with a name and description", () => {
    const skill = renderSkillTemplate()
    expect(skill.startsWith("---\n")).toBe(true)
    const frontmatter = skill.slice(4, skill.indexOf("\n---", 4))
    expect(frontmatter).toMatch(/^name: design-delta-verify$/m)
    expect(frontmatter).toMatch(/^description: .+$/m)
  })

  it("neither template names a specific consumer project, path, or component", () => {
    const CONSUMER_SPECIFIC_TERMS = [
      "example-org/example-app",
      "acme",
      "widget",
      "figma",
      "src/components",
    ]
    for (const template of [renderHookTemplate(), renderSkillTemplate()]) {
      for (const term of CONSUMER_SPECIFIC_TERMS) {
        expect(template.toLowerCase()).not.toContain(term.toLowerCase())
      }
      // Every command invoked is a `design-delta` subcommand this package
      // itself defines — never a project-specific script.
      const invocations = [...template.matchAll(/npx design-delta (\w+)/g)].map(
        m => m[1],
      )
      expect(invocations.length).toBeGreaterThan(0)
      for (const sub of invocations) {
        expect(["verify", "lint"]).toContain(sub)
      }
    }
  })

  it("writing into a real temp directory embeds no absolute host path into either file's content", () => {
    runDock([], ctx())
    const hook = readFileSync(
      join(root, ".claude/hooks/design-delta-verify.mjs"),
      "utf8",
    )
    const skill = readFileSync(
      join(root, ".claude/skills/design-delta-verify/SKILL.md"),
      "utf8",
    )
    expect(hook).not.toContain(root)
    expect(skill).not.toContain(root)
  })
})

// ---------------------------------------------------------------------------
// The linked skill stub (issue #336) — trigger frontmatter + a pointer to
// the canonical skill this package ships, no engine prose of its own.
// ---------------------------------------------------------------------------

describe("renderSkillStubTemplate", () => {
  it("declares valid frontmatter naming the canonical skill", () => {
    const stub = renderSkillStubTemplate()
    expect(stub.startsWith("---\n")).toBe(true)
    const frontmatter = stub.slice(4, stub.indexOf("\n---", 4))
    expect(frontmatter).toMatch(/^name: design-delta$/m)
    expect(frontmatter).toMatch(/^description: .+$/m)
  })

  it("links to the packaged canonical skill and names no consumer specifics", () => {
    const stub = renderSkillStubTemplate()
    expect(stub).toContain(
      "node_modules/design-delta/skills/design-delta/SKILL.md",
    )
    for (const term of ["example-org/example-app", "acme", "widget", "figma"]) {
      expect(stub.toLowerCase()).not.toContain(term.toLowerCase())
    }
  })

  it("is written at skills/design-delta/SKILL.md, distinct from the verify skill", () => {
    runDock([], ctx())
    expect(existsSync(join(root, ".claude/skills/design-delta/SKILL.md"))).toBe(
      true,
    )
    const stub = readFileSync(
      join(root, ".claude/skills/design-delta/SKILL.md"),
      "utf8",
    )
    expect(stub).not.toContain(root)
  })
})

// ---------------------------------------------------------------------------
// The stub's overwrite guard. `skills/design-delta/` is a name a consumer's
// OWN skill can already occupy — unlike the hook and the verify skill, which
// this package named for itself — so a file there without the generated-by
// marker must survive `dock` byte-for-byte.
// ---------------------------------------------------------------------------

const STUB_PATH = ".claude/skills/design-delta/SKILL.md"

function writeExistingStub(content) {
  const abs = join(root, STUB_PATH)
  mkdirSync(dirname(abs), { recursive: true })
  writeFileSync(abs, content)
  return abs
}

describe("the linked stub's generated-by guard", () => {
  it("the generated template carries the marker", () => {
    expect(renderSkillStubTemplate()).toContain(GENERATED_MARKER)
  })

  it("leaves a consumer's own skill at that path untouched, reporting 'skipped'", () => {
    const hand = "---\nname: design-delta\n---\n\nOur own house rules.\n"
    const abs = writeExistingStub(hand)

    const { out } = runJson(["--json"])
    const payload = JSON.parse(out)
    expect(payload.files).toContainEqual({
      path: STUB_PATH,
      action: "skipped",
    })
    expect(readFileSync(abs, "utf8")).toBe(hand)
  })

  it("still refreshes a stale file that carries the marker", () => {
    const stale = `An older stub.\n\n${GENERATED_MARKER} — old wording.\n`
    const abs = writeExistingStub(stale)

    const { out } = runJson(["--json"])
    const payload = JSON.parse(out)
    expect(payload.files).toContainEqual({ path: STUB_PATH, action: "wrote" })
    expect(readFileSync(abs, "utf8")).toBe(renderSkillStubTemplate())
  })

  it("does not guard the hook or the verify skill, which this package names", () => {
    const hookAbs = join(root, ".claude/hooks/design-delta-verify.mjs")
    const skillAbs = join(root, ".claude/skills/design-delta-verify/SKILL.md")
    for (const abs of [hookAbs, skillAbs]) {
      mkdirSync(dirname(abs), { recursive: true })
      writeFileSync(abs, "stale, no marker\n")
    }

    const { out } = runJson(["--json"])
    const actions = Object.fromEntries(
      JSON.parse(out).files.map(f => [f.path, f.action]),
    )
    expect(actions[".claude/hooks/design-delta-verify.mjs"]).toBe("wrote")
    expect(actions[".claude/skills/design-delta-verify/SKILL.md"]).toBe("wrote")
  })

  it("the human output marks a skip and says why", () => {
    writeExistingStub("Our own house rules.\n")
    const { io, out } = fakeIo()
    expect(runDock([], { globalOpts: {}, io, root })).toBe(0)
    expect(out()).toContain(`SKIP   ${STUB_PATH}`)
    expect(out()).toContain("left untouched")
  })
})
