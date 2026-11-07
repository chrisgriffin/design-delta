/**
 * sources-code-tokens-dir.test.js — `paths.tokensFile` naming a DIRECTORY
 * (spec 008). Every `*.json` under it is read in sorted path order and merged
 * into one DTCG document; both token censuses (`censusTokens`,
 * `censusTokenLint`) read it through the one shared loader.
 *
 * Real temp trees, generic token names — nothing here belongs to any one
 * design system.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

import { censusTokenLint, censusTokens } from "../src/sources/code.mjs"

let root

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "design-delta-tokens-dir-"))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

function write(relPath, value) {
  const abs = join(root, relPath)
  mkdirSync(dirname(abs), { recursive: true })
  writeFileSync(
    abs,
    typeof value === "string" ? value : JSON.stringify(value, null, 2),
  )
}

const RED = { colorSpace: "srgb", components: [1, 0, 0] }
const BLUE = { colorSpace: "srgb", components: [0, 0, 1] }

// One document, and the same document split across a nested directory: the
// group `$type` lives in one file, its tokens in two others, and an alias
// crosses files.
const WHOLE = {
  color: {
    $type: "color",
    red: { $value: RED },
    blue: { $value: BLUE },
    accent: { $value: "{color.red}" },
  },
  space: {
    sm: { $type: "dimension", $value: { value: 4, unit: "px" } },
  },
}

function writeSplit() {
  write("tokens/color/_group.json", { color: { $type: "color" } })
  write("tokens/color/base.json", {
    color: { red: { $value: RED }, blue: { $value: BLUE } },
  })
  write("tokens/color/semantic/accent.json", {
    color: { accent: { $value: "{color.red}" } },
  })
  write("tokens/space.json", { space: WHOLE.space })
}

const dirConfig = (dir = "tokens") => ({ paths: { tokensFile: dir } })

describe("censusTokens — tokensFile as a directory", () => {
  it("censuses a nested directory exactly as the merged single file", async () => {
    writeSplit()
    write("whole.json", WHOLE)

    const fromDir = await censusTokens(dirConfig(), { root })
    const fromFile = await censusTokens(
      { paths: { tokensFile: "whole.json" } },
      { root },
    )

    expect(fromDir.ok).toBe(true)
    expect(fromDir.diagnostics).toEqual([])
    expect(fromDir.tokens.map(t => t.id)).toEqual([
      "color.accent",
      "color.blue",
      "color.red",
      "space.sm",
    ])
    expect(fromDir.tokens).toEqual(fromFile.tokens)
  })

  it("is deterministic across runs and accepts a trailing slash", async () => {
    writeSplit()
    const first = await censusTokens(dirConfig(), { root })
    const second = await censusTokens(dirConfig("tokens/"), { root })
    expect(second).toEqual(first)
  })

  it("ignores files that are not *.json", async () => {
    writeSplit()
    write("tokens/README.md", "# not tokens")
    write("tokens/notes.txt", "{ not json")
    const result = await censusTokens(dirConfig(), { root })
    expect(result.ok).toBe(true)
    expect(result.tokens).toHaveLength(4)
  })

  it("a token in two files is a duplicate-token naming both; the first in path order wins", async () => {
    write("tokens/a.json", { color: { $type: "color", red: { $value: RED } } })
    write("tokens/b.json", { color: { red: { $value: BLUE } } })

    const result = await censusTokens(dirConfig(), { root })

    expect(result.ok).toBe(true)
    const dupes = result.diagnostics.filter(d => d.code === "duplicate-token")
    expect(dupes).toHaveLength(1)
    expect(dupes[0].file).toBe("tokens/b.json")
    expect(dupes[0].message).toContain('"color.red"')
    expect(dupes[0].message).toContain("tokens/a.json")
    expect(dupes[0].message).toContain("tokens/b.json")
    const red = result.tokens.find(t => t.id === "color.red")
    expect(red.value).toMatchObject({ components: [1, 0, 0] })
  })

  it("path order is sorted, not filesystem order — a nested dir sorts by its name", async () => {
    // "a/z.json" sorts before "b.json" because "a" < "b", whatever the
    // filesystem hands back first.
    write("tokens/b.json", { color: { $type: "color", x: { $value: BLUE } } })
    write("tokens/a/z.json", { color: { $type: "color", x: { $value: RED } } })

    const result = await censusTokens(dirConfig(), { root })
    const dupe = result.diagnostics.find(d => d.code === "duplicate-token")
    expect(dupe.file).toBe("tokens/b.json")
    expect(result.tokens[0].value).toMatchObject({ components: [1, 0, 0] })
  })

  it("a token in one file colliding with a group in another is reported, not merged", async () => {
    write("tokens/a.json", { color: { $type: "color", red: { $value: RED } } })
    write("tokens/b.json", {
      color: { red: { dark: { $type: "color", $value: BLUE } } },
    })

    const result = await censusTokens(dirConfig(), { root })
    const dupe = result.diagnostics.find(d => d.code === "duplicate-token")
    expect(dupe.message).toContain("a token in tokens/a.json")
    expect(dupe.message).toContain("a group in tokens/b.json")
    expect(result.tokens.map(t => t.id)).toEqual(["color.red"])
  })

  it("an equal group $-key in two files merges silently", async () => {
    write("tokens/a.json", { color: { $type: "color", red: { $value: RED } } })
    write("tokens/b.json", {
      color: { $type: "color", blue: { $value: BLUE } },
    })

    const result = await censusTokens(dirConfig(), { root })
    expect(result.diagnostics).toEqual([])
    expect(result.tokens.map(t => [t.id, t.$type])).toEqual([
      ["color.blue", "color"],
      ["color.red", "color"],
    ])
  })

  it("a differing group $-key is a group-key-conflict naming both files; the first value wins", async () => {
    write("tokens/a.json", {
      color: { $description: "first", red: { $type: "color", $value: RED } },
    })
    write("tokens/b.json", {
      color: {
        $description: "second",
        blue: { $type: "color", $value: BLUE },
      },
    })

    const result = await censusTokens(dirConfig(), { root })
    expect(result.ok).toBe(true)
    const conflicts = result.diagnostics.filter(
      d => d.code === "group-key-conflict",
    )
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0]).toMatchObject({ file: "tokens/b.json" })
    expect(conflicts[0].message).toContain('group "color"')
    expect(conflicts[0].message).toContain("$description")
    expect(conflicts[0].message).toContain("tokens/a.json")
    // The rest of the later file still counts.
    expect(result.tokens.map(t => t.id)).toEqual(["color.blue", "color.red"])
  })

  it("invalid JSON in one file fails the census naming that file", async () => {
    writeSplit()
    write("tokens/color/broken.json", "{ not valid json")

    const result = await censusTokens(dirConfig(), { root })
    expect(result.ok).toBe(false)
    expect(result.tokens).toEqual([])
    expect(result.diagnostics).toHaveLength(1)
    expect(result.diagnostics[0]).toMatchObject({
      code: "invalid-json",
      file: "tokens/color/broken.json",
    })
    expect(result.diagnostics[0].message).toContain("tokens/color/broken.json")
  })

  it("a non-object file fails the census naming that file", async () => {
    writeSplit()
    write("tokens/list.json", [1, 2])
    const result = await censusTokens(dirConfig(), { root })
    expect(result.ok).toBe(false)
    expect(result.diagnostics[0]).toMatchObject({
      code: "invalid-tokens-shape",
      file: "tokens/list.json",
    })
  })

  it("an empty directory is empty-tokens-dir, never a silent zero-token census", async () => {
    mkdirSync(join(root, "tokens/nested"), { recursive: true })
    write("tokens/README.md", "nothing here")
    const result = await censusTokens(dirConfig(), { root })
    expect(result).toMatchObject({ ok: false, tokens: [] })
    expect(result.diagnostics[0].code).toBe("empty-tokens-dir")
    expect(result.diagnostics[0].message).toContain("tokens")
  })

  it("a missing directory is missing-tokens-file, as for a file", async () => {
    const result = await censusTokens(dirConfig("nowhere"), { root })
    expect(result.diagnostics[0].code).toBe("missing-tokens-file")
  })
})

describe("censusTokenLint — tokensFile as a directory", () => {
  const rules = { "core/valid-color": "error" }

  it("names each violation's own file, with a line in that file", async () => {
    write("tokens/a.json", { color: { $type: "color", ok: { $value: RED } } })
    // Pretty-printed: `"$value": "#f00"` is on line 5 of this file.
    write("tokens/b.json", {
      color: { bad: { $type: "color", $value: "#f00" } },
    })

    const result = await censusTokenLint(dirConfig(), { root, rules })
    expect(result.ok).toBe(true)
    expect(result.violations).toHaveLength(1)
    expect(result.violations[0]).toMatchObject({
      ruleId: "core/valid-color",
      file: "tokens/b.json",
      line: 5,
    })
  })

  it("a file that lost a node to a conflict names no line — never a wrong one", async () => {
    write("tokens/a.json", { color: { $type: "color", red: { $value: RED } } })
    // b.json duplicates color.red AND carries a real violation on line 6; it
    // reaches the parser re-serialised, so no line in it can be trusted.
    write("tokens/b.json", {
      color: {
        red: { $value: BLUE },
        bad: { $type: "color", $value: "#f00" },
      },
    })
    // c.json is untouched: its line stays real.
    write("tokens/c.json", { other: { $type: "color", $value: "#0f0" } })

    const result = await censusTokenLint(dirConfig(), { root, rules })
    const byFile = Object.fromEntries(
      result.violations.map(v => [v.file, v.line]),
    )
    expect(byFile).toEqual({ "tokens/b.json": undefined, "tokens/c.json": 4 })
  })

  it("reports the directory's merge conflicts too", async () => {
    write("tokens/a.json", { color: { $type: "color", red: { $value: RED } } })
    write("tokens/b.json", { color: { red: { $value: BLUE } } })
    const result = await censusTokenLint(dirConfig(), { root, rules })
    expect(result.diagnostics.map(d => d.code)).toEqual(["duplicate-token"])
  })

  it("degrades on bad JSON in one file, naming it", async () => {
    write("tokens/a.json", { color: { $type: "color", red: { $value: RED } } })
    write("tokens/b.json", "{ nope")
    const result = await censusTokenLint(dirConfig(), { root, rules })
    expect(result).toMatchObject({ ok: false, delegated: false })
    expect(result.diagnostics[0]).toMatchObject({
      code: "invalid-json",
      file: "tokens/b.json",
    })
  })
})

describe("single-file tokensFile is unchanged", () => {
  it("a lint violation still names tokensFile and a line in it", async () => {
    write("tokens.json", {
      color: { bad: { $type: "color", $value: "#f00" } },
    })
    const result = await censusTokenLint(
      { paths: { tokensFile: "tokens.json" } },
      { root, rules: { "core/valid-color": "error" } },
    )
    expect(result.violations[0]).toMatchObject({ file: "tokens.json", line: 5 })
  })

  it("a single file carries no merge diagnostics and no file field on failure", async () => {
    write("tokens.json", "{ nope")
    const result = await censusTokens(
      { paths: { tokensFile: "tokens.json" } },
      { root },
    )
    expect(result.diagnostics).toEqual([
      expect.objectContaining({ code: "invalid-json" }),
    ])
    expect(result.diagnostics[0].file).toBeUndefined()
  })
})
