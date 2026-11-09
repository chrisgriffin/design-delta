/**
 * anatomy.mjs — anatomy parity (ADR-001 D5, Phase 2c, issue #104): the THIRD
 * checker of Phase 2, comparing a contract's declared `anatomy` element tree
 * (node types, the DOM tag each renders, child order, content bindings)
 * against the framework adapter's structural census of what the component
 * actually renders.
 *
 * PURE: `runAnatomyCheck(contracts, treeCensus, config) => findings[]`. Never
 * touches fs/network — the adapter's tree census builds the
 * census; this module only ever compares that already-loaded value against
 * the already-loaded contracts, the same layering contract
 * `modules/styles.mjs` and `modules/tokens.mjs` both document.
 *
 * THE SURFACE: `"anatomy"`, not folded into `"components"` — the same call
 * `modules/styles.mjs`'s docblock records for `"styles"` and for the same
 * reason. This is explicitly the riskiest checker in Phase 2 (the issue's own
 * words: "the hardest check to do deterministically"); a consumer who finds
 * it noisy on their codebase needs to be able to turn OFF anatomy findings
 * without also losing the components surface's props/API parity, which has
 * nothing to do with markup shape and every reason to stay on.
 *
 * ---------------------------------------------------------------------------
 * THE BAR — only assert what the framework adapter made unambiguous
 * ---------------------------------------------------------------------------
 *
 * the framework adapter already declines (`resolvable: false`) a component whose
 * render shape has no single static answer — a conditional, a `.map()`, an
 * early return, a Fragment, or any other shape it could not fully resolve.
 * When that happens this module emits exactly ONE `anatomy/coverage-declined`
 * finding (review severity) for the whole contract and asserts NOTHING else
 * about it — never a partial structural finding built from a guess about
 * which branch "counts".
 *
 * A component can also resolve PARTIALLY (`partial: true`): it renders several
 * branches sharing a root, so the adapter hands over their intersection, with
 * every position the branches disagreed on marked `{kind: "unresolved"}` and
 * listed in `unresolvedAt`. This module asserts NOTHING at such a position —
 * not its element, not its content, not that it is an unexpected child — and
 * emits one `anatomy/coverage-partial` naming what went uncompared. That
 * finding is what makes the silence honest: a partial comparison presented as
 * a complete one is the same false-finding class as guessing a branch. A node
 * carrying `childrenResolved: false` earns the same silence for its whole
 * child list, which means NOT KNOWN and never "renders nothing".
 *
 * Even once a component IS resolvable, three more sources of ambiguity are
 * silenced individually, each for a reason specific to it (never guessed
 * past):
 *
 *   - **`presentIf`**: a contract node marked `presentIf` is, by the
 *     contract's OWN admission, conditionally rendered. A resolvable
 *     component (by definition, no conditional anywhere) either always
 *     renders it or never does — which says nothing about whether the
 *     PROP that would gate it is true or false in general use. So THIS
 *     module never emits `anatomy/node-missing` for a `presentIf` node's
 *     absence, and never emits `anatomy/node-unexpected` purely because a
 *     sibling shifted position around it (see the children-count rule
 *     below). If the node IS present, its own element/content are still
 *     checked normally — being present in code doesn't excuse being wrong.
 *   - **`type: "instance"`**: a nested component instance is conformed
 *     against its OWN contract elsewhere — `modules/styles.mjs` already
 *     established this exact precedent ("skipped entirely — not mapped, not
 *     reported") for style bindings, and this module follows it for
 *     structure: an instance node's presence is still checked (its absence
 *     IS a real structural fact worth `anatomy/node-missing`), but its
 *     `element`/`content` are never compared and its children are never
 *     descended into — that subtree is a different contract's business.
 *   - **children-count mismatch**: the contract's `children` list is
 *     compared to the code's actual structural (element/component) children
 *     POSITIONALLY, index by index — the only correlation this module has
 *     without a stronger per-child identity (there is no markup-side
 *     `codeClass`-equivalent to key off, unlike `modules/styles.mjs`'s
 *     selector mapping). Positional pairing is trustworthy ONLY when the two
 *     lists are the SAME LENGTH — that is the general case this module
 *     recurses on. Two counts, though, are unambiguous even when they
 *     DIFFER, and are handled directly rather than folded into the general
 *     silence: the contract declares ZERO children at all (any structural
 *     child code renders there is then unambiguously extra —
 *     `anatomy/node-unexpected` fires for each one, the same
 *     "wholly-undeclared property only ever checked in the unexpected
 *     direction" asymmetry `modules/styles.mjs`'s `compareProperty` already
 *     applies to box-grammar properties, ported to children); and code
 *     renders ZERO structural children at all while the contract declares
 *     some (every declared child is then unambiguously absent outright —
 *     `anatomy/node-missing` fires for each, still honoring `presentIf`).
 *     Only when BOTH counts are non-zero and DIFFERENT — the genuinely
 *     ambiguous case, a `presentIf` sibling rendering being the common cause
 *     but not the only one — does this module stay SILENT for that node's
 *     whole children region: no missing, no unexpected, no descent.
 *
 * CONTENT comparison is similarly conservative: a node's `content` (a literal
 * string, or `{$prop: name}`) is checked against the component's CONTENT
 * children (text / `{identifier}` expressions — never its structural
 * element/component children, a different concern entirely). If ANY content
 * child at that position is `{kind: "unknown"}` (an expression this
 * module's census could not classify, e.g. `{formatPrice(x)}`), the whole
 * content check for that node stays silent — an unknown child might well BE
 * the match, and guessing either way is exactly what this checker exists to
 * avoid. Only a node whose content children are ALL classified, and none of
 * them match the declared literal/prop, is reported as
 * `anatomy/content-unbound`.
 *
 * OUT OF SCOPE, deliberately, matching the issue's four named rules exactly
 * (no fifth rule invented): unexpected CONTENT the contract doesn't declare
 * at all (only a missing content BINDING is checked, never an unexpected
 * one — `components/prop-unexpected`'s "extra stuff" symmetry does not carry
 * over here, since an extra literal caption or an extra interpolated value
 * inside an otherwise-correct node is far more likely incidental copy than
 * drift worth flagging, and there is no companion rule id for it in the
 * issue to register); the anatomy node `type` vocabulary itself
 * (container/text/glyph/vector/…) is a design-side classification the CODE
 * comparison cannot verify from markup at all, so `runAnatomyCheck` never
 * compares `type`, only `element` (the one field with a direct code-side
 * counterpart) — the design comparison below is where `type` finally gets
 * checked, against the side that can answer for it; an orphaned
 * anatomy node never reached by descending from `root` is not itself
 * flagged — this module walks the tree exactly as the contract declares it
 * connected, and does not separately audit "was every declared node visited."
 *
 * ---------------------------------------------------------------------------
 * COMPONENTS THAT RENDER MORE THAN ONE ROOT (ADR-002, issue #429)
 * ---------------------------------------------------------------------------
 *
 * A component whose branches render DIFFERENT root elements has no single
 * anatomy to describe, so the adapter declines it — and carries the trees it
 * found, under `branches` (ADR-002 D5). A contract answers with `$variants`:
 * alternative shapes, each a PARTIAL OVERRIDE of the base anatomy (D3). This
 * module matches the two.
 *
 * MATCHING IS STRUCTURAL, BY ROOT ELEMENT, AND NOTHING ELSE (D4). This engine
 * is static, so whether a prop is set is not knowable here; a variant's `when`
 * is free text for a human reader and is never read as a predicate. Both
 * unmatched sides are therefore REPORTED rather than guessed past: a rendered
 * branch no declared shape claims is `anatomy/variant-unexpected` (the
 * contract does not describe a shape the component renders), and a declared
 * shape — the base included — that no branch renders is
 * `anatomy/variant-missing` (the contract describes a shape that does not
 * exist). A matched pair is then compared with exactly the node/attribute
 * rules above, and every finding from it names the shape it came from, since
 * the same node name appears in each shape.
 *
 * The component DECLINES exactly as before whenever the match cannot be made
 * honestly: no `$variants` block at all, a decline that carried no branches
 * (the adapter omits them unless every branch resolved), a declared shape with
 * no root element to match on, two declared shapes claiming one element, or
 * two rendered branches sharing one root. `spec/contracts.mjs` rejects two
 * VARIANTS claiming one element at load time; the other cases are only visible
 * here, and each is the same ambiguity — nothing that can say which branch is
 * which, which is the one thing this surface never guesses.
 *
 * ---------------------------------------------------------------------------
 * THE DESIGN SIDE — `runDesignAnatomyCheck` (issue #402)
 * ---------------------------------------------------------------------------
 *
 * The contract is the source of truth for BOTH sides, so the same anatomy is
 * compared a second time against the design component's own layer tree — the
 * one the caller merged onto the design census (`entries[].layers`, normalized
 * into this engine's node vocabulary by the provider, never a design tool's
 * raw shape). Three of the rules above fire again with `side: "design"` —
 * `node-missing`, `node-unexpected`, `element-mismatch`. Same rule ids, second
 * side: `side` is a FIELD of a finding, not part of its id (ADR-001 D5), so a
 * consumer turning a rule off turns it off everywhere rather than having to
 * learn a parallel rule set.
 *
 * WHAT DIFFERS, and why:
 *
 *   - **Nodes are located by NAME, not by position.** A layer carries a name
 *     and a rendered code node carries none, so the code side's positional
 *     pairing (with all the silence an ambiguous child count forces on it) is
 *     not the best correlation available here — `designLayer` is in the
 *     schema precisely to name the layer when it differs from the node's own
 *     name, and this is its first reader. Exact name first, then one
 *     documented fold of case and separators (`iconLeft` ≙ `Icon Left`); two
 *     candidates at either tier is an ambiguity and asserts nothing.
 *   - **`element` is not compared; `type` is.** A layer has no DOM tag, and
 *     `type` is the one field both sides carry. A layer the provider could
 *     not classify carries no `type` at all and is never a mismatch.
 *   - **`content`/`attributes` are not compared at all.** Neither has a
 *     design-side counterpart in this census, and inventing one would report
 *     a comparison that never happened.
 *   - **An unlocated node suppresses `node-unexpected` for its whole sibling
 *     region.** A leftover layer may well BE that node under a name the
 *     contract does not record; reporting a rename as both a missing node and
 *     an unexpected layer states one fact twice and asserts a second one.
 *
 *   - **`root` is the census unit, not a layer** (issue #658). A census
 *     entry's own top node is always a whole component, so `root`'s
 *     declared `type` is never compared — the answer is fixed by
 *     construction and no contract could change it. Its declared CHILDREN
 *     are compared as usual, against that component's layers.
 *   - **A variant set is compared through one variant** (issue #658). When
 *     the census entry says `unit: "variant-set"`, the top node's children
 *     are its variants, each named for its variant combination, not the
 *     component's layers — so `root` is compared against ONE variant, and
 *     the walk descends from there. Which one is fixed: the first variant by
 *     name, in plain code-unit order, so it is the same on every run and no
 *     reordering in the design file moves it. Variants share their layer
 *     structure, which is what this surface compares; a variant whose
 *     layers differ from that one's is not reported here.
 *
 * WHAT IS THE SAME, deliberately: `presentIf` silences `node-missing`; a
 * `type: "instance"` node is never descended into (its subtree answers to its
 * own contract); `childrenResolved: false` means NOT KNOWN and silences that
 * node's whole children region. A census entry with no `layers` at all — the
 * normal state until a project runs the bindings gather — produces NOTHING,
 * on the same "absence of data is never drift" rule the design-side styles
 * check already follows.
 */

