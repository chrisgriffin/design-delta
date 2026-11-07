/**
 * sources-styles.test.js — `src/sources/styles.mjs`, the plain-text
 * stylesheet census (ADR-001 D5, Phase 2b, issue #103).
 *
 * The pure text-parsing entry (`censusStylesheetText`/`classifyDeclarationValue`/
 * `resolveHeaderSelectors`) is exercised directly with hand-written CSS/SCSS
 * strings; the fs-touching layer (`censusStyleFile`/`censusStyles`) is
 * exercised with an injected fake fs, matching every other `sources/` test
 * in this suite.
 */

import {
  censusStyleFile,
  censusStyles,
  censusStylesheetText,
  classifyDeclarationValue,
  resolveHeaderSelectors,
} from "../src/sources/styles.mjs"

function bySelector(selectors, selector) {
  return selectors.find(s => s.selector === selector)
}

function declOf(entry, property) {
  return entry.declarations.find(d => d.property === property)
}

// ---------------------------------------------------------------------------
// classifyDeclarationValue
// ---------------------------------------------------------------------------

describe("classifyDeclarationValue", () => {
  it("classifies a var() reference", () => {
    expect(classifyDeclarationValue("var(--acme-color-fg)")).toEqual({
      kind: "var",
      varName: "--acme-color-fg",
      raw: "var(--acme-color-fg)",
    })
  })

  it("classifies a var() reference with a fallback argument by its var name", () => {
    expect(classifyDeclarationValue("var(--acme-color-fg, #111)")).toEqual(
      expect.objectContaining({ kind: "var", varName: "--acme-color-fg" }),
    )
  })

  it("strips a trailing !important before classifying", () => {
    expect(classifyDeclarationValue("var(--acme-color-fg) !important")).toEqual(
      expect.objectContaining({ kind: "var", varName: "--acme-color-fg" }),
    )
  })

  it("collapses a multi-line value's whitespace to single spaces (#369)", () => {
    // `linear-gradient(\n  to right,\n  …)` is one value; its line breaks are
    // authoring. Left in, the literal reads as `linear-gradient(     to
    // right,     …)` in every finding, and a markdown table cell with a
    // whitespace run repads under any CommonMark formatter.
    expect(
      classifyDeclarationValue(
        "linear-gradient(\n    to right,\n    transparent\n  )",
      ),
    ).toEqual({
      kind: "literal",
      value: "linear-gradient( to right, transparent )",
    })
    expect(
      classifyDeclarationValue("1px   solid\n  var(--acme-color-border)"),
    ).toEqual(
      expect.objectContaining({
        kind: "compound",
        raw: "1px solid var(--acme-color-border)",
      }),
    )
  })

  it("classifies any non-var() text as a literal", () => {
    expect(classifyDeclarationValue("16px")).toEqual({
      kind: "literal",
      value: "16px",
    })
    expect(classifyDeclarationValue("#fff")).toEqual({
      kind: "literal",
      value: "#fff",
    })
    expect(classifyDeclarationValue("1px solid currentcolor")).toEqual({
      kind: "literal",
      value: "1px solid currentcolor",
    })
  })
})

// ---------------------------------------------------------------------------
// resolveHeaderSelectors — the nesting-resolution rule directly.
// ---------------------------------------------------------------------------

