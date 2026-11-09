/**
 * core-helpers.test.js — `src/core/census.mjs`, `src/core/paths.mjs` and
 * `src/core/text.mjs` (issue #545).
 */

import { jest } from "@jest/globals"
import path from "node:path"

import {
  CONTENT_KINDS,
  STRUCTURAL_KINDS,
  isContentNode,
  isStructuralNode,
} from "../src/core/census.mjs"
import { collectFilesSorted } from "../src/core/paths.mjs"
import { compareStrings, formatList, kebabCase } from "../src/core/text.mjs"

describe("census kinds", () => {
  it("splits the adapter vocabulary into two disjoint sets", () => {
    expect([...STRUCTURAL_KINDS].sort()).toEqual([
      "component",
      "element",
      "unresolved",
    ])
    expect([...CONTENT_KINDS].sort()).toEqual(["expression", "text", "unknown"])
    for (const kind of STRUCTURAL_KINDS)
      expect(CONTENT_KINDS.has(kind)).toBe(false)
  })

  it("classifies each kind as exactly one of structural or content", () => {
    for (const kind of STRUCTURAL_KINDS) {
      expect(isStructuralNode({ kind })).toBe(true)
      expect(isContentNode({ kind })).toBe(false)
    }
    for (const kind of CONTENT_KINDS) {
      expect(isContentNode({ kind })).toBe(true)
      expect(isStructuralNode({ kind })).toBe(false)
    }
  })

  it("is neither for a missing node or an unknown kind", () => {
    for (const node of [null, undefined, {}, { kind: "fragment" }]) {
      expect(isStructuralNode(node)).toBe(false)
      expect(isContentNode(node)).toBe(false)
    }
  })
})

describe("formatList", () => {
  it("joins 0, 1, 2 and 3+ items for natural reading", () => {
    expect(formatList([])).toBe("")
    expect(formatList(["a"])).toBe("a")
    expect(formatList(["a", "b"])).toBe("a and b")
    expect(formatList(["a", "b", "c", "d"])).toBe("a, b, c and d")
  })

  it("uses a custom conjunction", () => {
    expect(formatList(["a", "b"], "or")).toBe("a or b")
    expect(formatList(["a", "b", "c"], "or")).toBe("a, b or c")
  })
})

describe("kebabCase", () => {
  it("dashes a lower-or-digit to upper boundary", () => {
    expect(kebabCase("SampleButton")).toBe("sample-button")
    expect(kebabCase("sampleButton")).toBe("sample-button")
    expect(kebabCase("Grid2Col")).toBe("grid2-col")
    expect(kebabCase("already-kebab")).toBe("already-kebab")
  })

  it("leaves an acronym run unsplit", () => {
    expect(kebabCase("APIButton")).toBe("apibutton")
  })
})

describe("compareStrings", () => {
  it("is 0 on ties and antisymmetric otherwise", () => {
    expect(compareStrings("a", "a")).toBe(0)
    expect(compareStrings("a", "b")).toBe(-1)
    expect(compareStrings("b", "a")).toBe(1)
  })

  it("orders by code unit, so case is significant and uppercase sorts first", () => {
    expect(["b", "a", "B", "A", "_", "10", "9"].sort(compareStrings)).toEqual([
      "10",
      "9",
      "A",
      "B",
      "_",
      "a",
      "b",
    ])
  })

  it("gives the same total order whatever the input order", () => {
    const items = ["beta", "Alpha", "alpha", "beta", "", "alpha2"]
    const expected = ["", "Alpha", "alpha", "alpha2", "beta", "beta"]
    for (const input of [
      items,
      [...items].reverse(),
      [...items.slice(3), ...items.slice(0, 3)],
    ])
      expect([...input].sort(compareStrings)).toEqual(expected)
  })
})

/** An in-memory `fs` from a nested object: a string is a file, an object a dir. */
function stubFs(tree) {
  const lookup = abs => {
    let node = { "/": tree }
    for (const part of ["/", ...abs.split("/").filter(Boolean)]) {
      if (typeof node !== "object" || !(part in node)) return undefined
      node = node[part]
    }
    return node
  }
  return {
    existsSync: abs => lookup(abs) !== undefined,
    readdirSync: abs =>
      Object.entries(lookup(abs)).map(([name, value]) => ({
        name,
        isDirectory: () => typeof value === "object",
      })),
  }
}

describe("collectFilesSorted", () => {
  // Keys are deliberately out of order, so the walk has to sort to pass.
  const fs = stubFs({
    src: {
      "z.mjs": "",
      b: { "y.mjs": "", "x.css": "", "a.mjs": "" },
      "a.mjs": "",
      "readme.md": "",
      a: { "c.css": "" },
    },
  })

  it("returns [] for a missing directory", () => {
    expect(collectFilesSorted("/nope", [".mjs"], fs)).toEqual([])
  })

  it("keeps matching suffixes, sorted at every level", () => {
    expect(collectFilesSorted("/src", [".mjs", ".css"], fs)).toEqual([
      "/src/a/c.css",
      "/src/a.mjs",
      "/src/b/a.mjs",
      "/src/b/x.css",
      "/src/b/y.mjs",
      "/src/z.mjs",
    ])
  })

  it("filters on the suffix list", () => {
    expect(collectFilesSorted("/src", [".css"], fs)).toEqual([
      "/src/a/c.css",
      "/src/b/x.css",
    ])
  })
})

describe("toPosixRelative", () => {
  // The win32 case below swaps `node:path`; undo it so nothing after it
  // inherits win32 semantics.
  afterAll(() => {
    jest.unstable_unmockModule("node:path")
    jest.resetModules()
  })

  it("is root-relative with / separators", async () => {
    const { toPosixRelative } = await import("../src/core/paths.mjs")
    expect(toPosixRelative("/repo", "/repo/src/core/a.mjs")).toBe(
      "src/core/a.mjs",
    )
  })

  it("turns a Windows path's \\ separators into /", async () => {
    // The host is posix, so swap in win32 path semantics to see the
    // separator rewrite the helper exists for.
    jest.resetModules()
    jest.unstable_mockModule("node:path", () => ({
      ...path.win32,
      default: path.win32,
    }))
    const { toPosixRelative } = await import("../src/core/paths.mjs")
    expect(toPosixRelative("C:\\repo", "C:\\repo\\src\\core\\census.mjs")).toBe(
      "src/core/census.mjs",
    )
  })
})
