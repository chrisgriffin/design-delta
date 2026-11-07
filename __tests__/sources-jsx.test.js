/**
 * sources-jsx.test.js — `src/sources/react/jsx.mjs`, the JSX structural census
 * (ADR-001 D5, Phase 2c, issue #104).
 *
 * Every fixture here is a small, generically-named, in-repo `.tsx` file
 * under `__tests__/fixtures/jsx/` — never a path or shape borrowed from any
 * specific consuming project.
 */

import { join } from "node:path"

import {
  extractJsxComponent,
  extractJsxComponents,
} from "../src/sources/react/jsx.mjs"

const FIXTURES = join(process.cwd(), "__tests__", "fixtures", "jsx")
const f = name => join(FIXTURES, name)

// ---------------------------------------------------------------------------
// The resolvable cases — a single, unambiguous static tree.
// ---------------------------------------------------------------------------

describe("extractJsxComponent — resolvable trees", () => {
  it("a simple element wrapping a single expression child", () => {
    const { ok, component } = extractJsxComponent(f("simple.tsx"))
    expect(ok).toBe(true)
    expect(component.resolvable).toBe(true)
    expect(component.root).toEqual({
      kind: "element",
      tag: "div",
      children: [
        {
          kind: "element",
          tag: "span",
          children: [{ kind: "expression", prop: "label" }],
        },
      ],
    })
  })

  it("a self-closing root has no children", () => {
    const { component } = extractJsxComponent(f("self-closing.tsx"))
    expect(component.resolvable).toBe(true)
    expect(component.root).toEqual({
      kind: "element",
      tag: "svg",
      attributes: { "data-icon": { unresolved: true } }, // `{name}` — computed (#364)
      children: [],
    })
  })

  it('{children} resolves to an expression node bound to "children" — not a decline', () => {
    const { component } = extractJsxComponent(f("children-slot.tsx"))
    expect(component.resolvable).toBe(true)
    expect(component.root).toEqual({
      kind: "element",
      tag: "div",
      children: [{ kind: "expression", prop: "children" }],
    })
  })

  it("a literal JSX text child and a literal string expression are both 'text'", () => {
    const { component } = extractJsxComponent(f("literal-text.tsx"))
    expect(component.resolvable).toBe(true)
    expect(component.root).toEqual({
      kind: "element",
      tag: "div",
      children: [
        {
          kind: "element",
          tag: "span",
          children: [{ kind: "text", value: "Fixed label" }],
        },
        {
          kind: "element",
          tag: "span",
          children: [{ kind: "expression", prop: "label" }],
        },
      ],
    })
  })

  it("a nested custom component is its own 'component' node, opaque children never followed", () => {
    const { component } = extractJsxComponent(f("composed-child.tsx"))
    expect(component.resolvable).toBe(true)
    expect(component.root).toEqual({
      kind: "element",
      tag: "div",
      children: [
        { kind: "component", name: "Icon", children: [] },
        {
          kind: "element",
          tag: "span",
          children: [{ kind: "expression", prop: "label" }],
        },
      ],
    })
  })

  it("multiple structural children keep their source order", () => {
    const { component } = extractJsxComponent(f("multi-child.tsx"))
    expect(component.resolvable).toBe(true)
    expect(component.root.children.map(c => c.tag)).toEqual(["span", "span"])
  })

  it("an unrecognized content expression is 'unknown' — content-only, not a decline", () => {
    const { component } = extractJsxComponent(f("unknown-expression.tsx"))
    expect(component.resolvable).toBe(true)
    expect(component.root).toEqual({
      kind: "element",
      tag: "span",
      children: [{ kind: "unknown" }],
    })
  })
})

// ---------------------------------------------------------------------------
// Decline reasons — every one named in the module docblock, proven silent.
// ---------------------------------------------------------------------------

