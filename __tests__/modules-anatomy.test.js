/**
 * modules-anatomy.test.js — `src/modules/anatomy.mjs`, the anatomy-parity
 * checker (ADR-001 D5, Phase 2c, issue #104).
 *
 * PURE input throughout: every case hand-builds its `contracts`/`jsxCensus`
 * fixtures in memory (the exact shapes `spec/contracts.mjs`'s
 * `loadContracts`/the framework adapter's `extractJsxComponents` produce) rather
 * than touching fs — same convention `modules-styles.test.js` and
 * `modules-tokens.test.js` follow.
 */

import {
  runAnatomyCheck,
  runDesignAnatomyCheck,
} from "../src/modules/anatomy.mjs"
import { DECLINE_REASONS } from "../src/sources/react/jsx.mjs"

function config(overrides = {}) {
  return { ...overrides }
}

function contract(id, body) {
  return {
    id,
    file: `${id}.contract.json`,
    contract: { id, title: id, ...body },
  }
}

function jsxCensus(components) {
  return { components }
}

function resolved(file, root) {
  return { file, resolvable: true, root }
}

function declined(file, reason) {
  return { file, resolvable: false, reason }
}

// The branch-bearing form (ADR-002 D5): still declined, carrying the trees.
function branched(file, branches, reason = "divergent-roots") {
  return { file, resolvable: false, reason, branches }
}

function el(tag, children = []) {
  return { kind: "element", tag, children }
}

function comp(name, children = []) {
  return { kind: "component", name, children }
}

function text(value) {
  return { kind: "text", value }
}

function expr(prop) {
  return { kind: "expression", prop }
}

function unknown() {
  return { kind: "unknown" }
}

function unresolved() {
  return { kind: "unresolved" }
}

function partial(file, root, unresolvedAt) {
  return { file, resolvable: true, root, partial: true, unresolvedAt }
}

function findingIds(findings) {
  return findings.map(f => f.ruleId).sort()
}

const CODE_PATH = "widget.tsx"

function widgetContract(anatomy) {
  return contract("widget", {
    sources: { code: { path: CODE_PATH } },
    anatomy,
  })
}

// ---------------------------------------------------------------------------
// Each rule firing, in isolation.
// ---------------------------------------------------------------------------

describe("runAnatomyCheck — each rule firing", () => {
  it("anatomy/node-missing when a declared child is entirely absent", () => {
    const contracts = [
      widgetContract({
        root: { type: "container", element: "div", children: ["label"] },
        label: { type: "text", content: { $prop: "label" } },
      }),
    ]
    const census = jsxCensus([resolved(CODE_PATH, el("div", []))])
    const findings = runAnatomyCheck(contracts, census, config())
    expect(findingIds(findings)).toEqual(["anatomy/node-missing"])
    expect(findings[0]).toEqual(
      expect.objectContaining({
        ruleId: "anatomy/node-missing",
        surface: "anatomy",
        side: "code",
        severity: "error",
        entity: "widget.label",
        data: { element: "label" },
      }),
    )
  })

  it("anatomy/node-unexpected when the contract declares zero children but code renders one", () => {
    const contracts = [
      widgetContract({
        root: { type: "container", element: "div" },
      }),
    ]
    const census = jsxCensus([
      resolved(CODE_PATH, el("div", [el("span", [expr("label")])])),
    ])
    const findings = runAnatomyCheck(contracts, census, config())
    expect(findingIds(findings)).toEqual(["anatomy/node-unexpected"])
    expect(findings[0]).toEqual(
      expect.objectContaining({
        ruleId: "anatomy/node-unexpected",
        entity: "widget.root",
        data: { parent: "root", found: "<span>" },
      }),
    )
  })

  it("anatomy/element-mismatch when the contract says button but code renders div", () => {
    const contracts = [
      widgetContract({
        root: { type: "container", element: "button" },
      }),
    ]
    const census = jsxCensus([resolved(CODE_PATH, el("div", []))])
    const findings = runAnatomyCheck(contracts, census, config())
    expect(findingIds(findings)).toEqual(["anatomy/element-mismatch"])
    expect(findings[0]).toEqual(
      expect.objectContaining({
        ruleId: "anatomy/element-mismatch",
        entity: "widget.root",
        data: { element: "root", expected: "button", found: "div" },
      }),
    )
  })

  it("anatomy/element-mismatch also fires when the contract expects a DOM tag but code renders a custom component", () => {
    const contracts = [
      widgetContract({
        root: { type: "container", element: "button" },
      }),
    ]
    const census = jsxCensus([resolved(CODE_PATH, comp("FancyButton", []))])
    const findings = runAnatomyCheck(contracts, census, config())
    expect(findingIds(findings)).toEqual(["anatomy/element-mismatch"])
    expect(findings[0].data.found).toBe("<FancyButton/>")
  })

  it("anatomy/content-unbound when the bound prop is not rendered there", () => {
    const contracts = [
      widgetContract({
        root: {
          type: "container",
          element: "div",
          content: { $prop: "label" },
        },
      }),
    ]
    const census = jsxCensus([resolved(CODE_PATH, el("div", [text("Fixed")]))])
    const findings = runAnatomyCheck(contracts, census, config())
    expect(findingIds(findings)).toEqual(["anatomy/content-unbound"])
    expect(findings[0]).toEqual(
      expect.objectContaining({
        ruleId: "anatomy/content-unbound",
        entity: "widget.root",
        data: { element: "root", content: { $prop: "label" } },
      }),
    )
  })

  it("anatomy/content-unbound also fires for a mismatched literal string", () => {
    const contracts = [
      widgetContract({
        root: { type: "container", element: "div", content: "Submit" },
      }),
    ]
    const census = jsxCensus([resolved(CODE_PATH, el("div", [text("Cancel")]))])
    const findings = runAnatomyCheck(contracts, census, config())
    expect(findingIds(findings)).toEqual(["anatomy/content-unbound"])
  })

  it("anatomy/coverage-declined when the jsx census could not resolve the component, and nothing else fires", () => {
    const contracts = [
      widgetContract({
        root: {
          type: "container",
          element: "button",
          content: { $prop: "label" },
        },
      }),
    ]
    const census = jsxCensus([declined(CODE_PATH, "conditional-render")])
    const findings = runAnatomyCheck(contracts, census, config())
    expect(findingIds(findings)).toEqual(["anatomy/coverage-declined"])
    expect(findings[0]).toEqual(
      expect.objectContaining({
        ruleId: "anatomy/coverage-declined",
        surface: "anatomy",
        severity: "review",
        entity: "widget",
        data: { reason: "conditional-render" },
      }),
    )
  })
})