import {
  compareEntities,
  makeFinding,
  sortFindings,
} from "../core/findings.mjs"
import { isContentNode, isStructuralNode } from "../core/census.mjs"
import { createRegistry, resolveRuleConfig } from "../core/rules.mjs"
import { compareStrings } from "../core/text.mjs"
import { resolveConfig } from "../core/config.mjs"

// ---------------------------------------------------------------------------
// The rule registry for this module.
// ---------------------------------------------------------------------------

export const RULES = [
  {
    id: "anatomy/node-missing",
    surface: "anatomy",
    defaultSeverity: "error",
    description:
      "The contract declares an anatomy node the compared side does not have: code side, nothing is rendered at the position the contract declares; design side, the design component carries no layer of that name under the parent's own layer — for a variant set, inside the variant it is compared through, the first by name.",
  },
  {
    id: "anatomy/node-unexpected",
    surface: "anatomy",
    defaultSeverity: "warn",
    description:
      "The compared side has a child the contract does not declare at all for this node: a structural (element or component) child code side, a layer design side.",
  },
  {
    id: "anatomy/element-mismatch",
    surface: "anatomy",
    defaultSeverity: "error",
    description:
      "The contract declares what this node is and the compared side has something else: code side, the DOM element the contract declares against the one the code renders; design side, the node type the contract declares against the design layer's own type, for every node below `root` (whose node is the component itself, never a layer).",
  },
  {
    id: "anatomy/content-unbound",
    surface: "anatomy",
    defaultSeverity: "error",
    description:
      "The contract binds this node's content to a literal or a prop the code does not render there.",
  },
  {
    id: "anatomy/attribute-mismatch",
    surface: "anatomy",
    defaultSeverity: "error",
    description:
      "The contract declares a DOM attribute value for this node, and the code sets that attribute to a different literal.",
  },
  {
    id: "anatomy/attribute-missing",
    surface: "anatomy",
    defaultSeverity: "error",
    description:
      "The contract declares a DOM attribute for this node that the code does not set — and the adapter resolved the full attribute set, so nothing could be supplying it.",
  },
  {
    id: "anatomy/attribute-unresolved",
    surface: "anatomy",
    defaultSeverity: "review",
    description:
      "The contract declares a DOM attribute for this node, but its value in code is computed, or a spread makes the attribute set unknowable — neither confirmed nor contradicted.",
  },
  {
    id: "anatomy/variant-missing",
    surface: "anatomy",
    defaultSeverity: "error",
    description:
      "The contract declares an anatomy shape — the base tree, or one of its `$variants` — whose root element this component renders on no branch.",
  },
  {
    id: "anatomy/variant-unexpected",
    surface: "anatomy",
    defaultSeverity: "error",
    description:
      "The component renders a branch whose root element no declared anatomy shape claims: the contract does not describe that shape at all.",
  },
  {
    id: "anatomy/coverage-declined",
    surface: "anatomy",
    defaultSeverity: "review",
    description:
      "This component's rendered markup could not be resolved to a single, unambiguous structure — no anatomy finding was attempted for it.",
  },
  {
    id: "anatomy/coverage-partial",
    surface: "anatomy",
    defaultSeverity: "review",
    description:
      "This component renders more than one tree; only the structure invariant across every branch was compared, and the positions where the branches disagreed were not checked.",
  },
]

