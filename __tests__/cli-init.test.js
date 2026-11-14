/**
 * cli-init.test.js — `src/cli/commands/init.mjs`, the `design-delta init`
 * subcommand (ADR-001 D8, Phase 4).
 *
 * Real temp directories for the fs side (same reasoning as
 * `cli-init-detect.test.js`); a SCRIPTED FAKE for `@clack/prompts` on the
 * interactive side, since no real TTY exists in CI — `runInit` accepts both
 * as injected `ctx` fields for exactly this reason.
 */

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  GENERATED_MARKER,
  renderSkillStubTemplate,
} from "../src/cli/commands/dock.mjs"
import { runInit } from "../src/cli/commands/init.mjs"

let root

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "design-delta-init-cmd-"))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

function write(relPath, content) {
  const abs = join(root, relPath)
  mkdirSync(join(abs, ".."), { recursive: true })
  writeFileSync(abs, content)
}

function readConfig(relPath = "design-delta.json") {
  return JSON.parse(readFileSync(join(root, relPath), "utf8"))
}

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
// --yes: no prompts, accepts current-or-detected.
// ---------------------------------------------------------------------------

describe("runInit --yes", () => {
  it("writes only $schema when nothing is detected and nothing exists", async () => {
    const code = await runInit(["--yes"], ctx())
    expect(code).toBe(0)
    const config = readConfig()
    expect(config.$schema).toMatch(/config\.schema\.json$/)
    expect(config.paths).toBeUndefined()
    expect(config.conventions).toBeUndefined()
  })

  it("writes every field it can detect from real filesystem evidence", async () => {
    write("tokens.json", JSON.stringify({ color: { fg: { $value: "#000" } } }))
    write("components/widget/widget.tsx", "export const Widget = () => null")
    write(
      "components/widget/widget.module.css",
      ".a { --acme-color-bg: red; } .b { --acme-space-md: 4px; }",
    )

    const code = await runInit(["--yes"], ctx())
    expect(code).toBe(0)
    const config = readConfig()
    expect(config.paths.tokensFile).toBe("tokens.json")
    expect(config.paths.componentsDir).toBe("components")
    expect(config.conventions.cssVarPrefix).toBe("--acme-")
  })

  it("prints the suggested npm scripts to stdout", async () => {
    const { io, out } = fakeIo()
    await runInit(["--yes"], { globalOpts: {}, io, root })
    expect(out()).toContain('"drift:audit": "design-delta audit"')
    expect(out()).toContain('"drift:lint": "design-delta lint"')
    expect(out()).toContain('"drift:verify": "design-delta verify"')
  })

  it("respects --config for a non-default path", async () => {
    const code = await runInit(
      ["--yes"],
      ctx({ globalOpts: { config: "custom/design-delta.json" } }),
    )
    expect(code).toBe(0)
    expect(() => readConfig("custom/design-delta.json")).not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// The linked skill stub (issue #336) — a third `dock` template `init` also
// writes, through `dock`'s own template + writer.
// ---------------------------------------------------------------------------

describe("runInit — the linked skill stub", () => {
  it("--yes writes .claude/skills/design-delta/SKILL.md linking to the canonical skill", async () => {
    const code = await runInit(["--yes"], ctx())
    expect(code).toBe(0)
    const stub = readFileSync(
      join(root, ".claude/skills/design-delta/SKILL.md"),
      "utf8",
    )
    expect(stub).toContain(
      "node_modules/design-delta/skills/design-delta/SKILL.md",
    )
  })

  it("is overwrite-safe: re-running with the same content changes nothing", async () => {
    await runInit(["--yes"], ctx())
    const first = readFileSync(
      join(root, ".claude/skills/design-delta/SKILL.md"),
      "utf8",
    )
    await runInit(["--yes"], ctx())
    const second = readFileSync(
      join(root, ".claude/skills/design-delta/SKILL.md"),
      "utf8",
    )
    expect(second).toBe(first)
  })

  it("interactive init writes it too", async () => {
    const { prompts } = scriptedPrompts([
      "tokens.json",
      "components",
      "components",
      "--",
      "none",
    ])
    const code = await runInit([], ctx({ prompts }))
    expect(code).toBe(0)
    expect(existsSync(join(root, ".claude/skills/design-delta/SKILL.md"))).toBe(
      true,
    )
  })

  // `skills/design-delta/` is the natural name a consumer's own skill takes,
  // and this package does not own it — so `init` must never destroy one.
  it("leaves a consumer's own skill at that path untouched and says so", async () => {
    const hand = "---\nname: design-delta\n---\n\nOur own house rules.\n"
    write(".claude/skills/design-delta/SKILL.md", hand)

    const { io, out } = fakeIo()
    const code = await runInit(["--yes"], { globalOpts: {}, io, root })
    expect(code).toBe(0)
    expect(
      readFileSync(join(root, ".claude/skills/design-delta/SKILL.md"), "utf8"),
    ).toBe(hand)
    expect(out()).toContain("skipped .claude/skills/design-delta/SKILL.md")
    expect(out()).toContain("left untouched")
  })

  it("still refreshes a stale stub that carries the generated-by marker", async () => {
    write(
      ".claude/skills/design-delta/SKILL.md",
      `An older stub.\n\n${GENERATED_MARKER} — old wording.\n`,
    )

    const code = await runInit(["--yes"], ctx())
    expect(code).toBe(0)
    expect(
      readFileSync(join(root, ".claude/skills/design-delta/SKILL.md"), "utf8"),
    ).toBe(renderSkillStubTemplate())
  })
})

// ---------------------------------------------------------------------------
// Update flow: existing config wins over fresh detection, and everything the
// wizard does not touch survives untouched.
// ---------------------------------------------------------------------------

describe("runInit --yes — update flow against an existing config", () => {
  it("preserves fields this command never touches (e.g. lint, rules)", async () => {
    write(
      "design-delta.json",
      JSON.stringify({
        paths: { componentsDir: "components" },
        lint: { tiers: ["primitive", "semantic"] },
        rules: { "tokens/token-untracked": "off" },
      }),
    )
    write("components/widget/widget.tsx", "export const Widget = () => null")

    const code = await runInit(["--yes"], ctx())
    expect(code).toBe(0)
    const config = readConfig()
    expect(config.lint).toEqual({ tiers: ["primitive", "semantic"] })
    expect(config.rules).toEqual({ "tokens/token-untracked": "off" })
  })

  it("keeps an existing design.provider as-is rather than overwriting it", async () => {
    write(
      "design-delta.json",
      JSON.stringify({ design: { provider: "figma" } }),
    )
    const code = await runInit(["--yes"], ctx())
    expect(code).toBe(0)
    expect(readConfig().design).toEqual({ provider: "figma" })
  })

  it("keeps the EXISTING value over a freshly detected one — never silently reverts a hand-edit", async () => {
    write(
      "design-delta.json",
      JSON.stringify({ paths: { componentsDir: "src/ui" } }),
    )
    // Detection would suggest "components" here, since that's what exists —
    // the existing config's own choice must win.
    write("components/widget/widget.tsx", "export const Widget = () => null")

    const code = await runInit(["--yes"], ctx())
    expect(code).toBe(0)
    const config = readConfig()
    expect(config.paths.componentsDir).toBe("src/ui")
  })

  it("does not overwrite an existing $schema", async () => {
    write(
      "design-delta.json",
      JSON.stringify({ $schema: "./custom-schema.json" }),
    )
    await runInit(["--yes"], ctx())
    expect(readConfig().$schema).toBe("./custom-schema.json")
  })

  it("degrades to treating a malformed existing file as absent, never throws", async () => {
    write("design-delta.json", "{ not valid json")
    const code = await runInit(["--yes"], ctx())
    expect(code).toBe(0)
    expect(() => readConfig()).not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// Interactive path — a scripted fake `@clack/prompts`.
// ---------------------------------------------------------------------------

function scriptedPrompts(answers) {
  const calls = []
  let i = 0
  const next = opts => {
    calls.push(opts)
    return answers[i++]
  }
  return {
    calls,
    prompts: {
      intro: () => {},
      outro: () => {},
      cancel: () => {},
      isCancel: value => value === "CANCEL",
      text: async opts => next(opts),
      select: async opts => next(opts),
    },
  }
}

describe("runInit — interactive", () => {
  it("writes exactly the scripted answers", async () => {
    const { prompts } = scriptedPrompts([
      "tokens.json",
      "components",
      "components",
      "--acme-",
      "figma",
    ])
    const code = await runInit([], ctx({ prompts }))
    expect(code).toBe(0)
    const config = readConfig()
    expect(config.paths).toEqual({
      tokensFile: "tokens.json",
      componentsDir: "components",
      contractsDir: "components",
    })
    expect(config.conventions.cssVarPrefix).toBe("--acme-")
    expect(config.design).toEqual({ provider: "figma" })
  })

  it("passes current-or-detected as each prompt's defaultValue", async () => {
    write("tokens.json", JSON.stringify({ color: { $value: "#000" } }))
    const { prompts, calls } = scriptedPrompts([
      "tokens.json",
      "components",
      "components",
      "--",
      "none",
    ])
    await runInit([], ctx({ prompts }))
    expect(calls[0].defaultValue).toBe("tokens.json") // detected
  })

  it("writes no design block when 'none' is picked", async () => {
    const { prompts } = scriptedPrompts([
      "tokens.json",
      "components",
      "components",
      "--",
      "none",
    ])
    await runInit([], ctx({ prompts }))
    expect(readConfig().design).toBeUndefined()
  })

  it("offers 'none' plus every known provider, defaulted to the existing value", async () => {
    write(
      "design-delta.json",
      JSON.stringify({ design: { provider: "figma" } }),
    )
    const { prompts, calls } = scriptedPrompts([
      "tokens.json",
      "components",
      "components",
      "--",
      "figma",
    ])
    await runInit([], ctx({ prompts }))
    const selectCall = calls[calls.length - 1]
    expect(selectCall.initialValue).toBe("figma")
    expect(selectCall.options).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ value: "none" }),
        expect.objectContaining({ value: "figma" }),
      ]),
    )
  })

  it("clears an existing design.provider when 'none' is chosen on a re-run", async () => {
    write(
      "design-delta.json",
      JSON.stringify({ design: { provider: "figma" } }),
    )
    const { prompts } = scriptedPrompts([
      "tokens.json",
      "components",
      "components",
      "--",
      "none",
    ])
    await runInit([], ctx({ prompts }))
    expect(readConfig().design).toBeUndefined()
  })

  it("aborts on cancellation — nothing is written, exit code 1", async () => {
    const { prompts } = scriptedPrompts(["tokens.json", "CANCEL"])
    const code = await runInit([], ctx({ prompts }))
    expect(code).toBe(1)
    expect(() => readConfig()).toThrow() // never written at all
  })

  it("cancelling on the LAST prompt still writes nothing — all-or-nothing", async () => {
    const { prompts } = scriptedPrompts([
      "tokens.json",
      "components",
      "components",
      "--",
      "CANCEL",
    ])
    const code = await runInit([], ctx({ prompts }))
    expect(code).toBe(1)
    expect(() => readConfig()).toThrow()
  })
})

// ---------------------------------------------------------------------------
// Flag errors.
// ---------------------------------------------------------------------------

describe("runInit — flag errors", () => {
  it("rejects an unknown flag rather than running with defaults", async () => {
    const { io, err } = fakeIo()
    const code = await runInit(["--bogus"], { globalOpts: {}, io, root })
    expect(code).toBe(1)
    expect(err()).toMatch(/bogus/)
  })
})
