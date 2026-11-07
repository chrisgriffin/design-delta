/**
 * tokens-source-scope.test.js — `ignoreSources` (#640, spec 025): scoping
 * `tokens/token-unreferenced` and `tokens/token-unemitted` by the file a token
 * was authored in, for a project whose tiers are directories rather than id
 * roots. Primitive and semantic ids share one `color` group here, so no
 * `ignorePrefixes` entry could separate them.
 *
 * Real temp trees through the real census, generic token names.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

import { runTokensCheck } from "../src/modules/tokens.mjs"
import { censusTokens } from "../src/sources/code.mjs"

let root

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "design-delta-source-scope-"))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

function write(relPath, value) {
  const abs = join(root, relPath)
  mkdirSync(dirname(abs), { recursive: true })
  writeFileSync(abs, JSON.stringify(value, null, 2))
}

const RED = { colorSpace: "srgb", components: [1, 0, 0] }
const BLUE = { colorSpace: "srgb", components: [0, 0, 1] }

// `color.blue` and `color.red` are primitives; `color.red` is aliased by a
// semantic token and so is referenced. `color.fg.default` and `color.fg.muted`
// are semantic and unused.
function writeTwoTiers() {
  write("tokens/primitives/color.json", {
    color: {
      $type: "color",
      blue: { $value: BLUE },
      red: { $value: RED },
    },
  })
  write("tokens/semantics/color.json", {
    color: {
      fg: {
        default: { $value: "{color.red}" },
        muted: { $value: "{color.blue}" },
      },
    },
  })
}

const BASE = { paths: { tokensFile: "tokens" } }
const noVars = { ok: true, vars: [] }
const scoped = (globs, extra = {}) => ({
  ...BASE,
  ...extra,
  rules: {
    "tokens/token-unreferenced": ["review", { ignoreSources: globs }],
  },
})
const entities = (findings, ruleId) =>
  findings
    .filter(f => f.ruleId === ruleId)
    .map(f => f.entity)
    .sort()

async function check(config, vars = noVars) {
  const census = await censusTokens(config, { root })
  expect(census.ok).toBe(true)
  return runTokensCheck(census, vars, config)
}

describe("ignoreSources — tokensFile as a directory (#640)", () => {
  it("reports both directories when no glob is configured", async () => {
    writeTwoTiers()
    // Both colour primitives are aliased, so add an unaliased one.
    write("tokens/primitives/space.json", {
      space: { lg: { $type: "dimension", $value: { value: 8, unit: "px" } } },
    })
    const findings = await check(BASE)
    expect(entities(findings, "tokens/token-unreferenced")).toEqual([
      "color.fg.default",
      "color.fg.muted",
      "space.lg",
    ])
  })

  it("drops the primitive directory and KEEPS the semantic one", async () => {
    writeTwoTiers()
    write("tokens/primitives/color-extra.json", {
      color: { green: { $type: "color", $value: RED } },
    })
    const findings = await check(scoped(["tokens/primitives/**"]))
    expect(entities(findings, "tokens/token-unreferenced")).toEqual([
      "color.fg.default",
      "color.fg.muted",
    ])
  })

  it("scopes token-unemitted through token-unreferenced's option", async () => {
    writeTwoTiers()
    write("tokens/primitives/color-extra.json", {
      color: { green: { $type: "color", $value: RED } },
    })
    mkdirSync(join(root, "styles"), { recursive: true })
    const findings = await check(
      scoped(["tokens/primitives/**"], {
        paths: { tokensFile: "tokens", styleRoots: ["styles"] },
      }),
    )
    expect(entities(findings, "tokens/token-unemitted")).toEqual([
      "color.fg.default",
      "color.fg.muted",
    ])
  })

  it("matches nothing outside the glob", async () => {
    writeTwoTiers()
    const findings = await check(scoped(["tokens/nowhere/**"]))
    expect(entities(findings, "tokens/token-unreferenced")).toEqual([
      "color.fg.default",
      "color.fg.muted",
    ])
  })

  it("keeps a mode group that straddles a matching and a non-matching file", async () => {
    // Two mode sets folding to one var: one authored with the primitives, one
    // with the semantics. The finding is about a semantic var, so it stays.
    write("tokens/primitives/dark.json", {
      "theme/dark": { surface: { $type: "color", $value: BLUE } },
    })
    write("tokens/semantics/light.json", {
      "theme/light": { surface: { $type: "color", $value: RED } },
    })
    const findings = await check(
      scoped(["tokens/primitives/**"], {
        paths: { tokensFile: "tokens" },
        conventions: { cssVarPrefix: "--x-" },
      }),
    )
    expect(
      findings
        .filter(f => f.ruleId === "tokens/token-unreferenced")
        .map(f => f.data.tokens),
    ).toEqual([["theme/dark.surface", "theme/light.surface"]])
  })

  it("has no effect when tokensFile is a single file", async () => {
    write("tokens.json", {
      color: { $type: "color", blue: { $value: BLUE } },
    })
    const config = {
      paths: { tokensFile: "tokens.json" },
      rules: {
        "tokens/token-unreferenced": ["review", { ignoreSources: ["*"] }],
      },
    }
    const findings = await check(config)
    expect(entities(findings, "tokens/token-unreferenced")).toEqual([
      "color.blue",
    ])
  })

  it("a rule that does NOT declare the option cannot acquire it", async () => {
    writeTwoTiers()
    const config = {
      ...BASE,
      conventions: { cssVarPrefix: "--x-" },
      rules: {
        "tokens/token-untracked": ["warn", { ignoreSources: ["*"] }],
      },
    }
    const vars = {
      ok: true,
      vars: [
        {
          name: "--x-orphan",
          declarations: [{ file: "a.scss", line: 1 }],
          usages: [],
        },
      ],
    }
    const findings = await check(config, vars)
    expect(entities(findings, "tokens/token-untracked")).toEqual(["--x-orphan"])
  })
})