export const registry = createRegistry(RULES)

// ---------------------------------------------------------------------------
// Small, pure helpers.
// ---------------------------------------------------------------------------

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

// The structural/content split lives in `core/census.mjs` — `spec/scaffold
// .mjs` drafts against the same one, and a second copy here is exactly how
// the two sides came to disagree (#351).
//
// "unresolved" counts as STRUCTURAL because it occupies a real position in the
// rendered tree — the branches of a multi-return component disagreed about
// what sits there, not about whether anything does (issue #156). Excluding it
// would make a parent look childless, and the "nothing rendered here at all"
// path would then emit `node-missing` for every declared child: a false
// finding manufactured out of an explicit "not known". `compareNode` returns
// immediately on the kind, so counting it costs nothing and asserts nothing.
function structuralChildrenOf(codeNode) {
  return (codeNode.children || []).filter(isStructuralNode)
}

function contentChildrenOf(codeNode) {
  return (codeNode.children || []).filter(isContentNode)
}

function describeNode(codeNode) {
  if (codeNode.kind === "component") return `<${codeNode.name}/>`
  return `<${codeNode.tag}>`
}

function describeContent(content) {
  if (typeof content === "string") return JSON.stringify(content)
  if (isPlainObject(content) && typeof content.$prop === "string")
    return `{${content.$prop}}`
  return JSON.stringify(content)
}

