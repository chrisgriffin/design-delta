/**
 * modules-styles.test.js — `src/modules/styles.mjs`, the style-parity
 * checker (ADR-001 D5, Phase 2b, issue #103).
 *
 * PURE input throughout: every case hand-builds its `contracts`/
 * `styleCensus` fixtures in memory (the exact shapes `spec/contracts.mjs`'s
 * `loadContracts`/`sources/styles.mjs`'s `censusStyles` produce) rather than
 * touching fs — the layering guard (`__tests__/layering.test.js`'s "modules
 * never import sources") is what that buys.
 */

import {
  compareProperty,
  PROPERTY_DEFS,
  locateElementSelector,
  locateVariantSelector,
  runStylesCheck,
  runDesignBindingsCheck,
  buildAliasIndex,
  expandThroughAliases,
} from "../src/modules/styles.mjs"

const PREFIX = "--acme-"

function config(overrides = {}) {
  return { conventions: { cssVarPrefix: PREFIX }, ...overrides }
}

function contract(id, body) {
  return {
    id,
    file: `${id}.contract.json`,
    contract: { id, title: id, ...body },
  }
}

function fileCensus(file, selectors) {
  return { files: [{ file, selectors }] }
}

function selector(sel, { parent = null, declarations = [] } = {}) {
  return { selector: sel, parent, declarations }
}

function decl(property, kind, extra = {}) {
  return { property, kind, ...extra }
}

function varDecl(property, varName) {
  return decl(property, "var", { varName, raw: `var(${varName})` })
}

function literalDecl(property, value) {
  return decl(property, "literal", { value })
}

function findingIds(findings) {
  return findings.map(f => f.ruleId).sort()
}

// ---------------------------------------------------------------------------
// Element -> selector mapping, directly.
// ---------------------------------------------------------------------------

describe("locateElementSelector — the mapping rule", () => {
  const index = fileIndexOf([
    selector(".acmeField"),
    selector(".root"),
    selector(".iconLeft"),
    selector(".icon-right"),
  ])

  it("codeClass is authoritative when the exact selector exists", () => {
    expect(
      locateElementSelector({ codeClass: "acmeField" }, "root", index),
    ).toBe(".acmeField")
  })

  it("codeClass naming nothing censused is unmapped, never falls back", () => {
    expect(
      locateElementSelector({ codeClass: "doesNotExist" }, "root", index),
    ).toBeNull()
  })

  it('"root" tries the literal ".root" first', () => {
    expect(locateElementSelector({}, "root", index)).toBe(".root")
  })

  it('"root" falls back to the sole top-level selector when ".root" is absent', () => {
    const solo = fileIndexOf([
      selector(".acmeBadge"),
      selector(".acmeBadge.large", { parent: ".acmeBadge" }),
    ])
    expect(locateElementSelector({}, "root", solo)).toBe(".acmeBadge")
  })

  it('"root" is unmapped when there is more than one top-level selector and no ".root"', () => {
    const ambiguous = fileIndexOf([selector(".a"), selector(".b")])
    expect(locateElementSelector({}, "root", ambiguous)).toBeNull()
  })

  it("a non-root element matches its literal or kebab-case class name", () => {
    expect(locateElementSelector({}, "iconLeft", index)).toBe(".iconLeft")
    expect(
      locateElementSelector(
        {},
        "iconRight",
        fileIndexOf([selector(".icon-right")]),
      ),
    ).toBe(".icon-right")
  })

  it("a non-root element with no matching selector at all is unmapped", () => {
    expect(locateElementSelector({}, "label", index)).toBeNull()
  })

  it("a non-root element matching BOTH the literal and kebab form (as distinct selectors) is unmapped", () => {
    const both = fileIndexOf([selector(".iconLeft"), selector(".icon-left")])
    expect(locateElementSelector({}, "iconLeft", both)).toBeNull()
  })
})

describe("locateVariantSelector — the attribute-selector convention", () => {
  it("locates a single-key when's nested attribute-selector child", () => {
    const index = fileIndexOf([
      selector(".acmeField"),
      selector('.acmeField[data-tone="danger"]', { parent: ".acmeField" }),
    ])
    expect(locateVariantSelector(".acmeField", { tone: "danger" }, index)).toBe(
      '.acmeField[data-tone="danger"]',
    )
  })

  it("also matches the camelCase attribute-name form", () => {
    const index = fileIndexOf([
      selector(".acmeField"),
      selector('.acmeField[data-tone="danger"]', { parent: ".acmeField" }),
    ])
    expect(
      locateVariantSelector(".acmeField", { tone: "danger" }, index),
    ).not.toBeNull()
  })

  it("stays silent for a multi-key when", () => {
    const index = fileIndexOf([
      selector(".acmeField"),
      selector('.acmeField[data-tone="danger"][data-size="lg"]', {
        parent: ".acmeField",
      }),
    ])
    expect(
      locateVariantSelector(
        ".acmeField",
        { tone: "danger", size: "lg" },
        index,
      ),
    ).toBeNull()
  })

  it("stays silent when no matching child selector exists", () => {
    const index = fileIndexOf([selector(".acmeField")])
    expect(
      locateVariantSelector(".acmeField", { tone: "danger" }, index),
    ).toBeNull()
  })
})

// A tiny helper mirroring `modules/styles.mjs`'s own `buildFileIndex`, kept
// separate so these direct-function tests do not depend on that private
// helper's existence.
function fileIndexOf(selectors) {
  const bySelectorMap = new Map(
    selectors.map(entry => [
      entry.selector,
      {
        ...entry,
        declarations: new Map(entry.declarations.map(d => [d.property, d])),
      },
    ]),
  )
  const byParent = new Map()
  for (const entry of selectors) {
    if (entry.parent !== null) {
      if (!byParent.has(entry.parent)) byParent.set(entry.parent, [])
      byParent.get(entry.parent).push(entry.selector)
    }
  }
  const topLevelSelectors = selectors
    .filter(entry => entry.parent === null)
    .map(entry => entry.selector)
  return { bySelector: bySelectorMap, byParent, topLevelSelectors }
}

// ---------------------------------------------------------------------------
// compareProperty — the box-grammar precedence machinery, directly.
// ---------------------------------------------------------------------------

const EDGE_DEF = {
  key: "padding",
  path: ["padding"],
  finestSlots: ["blockStart", "blockEnd", "inlineStart", "inlineEnd"],
  fallbacks: {
    blockStart: ["blockStart", "block", "all"],
    blockEnd: ["blockEnd", "block", "all"],
    inlineStart: ["inlineStart", "inline", "all"],
    inlineEnd: ["inlineEnd", "inline", "all"],
  },
  cssNames: {
    all: "padding",
    block: "padding-block",
    inline: "padding-inline",
    blockStart: "padding-block-start",
    blockEnd: "padding-block-end",
    inlineStart: "padding-inline-start",
    inlineEnd: "padding-inline-end",
  },
}

const SIMPLE_DEF = {
  key: "color",
  path: ["color"],
  finestSlots: ["_value"],
  fallbacks: { _value: ["_value"] },
  cssNames: { _value: "color" },
}

function declMap(entries) {
  return new Map(entries.map(d => [d.property, d]))
}

