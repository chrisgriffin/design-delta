/**
 * cli-dock.test.js — `design-delta dock` (`src/cli/commands/dock.mjs`),
 * issue #221: scaffolds a generic Claude Code hook + skill wrapping
 * `verify`/`lint --json` for agent self-correction, plus a linked stub for
 * each consumer-facing skill this package ships.
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
import { fileURLToPath } from "node:url"

import yaml from "js-yaml"

import {
  GENERATED_MARKER,
  LINKED_SKILLS,
  renderHookTemplate,
  renderPackagedSkillStubTemplate,
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
// Writes every template, under the default dir and a custom one.
// ---------------------------------------------------------------------------

describe("runDock", () => {
  it("writes the hook, the verify skill and every linked stub under the default .claude dir", () => {
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
    expect(
      existsSync(join(root, ".claude/skills/design-delta-build/SKILL.md")),
    ).toBe(true)
    expect(
      existsSync(join(root, ".claude/skills/design-delta-author/SKILL.md")),
    ).toBe(true)
    expect(
      existsSync(join(root, ".claude/skills/design-delta-refresh/SKILL.md")),
    ).toBe(true)
    expect(
      existsSync(join(root, ".claude/skills/design-delta-resolve/SKILL.md")),
    ).toBe(true)
    expect(
      existsSync(join(root, ".claude/skills/design-delta-docs/SKILL.md")),
    ).toBe(true)
    expect(
      existsSync(join(root, ".claude/skills/design-delta-token/SKILL.md")),
    ).toBe(true)
    expect(
      existsSync(join(root, ".claude/skills/design-delta-adopt/SKILL.md")),
    ).toBe(true)
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
      { path: ".claude/skills/design-delta-build/SKILL.md", action: "wrote" },
      { path: ".claude/skills/design-delta-author/SKILL.md", action: "wrote" },
      { path: ".claude/skills/design-delta-refresh/SKILL.md", action: "wrote" },
      { path: ".claude/skills/design-delta-resolve/SKILL.md", action: "wrote" },
      { path: ".claude/skills/design-delta-docs/SKILL.md", action: "wrote" },
      { path: ".claude/skills/design-delta-token/SKILL.md", action: "wrote" },
      { path: ".claude/skills/design-delta-adopt/SKILL.md", action: "wrote" },
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
      {
        path: ".claude/skills/design-delta-build/SKILL.md",
        action: "up-to-date",
      },
      {
        path: ".claude/skills/design-delta-author/SKILL.md",
        action: "up-to-date",
      },
      {
        path: ".claude/skills/design-delta-refresh/SKILL.md",
        action: "up-to-date",
      },
      {
        path: ".claude/skills/design-delta-resolve/SKILL.md",
        action: "up-to-date",
      },
      {
        path: ".claude/skills/design-delta-docs/SKILL.md",
        action: "up-to-date",
      },
      {
        path: ".claude/skills/design-delta-token/SKILL.md",
        action: "up-to-date",
      },
      {
        path: ".claude/skills/design-delta-adopt/SKILL.md",
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
      "agent-config/skills/design-delta-build/SKILL.md",
      "agent-config/skills/design-delta-author/SKILL.md",
      "agent-config/skills/design-delta-refresh/SKILL.md",
      "agent-config/skills/design-delta-resolve/SKILL.md",
      "agent-config/skills/design-delta-docs/SKILL.md",
      "agent-config/skills/design-delta-token/SKILL.md",
      "agent-config/skills/design-delta-adopt/SKILL.md",
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
// The linked stub of each packaged procedure skill — same shape as the stub
// above, pointing at the packaged skill, with its trigger description read
// from that skill so the two cannot disagree.
// ---------------------------------------------------------------------------

describe("the packaged procedure skills dock links", () => {
  it("are the build, authoring, refresh, resolve, docs, token and adopt skills", () => {
    expect(LINKED_SKILLS).toEqual([
      "design-delta-build",
      "design-delta-author",
      "design-delta-refresh",
      "design-delta-resolve",
      "design-delta-docs",
      "design-delta-token",
      "design-delta-adopt",
    ])
  })
})

describe.each(LINKED_SKILLS)("renderPackagedSkillStubTemplate(%s)", name => {
  const stubPath = `.claude/skills/${name}/SKILL.md`
  const packagedPath = join(import.meta.dirname, `../skills/${name}/SKILL.md`)

  it("declares frontmatter naming the skill, with the packaged skill's own description", () => {
    const stub = renderPackagedSkillStubTemplate(name)
    expect(stub.startsWith("---\n")).toBe(true)
    const frontmatter = stub.slice(4, stub.indexOf("\n---", 4))
    expect(frontmatter).toMatch(new RegExp(`^name: ${name}$`, "m"))
    const packaged = readFileSync(packagedPath, "utf8")
    const [description] = packaged.match(/^description: .+$/m)
    expect(description.length).toBeGreaterThan("description: ".length)
    expect(frontmatter).toContain(description)
  })

  it("links to the packaged skill, carries the marker and no procedure of its own", () => {
    const stub = renderPackagedSkillStubTemplate(name)
    expect(stub).toContain(`node_modules/design-delta/skills/${name}/SKILL.md`)
    expect(stub).toContain(GENERATED_MARKER)
    // A pointer, not a copy: no command of the engine's is restated here.
    expect(stub).not.toMatch(/npx design-delta/)
    for (const term of ["example-org/example-app", "acme", "widget", "figma"]) {
      expect(stub.toLowerCase()).not.toContain(term.toLowerCase())
    }
  })

  it("leaves a consumer's own skill at that path untouched, reporting 'skipped'", () => {
    const hand = `---\nname: ${name}\n---\n\nOur own steps.\n`
    const abs = join(root, stubPath)
    mkdirSync(dirname(abs), { recursive: true })
    writeFileSync(abs, hand)

    const { out } = runJson(["--json"])
    expect(JSON.parse(out).files).toContainEqual({
      path: stubPath,
      action: "skipped",
    })
    expect(readFileSync(abs, "utf8")).toBe(hand)
  })

  it("refreshes a stale generated stub at that path", () => {
    const abs = join(root, stubPath)
    mkdirSync(dirname(abs), { recursive: true })
    writeFileSync(abs, `An older stub.\n\n${GENERATED_MARKER} — old wording.\n`)

    runJson(["--json"])
    expect(readFileSync(abs, "utf8")).toBe(
      renderPackagedSkillStubTemplate(name),
    )
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

// ---------------------------------------------------------------------------
// #55 the router stub reads the packaged router's description, and
// `dock --check` reports, without writing, what a version bump left stale.
// ---------------------------------------------------------------------------

describe("#55 the router stub's description", () => {
  it("is the packaged router skill's own, not a second copy", () => {
    const packaged = readFileSync(
      join(
        dirname(fileURLToPath(import.meta.url)),
        "../skills/design-delta/SKILL.md",
      ),
      "utf8",
    ).match(/^description: (.+)$/m)[1]
    expect(renderSkillStubTemplate()).toContain(`\ndescription: ${packaged}\n`)
  })
})

describe("#55 runDock --check", () => {
  const ROUTER = ".claude/skills/design-delta/SKILL.md"
  const HOOK = ".claude/hooks/design-delta-verify.mjs"
  const actionsOf = out =>
    Object.fromEntries(JSON.parse(out).files.map(f => [f.path, f.action]))

  it("on an empty project writes nothing and exits 1, every stub missing", () => {
    const { code, out } = runJson(["--check", "--json"])
    expect(code).toBe(1)
    const payload = JSON.parse(out)
    expect(payload).toMatchObject({ command: "dock", check: true, ok: false })
    const actions = actionsOf(out)
    expect(actions[ROUTER]).toBe("missing")
    for (const name of LINKED_SKILLS) {
      expect(actions[`.claude/skills/${name}/SKILL.md`]).toBe("missing")
    }
    expect(actions[HOOK]).toBe("absent")
    expect(existsSync(join(root, ".claude"))).toBe(false)
  })

  it("exits 0 right after dock, every file up to date", () => {
    runJson([])
    const { code, out } = runJson(["--check", "--json"])
    expect(code).toBe(0)
    expect(JSON.parse(out).ok).toBe(true)
    expect(new Set(Object.values(actionsOf(out)))).toEqual(
      new Set(["up-to-date"]),
    )
  })

  it("exits 0 after init's stubs alone: a hook and verify skill never written are not drift", () => {
    runJson([])
    rmSync(join(root, HOOK))
    rmSync(join(root, ".claude/skills/design-delta-verify"), {
      recursive: true,
    })
    const { code, out } = runJson(["--check", "--json"])
    expect(code).toBe(0)
    expect(actionsOf(out)[HOOK]).toBe("absent")
  })

  it("exits 1 on a generated stub with an old description, and leaves it as it was", () => {
    runJson([])
    const abs = join(root, ROUTER)
    const old = readFileSync(abs, "utf8").replace(
      /^description: .+$/m,
      "description: an older release's description",
    )
    writeFileSync(abs, old)
    const { code, out } = runJson(["--check", "--json"])
    expect(code).toBe(1)
    expect(actionsOf(out)[ROUTER]).toBe("stale")
    expect(readFileSync(abs, "utf8")).toBe(old)
  })

  it("exits 1 on a stale hook dock once wrote", () => {
    runJson([])
    writeFileSync(join(root, HOOK), "an older release's hook\n")
    const { code, out } = runJson(["--check", "--json"])
    expect(code).toBe(1)
    expect(actionsOf(out)[HOOK]).toBe("stale")
  })

  it("a consumer-owned file is skipped, not drift", () => {
    runJson([])
    writeFileSync(join(root, ROUTER), "Our own house rules.\n")
    const { code, out } = runJson(["--check", "--json"])
    expect(code).toBe(0)
    expect(actionsOf(out)[ROUTER]).toBe("skipped")
  })

  it("the human output names the stale file and says to re-run dock", () => {
    const { code, out } = runJson(["--check"])
    expect(code).toBe(1)
    expect(out).toContain(`MISS   ${ROUTER}`)
    expect(out).toContain("run `npx design-delta dock` to")
  })

  it.each([
    ["agent-config", "npx design-delta dock --dir agent-config"],
    ["nested/agent-config", "npx design-delta dock --dir nested/agent-config"],
    ["agent config", "npx design-delta dock --dir 'agent config'"],
  ])(
    "under --dir %s, the fix it prints names that dir, and running it clears the check",
    (dir, command) => {
      const { code, out } = runJson(["--check", "--dir", dir])
      expect(code).toBe(1)
      expect(out).toContain(`run \`${command}\` to`)
      expect(runJson(["--dir", dir]).code).toBe(0)
      expect(runJson(["--check", "--dir", dir]).code).toBe(0)
    },
  )

  it("a generated file whose line endings a checkout turned to CRLF is up to date, not stale", () => {
    runJson([])
    const files = JSON.parse(runJson(["--check", "--json"]).out).files
    for (const { path } of files) {
      const abs = join(root, path)
      writeFileSync(abs, readFileSync(abs, "utf8").replace(/\n/g, "\r\n"))
    }
    const { code, out } = runJson(["--check", "--json"])
    expect(code).toBe(0)
    expect(new Set(Object.values(actionsOf(out)))).toEqual(
      new Set(["up-to-date"]),
    )
    // and dock leaves them be rather than rewriting them on every run
    expect(new Set(Object.values(actionsOf(runJson(["--json"]).out)))).toEqual(
      new Set(["up-to-date"]),
    )
  })

  it("a CRLF stub with an old description is still stale", () => {
    runJson([])
    const abs = join(root, ROUTER)
    writeFileSync(
      abs,
      readFileSync(abs, "utf8")
        .replace(/^description: .+$/m, "description: an older one")
        .replace(/\n/g, "\r\n"),
    )
    const { code, out } = runJson(["--check", "--json"])
    expect(code).toBe(1)
    expect(actionsOf(out)[ROUTER]).toBe("stale")
  })
})

// A stub copies its packaged skill's description into YAML frontmatter, so
// every stub dock writes has to parse, its description intact (#55).
describe("#55 every generated stub's frontmatter is valid YAML", () => {
  const STUBS = [
    ["design-delta", renderSkillStubTemplate()],
    ...LINKED_SKILLS.map(name => [name, renderPackagedSkillStubTemplate(name)]),
  ]

  it.each(STUBS)("%s", (name, text) => {
    const block = text.match(/^---\n([\s\S]*?)\n---\n/)[1]
    const parsed = yaml.load(block)
    expect(parsed.name).toBe(name)
    expect(parsed.description).toBe(block.match(/^description: (.+)$/m)[1])
  })
})