describe("extractJsxComponent — DOM attributes (#364)", () => {
  it("records literal attributes on elements, never on components", () => {
    const { component } = extractJsxComponent(f("attributes.tsx"))
    expect(component.resolvable).toBe(true)
    expect(component.root).toEqual({
      kind: "element",
      tag: "button",
      attributes: {
        type: "button",
        "aria-label": { unresolved: true }, // `{label}` — computed
        disabled: "true", // bare boolean
        onClick: { unresolved: true },
      },
      children: [{ kind: "component", name: "Icon", children: [] }],
    })
    expect(component.root.attributesResolved).toBeUndefined()
  })

  it("a spread marks the attribute SET unresolved, keeping the literals seen", () => {
    const { component } = extractJsxComponent(f("attributes-spread.tsx"))
    expect(component.root).toEqual({
      kind: "element",
      tag: "input",
      attributes: { type: "text" },
      attributesResolved: false,
      children: [],
    })
  })

  it("across branches, an attribute survives only where every branch agrees", () => {
    const { component } = extractJsxComponent(f("attributes-branches.tsx"))
    expect(component.resolvable).toBe(true)
    expect(component.root.attributes).toEqual({
      role: "switch",
      "aria-checked": { unresolved: true },
    })
  })
})

describe("extractJsxComponent — decline reasons (never a guessed structure)", () => {
  it("a conditional (&&) JSX child withholds its parent's children (#165)", () => {
    // `{hasIcon && <span/>}` renders ZERO OR ONE node, so the parent's child
    // count is unknowable and no sibling can be positionally aligned. The
    // component no longer declines whole — the root and everything above the
    // variable region resolve, and the withheld list is reported.
    const { ok, component } = extractJsxComponent(f("conditional.tsx"))
    expect(ok).toBe(true)
    expect(component.resolvable).toBe(true)
    expect(component.partial).toBe(true)
    expect(component.root).toMatchObject({
      kind: "element",
      tag: "div",
      childrenResolved: false,
    })
    expect(component.root.children).toEqual([])
    expect(component.unresolvedAt).toEqual(["root children"])
  })

  it("a ternary as the WHOLE returned expression declines", () => {
    const { component } = extractJsxComponent(f("ternary-root.tsx"))
    expect(component.resolvable).toBe(false)
    expect(component.reason).toBe("conditional-render")
  })

  it(".map() withholds its parent's children rather than declining (#165)", () => {
    // Zero-to-many children: same unknowable count as a logical conditional.
    // The `<ul>` itself is still asserted, which is what a contract most often
    // declares about a list.
    const { component } = extractJsxComponent(f("mapped-list.tsx"))
    expect(component.resolvable).toBe(true)
    expect(component.partial).toBe(true)
    expect(component.root).toMatchObject({
      kind: "element",
      tag: "ul",
      childrenResolved: false,
    })
    expect(component.unresolvedAt).toEqual(["root children"])
  })

  it("a ternary child with two JSX arms marks ONE unresolved position (#165)", () => {
    // Exactly one node renders either way, so the position is real and the
    // sibling after it keeps a trustworthy index.
    const { component } = extractJsxComponent(f("ternary-child-both-jsx.tsx"))
    expect(component.resolvable).toBe(true)
    expect(component.root.childrenResolved).toBeUndefined()
    expect(component.root.children).toEqual([
      { kind: "unresolved" },
      {
        kind: "element",
        tag: "em",
        children: [{ kind: "text", value: "after" }],
      },
    ])
    expect(component.unresolvedAt).toEqual(["root > 0"])
  })

  it("a ternary child with a null arm withholds the list instead (#165)", () => {
    // THE BUG this pins: `{cond ? <Icon/> : null}` renders ZERO OR ONE node.
    // Marking a definite position shifts `<em>` from index 1 to index 0
    // whenever the null arm is taken — an alignment true only half the time,
    // and exactly the invented structure the variable-count path exists to
    // refuse. Shipped briefly on #168 before the Evaluator caught it.
    const { component } = extractJsxComponent(f("ternary-child-null-arm.tsx"))
    expect(component.resolvable).toBe(true)
    expect(component.root).toMatchObject({
      kind: "element",
      tag: "div",
      childrenResolved: false,
    })
    expect(component.root.children).toEqual([])
    expect(component.unresolvedAt).toEqual(["root children"])
  })

  it("a ternary child with a Fragment arm withholds the list too", () => {
    // A Fragment arm splices in an unknown number of siblings — many, not one.
    const { component } = extractJsxComponent(
      f("ternary-child-fragment-arm.tsx"),
    )
    expect(component.resolvable).toBe(true)
    expect(component.root).toMatchObject({
      kind: "element",
      tag: "ul",
      childrenResolved: false,
    })
  })

  it("a Fragment child still declines — it splices unknown siblings", () => {
    // The line between #165's two treatments: a `.map()` or `&&` sits at ONE
    // position whose count is unknown, so the parent survives with its list
    // withheld. A Fragment has no wrapping node at all, so there is no parent
    // position to withhold — it still declines.
    const { component } = extractJsxComponent(f("fragment-in-branch.tsx"))
    expect(component.resolvable).toBe(false)
    expect(component.reason).toBe("fragment")
  })

  it("an early `return null` guard no longer declines at all (#156)", () => {
    // `if (!visible) return null; return <div>{label}</div>` — the null branch
    // renders NOTHING, so it was never a competing tree. Counting it declined a
    // component whose markup is completely unambiguous, and the early-return
    // guard is the most common multi-return shape there is.
    const { component } = extractJsxComponent(f("early-return.tsx"))
    expect(component.resolvable).toBe(true)
    expect(component.root).toMatchObject({ kind: "element", tag: "div" })
  })

  it("branches with different roots decline as divergent-roots (#156)", () => {
    // The `button` shape: `<a>` when `href` is set, `<button>` otherwise. No
    // resolver change can reconcile these — it needs a variant-keyed contract.
    const { component } = extractJsxComponent(f("divergent-roots.tsx"))
    expect(component.resolvable).toBe(false)
    expect(component.reason).toBe("divergent-roots")
  })

  it("carries the candidate trees of a divergent-roots component (ADR-002 D5)", () => {
    // The decline stands — no single tree exists — but the branches are kept
    // in source order, in the same StructuralNode vocabulary a resolved `root`
    // uses (attributes included), so a variant-aware checker can match them to
    // a contract's variants instead of finding nothing there at all.
    const { component } = extractJsxComponent(f("divergent-roots.tsx"))
    expect(component.branches).toEqual([
      {
        kind: "element",
        tag: "a",
        attributes: { href: { unresolved: true } },
        children: [{ kind: "expression", prop: "label" }],
      },
      {
        kind: "element",
        tag: "button",
        children: [{ kind: "expression", prop: "label" }],
      },
    ])
  })

  it("carries no trees when a divergent branch cannot be resolved on its own", () => {
    // All-or-nothing: one branch holds a nested Fragment, so the branch list
    // would cover only SOME of what the component renders. A list read as the
    // complete set of branches when it is not is the same false-finding class
    // as guessing which branch counts, so nothing is carried — and the reason
    // is unchanged, since resolving a branch is not what made it divergent.
    const { component } = extractJsxComponent(
      f("divergent-roots-branch-declines.tsx"),
    )
    expect(component.resolvable).toBe(false)
    expect(component.reason).toBe("divergent-roots")
    expect(component.branches).toBeUndefined()
  })

  it("branches SHARING a root resolve to their intersection (#156 stage 2)", () => {
    // `<time>{label}</time>` vs `<time><span>{label}</span></time>`: the root
    // is invariant, the single child is not. The child position becomes
    // `unresolved` rather than picking a branch, and the divergence is
    // REPORTED — a partial comparison that reads as complete is the exact
    // false-finding class this module exists to avoid.
    const { component } = extractJsxComponent(f("shared-root-returns.tsx"))
    expect(component.resolvable).toBe(true)
    expect(component.partial).toBe(true)
    expect(component.root).toMatchObject({ kind: "element", tag: "time" })
    expect(component.root.children).toEqual([{ kind: "unresolved" }])
    expect(component.unresolvedAt).toEqual(["root > 0"])
  })

  it("does NOT flag partial when the branches agree completely", () => {
    // An intersection that finds no disagreement is a complete answer. Marking
    // it partial would make `modules/anatomy.mjs` hedge on a tree it can fully
    // trust — silently losing real findings.
    const { component } = extractJsxComponent(f("shared-root-identical.tsx"))
    expect(component.resolvable).toBe(true)
    expect(component.partial).toBeUndefined()
    expect(component.unresolvedAt).toBeUndefined()
    expect(component.root).toMatchObject({ kind: "element", tag: "time" })
    expect(component.root.children).toEqual([
      { kind: "expression", prop: "label" },
    ])
  })

  it("marks the whole children list unresolved when the counts differ", () => {
    // THE dangerous case: aligning differing-length lists positionally would
    // synthesize a tree matching NEITHER branch. The node itself still
    // resolves; only its children are withheld.
    const { component } = extractJsxComponent(f("shared-root-child-count.tsx"))
    expect(component.resolvable).toBe(true)
    expect(component.partial).toBe(true)
    expect(component.root).toMatchObject({
      kind: "element",
      tag: "div",
      childrenResolved: false,
    })
    expect(component.root.children).toEqual([])
    expect(component.unresolvedAt).toEqual(["root children"])
  })

  it("keeps childrenResolved:false across a THREE-branch fold", () => {
    // Each intersect call builds a fresh node, so the flag has to be carried
    // forward explicitly. Two-branch fixtures cannot catch this: the first
    // fold sets it, the second compares two already-emptied lists, finds the
    // lengths equal, and would drop it — leaving `children: []` reading as
    // "renders nothing" and reporting every declared child missing.
    const { component } = extractJsxComponent(
      f("shared-root-three-branches.tsx"),
    )
    expect(component.resolvable).toBe(true)
    expect(component.partial).toBe(true)
    expect(component.root).toMatchObject({
      kind: "element",
      tag: "div",
      childrenResolved: false,
    })
    // Deduplicated — the fold reaches the same position twice.
    expect(component.unresolvedAt).toEqual(["root children"])
  })

  it("declines when any single branch cannot be resolved on its own", () => {
    // A branch is not held to a weaker standard for having a sibling: a nested
    // Fragment in one branch declines the component with that branch's own
    // reason, exactly as it would with a single return. (Was a `.map()` before
    // #165 made that resolvable — the rule is unchanged, the example moved.)
    const { component } = extractJsxComponent(f("fragment-in-branch.tsx"))
    expect(component.resolvable).toBe(false)
    expect(component.reason).toBe("fragment")
  })

  it("intersects branches whose children are withheld for different reasons", () => {
    // One branch withholds its children for a `.map()`, the other resolves
    // them. The intersection must carry the withholding forward rather than
    // adopting the resolved branch's list — that list is true of one branch
    // only.
    const { component } = extractJsxComponent(
      f("shared-root-branch-declines.tsx"),
    )
    expect(component.resolvable).toBe(true)
    expect(component.root).toMatchObject({
      kind: "element",
      tag: "ul",
      childrenResolved: false,
    })
  })

  it("stays multiple-returns when a branch has no nameable root", () => {
    // One branch is a ternary. Claiming the roots DIVERGE would assert more
    // than is known, so the weaker, older reason is kept.
    const { component } = extractJsxComponent(
      f("guard-then-unnameable-root.tsx"),
    )
    expect(component.resolvable).toBe(false)
    expect(component.reason).toBe("multiple-returns")
  })

  it("declines as no-jsx-returned when every branch renders nothing", () => {
    // Dropping null branches must not leave "multiple-returns" implying
    // competing trees that do not exist.
    const { component } = extractJsxComponent(f("all-branches-null.tsx"))
    expect(component.resolvable).toBe(false)
    expect(component.reason).toBe("no-jsx-returned")
  })

  it("a Fragment root declines", () => {
    const { component } = extractJsxComponent(f("fragment-root.tsx"))
    expect(component.resolvable).toBe(false)
    expect(component.reason).toBe("fragment")
  })

  it("a Fragment nested anywhere in the tree declines too", () => {
    const { component } = extractJsxComponent(f("nested-fragment.tsx"))
    expect(component.resolvable).toBe(false)
    expect(component.reason).toBe("fragment")
  })

  it("a non-JSX call expression as the sole return declines as unsupported-shape", () => {
    const { component } = extractJsxComponent(f("unsupported-call-root.tsx"))
    expect(component.resolvable).toBe(false)
    expect(component.reason).toBe("unsupported-shape")
  })

  it("a sole `return null` declines as no-jsx-returned", () => {
    const { component } = extractJsxComponent(f("null-root.tsx"))
    expect(component.resolvable).toBe(false)
    expect(component.reason).toBe("no-jsx-returned")
  })

  it("a decline is never a diagnostic — ok stays true", () => {
    const { ok, diagnostics } = extractJsxComponent(f("conditional.tsx"))
    expect(ok).toBe(true)
    expect(diagnostics).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Never throws — genuine extraction failures, distinct from a decline.
// ---------------------------------------------------------------------------

describe("extractJsxComponent — never throws", () => {
  it("degrades to ok:false when typescript cannot load", () => {
    const result = extractJsxComponent(f("simple.tsx"), {
      tsModuleName: "definitely-not-a-real-module-xyz",
    })
    expect(result.ok).toBe(false)
    expect(result.component).toBeNull()
    expect(result.diagnostics[0].code).toBe("typescript-not-installed")
  })

  it("degrades to ok:false when the file does not exist", () => {
    const result = extractJsxComponent(f("does-not-exist.tsx"))
    expect(result.ok).toBe(false)
    expect(result.diagnostics[0].code).toBe("missing-component-file")
  })

  it("degrades to ok:false when no exported function component is found", () => {
    const result = extractJsxComponent(f("no-component.tsx"))
    expect(result.ok).toBe(false)
    expect(result.diagnostics[0].code).toBe("no-component-found")
  })

  it("labels diagnostics with the given `label`, not the real path", () => {
    const result = extractJsxComponent(f("no-component.tsx"), {
      label: "src/ui/no-component.tsx",
    })
    expect(result.diagnostics[0].file).toBe("src/ui/no-component.tsx")
  })
})

// ---------------------------------------------------------------------------
// Determinism.
// ---------------------------------------------------------------------------

describe("extractJsxComponent — determinism", () => {
  it("the same file censuses byte-identically twice", () => {
    const a = JSON.stringify(extractJsxComponent(f("simple.tsx")))
    const b = JSON.stringify(extractJsxComponent(f("simple.tsx")))
    expect(a).toBe(b)
  })
})

// ---------------------------------------------------------------------------
// extractJsxComponents — the whole-set entry point.
// ---------------------------------------------------------------------------

describe("extractJsxComponents", () => {
  it("censuses every file, sorted by file, regardless of input order", () => {
    const files = [f("simple.tsx"), f("conditional.tsx"), f("self-closing.tsx")]
    const { ok, components, diagnostics } = extractJsxComponents(files)
    expect(ok).toBe(true)
    expect(diagnostics).toEqual([])
    expect(components.map(c => c.file)).toEqual([...files].sort())
  })

  it("one bad file contributes a diagnostic without aborting the rest", () => {
    const { ok, components, diagnostics } = extractJsxComponents([
      f("simple.tsx"),
      f("no-component.tsx"),
    ])
    expect(ok).toBe(false)
    expect(components.map(c => c.file)).toEqual([f("simple.tsx")])
    expect(diagnostics).toEqual([
      expect.objectContaining({
        code: "no-component-found",
        file: f("no-component.tsx"),
      }),
    ])
  })

  it("a decline is a normal census entry, never a diagnostic", () => {
    const { ok, components, diagnostics } = extractJsxComponents([
      f("simple.tsx"),
      f("ternary-root.tsx"),
    ])
    expect(ok).toBe(true)
    expect(diagnostics).toEqual([])
    const declined = components.find(c => c.file === f("ternary-root.tsx"))
    expect(declined).toEqual({
      file: f("ternary-root.tsx"),
      resolvable: false,
      reason: "conditional-render",
    })
  })

  it("relabels each component relative to `root` when given", () => {
    const { components } = extractJsxComponents([f("simple.tsx")], {
      root: process.cwd(),
    })
    expect(components[0].file).toBe("__tests__/fixtures/jsx/simple.tsx")
  })

  it("degrades to ok:false, skipped:true when typescript cannot load — never one diagnostic per file", () => {
    const result = extractJsxComponents(
      [f("simple.tsx"), f("self-closing.tsx")],
      {
        tsModuleName: "definitely-not-a-real-module-xyz",
      },
    )
    expect(result.ok).toBe(false)
    expect(result.skipped).toBe(true)
    expect(result.components).toEqual([])
    expect(result.diagnostics).toHaveLength(1)
    expect(result.diagnostics[0].code).toBe("typescript-not-installed")
  })

  it("is deterministic — the same file set censuses to byte-identical JSON twice", () => {
    const files = [f("simple.tsx"), f("self-closing.tsx"), f("conditional.tsx")]
    const a = JSON.stringify(extractJsxComponents(files))
    const b = JSON.stringify(extractJsxComponents([...files].reverse()))
    expect(a).toBe(b)
  })
})

// ---------------------------------------------------------------------------
// Component discovery — measured against real code, not assumed.
// ---------------------------------------------------------------------------

describe("extractJsxComponent — how a component is exported", () => {
  it("follows `export default X` back to a `const X = …` declaration", () => {
    // The dominant real-world shape, and originally unhandled. Measured
    // across a real design system: of 100 components, ZERO used
    // `export function X`, and 55 declared `const X = …` then exported it on
    // the last line. Handling only the inline-export forms left the walker
    // unable to find a component in 69 of those 100 files — the anatomy check
    // would have silently covered under a third of the codebase while
    // reporting confidently on the rest.
    const result = extractJsxComponent(
      join(FIXTURES, "default-exported-const.tsx"),
    )
    expect(result.ok).toBe(true)
    expect(result.component.resolvable).toBe(true)
    expect(result.component.root.tag).toBe("div")
  })
})

// ---------------------------------------------------------------------------
// Higher-order component wrappers (issue #134).
//
// `forwardRef`/`memo` make the declaration's initializer a CallExpression, so
// a finder matching only arrows and function expressions returned nothing and
// this reader emitted `no-component-found` — leaving the anatomy surface blind
// to a real component, and (with the props reader failing the same way)
// dropping it out of the contract worklist entirely (#132).
//
// Both resolution passes need it: the inline-export path and the
// `export default <Identifier>` path.
// ---------------------------------------------------------------------------

describe("extractJsxComponent — forwardRef/memo-wrapped components", () => {
  it("resolves a forwardRef component exported inline", () => {
    const result = extractJsxComponent(join(FIXTURES, "forward-ref.tsx"))
    expect(result.ok).toBe(true)
    expect(result.component.resolvable).toBe(true)
    expect(result.component.root.tag).toBe("div")
  })

  it("resolves a memo component reached via export default", () => {
    const result = extractJsxComponent(
      join(FIXTURES, "memo-default-export.tsx"),
    )
    expect(result.ok).toBe(true)
    expect(result.component.resolvable).toBe(true)
    expect(result.component.root.tag).toBe("section")
  })

  // The `React.`-qualified spelling (issue #577). This reader calls `unwrapHoc`
  // independently of `extract.mjs`, so the property-access callee needs its own
  // cover here: unresolved, the anatomy surface reports `no-component-found`
  // against a real component. The nested child is asserted, not just the root,
  // because that is what proves the WRAPPED function's body was walked rather
  // than something merely having been found.
  it("resolves a React.-qualified forwardRef component", () => {
    const result = extractJsxComponent(f("qualified-forward-ref.tsx"))
    expect(result.ok).toBe(true)
    expect(result.diagnostics).toEqual([])
    expect(result.component.resolvable).toBe(true)
    expect(result.component.root.tag).toBe("div")
    expect(result.component.root.children).toEqual([
      { kind: "element", tag: "span", children: [{ kind: "unknown" }] },
    ])
  })
})