describe("compareProperty — box-grammar precedence (individual > axis > all)", () => {
  it("contract 'all' matches a css shorthand for the whole property", () => {
    const outcomes = compareProperty(
      EDGE_DEF,
      { all: { token: "acme.space.md" } },
      declMap([varDecl("padding", "--acme-space-md")]),
      PREFIX,
    )
    expect(outcomes).toEqual([])
  })

  it("contract 'all' ALSO matches an equivalent block+inline longhand pair", () => {
    const outcomes = compareProperty(
      EDGE_DEF,
      { all: { token: "acme.space.md" } },
      declMap([
        varDecl("padding-block", "--acme-space-md"),
        varDecl("padding-inline", "--acme-space-md"),
      ]),
      PREFIX,
    )
    expect(outcomes).toEqual([])
  })

  it("a fully-absent css property is a single binding-missing outcome across all finest slots", () => {
    const outcomes = compareProperty(
      EDGE_DEF,
      { all: { token: "acme.space.md" } },
      declMap([]),
      PREFIX,
    )
    expect(outcomes).toEqual([
      {
        rule: "missing",
        slots: ["blockStart", "blockEnd", "inlineStart", "inlineEnd"],
      },
    ])
  })

  it("individual-edge precedence: a more specific css declaration overrides 'all' per slot", () => {
    // Contract declares only "all"; css declares "all" for 3 sides and
    // overrides just blockStart with a DIFFERENT token — a real mismatch on
    // exactly that one slot.
    const outcomes = compareProperty(
      EDGE_DEF,
      { all: { token: "acme.space.md" } },
      declMap([
        varDecl("padding", "--acme-space-md"),
        varDecl("padding-block-start", "--acme-space-lg"),
      ]),
      PREFIX,
    )
    expect(outcomes).toEqual([
      {
        rule: "mismatch",
        slots: ["blockStart"],
        detail: [
          {
            slot: "blockStart",
            tokenId: "acme.space.md",
            expectedVar: "--acme-space-md",
            foundVar: "--acme-space-lg",
          },
        ],
      },
    ])
  })

  it("a literal where a token is expected is raw-value, not missing", () => {
    const outcomes = compareProperty(
      EDGE_DEF,
      { all: { token: "acme.space.md" } },
      declMap([literalDecl("padding", "16px")]),
      PREFIX,
    )
    expect(outcomes).toEqual([
      {
        rule: "raw",
        slots: ["blockStart", "blockEnd", "inlineStart", "inlineEnd"],
        detail: [
          { slot: "blockStart", value: "16px" },
          { slot: "blockEnd", value: "16px" },
          { slot: "inlineStart", value: "16px" },
          { slot: "inlineEnd", value: "16px" },
        ],
      },
    ])
  })

  it("a contract raw(...) value stays silent regardless of what css declares", () => {
    expect(
      compareProperty(EDGE_DEF, { all: "raw(0)" }, declMap([]), PREFIX),
    ).toEqual([])
    expect(
      compareProperty(
        EDGE_DEF,
        { all: "raw(0)" },
        declMap([varDecl("padding", "--acme-space-lg")]),
        PREFIX,
      ),
    ).toEqual([])
    expect(
      compareProperty(
        EDGE_DEF,
        { all: "raw(0)" },
        declMap([literalDecl("padding", "16px")]),
        PREFIX,
      ),
    ).toEqual([])
  })

  it("a wholly-undeclared contract property fires binding-unexpected only when css binds a token", () => {
    expect(compareProperty(EDGE_DEF, undefined, declMap([]), PREFIX)).toEqual(
      [],
    )
    expect(
      compareProperty(
        EDGE_DEF,
        undefined,
        declMap([literalDecl("padding", "16px")]),
        PREFIX,
      ),
    ).toEqual([]) // a literal for an untracked property is out of scope (layout)
    expect(
      compareProperty(
        EDGE_DEF,
        undefined,
        declMap([varDecl("padding", "--acme-space-md")]),
        PREFIX,
      ),
    ).toEqual([
      {
        rule: "unexpected",
        slots: ["blockStart", "blockEnd", "inlineStart", "inlineEnd"],
        detail: [
          { slot: "blockStart", varName: "--acme-space-md" },
          { slot: "blockEnd", varName: "--acme-space-md" },
          { slot: "inlineStart", varName: "--acme-space-md" },
          { slot: "inlineEnd", varName: "--acme-space-md" },
        ],
      },
    ])
  })

  it("a partially-declared contract property does not sweep its undeclared slots for binding-unexpected", () => {
    const outcomes = compareProperty(
      EDGE_DEF,
      { blockStart: { token: "acme.space.md" } },
      declMap([varDecl("padding-inline", "--acme-space-lg")]),
      PREFIX,
    )
    // blockStart is missing (contract addresses it, css doesn't); the
    // inline binding is NOT reported as unexpected, since the property as a
    // whole IS addressed by the contract.
    expect(outcomes).toEqual([{ rule: "missing", slots: ["blockStart"] }])
  })

  it("an unmappable token (tokens.mjs's own fold-to-nothing case) stays silent", () => {
    const outcomes = compareProperty(
      EDGE_DEF,
      { all: { token: "acme" } }, // folds to nothing under prefix "--acme-"
      declMap([literalDecl("padding", "16px")]),
      PREFIX,
    )
    expect(outcomes).toEqual([])
  })

  it("simple (single-slot) properties reduce to one comparison", () => {
    expect(
      compareProperty(
        SIMPLE_DEF,
        { token: "acme.color.fg" },
        declMap([varDecl("color", "--acme-color-fg")]),
        PREFIX,
      ),
    ).toEqual([])
    expect(
      compareProperty(
        SIMPLE_DEF,
        { token: "acme.color.fg" },
        declMap([]),
        PREFIX,
      ),
    ).toEqual([{ rule: "missing", slots: ["_value"] }])
  })
})

// ---------------------------------------------------------------------------
// runStylesCheck — end to end over hand-built contracts + style census.
// ---------------------------------------------------------------------------

describe("runStylesCheck — each rule firing", () => {
  it("styles/binding-missing", () => {
    const contracts = [
      contract("widget", {
        sources: { code: { styles: "widget.scss" } },
        anatomy: { root: { type: "container" } },
        styles: { root: { base: { color: { token: "acme.color.fg" } } } },
      }),
    ]
    const census = fileCensus("widget.scss", [selector(".widget")])
    const findings = runStylesCheck(contracts, census, config())
    expect(findingIds(findings)).toEqual(["styles/binding-missing"])
    expect(findings[0]).toEqual(
      expect.objectContaining({
        ruleId: "styles/binding-missing",
        surface: "styles",
        side: "code",
        severity: "error",
        entity: "widget.root",
      }),
    )
  })

  it("styles/binding-unexpected", () => {
    const contracts = [
      contract("widget", {
        sources: { code: { styles: "widget.scss" } },
        anatomy: { root: { type: "container" } },
        styles: { root: { base: {} } },
      }),
    ]
    const census = fileCensus("widget.scss", [
      selector(".widget", {
        declarations: [varDecl("color", "--acme-color-fg")],
      }),
    ])
    const findings = runStylesCheck(contracts, census, config())
    expect(findingIds(findings)).toEqual(["styles/binding-unexpected"])
  })

  it("styles/token-mismatch", () => {
    const contracts = [
      contract("widget", {
        sources: { code: { styles: "widget.scss" } },
        anatomy: { root: { type: "container" } },
        styles: { root: { base: { color: { token: "acme.color.fg" } } } },
      }),
    ]
    const census = fileCensus("widget.scss", [
      selector(".widget", {
        declarations: [varDecl("color", "--acme-color-danger")],
      }),
    ])
    const findings = runStylesCheck(contracts, census, config())
    expect(findingIds(findings)).toEqual(["styles/token-mismatch"])
  })

  it("styles/raw-value", () => {
    const contracts = [
      contract("widget", {
        sources: { code: { styles: "widget.scss" } },
        anatomy: { root: { type: "container" } },
        styles: { root: { base: { color: { token: "acme.color.fg" } } } },
      }),
    ]
    const census = fileCensus("widget.scss", [
      selector(".widget", { declarations: [literalDecl("color", "#111111")] }),
    ])
    const findings = runStylesCheck(contracts, census, config())
    expect(findingIds(findings)).toEqual(["styles/raw-value"])
  })

  it("styles/element-unmapped, and it silences every other rule for that element", () => {
    const contracts = [
      contract("widget", {
        sources: { code: { styles: "widget.scss" } },
        anatomy: { root: { type: "container" } },
        styles: { root: { base: { color: { token: "acme.color.fg" } } } },
      }),
    ]
    // Two top-level selectors, neither named ".root" — root is unmappable.
    const census = fileCensus("widget.scss", [
      selector(".a", { declarations: [literalDecl("color", "#fff")] }),
      selector(".b"),
    ])
    const findings = runStylesCheck(contracts, census, config())
    expect(findingIds(findings)).toEqual(["styles/element-unmapped"])
    expect(findings[0].data).toEqual({ element: "root" })
  })

  it("never treats anatomy's `$variants` sigil key as an element", () => {
    // ADR-002's variant block lives IN the node map and survives loading, so
    // an element loop that reads every key would report it unmappable —
    // a finding about a selector that was never supposed to exist.
    const contracts = [
      contract("widget", {
        sources: { code: { styles: "widget.scss" } },
        anatomy: {
          root: { type: "container" },
          $variants: { asLink: { root: { type: "container", element: "a" } } },
        },
        styles: { root: { base: { color: { token: "acme.color.fg" } } } },
      }),
    ]
    const census = fileCensus("widget.scss", [
      selector(".root", {
        declarations: [varDecl("color", "--acme-color-fg")],
      }),
    ])
    expect(runStylesCheck(contracts, census, config())).toEqual([])
  })
})