// ---------------------------------------------------------------------------
// Content comparison — see the module docblock's "CONTENT comparison".
// ---------------------------------------------------------------------------

function contentMatches(content, contentChild) {
  if (typeof content === "string")
    return contentChild.kind === "text" && contentChild.value === content
  if (isPlainObject(content) && typeof content.$prop === "string")
    return (
      contentChild.kind === "expression" && contentChild.prop === content.$prop
    )
  return false // an unrecognized content shape — nothing to compare against
}

function checkContent(elementName, content, codeNode, ctx) {
  // An `unresolved` position could be holding this node's content — the
  // branches disagreed about what sits there, and the adapter declined to
  // guess between a structural child and a text/expression one. Comparing
  // content against the children that DID resolve would report the declared
  // binding as absent when it may be exactly what the unresolved position
  // renders. Same silence `childrenResolved: false` earns, for the same
  // reason (issue #156).
  if ((codeNode.children || []).some(child => child.kind === "unresolved"))
    return
  if (codeNode.childrenResolved === false) return

  const contentChildren = contentChildrenOf(codeNode)
  if (contentChildren.some(child => child.kind === "unknown")) return // ambiguous — stay silent

  const matched = contentChildren.some(child => contentMatches(content, child))
  if (matched) return

  ctx.emit("anatomy/content-unbound", {
    entity: `${ctx.id}.${elementName}`,
    message: `"${elementName}" in "${ctx.id}" binds content to ${describeContent(content)}, which the code does not render there`,
    data: { element: elementName, content },
  })
}

// ---------------------------------------------------------------------------
// The recursive node comparison — see the module docblock's "THE BAR".
// ---------------------------------------------------------------------------

// DOM attributes (issue #364). Only what the contract declares is checked —
// the code setting attributes the contract never named is not drift, so
// there is no "unexpected" direction here. Three outcomes per declared
// attribute, and `error` only when both sides are literal and disagree AND
// nothing else could be setting it: under a spread, a disagreeing literal
// is `review` (the spread may override it), while an agreeing one is silent
// (the best evidence available — reporting a match as doubtful on every
// spread element would be noise, not information).
function checkAttributes(elementName, declared, codeNode, ctx) {
  const actual = codeNode.attributes || {}
  for (const name of Object.keys(declared).sort()) {
    const expected = declared[name]
    const found = actual[name]
    const entity = `${ctx.id}.${elementName}`
    if (found === undefined) {
      if (codeNode.attributesResolved === false) {
        ctx.emit("anatomy/attribute-unresolved", {
          entity,
          message: `"${elementName}" in "${ctx.id}" declares attribute ${name}="${expected}", but the code spreads props onto this element, so whether it is set cannot be resolved`,
          data: { element: elementName, attribute: name, expected },
        })
      } else {
        ctx.emit("anatomy/attribute-missing", {
          entity,
          message: `"${elementName}" in "${ctx.id}" declares attribute ${name}="${expected}", which the code does not set`,
          data: { element: elementName, attribute: name, expected },
        })
      }
      continue
    }
    if (typeof found !== "string") {
      ctx.emit("anatomy/attribute-unresolved", {
        entity,
        message: `"${elementName}" in "${ctx.id}" declares attribute ${name}="${expected}", but the code computes its value, so it is neither confirmed nor contradicted`,
        data: { element: elementName, attribute: name, expected },
      })
      continue
    }
    if (found !== expected && codeNode.attributesResolved === false) {
      // A literal that disagrees is still not the last word when a spread
      // sits on the same element — it may set the attribute again, and the
      // adapter records no order. Not authoritative, so not an error.
      ctx.emit("anatomy/attribute-unresolved", {
        entity,
        message: `"${elementName}" in "${ctx.id}" declares attribute ${name}="${expected}"; the code sets ${name}="${found}" but also spreads props onto this element, so the final value cannot be resolved`,
        data: { element: elementName, attribute: name, expected, found },
      })
      continue
    }
    if (found !== expected) {
      ctx.emit("anatomy/attribute-mismatch", {
        entity,
        message: `"${elementName}" in "${ctx.id}" declares attribute ${name}="${expected}", but the code sets ${name}="${found}"`,
        data: { element: elementName, attribute: name, expected, found },
      })
    }
  }
}

