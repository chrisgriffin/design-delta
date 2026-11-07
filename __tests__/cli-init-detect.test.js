/**
 * cli-init-detect.test.js — `src/cli/init-detect.mjs`, `design-delta init`'s
 * detection heuristics (ADR-001 D8, Phase 4).
 *
 * Real temp directories throughout, not a hand-rolled fake `fs` — the
 * detectors recurse `readdirSync` with `withFileTypes: true`, and faking
 * Dirent's shape would buy little over writing real files, the same call
 * `__tests__/helpers/synthetic-project.mjs` already made for this codebase.
 *
 * Every fixture is generic and in-repo (CLAUDE.md: nothing consumer-specific)
 * — a made-up token/component/prefix vocabulary, never a real project's.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  detectTokensFile,
  detectComponentsDir,
  componentsDirHasContracts,
  detectCssVarPrefix,
  detectStyleRoots,
  detectProject,
} from "../src/cli/init-detect.mjs"

let root

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "design-delta-init-"))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

function write(relPath, content) {
  const abs = join(root, relPath)
  mkdirSync(join(abs, ".."), { recursive: true })
  writeFileSync(abs, content)
}

// ---------------------------------------------------------------------------
// detectTokensFile
// ---------------------------------------------------------------------------

describe("detectTokensFile", () => {
  it("finds a DTCG-shaped file at the first candidate path that exists", () => {
    write("tokens.json", JSON.stringify({ color: { fg: { $value: "#000" } } }))
    expect(detectTokensFile(root)).toBe("tokens.json")
  })

  it("prefers the most specific candidate, in the module's own priority order", () => {
    // "tokens/json/tokens.json" is checked before "design-tokens.json" —
    // both plausible, the more specific/common one wins.
    write(
      "tokens/json/tokens.json",
      JSON.stringify({ color: { $value: "#000" } }),
    )
    write("design-tokens.json", JSON.stringify({ color: { $value: "#fff" } }))
    expect(detectTokensFile(root)).toBe("tokens/json/tokens.json")
  })

  it("proposes a directory of DTCG files when no single-file candidate matches", () => {
    write("tokens/json/color/base.json", JSON.stringify({ c: { $value: 1 } }))
    write("tokens/json/space.json", JSON.stringify({ s: { $value: 2 } }))
    expect(detectTokensFile(root)).toBe("tokens/json")
  })

  it("a single-file candidate still wins over a directory", () => {
    write("tokens/json/space.json", JSON.stringify({ s: { $value: 2 } }))
    write("design-tokens.json", JSON.stringify({ x: { $value: 1 } }))
    expect(detectTokensFile(root)).toBe("design-tokens.json")
  })

  it("skips a directory whose JSON files are not DTCG-shaped", () => {
    write("tokens/generated/map.json", JSON.stringify({ name: "a map" }))
    write("tokens/css/system.css", "")
    expect(detectTokensFile(root)).toBeNull()
  })

  it("skips a candidate that exists but is not JSON", () => {
    write("tokens.json", "not json at all")
    write("design-tokens.json", JSON.stringify({ x: { $value: 1 } }))
    expect(detectTokensFile(root)).toBe("design-tokens.json")
  })

  it("skips a candidate that parses but has no $value anywhere — not DTCG-shaped", () => {
    write("tokens.json", JSON.stringify({ name: "just some config" }))
    expect(detectTokensFile(root)).toBeNull()
  })

  it("finds a $value nested several groups deep", () => {
    write(
      "tokens.json",
      JSON.stringify({
        base: { color: { neutral: { 50: { $value: "#eee" } } } },
      }),
    )
    expect(detectTokensFile(root)).toBe("tokens.json")
  })

  it("returns null when nothing at any candidate path exists", () => {
    expect(detectTokensFile(root)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// detectComponentsDir
// ---------------------------------------------------------------------------

describe("detectComponentsDir", () => {
  it("finds a candidate directory containing component-shaped files", () => {
    write("components/widget/widget.tsx", "export const Widget = () => null")
    expect(detectComponentsDir(root)).toBe("components")
  })

  it("looks arbitrarily deep, not just the immediate children", () => {
    write(
      "components/group/nested/deep/thing.tsx",
      "export const Thing = () => null",
    )
    expect(detectComponentsDir(root)).toBe("components")
  })

  it("skips a candidate directory that exists but holds no component files", () => {
    write("components/readme.md", "# nothing here")
    write("src/components/widget.tsx", "export const Widget = () => null")
    expect(detectComponentsDir(root)).toBe("src/components")
  })

  it("returns null when no candidate directory exists at all", () => {
    expect(detectComponentsDir(root)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// componentsDirHasContracts
// ---------------------------------------------------------------------------

describe("componentsDirHasContracts", () => {
  it("true when a *.contract.json file is colocated anywhere under componentsDir", () => {
    write("components/widget/widget.tsx", "")
    write("components/widget/widget.contract.json", "{}")
    expect(
      componentsDirHasContracts(root, "components", ".contract.json"),
    ).toBe(true)
  })

  it("false when componentsDir has components but no contracts", () => {
    write("components/widget/widget.tsx", "")
    expect(
      componentsDirHasContracts(root, "components", ".contract.json"),
    ).toBe(false)
  })

  it("false when componentsDir does not exist", () => {
    expect(componentsDirHasContracts(root, "nowhere", ".contract.json")).toBe(
      false,
    )
  })
})

// ---------------------------------------------------------------------------
// detectCssVarPrefix
// ---------------------------------------------------------------------------

describe("detectCssVarPrefix", () => {
  it("suggests the shared prefix when every declaration agrees", () => {
    write(
      "components/widget/widget.module.css",
      "odd { --acme-color-bg: red; --acme-color-fg: blue; }",
    )
    write("components/badge/badge.module.scss", ".x { --acme-space-md: 8px; }")
    expect(detectCssVarPrefix(root, "components")).toBe("--acme-")
  })

  it("offers nothing when declarations are evenly split, no majority", () => {
    write(
      "components/widget/widget.module.css",
      "odd { --acme-color-bg: red; --other-space-md: 8px; }",
    )
    expect(detectCssVarPrefix(root, "components")).toBeNull()
  })

  it("suggests the MAJORITY prefix, not a unanimous one — measured against a real design system", () => {
    // A component tree legitimately mixes design-token vars with component-
    // LOCAL computation vars in an unrelated namespace (a real project had
    // hundreds of `--system-*` declarations alongside a handful of
    // `--hero-icon-size`/`--marquee-gap`-style locals and an entire unrelated
    // `--cg-*` grid-utility namespace) — requiring unanimous agreement missed
    // an obvious, overwhelming dominant prefix on real code.
    write(
      "components/widget/widget.module.css",
      [
        ".a { --acme-color-bg: red; --acme-color-fg: blue; }",
        ".b { --acme-space-md: 8px; --acme-radius-sm: 4px; }",
        ".c { --hero-icon-size: 24px; --marquee-gap: 8px; }",
      ].join("\n"),
    )
    expect(detectCssVarPrefix(root, "components")).toBe("--acme-")
  })

  it("offers nothing when the top prefix is only a plurality, not a majority", () => {
    write(
      "components/widget/widget.module.css",
      [
        ".a { --acme-color-bg: red; --acme-color-fg: blue; }",
        ".b { --other-space-md: 8px; }",
        ".c { --third-radius-sm: 4px; }",
      ].join("\n"),
    )
    // 2 of 4 is the largest single group but not a majority (not > half).
    expect(detectCssVarPrefix(root, "components")).toBeNull()
  })

  it("offers nothing when a declared var has no namespace segment at all", () => {
    write("components/widget/widget.module.css", "odd { --gap: 8px; }")
    expect(detectCssVarPrefix(root, "components")).toBeNull()
  })

  it("only samples DECLARATIONS, never usage-only var() references", () => {
    // A component consuming a var it does not itself declare must not bias
    // the sample toward that var's (unrelated) namespace.
    write(
      "components/widget/widget.module.css",
      "odd { --acme-color-bg: red; color: var(--foreign-lib-fg); }",
    )
    expect(detectCssVarPrefix(root, "components")).toBe("--acme-")
  })

  it("returns null when componentsDir is null (nothing to scan)", () => {
    expect(detectCssVarPrefix(root, null)).toBeNull()
  })

  it("returns null when no CSS files exist under componentsDir", () => {
    write("components/widget/widget.tsx", "")
    expect(detectCssVarPrefix(root, "components")).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// detectStyleRoots
// ---------------------------------------------------------------------------

describe("detectStyleRoots", () => {
  it("lists every existing candidate, sorted", () => {
    write("styles/x.css", "")
    write("tokens/css/x.css", "")
    expect(detectStyleRoots(root)).toEqual(["styles", "tokens/css"])
  })

  it("returns an empty array when no candidate exists", () => {
    expect(detectStyleRoots(root)).toEqual([])
  })

  it("does not require the directory to hold any CSS — existence alone is the signal", () => {
    mkdirSync(join(root, "styles"), { recursive: true })
    expect(detectStyleRoots(root)).toEqual(["styles"])
  })
})

// ---------------------------------------------------------------------------
// detectProject — the composed call.
// ---------------------------------------------------------------------------

describe("detectProject", () => {
  it("composes every detector into one suggestion set, real project shape", () => {
    write("tokens.json", JSON.stringify({ color: { fg: { $value: "#000" } } }))
    write("components/widget/widget.tsx", "export const Widget = () => null")
    write("components/widget/widget.contract.json", "{}")
    write(
      "components/widget/widget.module.css",
      "odd { --acme-color-fg: red; }",
    )

    expect(detectProject(root)).toEqual({
      tokensFile: "tokens.json",
      componentsDir: "components",
      contractsDir: "components",
      cssVarPrefix: "--acme-",
      styleRoots: [],
    })
  })

  it("every field is null/empty on a project with nothing detectable — never a guess", () => {
    write("README.md", "# empty project")
    expect(detectProject(root)).toEqual({
      tokensFile: null,
      componentsDir: null,
      contractsDir: null,
      cssVarPrefix: null,
      styleRoots: [],
    })
  })

  it("includes styleRoots when a style-root candidate directory exists", () => {
    write("tokens/css/system.css", "")
    write("components/widget/widget.module.css", ".a { --acme-color-bg: red; }")
    expect(detectProject(root).styleRoots).toEqual(["tokens/css"])
  })

  it("contractsDir stays null when components exist but no contracts do", () => {
    write("components/widget/widget.tsx", "export const Widget = () => null")
    write("tokens.json", JSON.stringify({ color: { $value: "#000" } }))
    const result = detectProject(root)
    expect(result.componentsDir).toBe("components")
    expect(result.contractsDir).toBeNull()
  })

  it("respects a NON-DEFAULT contractSuffix, not a hardcoded one", () => {
    write("components/widget/widget.tsx", "")
    write("components/widget/widget.spec.json", "{}")
    const result = detectProject(root, { contractSuffix: ".spec.json" })
    expect(result.contractsDir).toBe("components")
  })

  it("throws on a relative root — every detector below assumes absolute", () => {
    expect(() => detectProject("relative/path")).toThrow(/absolute/)
  })
})