describe("runStylesCheck — clean parity and the escape hatches", () => {
  it("a token declared and bound identically produces no findings", () => {
    const contracts = [
      contract("widget", {
        sources: { code: { styles: "widget.scss" } },
        anatomy: { root: { type: "container" } },
        styles: { root: { base: { color: { token: "acme.color.fg" } } } },
      }),
    ]
    const census = fileCensus("widget.scss", [
      selector(".widget", {
        declarations: [varDecl("color", "--acme-color-fg")],
      }),
    ])
    expect(runStylesCheck(contracts, census, config())).toEqual([])
  })

  it("a contract raw(...) value stays silent even against a mismatched literal", () => {
    const contracts = [
      contract("widget", {
        sources: { code: { styles: "widget.scss" } },
        anatomy: { root: { type: "container" } },
        styles: { root: { base: { color: "raw(currentcolor)" } } },
      }),
    ]
    const census = fileCensus("widget.scss", [
      selector(".widget", { declarations: [literalDecl("color", "#fff")] }),
    ])
    expect(runStylesCheck(contracts, census, config())).toEqual([])
  })

  it("a contract with no sources.code.styles is skipped entirely, silently", () => {
    const contracts = [
      contract("widget", {
        sources: { code: {} },
        anatomy: { root: { type: "container" } },
        styles: { root: { base: { color: { token: "acme.color.fg" } } } },
      }),
    ]
    expect(runStylesCheck(contracts, { files: [] }, config())).toEqual([])
  })

  it("a declared style file the census could not read is skipped, silently", () => {
    const contracts = [
      contract("widget", {
        sources: { code: { styles: "missing.scss" } },
        anatomy: { root: { type: "container" } },
        styles: { root: { base: { color: { token: "acme.color.fg" } } } },
      }),
    ]
    expect(runStylesCheck(contracts, { files: [] }, config())).toEqual([])
  })

  it("an anatomy node of type instance is never mapped nor reported", () => {
    const contracts = [
      contract("widget", {
        sources: { code: { styles: "widget.scss" } },
        anatomy: {
          root: { type: "container" },
          child: { type: "instance", instanceOf: "OtherComponent" },
        },
        styles: { root: { base: { color: { token: "acme.color.fg" } } } },
      }),
    ]
    const census = fileCensus("widget.scss", [
      selector(".widget", {
        declarations: [varDecl("color", "--acme-color-fg")],
      }),
    ])
    expect(runStylesCheck(contracts, census, config())).toEqual([])
  })

  it("a mapped variant compares cleanly when its own selector matches", () => {
    const contracts = [
      contract("widget", {
        sources: { code: { styles: "widget.scss" } },
        anatomy: { root: { type: "container" } },
        styles: {
          root: {
            base: { color: { token: "acme.color.fg" } },
            variants: [
              {
                when: { tone: "danger" },
                color: { token: "acme.color.danger" },
              },
            ],
          },
        },
      }),
    ]
    const census = fileCensus("widget.scss", [
      selector(".widget", {
        declarations: [varDecl("color", "--acme-color-fg")],
      }),
      selector('.widget[data-tone="danger"]', {
        parent: ".widget",
        declarations: [varDecl("color", "--acme-color-danger")],
      }),
    ])
    expect(runStylesCheck(contracts, census, config())).toEqual([])
  })

  it("an unlocatable variant reports ONE variant-unmapped note and checks none of its bindings (#363)", () => {
    // It used to stay silent — which on a real project hid 28 of 78 declared
    // variants behind a clean result. A coverage note, never a
    // `binding-missing` sweep for the bindings it could not locate.
    const contracts = [
      contract("widget", {
        sources: { code: { styles: "widget.scss" } },
        anatomy: { root: { type: "container" } },
        styles: {
          root: {
            base: { color: { token: "acme.color.fg" } },
            variants: [
              {
                when: { tone: "danger" },
                color: { token: "acme.color.danger" },
              },
            ],
          },
        },
      }),
    ]
    // No nested attribute selector for tone=danger anywhere.
    const census = fileCensus("widget.scss", [
      selector(".widget", {
        declarations: [varDecl("color", "--acme-color-fg")],
      }),
    ])
    const findings = runStylesCheck(contracts, census, config())
    expect(findingIds(findings)).toEqual(["styles/variant-unmapped"])
    expect(findings[0]).toEqual(
      expect.objectContaining({
        severity: "review",
        entity: "widget.root",
        data: { element: "root", when: { tone: "danger" } },
      }),
    )
  })

  it("multiple contracts are each checked against their own style file", () => {
    const contracts = [
      contract("alpha", {
        sources: { code: { styles: "alpha.scss" } },
        anatomy: { root: { type: "container" } },
        styles: { root: { base: { color: { token: "acme.color.fg" } } } },
      }),
      contract("beta", {
        sources: { code: { styles: "beta.scss" } },
        anatomy: { root: { type: "container" } },
        styles: { root: { base: { color: { token: "acme.color.fg" } } } },
      }),
    ]
    const styleCensus = {
      files: [
        {
          file: "alpha.scss",
          selectors: [
            selector(".alpha", {
              declarations: [varDecl("color", "--acme-color-fg")],
            }),
          ],
        },
        {
          file: "beta.scss",
          selectors: [
            selector(".beta", { declarations: [literalDecl("color", "#fff")] }),
          ],
        },
      ],
    }
    const findings = runStylesCheck(contracts, styleCensus, config())
    expect(findingIds(findings)).toEqual(["styles/raw-value"])
    expect(findings[0].entity).toBe("beta.root")
  })
})

describe("runStylesCheck — config-driven severity", () => {
  it("honors a rules override, including 'off'", () => {
    const contracts = [
      contract("widget", {
        sources: { code: { styles: "widget.scss" } },
        anatomy: { root: { type: "container" } },
        styles: { root: { base: { color: { token: "acme.color.fg" } } } },
      }),
    ]
    const census = fileCensus("widget.scss", [selector(".widget")])

    const errored = runStylesCheck(contracts, census, {
      ...config(),
      rules: { "styles/binding-missing": "warn" },
    })
    expect(errored[0].severity).toBe("warn")

    const off = runStylesCheck(contracts, census, {
      ...config(),
      rules: { "styles/binding-missing": "off" },
    })
    expect(off).toEqual([])
  })
})

describe("runStylesCheck — determinism", () => {
  it("the same inputs produce byte-identical findings JSON regardless of contract order", () => {
    const widgetA = contract("alpha", {
      sources: { code: { styles: "alpha.scss" } },
      anatomy: { root: { type: "container" } },
      styles: { root: { base: { color: { token: "acme.color.fg" } } } },
    })
    const widgetB = contract("beta", {
      sources: { code: { styles: "beta.scss" } },
      anatomy: { root: { type: "container" } },
      styles: { root: { base: { color: { token: "acme.color.fg" } } } },
    })
    const styleCensus = {
      files: [
        { file: "alpha.scss", selectors: [selector(".alpha")] },
        { file: "beta.scss", selectors: [selector(".beta")] },
      ],
    }

    const a = JSON.stringify(
      runStylesCheck([widgetA, widgetB], styleCensus, config()),
    )
    const b = JSON.stringify(
      runStylesCheck([widgetB, widgetA], styleCensus, config()),
    )
    expect(a).toBe(b)
    expect(JSON.parse(a).map(f => f.entity)).toEqual([
      "alpha.root",
      "beta.root",
    ])
  })
})

// ---------------------------------------------------------------------------
// Shorthand indeterminacy — the check's largest real-world false-finding risk.
// ---------------------------------------------------------------------------

describe("compareProperty — a shorthand carrying the slot's value", () => {
  const BORDER_COLOR_DEF = PROPERTY_DEFS.find(d => d.key === "border.color")

  it("a shorthand containing a var makes the slot indeterminate, NOT missing", () => {
    // `border: 1px solid var(--c)` plainly binds a token for border-color, but
    // the shorthand does not say which part satisfies which sub-property.
    // Reporting `missing` here fired on real components whose CSS is correct;
    // guessing a match would be equally unfounded. Silence is the only honest
    // answer, and this pins it.
    const outcomes = compareProperty(
      BORDER_COLOR_DEF,
      { token: "acme.color.border" },
      declMap([
        {
          property: "border",
          kind: "compound",
          varNames: ["--acme-color-border"],
          raw: "1px solid var(--acme-color-border)",
        },
      ]),
      PREFIX,
    )
    expect(outcomes).toEqual([])
  })

  it("still reports a genuine mismatch when the LONGHAND is used", () => {
    const outcomes = compareProperty(
      BORDER_COLOR_DEF,
      { token: "acme.color.border" },
      declMap([varDecl("border-color", "--acme-color-wrong")]),
      PREFIX,
    )
    expect(outcomes.map(o => o.rule)).toEqual(["mismatch"])
  })

  it("still reports missing when neither longhand nor shorthand is present", () => {
    const outcomes = compareProperty(
      BORDER_COLOR_DEF,
      { token: "acme.color.border" },
      declMap([]),
      PREFIX,
    )
    expect(outcomes.map(o => o.rule)).toEqual(["missing"])
  })
})