function compareNode(anatomy, elementName, codeNode, ctx) {
  const declNode = anatomy[elementName]
  if (!declNode) return // a child name with no matching anatomy entry — malformed contract, stay defensive

  if (codeNode === undefined) {
    if (!declNode.presentIf) {
      ctx.emit("anatomy/node-missing", {
        entity: `${ctx.id}.${elementName}`,
        message: `"${ctx.id}" declares anatomy node "${elementName}", which the code does not render`,
        data: { element: elementName },
      })
    }
    return
  }

  // A position the adapter could not resolve — the component renders more
  // than one tree and the branches disagreed HERE (issue #156). Nothing is
  // known about this position, so nothing is asserted: no element check, no
  // content check, no descent. `runAnatomyCheck` reports the partiality once
  // for the component, so this silence is stated rather than invisible.
  if (codeNode.kind === "unresolved") return

  const isInstance = declNode.type === "instance"

  if (!isInstance) {
    if (declNode.element) {
      const actualTag =
        codeNode.kind === "element" ? codeNode.tag : describeNode(codeNode)
      if (actualTag !== declNode.element) {
        ctx.emit("anatomy/element-mismatch", {
          entity: `${ctx.id}.${elementName}`,
          message: `"${elementName}" in "${ctx.id}" is declared as "${declNode.element}", but the code renders ${describeNode(codeNode)}`,
          data: {
            element: elementName,
            expected: declNode.element,
            found: actualTag,
          },
        })
      }
    }

    if (declNode.content !== undefined) {
      checkContent(elementName, declNode.content, codeNode, ctx)
    }

    if (isPlainObject(declNode.attributes) && codeNode.kind === "element") {
      checkAttributes(elementName, declNode.attributes, codeNode, ctx)
    }
  }

  if (isInstance) return // never descend — a nested instance's structure is its OWN contract's business

  const declaredChildren = Array.isArray(declNode.children)
    ? declNode.children
    : []

  // The branches rendered different NUMBERS of children here, so the adapter
  // withheld the whole list rather than aligning lists that do not correspond
  // (issue #156). `children: []` on such a node means "not known", not "none"
  // — treating it as "none" would emit `node-missing` for every declared
  // child, which is the false-finding this whole path exists to prevent.
  if (codeNode.childrenResolved === false) return

  const structuralChildren = structuralChildrenOf(codeNode)

  if (declaredChildren.length === 0) {
    // Unambiguous: the contract addresses NO children here at all, so any
    // structural child code renders is unambiguously extra — EXCEPT an
    // `unresolved` position, which the adapter explicitly refused to name.
    // Calling that "an unexpected child" asserts at exactly the position the
    // whole partial-tree mechanism exists to stay silent about (and printed
    // `<undefined>`, since there is no tag to describe). `compareNode`'s
    // early return does not cover this path — it is never reached from here.
    for (const extra of structuralChildren) {
      if (extra.kind === "unresolved") continue
      ctx.emit("anatomy/node-unexpected", {
        entity: `${ctx.id}.${elementName}`,
        message: `"${elementName}" in "${ctx.id}" renders an unexpected child ${describeNode(extra)} the contract does not declare`,
        data: { parent: elementName, found: describeNode(extra) },
      })
    }
    return
  }

  if (structuralChildren.length === 0) {
    // Unambiguous the OTHER direction: nothing rendered here at all, so
    // every declared child is absent outright — no positional guess needed
    // since there is nothing to align against. Recursing with `undefined`
    // reuses the same presentIf-skip the direct-absence branch above already
    // applies.
    for (const childName of declaredChildren) {
      compareNode(anatomy, childName, undefined, ctx)
    }
    return
  }

  if (declaredChildren.length !== structuralChildren.length) return // ambiguous count — stay silent, see docblock

  for (let i = 0; i < declaredChildren.length; i++) {
    compareNode(anatomy, declaredChildren[i], structuralChildren[i], ctx)
  }
}

// ---------------------------------------------------------------------------
// Variant-keyed anatomy (ADR-002, issue #429) — see the module docblock's
// "COMPONENTS THAT RENDER MORE THAN ONE ROOT".
// ---------------------------------------------------------------------------

// `anatomy` is a map of node names plus one reserved sigil key (ADR-002 D2);
// a node name is `^[A-Za-z][A-Za-z0-9]*$`, so no sigil can collide with one.
// `^_` comment keys are already gone — `spec/contracts.mjs` strips them at
// load — so `$` is the only prefix left to skip.
const ANATOMY_VARIANTS_KEY = "$variants"

// `when` sits flat alongside a variant's node names and is FREE TEXT for a
// human reader, never a predicate (ADR-002 D4): this engine is static, so a
// runtime prop value is not something it can evaluate. Nothing below reads it.
const VARIANT_WHEN_KEY = "when"

function anatomyNodes(anatomy) {
  const nodes = {}
  for (const key of Object.keys(anatomy)) {
    if (key.startsWith("$")) continue
    nodes[key] = anatomy[key]
  }
  return nodes
}

function describeShape(shape) {
  return shape.name === null ? "the base anatomy" : `variant "${shape.name}"`
}

// The root element a rendered branch shows, derived EXACTLY as `compareNode`
// derives the tag it compares against `element`. Sharing the derivation is
// what makes a matched branch unable to then mismatch on its own root — two
// spellings of "what is this rooted at" would let a branch match one shape
// and be reported as a different element in the same breath.
function rootElementOf(codeNode) {
  if (!isPlainObject(codeNode)) return undefined
  return codeNode.kind === "element" ? codeNode.tag : describeNode(codeNode)
}

// Every shape a contract describes: the base anatomy first, then each
// `$variants` entry as a PARTIAL OVERRIDE of it (ADR-002 D3) — every node the
// variant does not name is inherited whole, and a node it DOES name overrides
// the base's FIELD BY FIELD rather than wholesale.
//
// Field-level is what D3's own example means by "three lines rather than a
// duplicated tree": `button`'s `asLink` names `root` only to change its
// `element`, while the base `root` is what declares `children`. Replacing the
// whole node would silently drop that list and report every child of the
// variant's tree as unexpected — the contract author writing exactly the three
// lines the ADR shows would get a page of false findings for it.
//
// Sorted by variant name so the shape list, and every finding derived from it,
// is the same on every run.
function declaredShapes(anatomy) {
  const base = anatomyNodes(anatomy)
  const declared = anatomy[ANATOMY_VARIANTS_KEY]
  const variants = isPlainObject(declared) ? declared : {}

  const shapes = [{ name: null, nodes: base }]
  for (const name of Object.keys(variants).sort(compareEntities)) {
    const variant = variants[name]
    if (!isPlainObject(variant)) continue
    const nodes = { ...base }
    for (const key of Object.keys(variant)) {
      if (key === VARIANT_WHEN_KEY || key.startsWith("$")) continue
      const override = variant[key]
      nodes[key] =
        isPlainObject(nodes[key]) && isPlainObject(override)
          ? { ...nodes[key], ...override }
          : override
    }
    shapes.push({ name, nodes })
  }

  for (const shape of shapes) {
    const root = shape.nodes.root
    shape.element = isPlainObject(root) ? root.element : undefined
  }
  return shapes
}