describe("resolveHeaderSelectors", () => {
  it("a plain header is its own literal at the top level, and a descendant under one parent (#378)", () => {
    expect(resolveHeaderSelectors(".button", undefined)).toEqual([".button"])
    expect(resolveHeaderSelectors(".icon", ".button")).toEqual([
      ".button .icon",
    ])
    expect(resolveHeaderSelectors(".a, .b", ".button")).toEqual([
      ".button .a",
      ".button .b",
    ])
    // Under a comma parent there is no single ancestor to name.
    expect(resolveHeaderSelectors(".icon", null)).toEqual([".icon"])
  })

  it("splits a comma-separated header on TOP-LEVEL commas only", () => {
    expect(resolveHeaderSelectors(".a, .b", undefined)).toEqual([".a", ".b"])
    expect(resolveHeaderSelectors(":is(.a, .b)", undefined)).toEqual([
      ":is(.a, .b)",
    ])
  })

  it("combines a leading-& header with a single resolved parent", () => {
    expect(resolveHeaderSelectors("&.large", ".button")).toEqual([
      ".button.large",
    ])
    expect(resolveHeaderSelectors('&[data-tone="danger"]', ".button")).toEqual([
      '.button[data-tone="danger"]',
    ])
  })

  it("resolves to nothing when the parent is ambiguous or absent for a & header", () => {
    expect(resolveHeaderSelectors("&.large", null)).toEqual([])
    expect(resolveHeaderSelectors("&.large", undefined)).toEqual([])
  })

  it("resolves to nothing when & appears anywhere other than leading position", () => {
    expect(resolveHeaderSelectors(".foo & .bar", ".button")).toEqual([])
    expect(resolveHeaderSelectors("&.large&.small", ".button")).toEqual([])
  })

  it("an at-rule inherits the enclosing selector rather than naming a new one", () => {
    expect(
      resolveHeaderSelectors("@media (min-width: 600px)", ".button"),
    ).toEqual([".button"])
  })

  it("an at-rule with no enclosing selector resolves to nothing", () => {
    expect(
      resolveHeaderSelectors("@media (min-width: 600px)", undefined),
    ).toEqual([])
    expect(resolveHeaderSelectors("@media (min-width: 600px)", null)).toEqual(
      [],
    )
  })

  it("an empty header resolves to nothing", () => {
    expect(resolveHeaderSelectors("   ", undefined)).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// censusStylesheetText — the full brace walk.
// ---------------------------------------------------------------------------

describe("censusStylesheetText", () => {
  it("censuses a simple selector's declarations, classified", () => {
    const selectors = censusStylesheetText(`
      .acmeField {
        color: var(--acme-color-fg);
        background-color: var(--acme-color-bg);
      }
    `)
    expect(selectors).toHaveLength(1)
    const field = bySelector(selectors, ".acmeField")
    expect(field.parent).toBeNull()
    expect(declOf(field, "color")).toEqual({
      property: "color",
      kind: "var",
      varName: "--acme-color-fg",
      raw: "var(--acme-color-fg)",
    })
    expect(declOf(field, "background-color").varName).toBe("--acme-color-bg")
  })

  it("resolves a nested &-modifier selector and records its parent", () => {
    const selectors = censusStylesheetText(`
      .acmeButton {
        color: var(--acme-color-fg);

        &.large {
          padding: 16px;
        }
      }
    `)
    const large = bySelector(selectors, ".acmeButton.large")
    expect(large).toBeDefined()
    expect(large.parent).toBe(".acmeButton")
    expect(declOf(large, "padding")).toEqual({
      property: "padding",
      kind: "literal",
      value: "16px",
    })
  })

  it("resolves an attribute-selector variant nested via &", () => {
    const selectors = censusStylesheetText(`
      .acmeField {
        color: var(--acme-color-fg);

        &[data-tone="danger"] {
          color: var(--acme-color-danger);
        }
      }
    `)
    const danger = bySelector(selectors, '.acmeField[data-tone="danger"]')
    expect(danger).toBeDefined()
    expect(danger.parent).toBe(".acmeField")
    expect(declOf(danger, "color").varName).toBe("--acme-color-danger")
  })

  it("keeps a plain nested (descendant) selector as its own literal entry, not compounded", () => {
    const selectors = censusStylesheetText(`
      .acmeField {
        color: var(--acme-color-fg);

        .icon {
          color: var(--acme-color-icon);
        }
      }
    `)
    // Recorded as the descendant it is (#378) — never the bare `.icon`,
    // which merged every `.a .icon` / `.b .icon` block into one entry.
    expect(bySelector(selectors, ".icon")).toBeUndefined()
    expect(bySelector(selectors, ".acmeField .icon")).toBeDefined()
    expect(bySelector(selectors, ".acmeField .icon").parent).toBe(".acmeField")
  })

  it("an at-rule wraps its enclosing selector rather than starting a new scope", () => {
    const selectors = censusStylesheetText(`
      .acmeField {
        color: var(--acme-color-fg);

        @media (min-width: 600px) {
          padding: var(--acme-space-md);
        }
      }
    `)
    expect(selectors).toHaveLength(1)
    const field = bySelector(selectors, ".acmeField")
    expect(declOf(field, "padding").varName).toBe("--acme-space-md")
  })

  it("the same child class under two modifiers stays two entries, not one merged bag (#378)", () => {
    const selectors = censusStylesheetText(`
      .sm { .label { font-size: var(--acme-font-sm); } }
      .lg { .label { font-size: var(--acme-font-lg); } }
    `)
    expect(bySelector(selectors, ".label")).toBeUndefined()
    expect(
      declOf(bySelector(selectors, ".sm .label"), "font-size").varName,
    ).toBe("--acme-font-sm")
    expect(
      declOf(bySelector(selectors, ".lg .label"), "font-size").varName,
    ).toBe("--acme-font-lg")
    expect(bySelector(selectors, ".sm .label").parent).toBe(".sm")
  })

  it("a comma list of leading-& items shares one block across each resolved selector", () => {
    // `&.a,\n&.b { … }` is how SCSS shares a block between two modifiers.
    // Bailing on the second `&` hid the whole block — a real component's
    // shared `padding-top` under two variants read as missing under both.
    const selectors = censusStylesheetText(`
      .acmeBlock {
        &.hasElevation1,
        &.hasElevation2 {
          padding-top: var(--acme-space-lg);
        }
        &.hasElevation1 { background: var(--acme-color-bg-1); }
      }
    `)
    const one = bySelector(selectors, ".acmeBlock.hasElevation1")
    const two = bySelector(selectors, ".acmeBlock.hasElevation2")
    expect(declOf(one, "padding-top").varName).toBe("--acme-space-lg")
    expect(declOf(one, "background").varName).toBe("--acme-color-bg-1")
    expect(declOf(two, "padding-top").varName).toBe("--acme-space-lg")
    expect(one.parent).toBe(".acmeBlock")
    expect(two.parent).toBe(".acmeBlock")
  })

  it("a comma list mixing & with a plain selector still resolves to nothing", () => {
    const selectors = censusStylesheetText(`
      .acmeBlock {
        &.a, .b { color: var(--acme-color-fg); }
      }
    `)
    expect(bySelector(selectors, ".acmeBlock.a")).toBeUndefined()
    expect(bySelector(selectors, ".b")).toBeUndefined()
  })

  it("a selector re-emitted through a nested at-rule keeps its real parent, not itself (#363)", () => {
    // `&.sm { @include mq.md { … } }` — the at-rule frame closes FIRST, and
    // it used to record `.acmeField.sm` with parent `.acmeField.sm`, which
    // then won over the real frame's `.acmeField`. Every such modifier was
    // invisible to the variant lookup: measured, 5 of 5 on one component.
    const selectors = censusStylesheetText(`
      .acmeField {
        &.sm {
          padding: var(--acme-space-sm);
          @include mq.md {
            padding: var(--acme-space-md);
          }
        }
        @include mq.hover {
          &:hover { color: var(--acme-color-hover); }
        }
      }
    `)
    expect(bySelector(selectors, ".acmeField").parent).toBeNull()
    expect(bySelector(selectors, ".acmeField.sm").parent).toBe(".acmeField")
    expect(bySelector(selectors, ".acmeField:hover").parent).toBe(".acmeField")
  })

  it("a declaration inside an at-rule never displaces the unconditional one (#363)", () => {
    // The breakpoint re-opening came LAST in the file, so "last wins" made
    // the census report the responsive override as the selector's value —
    // and the style check then raised a token mismatch against a contract
    // that described the base correctly.
    const selectors = censusStylesheetText(`
      .acmeField {
        &.big { margin-bottom: var(--acme-stack-md); }
        @include mq.sm {
          &.big { margin-bottom: var(--acme-stack-lg); padding: var(--acme-space-lg); }
        }
        @include mq.reduced-motion { transition: none; }
        transition: color var(--acme-duration);
      }
    `)
    const big = bySelector(selectors, ".acmeField.big")
    expect(declOf(big, "margin-bottom").varName).toBe("--acme-stack-md")
    // A property ONLY the at-rule sets still lands — it fills a gap.
    expect(declOf(big, "padding").varName).toBe("--acme-space-lg")
    // Order in the file does not matter: unconditional wins even when it
    // appears after the conditional one.
    expect(declOf(bySelector(selectors, ".acmeField"), "transition").kind).toBe(
      "compound",
    )
  })

  it("SCSS #{…} interpolation in a value is text, not a block (#363)", () => {
    const selectors = censusStylesheetText(`
      .acmeField {
        transition:
          color var(--acme-duration),
          transform 1s #{motion.$easing};
        color: var(--acme-color-fg);
      }
    `)
    expect(selectors).toHaveLength(1)
    const field = bySelector(selectors, ".acmeField")
    expect(declOf(field, "color").varName).toBe("--acme-color-fg")
    expect(declOf(field, "transition").kind).toBe("compound")
  })

  it("a repeated property within the same selector keeps only the last occurrence", () => {
    const selectors = censusStylesheetText(`
      .acmeField {
        color: var(--acme-color-fg);
        color: var(--acme-color-override);
      }
    `)
    expect(declOf(bySelector(selectors, ".acmeField"), "color").varName).toBe(
      "--acme-color-override",
    )
  })

  it("re-opening the same selector twice merges declarations into one entry", () => {
    const selectors = censusStylesheetText(`
      .acmeField { color: var(--acme-color-fg); }
      .acmeField { background-color: var(--acme-color-bg); }
    `)
    expect(selectors).toHaveLength(1)
    const field = bySelector(selectors, ".acmeField")
    expect(field.declarations).toHaveLength(2)
  })

  it("a trailing declaration with no semicolon before the closing brace is still recorded", () => {
    const selectors = censusStylesheetText(`
      .acmeField {
        color: var(--acme-color-fg)
      }
    `)
    expect(declOf(bySelector(selectors, ".acmeField"), "color").varName).toBe(
      "--acme-color-fg",
    )
  })

  it("strips block comments and SCSS line comments before parsing", () => {
    const selectors = censusStylesheetText(`
      /* a block comment mentioning { and } to prove it is stripped first */
      .acmeField {
        // a line comment
        color: var(--acme-color-fg); // trailing line comment
      }
    `)
    expect(selectors).toHaveLength(1)
    expect(declOf(bySelector(selectors, ".acmeField"), "color").varName).toBe(
      "--acme-color-fg",
    )
  })

  it("declarations and selectors are sorted deterministically", () => {
    const selectors = censusStylesheetText(`
      .zeta { color: var(--acme-color-fg); }
      .alpha {
        color: var(--acme-color-fg);
        background-color: var(--acme-color-bg);
      }
    `)
    expect(selectors.map(s => s.selector)).toEqual([".alpha", ".zeta"])
    expect(
      bySelector(selectors, ".alpha").declarations.map(d => d.property),
    ).toEqual(["background-color", "color"])
  })

  it("an empty stylesheet censuses to no selectors", () => {
    expect(censusStylesheetText("")).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// censusStyleFile / censusStyles — the fs-touching layer, injected fs.
// ---------------------------------------------------------------------------

function fakeFs(files) {
  return {
    existsSync: path => Object.prototype.hasOwnProperty.call(files, path),
    readFileSync: path => {
      if (!Object.prototype.hasOwnProperty.call(files, path))
        throw new Error(`ENOENT: ${path}`)
      return files[path]
    },
  }
}

describe("censusStyleFile", () => {
  it("censuses a real file's text", () => {
    const fs = fakeFs({ "/proj/a.scss": ".a { color: var(--x); }" })
    const result = censusStyleFile("/proj/a.scss", { fs, label: "a.scss" })
    expect(result.ok).toBe(true)
    expect(result.file).toEqual({
      file: "a.scss",
      selectors: [
        {
          selector: ".a",
          parent: null,
          declarations: [
            { property: "color", kind: "var", varName: "--x", raw: "var(--x)" },
          ],
        },
      ],
    })
    expect(result.diagnostics).toEqual([])
  })

  it("degrades honestly for a missing file — never throws", () => {
    const fs = fakeFs({})
    const result = censusStyleFile("/proj/missing.scss", { fs })
    expect(result).toEqual({
      ok: false,
      file: null,
      diagnostics: [expect.objectContaining({ code: "missing-style-file" })],
    })
  })

  it("degrades honestly on a read error — never throws", () => {
    const fs = {
      existsSync: () => true,
      readFileSync: () => {
        throw new Error("boom")
      },
    }
    const result = censusStyleFile("/proj/a.scss", { fs })
    expect(result.ok).toBe(false)
    expect(result.diagnostics[0].code).toBe("read-error")
  })
})

describe("censusStyles", () => {
  it("censuses every file, sorted, and never aborts the set on one bad file", () => {
    const fs = fakeFs({
      "/proj/b.scss": ".b { color: var(--x); }",
    })
    const result = censusStyles(["b.scss", "a.scss"], { root: "/proj", fs })
    expect(result.ok).toBe(false) // a.scss is missing
    expect(result.files.map(f => f.file)).toEqual(["b.scss"])
    expect(result.diagnostics).toHaveLength(1)
    expect(result.diagnostics[0].code).toBe("missing-style-file")
  })

  it("deduplicates repeated paths", () => {
    const fs = fakeFs({ "/proj/a.scss": ".a { color: var(--x); }" })
    const result = censusStyles(["a.scss", "a.scss"], { root: "/proj", fs })
    expect(result.files).toHaveLength(1)
  })

  it("is deterministic regardless of input order", () => {
    const fs = fakeFs({
      "/proj/a.scss": ".a { color: var(--x); }",
      "/proj/b.scss": ".b { color: var(--y); }",
    })
    const forward = censusStyles(["a.scss", "b.scss"], { root: "/proj", fs })
    const backward = censusStyles(["b.scss", "a.scss"], { root: "/proj", fs })
    expect(JSON.stringify(forward)).toBe(JSON.stringify(backward))
  })
})

// ---------------------------------------------------------------------------
// Compound values — the third kind, and the check's largest false-finding risk.
// ---------------------------------------------------------------------------

describe("classifyDeclarationValue — compound values", () => {
  it("a value that CONTAINS a var without being one is compound, not literal", () => {
    // Measured against a real design system: 73 of 507 var-using declarations
    // are shaped like this. Classifying them "literal" made the style check
    // report a plainly-bound token as missing.
    expect(
      classifyDeclarationValue("1px solid var(--acme-color-border-subtle)"),
    ).toEqual({
      kind: "compound",
      varNames: ["--acme-color-border-subtle"],
      raw: "1px solid var(--acme-color-border-subtle)",
    })
  })

  it("collects every var in the value, deduplicated and sorted", () => {
    expect(classifyDeclarationValue("var(--b) var(--a) var(--b)")).toEqual({
      kind: "compound",
      varNames: ["--a", "--b"],
      raw: "var(--b) var(--a) var(--b)",
    })
  })

  it("sees a var nested inside calc()", () => {
    const result = classifyDeclarationValue("calc(100% - var(--m) * 2)")
    expect(result.kind).toBe("compound")
    expect(result.varNames).toEqual(["--m"])
  })

  it("a value that is SOLELY a var stays kind:var, not compound", () => {
    expect(classifyDeclarationValue("var(--a)").kind).toBe("var")
  })

  it("a value with no var at all stays literal", () => {
    expect(classifyDeclarationValue("1px solid black")).toEqual({
      kind: "literal",
      value: "1px solid black",
    })
  })
})