// ---------------------------------------------------------------------------
// Variant selector conventions — measured, not assumed.
// ---------------------------------------------------------------------------

describe("locateVariantSelector — modifier classes and data attributes", () => {
  const index = children => ({ byParent: new Map([[".root", children]]) })

  it("resolves a modifier class named after the variant VALUE", () => {
    // What real component stylesheets actually do: a nested `&.lg` compiling
    // to `.root.lg`. Measured across a real design system: 86 nested modifier
    // classes, ZERO data-attribute selectors. Supporting only the latter left
    // variant style parity checking nothing on every real component.
    expect(
      locateVariantSelector(".root", { size: "lg" }, index([".root.lg"])),
    ).toBe(".root.lg")
  })

  it("still resolves the data-attribute convention", () => {
    expect(
      locateVariantSelector(
        ".root",
        { size: "lg" },
        index(['.root[data-size="lg"]']),
      ),
    ).toBe('.root[data-size="lg"]')
  })

  it("stays SILENT when both conventions are present (ambiguous)", () => {
    expect(
      locateVariantSelector(
        ".root",
        { size: "lg" },
        index([".root.lg", '.root[data-size="lg"]']),
      ),
    ).toBeNull()
  })

  it("stays silent when neither is present", () => {
    expect(
      locateVariantSelector(".root", { size: "xl" }, index([".root.lg"])),
    ).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Physical CSS property spellings — what real stylesheets actually use.
// ---------------------------------------------------------------------------

describe("compareProperty — physical vs logical edge properties", () => {
  const MARGIN_DEF = PROPERTY_DEFS.find(d => d.key === "margin")

  it("matches a contract blockEnd against `margin-bottom`", () => {
    // Measured across a real design system: 109 declarations use the physical
    // spelling (margin-bottom, padding-left) and 8 use the logical one. Only
    // recognizing the logical form reported `binding-missing` for a token the
    // stylesheet plainly binds — on essentially every box binding in the
    // codebase, and on the very first real contract authored.
    expect(
      compareProperty(
        MARGIN_DEF,
        { blockEnd: { token: "acme.space.xs" } },
        declMap([varDecl("margin-bottom", "--acme-space-xs")]),
        PREFIX,
      ),
    ).toEqual([])
  })

  it("still matches the logical spelling", () => {
    expect(
      compareProperty(
        MARGIN_DEF,
        { blockEnd: { token: "acme.space.xs" } },
        declMap([varDecl("margin-block-end", "--acme-space-xs")]),
        PREFIX,
      ),
    ).toEqual([])
  })

  it("still reports a genuine mismatch through the physical spelling", () => {
    expect(
      compareProperty(
        MARGIN_DEF,
        { blockEnd: { token: "acme.space.xs" } },
        declMap([varDecl("margin-bottom", "--acme-space-WRONG")]),
        PREFIX,
      ).map(o => o.rule),
    ).toEqual(["mismatch"])
  })
})

// ---------------------------------------------------------------------------
// Shorthand forms a real stylesheet actually writes (issue #183).
//
// `shorthands` decides one thing: whether an absent longhand means "missing"
// or "indeterminate". It is a SEPARATE question from which CSS property a
// contract token binds — `background` still binds `background-color`.
//
// Two forms were unregistered, and both produced false `styles/binding-missing`
// on real components: the `background` shorthand, and the per-edge
// `border-{top,right,bottom,left}` forms. Ten of them on one real component
// set — and every one was "fixed" by DELETING a correct assertion from the
// contract, which is the opposite of what a contract is for. That consequence,
// not the count, is why these are pinned.
// ---------------------------------------------------------------------------

describe("PROPERTY_DEFS — shorthand forms real stylesheets use (#183)", () => {
  const BACKGROUND = PROPERTY_DEFS.find(d => d.key === "background")
  const BORDER_COLOR = PROPERTY_DEFS.find(d => d.key === "border.color")
  const BORDER_WIDTH = PROPERTY_DEFS.find(d => d.key === "border.width")

  it("`background: var(--x)` is indeterminate, not missing", () => {
    expect(
      compareProperty(
        BACKGROUND,
        { token: "acme.color.bg" },
        declMap([varDecl("background", "--acme-color-bg")]),
        PREFIX,
      ),
    ).toEqual([])
  })

  for (const edge of ["top", "right", "bottom", "left"]) {
    it(`\`border-${edge}\` is indeterminate for border.color, not missing`, () => {
      expect(
        compareProperty(
          BORDER_COLOR,
          { token: "acme.color.border" },
          declMap([
            {
              property: `border-${edge}`,
              kind: "compound",
              varNames: ["--acme-color-border"],
              raw: `1px solid var(--acme-color-border)`,
            },
          ]),
          PREFIX,
        ),
      ).toEqual([])
    })
  }

  it("`border-top` is indeterminate for border.width too", () => {
    expect(
      compareProperty(
        BORDER_WIDTH,
        { token: "acme.border.thin" },
        declMap([
          {
            property: "border-top",
            kind: "compound",
            varNames: ["--acme-border-thin"],
            raw: "var(--acme-border-thin) solid red",
          },
        ]),
        PREFIX,
      ),
    ).toEqual([])
  })

  // --- the guards: silence must not spread beyond the shorthand ------------

  it("still reports a MISMATCH when the background longhand names another token", () => {
    expect(
      compareProperty(
        BACKGROUND,
        { token: "acme.color.bg" },
        declMap([varDecl("background-color", "--acme-color-wrong")]),
        PREFIX,
      ).map(o => o.rule),
    ).toEqual(["mismatch"])
  })

  it("still reports MISSING when nothing is declared at all", () => {
    expect(
      compareProperty(
        BACKGROUND,
        { token: "acme.color.bg" },
        declMap([]),
        PREFIX,
      ),
    ).toEqual([{ rule: "missing", slots: ["_value"] }])
  })

  it("an unrelated property does not satisfy the slot", () => {
    // `border-top` is a border shorthand, never a background one — the lists
    // are per-property and must not leak into each other.
    expect(
      compareProperty(
        BACKGROUND,
        { token: "acme.color.bg" },
        declMap([varDecl("border-top", "--acme-color-bg")]),
        PREFIX,
      ),
    ).toEqual([{ rule: "missing", slots: ["_value"] }])
  })
})

// ---------------------------------------------------------------------------
// Variant-selector collision when two props share a value (issue #184).
//
// A value-named modifier class is ambiguous the moment two enum props on one
// component share a literal value. Real case: `paragraph` has
// `mb: "body"|"lead"|"none"` and `size: "sm"|"md"|"lg"|"lead"`, whose classes
// are `.mbLead` and `.lead`. Resolving the bare form for BOTH checked the
// margin variant against the font variant's CSS — a false `binding-missing`
// AND an unexplained `binding-unexpected` on the same selector, which no
// contract change could fix.
//
// The prop-prefixed form is tried as a SEPARATE pass, deliberately: folding it
// into one candidate set would make a component owning both `.mbLead` and
// `.lead` match twice and resolve to nothing, trading a wrong answer for none.
// ---------------------------------------------------------------------------

describe("locateVariantSelector — prop-scoped disambiguation (#184)", () => {
  const index = children => ({ byParent: new Map([[".cgP", children]]) })
  const COLLIDING = [".cgP.mbLead", ".cgP.lead"]

  it("picks the prop-scoped class when two props share a value", () => {
    expect(
      locateVariantSelector(".cgP", { mb: "lead" }, index(COLLIDING)),
    ).toBe(".cgP.mbLead")
  })

  it("still picks the bare class for the prop that owns it", () => {
    expect(
      locateVariantSelector(".cgP", { size: "lead" }, index(COLLIDING)),
    ).toBe(".cgP.lead")
  })

  it("resolves the prop-scoped kebab form too", () => {
    expect(
      locateVariantSelector(".cgP", { mb: "lead" }, index([".cgP.mb-lead"])),
    ).toBe(".cgP.mb-lead")
  })

  // --- the convention this must not break ---------------------------------
  // 86 nested modifier classes and ZERO data-attribute selectors were measured
  // on a real design system. A prop-aware pass that broke the plain form would
  // silently stop checking almost every variant that exists.

  it("a plain value class with no collision still resolves", () => {
    expect(
      locateVariantSelector(".cgP", { size: "lg" }, index([".cgP.lg"])),
    ).toBe(".cgP.lg")
  })

  it("the data-attribute form still resolves", () => {
    expect(
      locateVariantSelector(
        ".cgP",
        { size: "lg" },
        index(['.cgP[data-size="lg"]']),
      ),
    ).toBe('.cgP[data-size="lg"]')
  })

  it("a kebab-cased value still resolves", () => {
    expect(
      locateVariantSelector(
        ".cgP",
        { size: "extraLarge" },
        index([".cgP.extra-large"]),
      ),
    ).toBe(".cgP.extra-large")
  })

  it("returns null rather than guessing when nothing matches", () => {
    expect(
      locateVariantSelector(".cgP", { size: "lg" }, index([".cgP.other"])),
    ).toBe(null)
  })
})

// ---------------------------------------------------------------------------
// Variant conventions added by #363 — each measured on a real project first.
// ---------------------------------------------------------------------------

describe("locateVariantSelector — states, booleans, top-level classes, chains (#363)", () => {
  const index = (children, topLevel = []) => ({
    byParent: new Map(Object.entries(children)),
    topLevelSelectors: topLevel,
  })
  const stateProp = {
    state: { type: "enum", values: ["resting", "hover"], code: "none" },
  }

  it('a `code: "none"` prop resolves to the pseudo-class, never a class', () => {
    expect(
      locateVariantSelector(
        ".root",
        { state: "hover" },
        index({ ".root": [".root:hover", ".root.hover"] }),
        { props: stateProp },
      ),
    ).toBe(".root:hover")
  })

  it("the same value on a code-side prop is a class, not a pseudo-class", () => {
    expect(
      locateVariantSelector(
        ".root",
        { state: "hover" },
        index({ ".root": [".root:hover", ".root.hover"] }),
        { props: { state: { type: "enum", values: ["hover"] } } },
      ),
    ).toBe(".root.hover")
  })

  it("design vocabulary aliases: pressed → :active, focused → :focus", () => {
    const props = {
      state: { type: "enum", values: ["pressed", "focused"], code: "none" },
    }
    expect(
      locateVariantSelector(
        ".root",
        { state: "pressed" },
        index({ ".root": [".root:active"] }),
        { props },
      ),
    ).toBe(".root:active")
    expect(
      locateVariantSelector(
        ".root",
        { state: "focused" },
        index({ ".root": [".root:focus"] }),
        { props },
      ),
    ).toBe(".root:focus")
  })

  it("focus is unmapped when both :focus and :focus-visible exist (ambiguous)", () => {
    expect(
      locateVariantSelector(
        ".root",
        { state: "focus" },
        index({ ".root": [".root:focus", ".root:focus-visible"] }),
        { props: { state: { type: "enum", values: ["focus"], code: "none" } } },
      ),
    ).toBeNull()
  })

  it("a boolean variant is a class named after the PROP", () => {
    expect(
      locateVariantSelector(
        ".root",
        { mb: true },
        index({ ".root": [".root.mb"] }),
      ),
    ).toBe(".root.mb")
    expect(
      locateVariantSelector(
        ".root",
        { isTight: true },
        index({ ".root": [".root.is-tight"] }),
      ),
    ).toBe(".root.is-tight")
    // `false` names nothing — the base is the false case.
    expect(
      locateVariantSelector(
        ".root",
        { mb: false },
        index({ ".root": [".root.mb"] }),
      ),
    ).toBeNull()
  })

  it("the ROOT may fall back to a top-level co-applied class (CSS modules)", () => {
    expect(
      locateVariantSelector(
        ".chip",
        { size: "sm" },
        index({}, [".chip", ".sm"]),
        { isRoot: true },
      ),
    ).toBe(".sm")
    expect(
      locateVariantSelector(
        ".chip",
        { size: "sm" },
        index({}, [".chip", ".sizeSm"]),
        { isRoot: true },
      ),
    ).toBe(".sizeSm")
  })

  it("a child element never takes the top-level fallback — that class is the root's", () => {
    expect(
      locateVariantSelector(
        ".label",
        { size: "sm" },
        index({}, [".chip", ".label", ".sm"]),
      ),
    ).toBeNull()
  })

  it("a nested modifier wins over a top-level class of the same name", () => {
    expect(
      locateVariantSelector(
        ".chip",
        { size: "sm" },
        index({ ".chip": [".chip.sm"] }, [".chip", ".sm"]),
        { isRoot: true },
      ),
    ).toBe(".chip.sm")
  })

  it("a multi-key when resolves one key at a time, nesting each under the last", () => {
    expect(
      locateVariantSelector(
        ".root",
        { variant: "inverse", state: "hover" },
        index({
          ".root": [".root.inverse", ".root:hover"],
          ".root.inverse": [".root.inverse:hover"],
        }),
        { props: stateProp },
      ),
    ).toBe(".root.inverse:hover")
  })

  it("class keys chain in sorted order; a step with no next hop is unmapped", () => {
    // `size` sorts before `tone`: `.root.lg` then `.root.lg.danger`.
    expect(
      locateVariantSelector(
        ".root",
        { tone: "danger", size: "lg" },
        index({
          ".root": [".root.lg", ".root.danger"],
          ".root.lg": [".root.lg.danger"],
        }),
      ),
    ).toBe(".root.lg.danger")
    // Nested the other way round (`.root.danger.lg`) — nothing under the
    // first hop, so unmapped and reported rather than guessed.
    expect(
      locateVariantSelector(
        ".root",
        { size: "lg", tone: "danger" },
        index({
          ".root": [".root.lg", ".root.danger"],
          ".root.danger": [".root.danger.lg"],
        }),
      ),
    ).toBeNull()
  })

  it("a mapped state variant is compared like any other (end to end)", () => {
    const contracts = [
      contract("button", {
        sources: { code: { styles: "button.scss" } },
        props: stateProp,
        anatomy: { root: { type: "container" } },
        styles: {
          root: {
            base: { color: { token: "acme.color.fg" } },
            variants: [
              {
                when: { state: "hover" },
                color: { token: "acme.color.hover" },
              },
            ],
          },
        },
      }),
    ]
    const census = fileCensus("button.scss", [
      selector(".button", {
        declarations: [varDecl("color", "--acme-color-fg")],
      }),
      selector(".button:hover", {
        parent: ".button",
        declarations: [varDecl("color", "--acme-color-wrong")],
      }),
    ])
    const findings = runStylesCheck(contracts, census, config())
    expect(findingIds(findings)).toEqual(["styles/token-mismatch"])
    expect(findings[0].message).toContain('variant state="hover"')
  })
})

describe("locateVariantSelector — is/has state-prefixed modifiers", () => {
  const index = children => ({ byParent: new Map(Object.entries(children)) })

  it("a value-named class may carry an is/has prefix", () => {
    expect(
      locateVariantSelector(
        ".hero",
        { height: "tight" },
        index({ ".hero": [".hero.isTight"] }),
      ),
    ).toBe(".hero.isTight")
    expect(
      locateVariantSelector(
        ".block",
        { elevation: "1" },
        index({ ".block": [".block.hasElevation1"] }),
      ),
    ).toBe(".block.hasElevation1")
  })

  it("a kebab value joins the prefix as camelCase", () => {
    expect(
      locateVariantSelector(
        ".t",
        { size: "extra-large" },
        index({ ".t": [".t.isExtraLarge"] }),
      ),
    ).toBe(".t.isExtraLarge")
  })

  it("a boolean prop's class may carry an is/has prefix", () => {
    expect(
      locateVariantSelector(
        ".hero",
        { mediaBleed: true },
        index({ ".hero": [".hero.hasMediaBleed"] }),
      ),
    ).toBe(".hero.hasMediaBleed")
  })

  it("a prop-scoped class may carry an is/has prefix, and still wins over the bare value", () => {
    expect(
      locateVariantSelector(
        ".p",
        { mb: "lead" },
        index({ ".p": [".p.hasMbLead", ".p.lead"] }),
      ),
    ).toBe(".p.hasMbLead")
  })

  it("prefixed and unprefixed forms of one name are an ambiguity, not a coin flip", () => {
    expect(
      locateVariantSelector(
        ".hero",
        { height: "tight" },
        index({ ".hero": [".hero.tight", ".hero.isTight"] }),
      ),
    ).toBeNull()
  })
})

describe("descendant selectors — element and variant mapping (#378)", () => {
  const index = (children, topLevel = [], all = []) => ({
    byParent: new Map(Object.entries(children)),
    topLevelSelectors: topLevel,
    bySelector: new Map(all.map(s => [s, { selector: s }])),
  })

  it("a child element maps to its descendant form when no bare class exists", () => {
    const idx = index({}, [".button"], [".button", ".button .icon"])
    expect(locateElementSelector({}, "icon", idx)).toBe(".button .icon")
  })

  it("a codeClass keeps its exact name but may sit under the root or as a unique descendant", () => {
    // The census now records `.button { .icon {} }` as `.button .icon`, so
    // the exact name has to be found there — the NAME is never widened.
    const underRoot = index({}, [".button"], [".button", ".button .cgIcon"])
    expect(
      locateElementSelector({ codeClass: "cgIcon" }, "glyph", underRoot, {
        rootSelector: ".button",
      }),
    ).toBe(".button .cgIcon")
    const uniqueDescendant = index({}, [".a", ".b"], [".a", ".b", ".b .cgIcon"])
    expect(
      locateElementSelector({ codeClass: "cgIcon" }, "glyph", uniqueDescendant),
    ).toBe(".b .cgIcon")
    // A near-miss name is still nothing.
    expect(
      locateElementSelector({ codeClass: "cgIco" }, "glyph", uniqueDescendant),
    ).toBeNull()
  })

  it("a bare class wins over a descendant form of the same name", () => {
    const idx = index(
      {},
      [".button", ".icon"],
      [".button", ".icon", ".sm .icon"],
    )
    expect(locateElementSelector({}, "icon", idx)).toBe(".icon")
  })

  it("the root's own descendant form wins over a state's override of the same element", () => {
    const idx = index(
      {},
      [".card"],
      [".card", ".card .image", ".card:hover .image"],
    )
    expect(
      locateElementSelector({}, "image", idx, { rootSelector: ".card" }),
    ).toBe(".card .image")
    // Even with no root to claim, a pseudo-class ancestor is never a home.
    expect(locateElementSelector({}, "image", idx)).toBe(".card .image")
  })

  it("two descendant forms and no bare class is an ambiguity, not a guess", () => {
    // `.sm .label` + `.lg .label`: there is no "the" label rule.
    const idx = index(
      {},
      [".chip", ".sm", ".lg"],
      [".chip", ".sm .label", ".lg .label"],
    )
    expect(locateElementSelector({}, "label", idx)).toBeNull()
  })

  it("a child's variant resolves under the ROOT's modifier (.sm .text)", () => {
    const idx = index(
      { ".sm": [".sm .text"] },
      [".display", ".text", ".sm"],
      [".display", ".text", ".sm", ".sm .text"],
    )
    expect(
      locateVariantSelector(".text", { size: "sm" }, idx, {
        rootSelector: ".display",
      }),
    ).toBe(".sm .text")
  })

  it("a nested modifier on the child itself still wins over the root-descendant form", () => {
    const idx = index(
      { ".text": [".text.sm"], ".sm": [".sm .text"] },
      [".display", ".text", ".sm"],
      [".display", ".text", ".sm", ".text.sm", ".sm .text"],
    )
    expect(
      locateVariantSelector(".text", { size: "sm" }, idx, {
        rootSelector: ".display",
      }),
    ).toBe(".text.sm")
  })

  it("the descendant form is never used for the root itself", () => {
    const idx = index(
      {},
      [".display", ".sm"],
      [".display", ".sm", ".sm .display"],
    )
    expect(
      locateVariantSelector(".display", { size: "sm" }, idx, {
        isRoot: true,
        rootSelector: ".display",
      }),
    ).toBe(".sm")
  })

  it("end to end: a child's variant styled under the root's modifier is compared, and a merged base is not", () => {
    const contracts = [
      contract("display", {
        sources: { code: { styles: "display.scss" } },
        props: { size: { type: "enum", values: ["sm", "lg"] } },
        anatomy: {
          root: { type: "container", codeClass: "display" },
          text: { type: "text" },
        },
        styles: {
          text: {
            base: { color: { token: "acme.color.fg" } },
            variants: [
              { when: { size: "sm" }, color: { token: "acme.color.sm" } },
            ],
          },
        },
      }),
    ]
    const census = fileCensus("display.scss", [
      selector(".display"),
      selector(".text", {
        declarations: [varDecl("color", "--acme-color-fg")],
      }),
      selector(".sm", { declarations: [] }),
      selector(".sm .text", {
        parent: ".sm",
        declarations: [varDecl("color", "--acme-color-wrong")],
      }),
    ])
    const findings = runStylesCheck(contracts, census, config())
    expect(findingIds(findings)).toEqual(["styles/token-mismatch"])
    expect(findings[0].message).toContain('variant size="sm"')
  })
})

describe("runStylesCheck — one CSS property, two contract spellings (#363)", () => {
  it("a longhand satisfying `border.width` is not also unexpected under `borderWidth`", () => {
    const contracts = [
      contract("widget", {
        sources: { code: { styles: "widget.scss" } },
        anatomy: { root: { type: "container" } },
        styles: {
          root: { base: { border: { width: { token: "acme.border.thin" } } } },
        },
      }),
    ]
    const census = fileCensus("widget.scss", [
      selector(".widget", {
        declarations: [varDecl("border-width", "--acme-border-thin")],
      }),
    ])
    expect(runStylesCheck(contracts, census, config())).toEqual([])
  })

  it("an undeclared property with no declared sibling is still unexpected — once", () => {
    // Both spellings undeclared used to report the same `border-width`
    // twice; the first spelling in registry order claims it.
    const contracts = [
      contract("widget", {
        sources: { code: { styles: "widget.scss" } },
        anatomy: { root: { type: "container" } },
        styles: { root: { base: { color: { token: "acme.color.fg" } } } },
      }),
    ]
    const census = fileCensus("widget.scss", [
      selector(".widget", {
        declarations: [
          varDecl("color", "--acme-color-fg"),
          varDecl("border-width", "--acme-border-thin"),
        ],
      }),
    ])
    expect(findingIds(runStylesCheck(contracts, census, config()))).toEqual([
      "styles/binding-unexpected",
    ])
  })
})

// ---------------------------------------------------------------------------
// styles/design-binding-missing (issue #401) — component-level, opt-in data
// ---------------------------------------------------------------------------

describe("runDesignBindingsCheck — folded vocabularies (live-measured classes)", () => {
  const tokens = {
    tokens: [
      { id: "system.fontWeight.semibold" },
      { id: "system.color.bg.elevation.1.default" },
      { id: "system.layout.section" },
      { id: "system.typography.body.md", $type: "typography" },
    ],
  }
  const contracts = [
    {
      id: "card",
      designMatchKey: "abc:1:2",
      contract: {
        styles: {
          root: {
            base: {
              // kebab spelling of a camel census id
              fontWeight: { token: "system.font-weight.semibold" },
              // hyphenated spelling of a dotted census id
              background: { token: "system.color.bg.elevation-1.default" },
              // single-segment design var covers this
              margin: { token: "system.layout.section" },
              // composite — never a bindings finding
              font: { token: "system.typography.body.md" },
              // unknown to the census under any spelling — skipped
              color: { token: "system.no.such.token" },
            },
          },
        },
      },
    },
  ]

  it("bridges kebab/camel and hyphen/dot spellings, singles, composites, and unknown ids", () => {
    const bound = runDesignBindingsCheck(
      contracts,
      {
        entries: [
          {
            matchKey: "abc:1:2",
            usedVars: [
              "fontWeight/semibold",
              "bg/elevation/1/default",
              "section",
            ],
          },
        ],
      },
      tokens,
      {},
    )
    expect(bound).toEqual({ findings: [], skipped: [] })

    const unbound = runDesignBindingsCheck(
      contracts,
      { entries: [{ matchKey: "abc:1:2", usedVars: ["fontWeight/semibold"] }] },
      tokens,
      {},
    )
    // elevation + section now unbound; composite and unknown still silent.
    expect(unbound.findings.map(f => f.data.token)).toEqual([
      "system.color.bg.elevation-1.default",
      "system.layout.section",
    ])
  })
})

describe("runDesignBindingsCheck", () => {
  const contracts = [
    {
      id: "field",
      designMatchKey: "abc:1:2",
      contract: {
        styles: {
          root: {
            base: {
              color: { token: "acme.color.fg" },
              background: { token: "acme.color.bg" },
            },
            variants: [
              {
                when: { tone: "danger" },
                color: { token: "acme.color.danger" },
              },
            ],
          },
        },
      },
    },
  ]
  const tokens = {
    tokens: [
      { id: "acme.color.fg" },
      { id: "acme.color.bg" },
      { id: "acme.color.danger" },
    ],
  }

  it("reports each declared token no bound design variable maps to — once per token, elements in data", () => {
    const findings = runDesignBindingsCheck(
      contracts,
      { entries: [{ matchKey: "abc:1:2", usedVars: ["color/fg"] }] },
      tokens,
      {},
    )
    expect(findings.findings.map(f => f.data.token)).toEqual([
      "acme.color.bg",
      "acme.color.danger",
    ])
    expect(findings.skipped).toEqual([])
    expect(findings.findings[0]).toMatchObject({
      ruleId: "styles/design-binding-missing",
      surface: "styles",
      side: "design",
      entity: "field",
      data: { elements: ["root"], boundVariables: 1 },
    })
  })

  it("is silent when every declared token is bound, and for a variant binding too", () => {
    expect(
      runDesignBindingsCheck(
        contracts,
        {
          entries: [
            {
              matchKey: "abc:1:2",
              usedVars: ["color/fg", "color/bg", "color/danger"],
            },
          ],
        },
        tokens,
        {},
      ),
    ).toEqual({ findings: [], skipped: [] })
  })

  it("is silent for a snapshot without usedVars (pre-bindings gather), an unmatched contract, and rules off", () => {
    expect(
      runDesignBindingsCheck(
        contracts,
        { entries: [{ matchKey: "abc:1:2" }] },
        tokens,
        {},
      ),
    ).toEqual({ findings: [], skipped: [] })
    expect(
      runDesignBindingsCheck(
        [{ ...contracts[0], designMatchKey: null }],
        { entries: [] },
        tokens,
        {},
      ),
    ).toEqual({ findings: [], skipped: [] })
    expect(
      runDesignBindingsCheck(
        contracts,
        { entries: [{ matchKey: "abc:1:2", usedVars: [] }] },
        tokens,
        { rules: { "styles/design-binding-missing": "off" } },
      ),
    ).toEqual({ findings: [], skipped: [] })
  })
})

// Every case below is one the rule reported on a real project and could not
// be acted on: the contract is right, the stylesheet is right, the design
// file is right, and only the comparison was wrong (issue #492).
describe("runDesignBindingsCheck — what the comparison cannot reach (#492)", () => {
  const FIGMA = { unbindableProperties: ["lineHeight", "margin"] }

  it("a property the provider cannot express as a variable is skipped with a reason, not reported", () => {
    // Measured on a consumer project: `timestamp` declares
    // `margin.blockEnd = system.stack.lg`, the stylesheet carries it, and
    // the Figma component binds the spacing it owns — but flow spacing lives
    // on the PARENT frame, outside the component the contract addresses.
    const contracts = [
      {
        id: "timestamp",
        designMatchKey: "abc:1:2",
        contract: {
          styles: {
            root: {
              base: {
                margin: { blockEnd: { token: "system.stack.lg" } },
                lineHeight: { token: "system.lineHeight.body" },
                color: { token: "system.color.fg.muted" },
              },
            },
          },
        },
      },
    ]
    const tokens = {
      tokens: [
        { id: "system.stack.lg" },
        { id: "system.lineHeight.body" },
        { id: "system.color.fg.muted" },
      ],
    }
    const census = {
      entries: [{ matchKey: "abc:1:2", usedVars: ["fg/muted"] }],
    }

    const { findings, skipped } = runDesignBindingsCheck(
      contracts,
      census,
      tokens,
      {},
      FIGMA,
    )
    expect(findings).toEqual([])
    expect(skipped.map(entry => entry.token).sort()).toEqual([
      "system.lineHeight.body",
      "system.stack.lg",
    ])
    expect(skipped.every(entry => entry.entity === "timestamp")).toBe(true)
    expect(skipped[0].reason).toMatch(/node-level variable/)

    // WITHOUT a provider list, the same input still reports both — the limit
    // is declared, never inferred from the census.
    expect(
      runDesignBindingsCheck(contracts, census, tokens, {}).findings.map(
        f => f.data.token,
      ),
    ).toEqual(["system.lineHeight.body", "system.stack.lg"])
  })

  it("one unbindable declaration never silences the SAME token declared under a bindable property", () => {
    // The widening this skip must not cause: `system.stack.lg` is declared
    // for a `gap` the tool CAN bind and for a `margin` it cannot. The gap
    // binding is real drift and stays reported.
    const contracts = [
      {
        id: "card",
        designMatchKey: "abc:1:2",
        contract: {
          styles: {
            root: { base: { gap: { token: "system.stack.lg" } } },
            footer: {
              base: { margin: { blockStart: { token: "system.stack.lg" } } },
            },
          },
        },
      },
    ]
    const { findings, skipped } = runDesignBindingsCheck(
      contracts,
      { entries: [{ matchKey: "abc:1:2", usedVars: [] }] },
      { tokens: [{ id: "system.stack.lg", cssValue: "24px" }] },
      {},
      FIGMA,
    )
    expect(findings.map(f => f.data.token)).toEqual(["system.stack.lg"])
    expect(skipped).toEqual([])
  })

  it("a zero-valued token is skipped by VALUE, whatever property it sits under", () => {
    const contracts = [
      {
        id: "chip",
        designMatchKey: "abc:1:2",
        contract: {
          styles: { root: { base: { gap: { token: "system.none" } } } },
        },
      },
    ]
    const { findings, skipped } = runDesignBindingsCheck(
      contracts,
      { entries: [{ matchKey: "abc:1:2", usedVars: [] }] },
      { tokens: [{ id: "system.none", cssValue: "0px" }] },
      {},
      FIGMA,
    )
    expect(findings).toEqual([])
    expect(skipped[0]).toMatchObject({
      token: "system.none",
      entity: "chip",
    })
    expect(skipped[0].reason).toMatch(/resolves to zero/)
  })

  it("a non-zero token under the same property is still reported", () => {
    const contracts = [
      {
        id: "chip",
        designMatchKey: "abc:1:2",
        contract: {
          styles: { root: { base: { gap: { token: "system.stack.sm" } } } },
        },
      },
    ]
    const { findings, skipped } = runDesignBindingsCheck(
      contracts,
      { entries: [{ matchKey: "abc:1:2", usedVars: [] }] },
      { tokens: [{ id: "system.stack.sm", cssValue: "8px" }] },
      {},
      FIGMA,
    )
    expect(findings.map(f => f.data.token)).toEqual(["system.stack.sm"])
    expect(skipped).toEqual([])
  })

  it("a tokenMap redirect that moves a bound variable elsewhere is a skip, not drift", () => {
    // Measured: the project maps `layout/section` to the xl breakpoint so the
    // TOKEN census compares correctly, while the contract declares the family
    // alias. No change to the design file can satisfy the comparison.
    const contracts = [
      {
        id: "block",
        designMatchKey: "abc:1:2",
        contract: {
          styles: {
            root: { base: { padding: { token: "system.layout.section" } } },
          },
        },
      },
    ]
    const tokens = {
      tokens: [
        { id: "system.layout.section" },
        { id: "system.layout.xl.section" },
      ],
    }
    const census = {
      entries: [{ matchKey: "abc:1:2", usedVars: ["layout/section"] }],
    }
    const config = {
      design: {
        options: { tokenMap: { "layout/section": "system.layout.xl.section" } },
      },
    }

    const { findings, skipped } = runDesignBindingsCheck(
      contracts,
      census,
      tokens,
      config,
      FIGMA,
    )
    expect(findings).toEqual([])
    expect(skipped).toEqual([
      {
        token: "system.layout.section",
        entity: "block",
        reason: expect.stringContaining("layout/section"),
      },
    ])

    // A contract declaring the token the redirect POINTS AT is bound as
    // before — the redirect is the project's own correct answer, and this
    // skip never widens into silence for the token it resolves to.
    const atTarget = [
      {
        ...contracts[0],
        contract: {
          styles: {
            root: { base: { padding: { token: "system.layout.xl.section" } } },
          },
        },
      },
    ]
    expect(
      runDesignBindingsCheck(atTarget, census, tokens, config, FIGMA),
    ).toEqual({ findings: [], skipped: [] })
  })

  it("with no tokenMap configured, an unbound token is still reported", () => {
    const contracts = [
      {
        id: "block",
        designMatchKey: "abc:1:2",
        contract: {
          styles: {
            root: { base: { padding: { token: "system.layout.section" } } },
          },
        },
      },
    ]
    const { findings } = runDesignBindingsCheck(
      contracts,
      { entries: [{ matchKey: "abc:1:2", usedVars: ["color/fg"] }] },
      { tokens: [{ id: "system.layout.section" }, { id: "system.color.fg" }] },
      {},
      FIGMA,
    )
    expect(findings.map(f => f.data.token)).toEqual(["system.layout.section"])
  })
})

// The design side binds the primitive tier; the contract declares the
// semantic token aliasing it. A component should bind the semantic token, so
// that is still a finding — one whose message names the primitive and the fix.
describe("runDesignBindingsCheck — the alias chain above a bound variable", () => {
  const componentDeclaring = (...tokenIds) => [
    {
      id: "button",
      designMatchKey: "abc:1:2",
      contract: {
        styles: Object.fromEntries(
          tokenIds.map((token, index) => [
            `part${index}`,
            { base: { color: { token } } },
          ]),
        ),
      },
    },
  ]
  const binding = (...usedVars) => ({
    entries: [{ matchKey: "abc:1:2", usedVars }],
  })
  const tokens = {
    tokens: [
      { id: "acme.blue.500" },
      {
        id: "acme.color.action",
        aliasOf: "acme.blue.500",
        aliasChain: ["acme.blue.500"],
      },
      {
        id: "acme.color.link",
        aliasOf: "acme.blue.500",
        aliasChain: ["acme.blue.500"],
      },
      // two hops: hover -> action -> blue.500, recorded with only its direct
      // target so the walk itself has to make the second hop
      { id: "acme.color.hover", aliasOf: "acme.color.action" },
      { id: "acme.red.500" },
      {
        id: "acme.color.danger",
        aliasOf: "acme.red.500",
        aliasChain: ["acme.red.500"],
      },
    ],
  }

  it("a declared token one alias hop above the bound primitive is still reported, naming the primitive", () => {
    const { findings, skipped } = runDesignBindingsCheck(
      componentDeclaring("acme.color.action"),
      binding("blue/500"),
      tokens,
      {},
    )
    expect(skipped).toEqual([])
    expect(findings).toHaveLength(1)
    expect(findings[0]).toMatchObject({
      ruleId: "styles/design-binding-missing",
      severity: "review",
      data: { token: "acme.color.action", boundAliasTarget: "acme.blue.500" },
    })
    expect(findings[0].message).toContain(
      'binds primitive "acme.blue.500" directly',
    )
    expect(findings[0].message).toContain('so bind "acme.color.action"')
  })

  it("two hops above is reported the same way", () => {
    const { findings } = runDesignBindingsCheck(
      componentDeclaring("acme.color.hover"),
      binding("blue/500"),
      tokens,
      {},
    )
    expect(findings.map(f => f.data)).toMatchObject([
      { token: "acme.color.hover", boundAliasTarget: "acme.blue.500" },
    ])
  })

  it("two semantic tokens aliasing one bound primitive are each reported", () => {
    const { findings } = runDesignBindingsCheck(
      componentDeclaring("acme.color.action", "acme.color.link"),
      binding("blue/500"),
      tokens,
      {},
    )
    expect(findings.map(f => f.data)).toMatchObject([
      { token: "acme.color.action", boundAliasTarget: "acme.blue.500" },
      { token: "acme.color.link", boundAliasTarget: "acme.blue.500" },
    ])
  })

  it("a bound semantic token under the declared one is called a token, not a primitive", () => {
    const { findings } = runDesignBindingsCheck(
      componentDeclaring("acme.color.hover"),
      binding("color/action"),
      tokens,
      {},
    )
    expect(findings.map(f => f.data)).toMatchObject([
      { token: "acme.color.hover", boundAliasTarget: "acme.color.action" },
    ])
    expect(findings[0].message).toContain(
      'binds token "acme.color.action" directly',
    )
    expect(findings[0].message).not.toContain("primitive")
  })

  it("a declared token no chain reaches keeps the plain message", () => {
    const { findings } = runDesignBindingsCheck(
      componentDeclaring("acme.color.action", "acme.color.danger"),
      binding("blue/500"),
      tokens,
      {},
    )
    expect(findings.map(f => f.data.token)).toEqual([
      "acme.color.action",
      "acme.color.danger",
    ])
    const danger = findings[1]
    expect(danger.data.boundAliasTarget).toBeUndefined()
    expect(danger.message).toContain("no variable the design component binds")
    expect(danger.message).not.toContain("primitive")
  })

  it("a declared token the design side binds directly gives no finding", () => {
    expect(
      runDesignBindingsCheck(
        componentDeclaring("acme.color.action"),
        binding("color/action", "blue/500"),
        tokens,
        {},
      ),
    ).toEqual({ findings: [], skipped: [] })
  })

  it("never walks downward: a bound semantic token does not bind the primitive it aliases", () => {
    const { findings } = runDesignBindingsCheck(
      componentDeclaring("acme.blue.500"),
      binding("color/action"),
      tokens,
      {},
    )
    expect(findings.map(f => f.data.token)).toEqual(["acme.blue.500"])
  })

  it("a cyclic or self-referential chain terminates and invents nothing", () => {
    const cyclic = {
      tokens: [
        { id: "acme.a", aliasOf: "acme.b" },
        { id: "acme.b", aliasOf: "acme.a" },
        { id: "acme.self", aliasOf: "acme.self", aliasChain: ["acme.self"] },
        { id: "acme.loose" },
      ],
    }
    const { findings } = runDesignBindingsCheck(
      componentDeclaring("acme.b", "acme.loose"),
      binding("a", "self"),
      cyclic,
      {},
    )
    expect(findings.map(f => f.data)).toMatchObject([
      { token: "acme.b", boundAliasTarget: "acme.a" },
      { token: "acme.loose" },
    ])
    expect(findings[1].data.boundAliasTarget).toBeUndefined()
  })

  it("a tokenMap redirect stays a skip, even when the declared token aliases the redirect's target", () => {
    const redirected = {
      tokens: [
        {
          id: "acme.layout.section",
          aliasOf: "acme.layout.xl.section",
          aliasChain: ["acme.layout.xl.section"],
        },
        { id: "acme.layout.xl.section" },
      ],
    }
    const { findings, skipped } = runDesignBindingsCheck(
      componentDeclaring("acme.layout.section"),
      binding("layout/section"),
      redirected,
      {
        design: {
          options: {
            tokenMap: { "layout/section": "acme.layout.xl.section" },
          },
        },
      },
    )
    expect(findings).toEqual([])
    expect(skipped).toEqual([
      {
        token: "acme.layout.section",
        entity: "button",
        reason: expect.stringContaining("layout/section"),
      },
    ])
  })
})

describe("buildAliasIndex / expandThroughAliases", () => {
  it("indexes each alias target to the tokens aliasing it, from aliasOf and aliasChain", () => {
    const index = buildAliasIndex([
      { id: "p" },
      { id: "s1", aliasOf: "p" },
      { id: "s2", aliasOf: "p", aliasChain: ["p"] },
      { id: "s3", aliasOf: "s1", aliasChain: ["s1", "p"] },
    ])
    expect([...index.get("p")].sort()).toEqual(["s1", "s2", "s3"])
    expect([...index.get("s1")]).toEqual(["s3"])
    expect(index.has("s2")).toBe(false)
  })

  it("applies the fold to both sides of an edge", () => {
    const index = buildAliasIndex([{ id: "A.B", aliasOf: "C.D" }], id =>
      id.toLowerCase(),
    )
    expect([...index.get("c.d")]).toEqual(["a.b"])
  })

  it("expands upward transitively and stops on a cycle", () => {
    const index = buildAliasIndex([
      { id: "b", aliasOf: "a" },
      { id: "c", aliasOf: "b" },
      { id: "a", aliasOf: "c" },
      { id: "z", aliasOf: "z" },
    ])
    expect([...expandThroughAliases(["a"], index).keys()].sort()).toEqual([
      "a",
      "b",
      "c",
    ])
    expect([...expandThroughAliases(["z"], index).keys()]).toEqual(["z"])
  })

  it("records the bound id each reached id was walked up from", () => {
    const index = buildAliasIndex([
      { id: "s1", aliasOf: "p" },
      { id: "s2", aliasOf: "s1" },
      { id: "t1", aliasOf: "q" },
    ])
    expect(Object.fromEntries(expandThroughAliases(["p", "q"], index))).toEqual(
      { p: "p", q: "q", s1: "p", s2: "p", t1: "q" },
    )
  })
})