// Why this component cannot be matched at all, or `null` when it can. A
// variant is told apart from the base and from its siblings by ROOT ELEMENT
// and by nothing else (D4), so two claimants for one element, or a shape with
// no element to claim, leaves nothing that can say which rendered branch is
// which. `spec/contracts.mjs` already rejects two declared shapes claiming
// one element at load time — two variants, or a variant and the base (#442);
// what it never sees is what the code actually renders. Both are the same
// ambiguity, and an ambiguity asserts nothing — the component declines
// exactly as it did before variants existed, rather than one side silently
// winning.
function matchingProblem(shapes, branches) {
  const claimed = new Set()
  for (const shape of shapes) {
    if (typeof shape.element !== "string" || shape.element === "")
      return `${describeShape(shape)} declares no root element`
    if (claimed.has(shape.element))
      return `more than one declared shape claims the root element "${shape.element}"`
    claimed.add(shape.element)
  }

  const rendered = new Set()
  for (const branch of branches) {
    const element = rootElementOf(branch)
    if (element === undefined) return "a rendered branch has no nameable root"
    if (rendered.has(element))
      return `the component renders the root element "${element}" more than once, so no declared shape can be told apart from the other`
    rendered.add(element)
  }
  return null
}

// A matched shape's findings say which shape they came from: a variant-keyed
// component reports from more than one tree, and the same node name appears in
// each, so an unlabelled `"label" in "widget"` twice over reads as one node
// reported twice rather than as two trees disagreeing in the same place.
function shapeContext(ctx, shape) {
  const label = describeShape(shape)
  return {
    id: ctx.id,
    emit(ruleId, finding) {
      const data = { ...(finding.data || {}) }
      if (shape.name !== null) data.variant = shape.name
      ctx.emit(ruleId, {
        ...finding,
        message: `${finding.message} (${label})`,
        data,
      })
    },
  }
}

// Match every rendered branch to the shape claiming its root element, compare
// the pairs, and report BOTH unmatched sides (ADR-002 D4): a branch no shape
// claims is a shape the contract does not describe, and a shape no branch
// renders is a shape the component does not have. Neither is guessed past —
// they are the whole reason structural matching is honest.
function compareShapes(shapes, branches, ctx) {
  const byElement = new Map(shapes.map(shape => [shape.element, shape]))
  const matched = new Set()

  for (const branch of branches) {
    const element = rootElementOf(branch)
    const shape = byElement.get(element)
    if (!shape) {
      ctx.emit("anatomy/variant-unexpected", {
        entity: ctx.id,
        message: `"${ctx.id}" renders a branch rooted at ${describeNode(branch)}, which no declared anatomy shape claims — the contract does not describe it`,
        data: { found: element },
      })
      continue
    }
    matched.add(shape)
    compareNode(shape.nodes, "root", branch, shapeContext(ctx, shape))
  }

  for (const shape of shapes) {
    if (matched.has(shape)) continue
    ctx.emit("anatomy/variant-missing", {
      entity: ctx.id,
      message: `"${ctx.id}" declares ${describeShape(shape)} with root element "${shape.element}", which the component renders on no branch`,
      data: {
        expected: shape.element,
        ...(shape.name === null ? {} : { variant: shape.name }),
      },
    })
  }
}

// ---------------------------------------------------------------------------
// The checkers.
// ---------------------------------------------------------------------------

// One `emit` for both sides — `side` is a FIELD of a finding, never part of a
// rule id (ADR-001 D5), so the two checkers below differ in what they compare
// and in nothing else about how a finding is raised.
function createEmitter(findings, rulesConfig, side) {
  return function emit(ruleId, { entity, message, data }) {
    const { severity } = resolveRuleConfig(ruleId, rulesConfig, registry)
    if (severity === "off") return
    findings.push(
      makeFinding({
        ruleId,
        severity,
        surface: registry.get(ruleId).surface,
        side,
        entity,
        message,
        ...(data ? { data } : {}),
      }),
    )
  }
}

/**
 * Compare every loaded contract's `anatomy` against its own structural census and
 * emit D5 findings. Pure — never reads fs/network, never mutates its
 * arguments.
 *
 * @param {Array<{id: string, file: string, contract: object}>} contracts
 *   `spec/contracts.mjs`'s `loadContracts(...).contracts`
 * @param {{components: Array<{file: string, resolvable: boolean, root?: object, reason?: string, partial?: boolean, unresolvedAt?: string[]}>}} treeCensus
 *   the framework adapter's tree-census result (only `.components`
 *   is read; `.ok`/`.diagnostics`/`.skipped` are the caller's concern — a
 *   caller should skip calling this entirely when `treeCensus.skipped` is
 *   true, the same "surface skips with a reason" convention every other
 *   domain module here follows)
 * @param {object} [config] the project's (unresolved) config
 * @returns {object[]} findings, in `core/findings.mjs`'s deterministic order
 */