// ---------------------------------------------------------------------------
// Every documented decline/silence reason, proven silent.
// ---------------------------------------------------------------------------

describe("runAnatomyCheck — DOM attributes (#364)", () => {
  const withAttrs = (node, attributes, extra = {}) => ({
    ...node,
    attributes,
    ...extra,
  })

  it("a matching literal is silent; an undeclared attribute in code is not drift", () => {
    const contracts = [
      widgetContract({
        root: {
          type: "container",
          element: "button",
          attributes: { role: "button" },
        },
      }),
    ]
    const census = jsxCensus([
      resolved(
        CODE_PATH,
        withAttrs(el("button"), { role: "button", "aria-label": "Close" }),
      ),
    ])
    expect(runAnatomyCheck(contracts, census, config())).toEqual([])
  })

  it("anatomy/attribute-mismatch when both sides are literal and differ", () => {
    const contracts = [
      widgetContract({
        root: {
          type: "container",
          element: "button",
          attributes: { type: "button" },
        },
      }),
    ]
    const census = jsxCensus([
      resolved(CODE_PATH, withAttrs(el("button"), { type: "submit" })),
    ])
    const findings = runAnatomyCheck(contracts, census, config())
    expect(findingIds(findings)).toEqual(["anatomy/attribute-mismatch"])
    expect(findings[0]).toEqual(
      expect.objectContaining({
        severity: "error",
        entity: "widget.root",
        data: {
          element: "root",
          attribute: "type",
          expected: "button",
          found: "submit",
        },
      }),
    )
  })

  it("anatomy/attribute-missing when the code sets nothing and the set was resolved", () => {
    const contracts = [
      widgetContract({
        root: {
          type: "container",
          element: "div",
          attributes: { role: "status", "aria-live": "polite" },
        },
      }),
    ]
    const census = jsxCensus([resolved(CODE_PATH, el("div"))])
    const findings = runAnatomyCheck(contracts, census, config())
    expect(findingIds(findings)).toEqual([
      "anatomy/attribute-missing",
      "anatomy/attribute-missing",
    ])
    expect(findings.map(f => f.data.attribute)).toEqual(["aria-live", "role"])
  })

  it("anatomy/attribute-unresolved (review) when the value is computed", () => {
    const contracts = [
      widgetContract({
        root: {
          type: "container",
          element: "button",
          attributes: { "aria-label": "Close" },
        },
      }),
    ]
    const census = jsxCensus([
      resolved(
        CODE_PATH,
        withAttrs(el("button"), { "aria-label": { unresolved: true } }),
      ),
    ])
    const findings = runAnatomyCheck(contracts, census, config())
    expect(findingIds(findings)).toEqual(["anatomy/attribute-unresolved"])
    expect(findings[0].severity).toBe("review")
    expect(findings[0].message).toContain("computes its value")
  })

  it("anatomy/attribute-unresolved (review), not missing, when a spread makes the set unknowable", () => {
    const contracts = [
      widgetContract({
        root: {
          type: "container",
          element: "input",
          attributes: { type: "text", "aria-invalid": "false" },
        },
      }),
    ]
    const census = jsxCensus([
      resolved(
        CODE_PATH,
        withAttrs(el("input"), { type: "text" }, { attributesResolved: false }),
      ),
    ])
    const findings = runAnatomyCheck(contracts, census, config())
    expect(findingIds(findings)).toEqual(["anatomy/attribute-unresolved"])
    expect(findings[0].data.attribute).toBe("aria-invalid")
    expect(findings[0].message).toContain("spreads props")
  })

  it("a literal that DISAGREES under a spread is unresolved (review), never a mismatch error", () => {
    // `<input type="text" {...rest} />` — `rest` may set `type` too, and the
    // adapter records no order, so the literal is not the last word.
    const contracts = [
      widgetContract({
        root: {
          type: "container",
          element: "input",
          attributes: { type: "button" },
        },
      }),
    ]
    const census = jsxCensus([
      resolved(
        CODE_PATH,
        withAttrs(el("input"), { type: "text" }, { attributesResolved: false }),
      ),
    ])
    const findings = runAnatomyCheck(contracts, census, config())
    expect(findingIds(findings)).toEqual(["anatomy/attribute-unresolved"])
    expect(findings[0].severity).toBe("review")
    expect(findings[0].data).toEqual({
      element: "root",
      attribute: "type",
      expected: "button",
      found: "text",
    })
  })

  it("a literal that AGREES under a spread is silent — the best evidence available", () => {
    const contracts = [
      widgetContract({
        root: {
          type: "container",
          element: "input",
          attributes: { type: "text" },
        },
      }),
    ]
    const census = jsxCensus([
      resolved(
        CODE_PATH,
        withAttrs(el("input"), { type: "text" }, { attributesResolved: false }),
      ),
    ])
    expect(runAnatomyCheck(contracts, census, config())).toEqual([])
  })

  it("declaring nothing checks nothing — an existing contract is unaffected", () => {
    const contracts = [
      widgetContract({ root: { type: "container", element: "button" } }),
    ]
    const census = jsxCensus([
      resolved(
        CODE_PATH,
        withAttrs(
          el("button"),
          { type: "submit" },
          { attributesResolved: false },
        ),
      ),
    ])
    expect(runAnatomyCheck(contracts, census, config())).toEqual([])
  })
})