export function runAnatomyCheck(contracts, treeCensus, config = {}) {
  const { rules: rulesConfig } = resolveConfig(config)
  const findings = []
  const emit = createEmitter(findings, rulesConfig, "code")

  const componentsByFile = new Map(
    (treeCensus?.components || []).map(component => [
      component.file,
      component,
    ]),
  )

  const sortedContracts = [...(contracts || [])].sort((a, b) =>
    compareEntities(a.id, b.id),
  )

  for (const { id, contract } of sortedContracts) {
    const codePath = contract?.sources?.code?.path
    if (!codePath) continue // aspirational contract, nothing to compare — same as components.mjs

    const censusEntry = componentsByFile.get(codePath)
    if (!censusEntry) continue // no tree census for this path — components.mjs's coverage rules already say so

    const anatomy = isPlainObject(contract.anatomy) ? contract.anatomy : {}
    if (!isPlainObject(anatomy.root)) continue // nothing to anchor a walk on

    if (!censusEntry.resolvable) {
      const decline = note =>
        emit("anatomy/coverage-declined", {
          entity: id,
          message: `"${id}"'s rendered markup at "${codePath}" could not be resolved to a single, unambiguous structure (${censusEntry.reason})${note} — no anatomy finding was attempted`,
          data: { reason: censusEntry.reason },
        })

      // The variant path needs BOTH halves: the trees the component renders,
      // and more than one declared shape to match them to. Without either —
      // no `$variants` block, or a decline that carried no branches because
      // one of them did not resolve on its own — there is nothing to match
      // and the decline stands exactly as it always has (ADR-002 D5).
      const branches = Array.isArray(censusEntry.branches)
        ? censusEntry.branches
        : []
      const shapes = declaredShapes(anatomy)
      if (branches.length === 0 || shapes.length < 2) {
        decline("")
        continue
      }

      const problem = matchingProblem(shapes, branches)
      if (problem) {
        decline(`: ${problem}`)
        continue
      }

      compareShapes(shapes, branches, { emit, id })
      continue
    }

    // Stated, never silent: a partial comparison that reads as a complete one
    // is the false-finding class this surface exists to avoid, so the
    // positions that went uncompared are named BEFORE any finding derived
    // from the parts that did compare (issue #156).
    if (censusEntry.partial) {
      const positions = censusEntry.unresolvedAt || []
      emit("anatomy/coverage-partial", {
        entity: id,
        message: `"${id}"'s rendered markup at "${codePath}" resolves to more than one tree; only the structure common to every branch was compared${
          positions.length > 0 ? ` — not checked: ${positions.join(", ")}` : ""
        }`,
        data: { unresolvedAt: positions },
      })
    }

    compareNode(anatomy, "root", censusEntry.root, { emit, id })
  }

  return sortFindings(findings)
}

// ---------------------------------------------------------------------------
// The DESIGN side (issue #402) — see the module docblock's "THE DESIGN SIDE".
// ---------------------------------------------------------------------------

// The layer name a node is looked for under: `designLayer` when the contract
// declares one, else the node's own name.
function layerNameFor(declNode, elementName) {
  return typeof declNode.designLayer === "string" && declNode.designLayer !== ""
    ? declNode.designLayer
    : elementName
}

// The one documented normalization, and the reason it is safe: an anatomy node
// name cannot contain a space, a hyphen or an underscore (the contract
// schema's own `^[A-Za-z][A-Za-z0-9]*$`), while a hand-typed layer name
// routinely does — `iconLeft` and `Icon Left` are the same node under two
// spellings, and refusing to see that would report a `node-missing` for every
// multi-word node in every component. Nothing else is widened: this folds
// case and separators, never a prefix, a suffix or a substring.
function foldLayerName(name) {
  return String(name)
    .replace(/[-_\s]/g, "")
    .toLowerCase()
}

// Which of `siblings` this node is, or why nothing can be said. Exact name
// first, then the folded form — so a component carrying BOTH spellings is
// never ambiguous, the exact one wins. Two candidates at the same tier is an
// ambiguity, and an ambiguity asserts nothing: the same posture
// `modules/styles.mjs` takes when a selector could be one of two rules.
function locateLayer(siblings, wanted, claimed) {
  const available = siblings.filter(layer => !claimed.has(layer))
  const exact = available.filter(layer => layer.name === wanted)
  if (exact.length === 1) return { layer: exact[0] }
  if (exact.length > 1) return { ambiguous: true }
  const folded = foldLayerName(wanted)
  const near = available.filter(layer => foldLayerName(layer.name) === folded)
  if (near.length === 1) return { layer: near[0] }
  if (near.length > 1) return { ambiguous: true }
  return {}
}