describe("runAnatomyCheck — silence, one reason at a time", () => {
  it("clean parity produces no findings", () => {
    const contracts = [
      widgetContract({
        root: {
          type: "container",
          element: "div",
          children: ["label"],
        },
        label: { type: "text", content: { $prop: "label" } },
      }),
    ]
    const census = jsxCensus([
      resolved(CODE_PATH, el("div", [el("span", [expr("label")])])),
    ])
    expect(runAnatomyCheck(contracts, census, config())).toEqual([])
  })

  it("every adapter decline reason produces coverage-declined only, never a structural finding", () => {
    // Driven by the adapter's OWN declared list rather than a copy: a
    // hardcoded one went stale the moment #165 retired `dynamic-list`, and a
    // list that silently stops covering every reason is exactly the gap this
    // test exists to close.
    for (const reason of DECLINE_REASONS) {
      const contracts = [
        widgetContract({
          root: { type: "container", element: "button", children: ["label"] },
          label: { type: "text", content: { $prop: "label" } },
        }),
      ]
      const census = jsxCensus([declined(CODE_PATH, reason)])
      const findings = runAnatomyCheck(contracts, census, config())
      expect(findingIds(findings)).toEqual(["anatomy/coverage-declined"])
      expect(findings[0].data).toEqual({ reason })
    }
  })

  it("a declined entry CARRYING its candidate trees still only produces coverage-declined (ADR-002 D5)", () => {
    // Step 1 of ADR-002's plan carries the branches of a divergent-roots
    // component instead of discarding them, and changes nothing here: matching
    // them to a contract's variants is step 3, and until it lands the extra
    // field must not shift a single finding.
    const contracts = [
      widgetContract({
        root: { type: "container", element: "button", children: ["label"] },
        label: { type: "text", content: { $prop: "label" } },
      }),
    ]
    const census = jsxCensus([
      {
        ...declined(CODE_PATH, "divergent-roots"),
        branches: [el("a", [expr("label")]), el("button", [expr("label")])],
      },
    ])
    const findings = runAnatomyCheck(contracts, census, config())
    expect(findingIds(findings)).toEqual(["anatomy/coverage-declined"])
    expect(findings[0].data).toEqual({ reason: "divergent-roots" })
  })

  it("a presentIf node's absence is never node-missing", () => {
    const contracts = [
      widgetContract({
        root: {
          type: "container",
          element: "div",
          children: ["icon", "label"],
        },
        icon: { type: "glyph", element: "svg", presentIf: "hasIcon" },
        label: { type: "text", content: { $prop: "label" } },
      }),
    ]
    // Code never renders the icon at all (no conditional — a resolvable
    // component whose variant simply never shows it), so the declared/actual
    // child counts differ (2 vs 1) purely because of the presentIf sibling.
    const census = jsxCensus([
      resolved(CODE_PATH, el("div", [el("span", [expr("label")])])),
    ])
    expect(runAnatomyCheck(contracts, census, config())).toEqual([])
  })

  it("a presentIf node that IS present is still checked normally", () => {
    const contracts = [
      widgetContract({
        root: { type: "container", element: "div", children: ["icon"] },
        icon: { type: "glyph", element: "svg", presentIf: "hasIcon" },
      }),
    ]
    const census = jsxCensus([resolved(CODE_PATH, el("div", [el("div", [])]))])
    const findings = runAnatomyCheck(contracts, census, config())
    expect(findingIds(findings)).toEqual(["anatomy/element-mismatch"])
    expect(findings[0].entity).toBe("widget.icon")
  })

  it("an instance node's absence IS still node-missing", () => {
    const contracts = [
      widgetContract({
        root: { type: "container", element: "div", children: ["icon"] },
        icon: { type: "instance", instanceOf: "Icon" },
      }),
    ]
    const census = jsxCensus([resolved(CODE_PATH, el("div", []))])
    const findings = runAnatomyCheck(contracts, census, config())
    expect(findingIds(findings)).toEqual(["anatomy/node-missing"])
    expect(findings[0].entity).toBe("widget.icon")
  })

  it("an instance node's own element/content are never compared, and its children never descended into", () => {
    const contracts = [
      widgetContract({
        root: { type: "container", element: "div", children: ["icon"] },
        // Declares an element AND content that plainly disagree with what
        // the census shows below — an instance node is never checked past
        // its own presence.
        icon: {
          type: "instance",
          instanceOf: "Icon",
          element: "svg",
          content: "should never be compared",
        },
      }),
    ]
    const census = jsxCensus([
      resolved(
        CODE_PATH,
        el("div", [comp("Icon", [el("span", [text("noise")])])]),
      ),
    ])
    expect(runAnatomyCheck(contracts, census, config())).toEqual([])
  })

  it("a children-count mismatch (declared > 0) stays silent for the whole region — no missing, no unexpected, no descent", () => {
    const contracts = [
      widgetContract({
        root: {
          type: "container",
          element: "div",
          children: ["icon", "label"],
        },
        // Declares element: "button" for icon — if this module DID descend
        // despite the count mismatch, it would wrongly fire element-mismatch
        // against whichever actual child it guessed corresponded to "icon".
        icon: { type: "glyph", element: "svg" },
        label: { type: "text", content: { $prop: "label" } },
      }),
    ]
    // Only ONE structural child actually renders (2 declared, 1 actual) —
    // ambiguous which declared name it corresponds to.
    const census = jsxCensus([
      resolved(CODE_PATH, el("div", [el("span", [expr("label")])])),
    ])
    expect(runAnatomyCheck(contracts, census, config())).toEqual([])
  })

  it("an unknown content child silences content-unbound for that node", () => {
    const contracts = [
      widgetContract({
        root: {
          type: "container",
          element: "span",
          content: { $prop: "label" },
        },
      }),
    ]
    const census = jsxCensus([resolved(CODE_PATH, el("span", [unknown()]))])
    expect(runAnatomyCheck(contracts, census, config())).toEqual([])
  })

  it("a contract with no sources.code.path is skipped entirely, silently", () => {
    const contracts = [
      contract("widget", {
        sources: { code: {} },
        anatomy: { root: { type: "container", element: "div" } },
      }),
    ]
    expect(runAnatomyCheck(contracts, jsxCensus([]), config())).toEqual([])
  })

  it("a contract whose code path has no jsx census entry is skipped, silently", () => {
    const contracts = [
      widgetContract({ root: { type: "container", element: "div" } }),
    ]
    expect(runAnatomyCheck(contracts, jsxCensus([]), config())).toEqual([])
  })

  it("a contract with no anatomy.root is skipped, silently", () => {
    const contracts = [widgetContract({})]
    const census = jsxCensus([resolved(CODE_PATH, el("div", []))])
    expect(runAnatomyCheck(contracts, census, config())).toEqual([])
  })

  it("an anatomy child name not present in the anatomy map is skipped defensively, never a crash", () => {
    const contracts = [
      widgetContract({
        root: { type: "container", element: "div", children: ["ghost"] },
      }),
    ]
    const census = jsxCensus([resolved(CODE_PATH, el("div", [el("span", [])]))])
    expect(() => runAnatomyCheck(contracts, census, config())).not.toThrow()
    expect(runAnatomyCheck(contracts, census, config())).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Config-driven severity + determinism.
// ---------------------------------------------------------------------------

describe("runAnatomyCheck — config-driven severity", () => {
  it("honors a rules override, including 'off'", () => {
    const contracts = [
      widgetContract({ root: { type: "container", element: "button" } }),
    ]
    const census = jsxCensus([resolved(CODE_PATH, el("div", []))])

    const warned = runAnatomyCheck(contracts, census, {
      ...config(),
      rules: { "anatomy/element-mismatch": "warn" },
    })
    expect(warned[0].severity).toBe("warn")

    const off = runAnatomyCheck(contracts, census, {
      ...config(),
      rules: { "anatomy/element-mismatch": "off" },
    })
    expect(off).toEqual([])
  })
})

describe("runAnatomyCheck — determinism", () => {
  it("the same inputs produce byte-identical findings JSON regardless of contract order", () => {
    const alphaContract = contract("alpha", {
      sources: { code: { path: "alpha.tsx" } },
      anatomy: { root: { type: "container", element: "button" } },
    })
    const betaContract = contract("beta", {
      sources: { code: { path: "beta.tsx" } },
      anatomy: { root: { type: "container", element: "button" } },
    })
    const census = jsxCensus([
      resolved("alpha.tsx", el("div", [])),
      resolved("beta.tsx", el("div", [])),
    ])

    const a = JSON.stringify(
      runAnatomyCheck([alphaContract, betaContract], census, config()),
    )
    const b = JSON.stringify(
      runAnatomyCheck([betaContract, alphaContract], census, config()),
    )
    expect(a).toBe(b)
    expect(JSON.parse(a).map(f => f.entity)).toEqual([
      "alpha.root",
      "beta.root",
    ])
  })
})

// ---------------------------------------------------------------------------
// Partial trees — a multi-branch component compared on its invariant only
// (issue #156, stage 2).
//
// The bar this module's docblock sets is that it never builds "a partial
// answer by guessing which branch counts". Intersecting branches is legitimate
// ONLY because it guesses nothing: it asserts strictly less, and says so. The
// tests below pin both halves — the silence at unresolved positions, and the
// finding that makes that silence visible. Without the second, this feature is
// worse than the decline it replaces.
// ---------------------------------------------------------------------------

describe("runAnatomyCheck — partial trees (#156)", () => {
  const CODE = "components/timestamp/timestamp.tsx"

  const contracts = [
    contract("timestamp", {
      sources: { code: { path: CODE } },
      anatomy: {
        root: { type: "container", element: "time", children: ["label"] },
        label: { type: "text", element: "span" },
      },
    }),
  ]

  it("reports coverage-partial, naming the positions not compared", () => {
    const census = jsxCensus([
      partial(CODE, el("time", [unresolved()]), ["root > 0"]),
    ])
    const findings = runAnatomyCheck(contracts, census, config())
    const partialFinding = findings.find(
      f => f.ruleId === "anatomy/coverage-partial",
    )
    expect(partialFinding).toBeDefined()
    expect(partialFinding.message).toMatch(/more than one tree/)
    expect(partialFinding.message).toMatch(/root > 0/)
    expect(partialFinding.data.unresolvedAt).toEqual(["root > 0"])
  })

  it("asserts NOTHING at an unresolved position", () => {
    // `label` is declared as a `span`. The code position is unresolved, so a
    // mismatch must NOT be claimed — the branches disagreed, and this module
    // has no idea which one a reader meant.
    const census = jsxCensus([
      partial(CODE, el("time", [unresolved()]), ["root > 0"]),
    ])
    const findings = runAnatomyCheck(contracts, census, config())
    expect(findingIds(findings)).toEqual(["anatomy/coverage-partial"])
  })

  it("still checks the parts that DID resolve", () => {
    // The whole point of partial comparison: the invariant root is compared
    // normally. Declaring `time` while the code renders `div` is a real
    // mismatch and must still fire.
    const census = jsxCensus([
      partial(CODE, el("div", [unresolved()]), ["root > 0"]),
    ])
    const findings = runAnatomyCheck(contracts, census, config())
    expect(findingIds(findings)).toContain("anatomy/element-mismatch")
  })

  it("withholds the children check when the branches rendered different counts", () => {
    // `children: []` with `childrenResolved: false` means NOT KNOWN, not none.
    // Reading it as "none" would emit node-missing for every declared child —
    // the exact false finding this path exists to prevent.
    const census = jsxCensus([
      {
        file: CODE,
        resolvable: true,
        root: {
          kind: "element",
          tag: "time",
          children: [],
          childrenResolved: false,
        },
        partial: true,
        unresolvedAt: ["root children"],
      },
    ])
    const findings = runAnatomyCheck(contracts, census, config())
    expect(findingIds(findings)).toEqual(["anatomy/coverage-partial"])
  })

  it("does not call an unresolved position an UNEXPECTED child", () => {
    // The zero-declared-children path emits `node-unexpected` per structural
    // child and never reaches compareNode's early return, so it asserted at
    // the one position the whole mechanism exists to stay silent about — and
    // printed `<undefined>`, since an unresolved node has no tag.
    const noChildren = [
      contract("timestamp", {
        sources: { code: { path: CODE } },
        anatomy: { root: { type: "container", element: "time" } },
      }),
    ]
    const census = jsxCensus([
      partial(CODE, el("time", [unresolved()]), ["root > 0"]),
    ])
    const findings = runAnatomyCheck(noChildren, census, config())
    expect(findingIds(findings)).toEqual(["anatomy/coverage-partial"])
  })

  it("does not report content unbound when a position is unresolved", () => {
    // An unresolved position could be holding this node's content. Comparing
    // against only the children that DID resolve reports the declared binding
    // as absent when it may be exactly what that position renders.
    const contentContract = [
      contract("timestamp", {
        sources: { code: { path: CODE } },
        anatomy: {
          root: {
            type: "text",
            element: "time",
            content: { $prop: "children" },
          },
        },
      }),
    ]
    const census = jsxCensus([
      partial(CODE, el("time", [unresolved()]), ["root > 0"]),
    ])
    const findings = runAnatomyCheck(contentContract, census, config())
    expect(findingIds(findings)).toEqual(["anatomy/coverage-partial"])
  })

  it("stays silent on content when the children list itself is withheld", () => {
    const contentContract = [
      contract("timestamp", {
        sources: { code: { path: CODE } },
        anatomy: {
          root: {
            type: "text",
            element: "time",
            content: { $prop: "children" },
          },
        },
      }),
    ]
    const census = jsxCensus([
      {
        file: CODE,
        resolvable: true,
        root: {
          kind: "element",
          tag: "time",
          children: [],
          childrenResolved: false,
        },
        partial: true,
        unresolvedAt: ["root children"],
      },
    ])
    const findings = runAnatomyCheck(contentContract, census, config())
    expect(findingIds(findings)).toEqual(["anatomy/coverage-partial"])
  })

  it("does not report partial for a fully-resolved component", () => {
    const census = jsxCensus([resolved(CODE, el("time", [el("span")]))])
    const findings = runAnatomyCheck(contracts, census, config())
    expect(findingIds(findings)).not.toContain("anatomy/coverage-partial")
  })
})

// ---------------------------------------------------------------------------
// Variant-keyed anatomy (ADR-002, issue #429) — a component whose branches
// render DIFFERENT roots, matched to the shapes its contract declares.
//
// The bar is the same one the partial-tree block above pins: matching is
// STRUCTURAL, by root element (D4), and anything that cannot be told apart
// asserts nothing. So these tests pin both halves too — the comparison that
// now happens, and the two unmatched-side findings that keep it honest about
// what it could not place.
// ---------------------------------------------------------------------------

describe("runAnatomyCheck — variant-keyed anatomy (#429)", () => {
  // The canonical case, ADR-002's own: one root when a prop is set, another
  // when it is not. `when` is free text no part of this module reads.
  const twoShapes = (
    variant = {
      when: "href is set",
      root: { type: "container", element: "a" },
    },
  ) =>
    widgetContract({
      root: { type: "container", element: "button", children: ["label"] },
      label: { type: "text", element: "span", content: { $prop: "label" } },
      $variants: { asLink: variant },
    })

  // One branch of the contract above, rooted at whatever element it renders.
  const shell = root => ({
    ...root,
    children: [el("span", [expr("label")])],
  })

  it("compares each rendered branch against the shape it matches, and declines nothing", () => {
    const census = jsxCensus([
      branched(CODE_PATH, [shell(el("button")), shell(el("a"))]),
    ])
    expect(runAnatomyCheck([twoShapes()], census, config())).toEqual([])
  })

  it("checks a matched branch with the same node rules a single-tree component gets", () => {
    // The variant inherits `label` from the base (D3), so the branch that
    // renders nothing there is a real `node-missing` — and the finding says
    // WHICH shape it came from, since a variant component reports from more
    // than one tree.
    const census = jsxCensus([
      branched(CODE_PATH, [shell(el("button")), el("a", [])]),
    ])
    const findings = runAnatomyCheck([twoShapes()], census, config())
    expect(findingIds(findings)).toEqual(["anatomy/node-missing"])
    expect(findings[0]).toEqual(
      expect.objectContaining({
        entity: "widget.label",
        data: { element: "label", variant: "asLink" },
      }),
    )
    expect(findings[0].message).toMatch(/variant "asLink"/)
  })

  it("anatomy/variant-unexpected when a rendered branch matches no declared shape", () => {
    const census = jsxCensus([
      branched(CODE_PATH, [
        shell(el("button")),
        shell(el("a")),
        shell(el("summary")),
      ]),
    ])
    const findings = runAnatomyCheck([twoShapes()], census, config())
    expect(findingIds(findings)).toEqual(["anatomy/variant-unexpected"])
    expect(findings[0]).toEqual(
      expect.objectContaining({
        ruleId: "anatomy/variant-unexpected",
        surface: "anatomy",
        side: "code",
        severity: "error",
        entity: "widget",
        data: { found: "summary" },
      }),
    )
  })

  it("anatomy/variant-missing when a declared variant matches no rendered branch", () => {
    const census = jsxCensus([
      branched(CODE_PATH, [shell(el("button")), shell(el("span"))]),
    ])
    const findings = runAnatomyCheck([twoShapes()], census, config())
    expect(findingIds(findings)).toEqual([
      "anatomy/variant-missing",
      "anatomy/variant-unexpected",
    ])
    const missing = findings.find(f => f.ruleId === "anatomy/variant-missing")
    expect(missing).toEqual(
      expect.objectContaining({
        entity: "widget",
        severity: "error",
        data: { expected: "a", variant: "asLink" },
      }),
    )
  })

  it("reports the BASE anatomy the same way when nothing renders its root", () => {
    const census = jsxCensus([
      branched(CODE_PATH, [shell(el("a")), shell(el("span"))]),
    ])
    const findings = runAnatomyCheck([twoShapes()], census, config())
    const missing = findings.find(f => f.ruleId === "anatomy/variant-missing")
    expect(missing.data).toEqual({ expected: "button" })
    expect(missing.message).toMatch(/base anatomy/)
  })

  it("still declines a divergent-roots component whose contract declares no variants", () => {
    const contracts = [
      widgetContract({
        root: { type: "container", element: "button", children: ["label"] },
        label: { type: "text", element: "span", content: { $prop: "label" } },
      }),
    ]
    const census = jsxCensus([
      branched(CODE_PATH, [shell(el("button")), shell(el("a"))]),
    ])
    const findings = runAnatomyCheck(contracts, census, config())
    expect(findingIds(findings)).toEqual(["anatomy/coverage-declined"])
    expect(findings[0].data).toEqual({ reason: "divergent-roots" })
  })

  it("still declines when the contract declares variants but no branches were carried", () => {
    // `branches` is omitted whenever a branch did not resolve on its own —
    // there is nothing to match, so the decline stands.
    const census = jsxCensus([declined(CODE_PATH, "divergent-roots")])
    const findings = runAnatomyCheck([twoShapes()], census, config())
    expect(findingIds(findings)).toEqual(["anatomy/coverage-declined"])
  })

  it("declines rather than guess when two declared shapes claim one root element", () => {
    // The loader rejects two VARIANTS claiming one element; it never sees a
    // variant colliding with the base, and nothing here may pick a winner.
    const contracts = [
      twoShapes({
        when: "href is set",
        root: { type: "container", element: "button" },
      }),
    ]
    const census = jsxCensus([
      branched(CODE_PATH, [shell(el("button")), shell(el("a"))]),
    ])
    const findings = runAnatomyCheck(contracts, census, config())
    expect(findingIds(findings)).toEqual(["anatomy/coverage-declined"])
    expect(findings[0].message).toMatch(/root element "button"/)
  })

  it("declines rather than guess when a declared shape has no root element", () => {
    // Nothing to match ON: a root that declares no element is not a shape
    // structural matching can place, and a variant inheriting that root is
    // not either.
    const contracts = [
      widgetContract({
        root: { type: "container", children: ["label"] },
        label: { type: "text", element: "span", content: { $prop: "label" } },
        $variants: { asLink: { root: { type: "container", element: "a" } } },
      }),
    ]
    const census = jsxCensus([
      branched(CODE_PATH, [shell(el("button")), shell(el("a"))]),
    ])
    const findings = runAnatomyCheck(contracts, census, config())
    expect(findingIds(findings)).toEqual(["anatomy/coverage-declined"])
    expect(findings[0].message).toMatch(/no root element/)
  })

  it("declines rather than guess when two rendered branches share a root element", () => {
    const census = jsxCensus([
      branched(CODE_PATH, [
        shell(el("button")),
        shell(el("a")),
        el("button", []),
      ]),
    ])
    const findings = runAnatomyCheck([twoShapes()], census, config())
    expect(findingIds(findings)).toEqual(["anatomy/coverage-declined"])
    expect(findings[0].message).toMatch(/more than once/)
  })

  it("matches a component root by the same name the element check would compare", () => {
    // A branch rooted at a component carries no DOM tag, and `compareNode`
    // describes it `<Link/>`. Matching uses that same description, so a
    // matched branch can never then mismatch on its own root.
    const contracts = [
      twoShapes({
        when: "href is set",
        root: { type: "container", element: "<Link/>" },
      }),
    ]
    const census = jsxCensus([
      branched(CODE_PATH, [shell(el("button")), shell(comp("Link"))]),
    ])
    expect(runAnatomyCheck(contracts, census, config())).toEqual([])
  })

  it("honors config severity for the variant rules like every other rule", () => {
    const census = jsxCensus([
      branched(CODE_PATH, [
        shell(el("button")),
        shell(el("a")),
        shell(el("summary")),
      ]),
    ])
    const findings = runAnatomyCheck(
      [twoShapes()],
      census,
      config({ rules: { "anatomy/variant-unexpected": "off" } }),
    )
    expect(findingIds(findings)).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// The DESIGN side (issue #402) — the same three structural rules, `side:
// "design"`, driven by the layer tree `ingest --bindings` merges onto the
// design component census.
// ---------------------------------------------------------------------------

const MATCH_KEY = "FILE1:1:2"

function designContract(anatomy) {
  return { ...widgetContract(anatomy), designMatchKey: MATCH_KEY }
}

function designCensus(layers, { matchKey = MATCH_KEY, unit } = {}) {
  return {
    entries: [
      {
        matchKey,
        name: "Widget",
        ...(unit ? { unit } : {}),
        ...(layers ? { layers } : {}),
      },
    ],
  }
}

function layer(name, type, children) {
  return {
    name,
    ...(type ? { type } : {}),
    ...(children ? { children } : {}),
  }
}

describe("runDesignAnatomyCheck — each rule firing, side: design", () => {
  it("anatomy/node-missing when the design component carries no layer for a declared node", () => {
    const contracts = [
      designContract({
        root: { type: "container", children: ["label"] },
        label: { type: "text" },
      }),
    ]
    const findings = runDesignAnatomyCheck(
      contracts,
      designCensus(layer("Widget", "container", [])),
      config(),
    )
    expect(findings).toHaveLength(1)
    expect(findings[0]).toEqual(
      expect.objectContaining({
        ruleId: "anatomy/node-missing",
        side: "design",
        surface: "anatomy",
        entity: "widget.label",
        data: { element: "label", layer: "label" },
      }),
    )
  })

  it("anatomy/node-unexpected for a layer the contract declares no node for", () => {
    const contracts = [designContract({ root: { type: "container" } })]
    const findings = runDesignAnatomyCheck(
      contracts,
      designCensus(layer("Widget", "container", [layer("Icon", "vector")])),
      config(),
    )
    expect(findings).toHaveLength(1)
    expect(findings[0]).toEqual(
      expect.objectContaining({
        ruleId: "anatomy/node-unexpected",
        side: "design",
        entity: "widget.root",
        data: { parent: "root", found: "Icon" },
      }),
    )
  })

  it("anatomy/element-mismatch when the declared node type is not the layer's type", () => {
    const contracts = [
      designContract({
        root: { type: "container", children: ["label"] },
        label: { type: "text" },
      }),
    ]
    const findings = runDesignAnatomyCheck(
      contracts,
      designCensus(
        layer("Widget", "container", [layer("label", "container", [])]),
      ),
      config(),
    )
    expect(findings).toHaveLength(1)
    expect(findings[0]).toEqual(
      expect.objectContaining({
        ruleId: "anatomy/element-mismatch",
        side: "design",
        entity: "widget.label",
        data: { element: "label", expected: "text", found: "container" },
      }),
    )
  })

  it("a matching tree produces nothing at all", () => {
    const contracts = [
      designContract({
        root: { type: "container", children: ["label", "icon"] },
        label: { type: "text" },
        icon: { type: "vector" },
      }),
    ]
    const findings = runDesignAnatomyCheck(
      contracts,
      designCensus(
        layer("Widget", "container", [
          layer("label", "text"),
          layer("icon", "vector"),
        ]),
      ),
      config(),
    )
    expect(findings).toEqual([])
  })
})

describe("runDesignAnatomyCheck — locating a node's layer", () => {
  it("`designLayer` is what is looked for, and is named in the finding when absent", () => {
    const contracts = [
      designContract({
        root: { type: "container", children: ["label"] },
        label: { type: "text", designLayer: "Label Text" },
      }),
    ]
    const matched = runDesignAnatomyCheck(
      contracts,
      designCensus(layer("Widget", "container", [layer("Label Text", "text")])),
      config(),
    )
    expect(matched).toEqual([])

    const missing = runDesignAnatomyCheck(
      contracts,
      designCensus(layer("Widget", "container", [])),
      config(),
    )
    expect(missing[0].message).toContain('"Label Text"')
    expect(missing[0].data).toEqual({ element: "label", layer: "Label Text" })
  })

  it("case and separators are folded — `iconLeft` locates a layer named `Icon Left`", () => {
    const contracts = [
      designContract({
        root: { type: "container", children: ["iconLeft"] },
        iconLeft: { type: "vector" },
      }),
    ]
    const findings = runDesignAnatomyCheck(
      contracts,
      designCensus(
        layer("Widget", "container", [layer("Icon Left", "vector")]),
      ),
      config(),
    )
    expect(findings).toEqual([])
  })

  it("two sibling layers a node could equally be: nothing is asserted for that node or its siblings", () => {
    const contracts = [
      designContract({
        root: { type: "container", children: ["label"] },
        label: { type: "text" },
      }),
    ]
    const findings = runDesignAnatomyCheck(
      contracts,
      designCensus(
        layer("Widget", "container", [
          layer("Label", "text"),
          layer("LABEL", "container"),
        ]),
      ),
      config(),
    )
    expect(findings).toEqual([])
  })

  it("an exact name wins over a folded one, so an exact pair is never ambiguous", () => {
    const contracts = [
      designContract({
        root: { type: "container", children: ["label"] },
        label: { type: "text" },
      }),
    ]
    const findings = runDesignAnatomyCheck(
      contracts,
      designCensus(
        layer("Widget", "container", [
          layer("label", "text"),
          layer("LABEL", "container"),
        ]),
      ),
      config(),
    )
    // The exact match claimed `label`, so nothing went unlocated and the
    // leftover `LABEL` is unambiguously extra.
    expect(findingIds(findings)).toEqual(["anatomy/node-unexpected"])
  })
})

describe("runDesignAnatomyCheck — silence, one reason at a time", () => {
  it("a census entry with no layer tree gathered asserts nothing", () => {
    const contracts = [
      designContract({
        root: { type: "container", children: ["label"] },
        label: { type: "text" },
      }),
    ]
    expect(
      runDesignAnatomyCheck(contracts, designCensus(null), config()),
    ).toEqual([])
  })

  it("a contract with no design address, or no matching census entry, asserts nothing", () => {
    const anatomy = {
      root: { type: "container", children: ["label"] },
      label: { type: "text" },
    }
    const tree = designCensus(layer("Widget", "container", []))
    expect(
      runDesignAnatomyCheck([widgetContract(anatomy)], tree, config()),
    ).toEqual([])
    expect(
      runDesignAnatomyCheck(
        [designContract(anatomy)],
        designCensus(layer("Widget", "container", []), {
          matchKey: "OTHER:9:9",
        }),
        config(),
      ),
    ).toEqual([])
  })

  it("`presentIf` silences node-missing, exactly as it does code-side", () => {
    const contracts = [
      designContract({
        root: { type: "container", children: ["label"] },
        label: { type: "text", presentIf: "showLabel" },
      }),
    ]
    expect(
      runDesignAnatomyCheck(
        contracts,
        designCensus(layer("Widget", "container", [])),
        config(),
      ),
    ).toEqual([])
  })

  it("`childrenResolved: false` means NOT KNOWN, never `carries no layers`", () => {
    const contracts = [
      designContract({
        root: { type: "container", children: ["label"] },
        label: { type: "text" },
      }),
    ]
    const findings = runDesignAnatomyCheck(
      contracts,
      designCensus({
        name: "Widget",
        type: "container",
        childrenResolved: false,
      }),
      config(),
    )
    expect(findings).toEqual([])
  })

  it("a nested instance is never descended into — its own contract's business", () => {
    const contracts = [
      designContract({
        root: { type: "container", children: ["icon"] },
        icon: { type: "instance", children: ["glyph"] },
        glyph: { type: "vector" },
      }),
    ]
    const findings = runDesignAnatomyCheck(
      contracts,
      designCensus(
        layer("Widget", "container", [
          { name: "icon", type: "instance", childrenResolved: false },
        ]),
      ),
      config(),
    )
    expect(findings).toEqual([])
  })

  it("a layer whose type the provider could not map is never an element-mismatch", () => {
    const contracts = [
      designContract({
        root: { type: "container", children: ["label"] },
        label: { type: "text" },
      }),
    ]
    const findings = runDesignAnatomyCheck(
      contracts,
      designCensus(layer("Widget", "container", [layer("label")])),
      config(),
    )
    expect(findings).toEqual([])
  })

  it("a node that could not be located leaves the leftover layers unreported — a rename is one fact, not two", () => {
    const contracts = [
      designContract({
        root: { type: "container", children: ["label"] },
        label: { type: "text" },
      }),
    ]
    const findings = runDesignAnatomyCheck(
      contracts,
      designCensus(layer("Widget", "container", [layer("Caption", "text")])),
      config(),
    )
    expect(findingIds(findings)).toEqual(["anatomy/node-missing"])
  })

  it("a contract with no `anatomy.root` has nothing to anchor a walk on", () => {
    const contracts = [designContract({ label: { type: "text" } })]
    expect(
      runDesignAnatomyCheck(
        contracts,
        designCensus(layer("Widget", "container", [])),
        config(),
      ),
    ).toEqual([])
  })
})

describe("runDesignAnatomyCheck — `root` is the census unit itself (#658)", () => {
  it("a contract declaring `root` a vector raises no element-mismatch against the gathered component, and its children are still compared", () => {
    const contracts = [
      designContract({
        root: { type: "vector", children: ["path1", "path2"] },
        path1: { type: "vector" },
        path2: { type: "vector" },
      }),
    ]
    const findings = runDesignAnatomyCheck(
      contracts,
      designCensus(layer("Widget", "container", [layer("path1", "vector")]), {
        unit: "component",
      }),
      config(),
    )
    expect(findings).toEqual([
      expect.objectContaining({
        ruleId: "anatomy/node-missing",
        entity: "widget.path2",
      }),
    ])
  })

  it("a node below `root` is still type-checked", () => {
    const contracts = [
      designContract({
        root: { type: "vector", children: ["path1"] },
        path1: { type: "vector" },
      }),
    ]
    const findings = runDesignAnatomyCheck(
      contracts,
      designCensus(layer("Widget", "container", [layer("path1", "text")])),
      config(),
    )
    expect(findings).toEqual([
      expect.objectContaining({
        ruleId: "anatomy/element-mismatch",
        entity: "widget.path1",
        data: { element: "path1", expected: "vector", found: "text" },
      }),
    ])
  })

  it("a contract declaring `root` an instance is still never descended into", () => {
    const contracts = [
      designContract({
        root: { type: "instance", children: ["glyph"] },
        glyph: { type: "vector" },
      }),
    ]
    const findings = runDesignAnatomyCheck(
      contracts,
      designCensus(layer("Widget", "container", [])),
      config(),
    )
    expect(findings).toEqual([])
  })
})

describe("runDesignAnatomyCheck — a variant set is compared through one variant (#658)", () => {
  const anatomy = {
    root: { type: "container", children: ["body"] },
    body: { type: "container", children: ["label"] },
    label: { type: "text" },
  }

  function variantSet(variants) {
    return designCensus(layer("Widget", "container", variants), {
      unit: "variant-set",
    })
  }

  it("a declared child of `root` inside a variant set's only variant raises no node-missing", () => {
    const findings = runDesignAnatomyCheck(
      [designContract(anatomy)],
      variantSet([
        layer("size=md", "container", [
          layer("body", "container", [layer("label", "text")]),
        ]),
      ]),
      config(),
    )
    expect(findings).toEqual([])
  })

  it("descends through the variant: a node nested below `root` that is genuinely absent is still node-missing", () => {
    const findings = runDesignAnatomyCheck(
      [designContract(anatomy)],
      variantSet([
        layer("size=md", "container", [layer("body", "container", [])]),
      ]),
      config(),
    )
    expect(findings).toEqual([
      expect.objectContaining({
        ruleId: "anatomy/node-missing",
        side: "design",
        entity: "widget.label",
        data: { element: "label", layer: "label" },
      }),
    ])
  })

  it("compares against the variant's layers, so a layer there the contract does not declare is node-unexpected — and the sibling variants are not", () => {
    const findings = runDesignAnatomyCheck(
      [designContract({ root: { type: "container" } })],
      variantSet([layer("size=md", "container", [layer("Ghost", "text")])]),
      config(),
    )
    expect(findings).toEqual([
      expect.objectContaining({
        ruleId: "anatomy/node-unexpected",
        entity: "widget.root",
        data: { parent: "root", found: "Ghost" },
      }),
    ])
  })

  it("with several variants, the first by name is the one compared, whatever order they were gathered in", () => {
    const complete = layer("size=lg", "container", [
      layer("body", "container", [layer("label", "text")]),
    ])
    const incomplete = layer("size=sm", "container", [
      layer("body", "container", []),
    ])
    for (const order of [
      [complete, incomplete],
      [incomplete, complete],
    ])
      expect(
        runDesignAnatomyCheck(
          [designContract(anatomy)],
          variantSet(order),
          config(),
        ),
      ).toEqual([])
  })

  it("a variant set whose variants were not resolved, or that has none, asserts nothing", () => {
    const unresolved = designCensus(
      { name: "Widget", type: "container", childrenResolved: false },
      { unit: "variant-set" },
    )
    expect(
      runDesignAnatomyCheck([designContract(anatomy)], unresolved, config()),
    ).toEqual([])
    expect(
      runDesignAnatomyCheck(
        [designContract(anatomy)],
        variantSet([]),
        config(),
      ),
    ).toEqual([])
  })

  it("`presentIf` and `designLayer` work inside the variant exactly as on a plain component", () => {
    const findings = runDesignAnatomyCheck(
      [
        designContract({
          root: { type: "container", children: ["body", "badge"] },
          body: { type: "container", designLayer: "Content" },
          badge: { type: "text", presentIf: "hasCount" },
        }),
      ],
      variantSet([
        layer("size=md", "container", [layer("Content", "container", [])]),
      ]),
      config(),
    )
    expect(findings).toEqual([])
  })
})

describe("runDesignAnatomyCheck — config and determinism", () => {
  it("honors a rule turned off, the same registry the code side reads", () => {
    const contracts = [
      designContract({
        root: { type: "container", children: ["label"] },
        label: { type: "text" },
      }),
    ]
    const findings = runDesignAnatomyCheck(
      contracts,
      designCensus(layer("Widget", "container", [])),
      config({ rules: { "anatomy/node-missing": "off" } }),
    )
    expect(findings).toEqual([])
  })

  it("is deterministic regardless of contract order", () => {
    const anatomy = {
      root: { type: "container", children: ["label"] },
      label: { type: "text" },
    }
    const first = {
      ...contract("alpha", {
        sources: { code: { path: "alpha.tsx" } },
        anatomy,
      }),
      designMatchKey: "FILE1:1:1",
    }
    const second = designContract(anatomy)
    const census = {
      entries: [
        { matchKey: "FILE1:1:1", layers: layer("Alpha", "container", []) },
        { matchKey: MATCH_KEY, layers: layer("Widget", "container", []) },
      ],
    }
    const forward = runDesignAnatomyCheck([first, second], census, config())
    const reverse = runDesignAnatomyCheck([second, first], census, config())
    expect(forward).toEqual(reverse)
    expect(forward.map(f => f.entity)).toEqual(["alpha.label", "widget.label"])
  })
})