function compareDesignNode(anatomy, elementName, layerNode, ctx) {
  const declNode = anatomy[elementName]
  if (!declNode) return // a child name with no matching anatomy entry — malformed contract, stay defensive

  // The design side's answer to the code side's `element` check: `type` is
  // the one field both a contract node and a normalized layer carry, and it
  // is the field the code side explicitly CANNOT verify (see the docblock's
  // OUT OF SCOPE). A layer the provider could not classify carries no `type`
  // at all — unclassified is not a disagreement, so it stays silent. `root`
  // is never compared: its node is the census unit itself, not a layer, and
  // a census unit's type is fixed by construction (issue #658).
  if (
    elementName !== "root" &&
    declNode.type &&
    layerNode.type &&
    declNode.type !== layerNode.type
  ) {
    ctx.emit("anatomy/element-mismatch", {
      entity: `${ctx.id}.${elementName}`,
      message: `"${elementName}" in "${ctx.id}" is declared as type "${declNode.type}", but the design component's layer is a "${layerNode.type}"`,
      data: {
        element: elementName,
        expected: declNode.type,
        found: layerNode.type,
      },
    })
  }

  if (declNode.type === "instance") return // never descend — a nested instance is its OWN contract's business, exactly as code side
  if (layerNode.childrenResolved === false) return // NOT KNOWN, never "carries no layers"

  const layerChildren = Array.isArray(layerNode.children)
    ? layerNode.children
    : []
  const declaredChildren = Array.isArray(declNode.children)
    ? declNode.children
    : []

  const claimed = new Set()
  const matched = []
  let allLocated = true

  for (const childName of declaredChildren) {
    const childDecl = anatomy[childName]
    if (!childDecl) continue
    const wanted = layerNameFor(childDecl, childName)
    const found = locateLayer(layerChildren, wanted, claimed)
    if (found.ambiguous) {
      allLocated = false
      continue
    }
    if (!found.layer) {
      allLocated = false
      if (!childDecl.presentIf) {
        ctx.emit("anatomy/node-missing", {
          entity: `${ctx.id}.${childName}`,
          message: `"${ctx.id}" declares anatomy node "${childName}", and the design component has no layer named "${wanted}" under "${elementName}"`,
          data: { element: childName, layer: wanted },
        })
      }
      continue
    }
    claimed.add(found.layer)
    matched.push([childName, found.layer])
  }

  for (const [childName, childLayer] of matched)
    compareDesignNode(anatomy, childName, childLayer, ctx)

  // A declared node this walk could NOT place is the one case where an
  // unclaimed layer says nothing: it may well BE that node under a name the
  // contract does not record, and reporting the same rename as both a missing
  // node and an unexpected layer states one fact twice while asserting a
  // second one nothing here established.
  if (!allLocated) return

  for (const child of layerChildren) {
    if (claimed.has(child)) continue
    ctx.emit("anatomy/node-unexpected", {
      entity: `${ctx.id}.${elementName}`,
      message: `"${elementName}" in "${ctx.id}" has a layer "${child.name}" the contract does not declare`,
      data: { parent: elementName, found: child.name },
    })
  }
}

// The node a contract's `root` is compared against (issue #658). A
// `variant-set` entry's top node is the set, whose children are its variants,
// each a whole component — so `root` is compared against ONE variant, the
// first by name, which no reordering in the design file can move. A set
// whose variants were not resolved is passed through unchanged, so its
// `childrenResolved: false` still silences the walk; a set with no variant
// at all yields nothing to compare.
function unitRootOf(entry) {
  const unit = entry.layers
  if (entry.unit !== "variant-set" || unit.childrenResolved === false)
    return unit
  const variants = (Array.isArray(unit.children) ? unit.children : []).filter(
    isPlainObject,
  )
  if (variants.length === 0) return null
  return [...variants].sort((a, b) =>
    compareStrings(String(a.name), String(b.name)),
  )[0]
}

/**
 * Compare every loaded contract's `anatomy` against the DESIGN component's
 * layer tree and emit the same three structural findings with `side:
 * "design"`. Pure, exactly like `runAnatomyCheck` — the caller resolves every
 * address (a provider's job, D12) and hands this two already-loaded values.
 *
 * @param {Array<{id: string, contract: object, designMatchKey?: string|null}>} contracts
 *   `spec/contracts.mjs`'s `loadContracts(...).contracts`, each with the
 *   opaque design match key the CALLER resolved through the active provider
 * @param {{entries: Array<{matchKey: string, unit?: string, layers?: object}>}} designCensus
 *   the design-side component census; an entry with no `layers` was gathered
 *   before the layer census existed, or not gathered at all, and `unit:
 *   "variant-set"` says its `layers` children are variants, not layers
 * @param {object} [config] the project's (unresolved) config
 * @returns {object[]} findings, in `core/findings.mjs`'s deterministic order
 */
export function runDesignAnatomyCheck(contracts, designCensus, config = {}) {
  const { rules: rulesConfig } = resolveConfig(config)
  const findings = []
  const emit = createEmitter(findings, rulesConfig, "design")

  const entriesByKey = new Map(
    (designCensus?.entries || []).map(entry => [entry.matchKey, entry]),
  )

  const sortedContracts = [...(contracts || [])].sort((a, b) =>
    compareEntities(a.id, b.id),
  )

  for (const { id, contract, designMatchKey } of sortedContracts) {
    if (!designMatchKey) continue // no design address — `coverage/*` already says so
    const entry = entriesByKey.get(designMatchKey)
    // No census entry (again `coverage/*`'s business), or an entry whose
    // layer tree was never gathered: absent data is never reported as drift.
    if (!entry || !isPlainObject(entry.layers)) continue

    const anatomy = isPlainObject(contract?.anatomy) ? contract.anatomy : {}
    if (!isPlainObject(anatomy.root)) continue // nothing to anchor a walk on

    const rootNode = unitRootOf(entry)
    if (!rootNode) continue // a variant set with no variant to compare against

    compareDesignNode(anatomy, "root", rootNode, { emit, id })
  }

  return sortFindings(findings)
}
