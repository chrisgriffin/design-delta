/**
 * styles.mjs — style parity (ADR-001 D5, Phase 2b, issue #103): the SECOND
 * checker of Phase 2, comparing a contract's declared `styles` (token
 * bindings per anatomy element) against what the component's own stylesheet
 * actually declares.
 *
 * PURE: `runStylesCheck(contracts, styleCensus, config) => findings[]`. Never
 * touches fs/network — `sources/styles.mjs`'s `censusStyles` builds the
 * stylesheet census; this module only ever compares that already-loaded
 * value against the already-loaded contracts, the same layering contract
 * `modules/tokens.mjs` and `modules/components.mjs` both document.
 *
 * ---------------------------------------------------------------------------
 * THE HARD PART — mapping a contract element to a stylesheet selector
 * ---------------------------------------------------------------------------
 *
 * A contract names anatomy elements (`root`, `label`, …); a stylesheet names
 * CSS selectors. Nothing guarantees a relationship between the two strings —
 * a project's classes may be camelCase, kebab-case, BEM, or CSS-module-hashed
 * beyond anything a generic engine can predict. The mapping rule, in order,
 * and its explicit limits:
 *
 *   1. `anatomy.<element>.codeClass`, when present, is authoritative for
 *      the NAME: the class looked for is exactly `.<codeClass>`, never a
 *      partial or fuzzy match. It is looked for in the same three places
 *      rule 3 tries (its own top-level selector; directly under the root;
 *      the unique last segment of a descendant selector) — since #378 the
 *      census records `.button { .icon {} }` as `.button .icon`, so a
 *      `codeClass: "icon"` that used to hit the bare key must be allowed
 *      to find it there. What is never widened is the name itself.
 *   2. Absent a `codeClass`, for the element named `root` specifically:
 *      a. try the literal `.root` (some projects do name classes after
 *         anatomy elements directly);
 *      b. otherwise, if the stylesheet censused EXACTLY ONE top-level
 *         (non-nested) selector, `root` maps to it — the one safe inference
 *         a single-rule stylesheet supports: a component conventionally has
 *         one base rule for its own root element, with everything else
 *         nested underneath as children or modifiers, so there is no OTHER
 *         plausible reading of "the root's own selector" once uniqueness is
 *         established. More than one top-level selector removes that
 *         uniqueness, so `root` is UNMAPPED instead of guessing which one.
 *   3. Absent a `codeClass`, for any OTHER element: the literal
 *      `.<element>` and its kebab-case form (`iconLeft` → `.icon-left`) — the
 *      "documented normalization" this check applies, since anatomy element
 *      names cannot themselves contain a hyphen (the contract schema's own
 *      pattern) while CSS classes commonly do — tried in three tiers, each
 *      unique-or-null (issue #378): as a top-level selector of its own;
 *      then directly under the root's resolved selector (`.button .icon`,
 *      the census records descendant nesting as the descendant it is);
 *      then as the last segment of ANY descendant selector, unique across
 *      the file, never under a pseudo-class ancestor (`.card:hover .image`
 *      is a state's override, not the element's home). `.sm .label` and
 *      `.lg .label` with no base `.label` is therefore UNMAPPED — there is
 *      no "the" label rule to compare a base against.
 *
 * UNMAPPED IS NOT A FINDING FOR THE ELEMENT'S BINDINGS. It is a single
 * `styles/element-unmapped` coverage note (review severity) — never a
 * `styles/binding-missing` sweep. Reporting bindings-missing for an element
 * this module could not confidently locate would fire on every element of
 * every component with an unconventional class name, which is the exact
 * false-finding class `modules/tokens.mjs`'s docblock was corrected for and
 * this module is built to avoid from the start. An anatomy node of type
 * `"instance"` (a nested component instance, conformed against its OWN
 * contract) is skipped entirely — not mapped, not reported unmapped.
 *
 * VARIANT SELECTORS are even less constrained: `styleVariant` carries no
 * `codeClass`-equivalent at all. This module trusts a SHORT LIST of
 * conventions, each measured against a real design system before it was
 * added (see `variantCandidateTiers` for the list and the order): a nested
 * modifier class named for the prop+value or the value alone, a nested
 * `data-` attribute, a class named for a boolean prop, a top-level class
 * co-applied to the ROOT (the CSS-modules shape), for a prop the
 * contract marks `code: "none"` — a design-only interaction state — the
 * pseudo-class that state is realized as (`:hover`), and for a CHILD
 * element, as the fallback when its own modifier forms find nothing, the
 * child nested under the ROOT's resolved modifier (`.sm .label`, issue
 * #378). A multi-key `when`
 * resolves one key at a time, nesting each step under the last. At every
 * step the match must be UNIQUE; ambiguity resolves to nothing, never to a
 * guess. When a variant cannot be located, this module reports ONE
 * `styles/variant-unmapped` coverage note (review) and checks none of its
 * bindings — the same posture as an unmapped element. It used to stay
 * silent instead, which on a real project hid 28 of 78 declared variants
 * (36%) behind a clean-looking result (issue #363).
 *
 * ---------------------------------------------------------------------------
 * BOX GRAMMARS — `padding`/`margin`/`inset`/`borderWidth` (edge), `borderRadius`
 * (corner), `gap` (axis)
 * ---------------------------------------------------------------------------
 *
 * The contract schema documents one precedence for each grammar: individual
 * edge/corner/axis > axis (edge only) > `all`. This module applies that SAME
 * precedence to BOTH sides before comparing, resolving each side down to its
 * finest slots (four full logical edges for edge grammars, four corners, or
 * row/column for gap) — never comparing the raw authored keys 1:1. This is
 * what lets a contract's `padding: {all: {token: t}}` match a stylesheet that
 * expresses the same intent as `padding-block` + `padding-inline` (both
 * bound to `t`) rather than only the literal `padding` shorthand — the two
 * are equivalent under the schema's own resolution rule, and a 1:1 check
 * would otherwise report a false `binding-missing` for "padding" the moment a
 * codebase prefers explicit logical longhands over the shorthand.
 *
 * A property whose contract key is entirely ABSENT (no slot set at all) is
 * only ever checked in the `binding-unexpected` direction (does the
 * stylesheet bind a token for it anyway?) — a PARTIALLY-declared box property
 * (some slots set, not others) is compared only on the slots the contract
 * actually resolves a value for; the undeclared remainder is not swept for
 * `binding-unexpected` (a deliberate, narrower scope — see `PROPERTY_DEFS`'
 * `compareProperty`, which only checks the unexpected direction when NO slot
 * of the property is declared at all, to avoid noise around ordinary partial
 * box authoring).
 *
 * `border.style` (a plain string, never a token/raw `value`) is out of scope
 * entirely — there is nothing for this checker to compare it against.
 *
 * A contract `raw(...)` value is the sanctioned escape hatch (schema's own
 * words) and stays SILENT for that slot: no missing/mismatch/raw-value
 * finding, on either side, ever. It still counts as "the contract addresses
 * this property" for the `binding-unexpected` gate.
 *
 * A token whose `tokens.mjs`-style candidate var name resolves to `null`
 * (the same unmappable-token case `modules/tokens.mjs` stays silent for) is
 * skipped here too, for the same reason: this module cannot state what var
 * name it would even expect, so it says nothing rather than guess.
 */

import { candidateTokenIds } from "./tokens.mjs"
import {
  compareEntities,
  makeFinding,
  sortFindings,
} from "../core/findings.mjs"
import { createRegistry, resolveRuleConfig } from "../core/rules.mjs"
import { resolveConfig } from "../core/config.mjs"
import { candidateVarName } from "./tokens.mjs"
import { kebabCase } from "../core/text.mjs"

// ---------------------------------------------------------------------------
// The rule registry for this module.
// ---------------------------------------------------------------------------

export const RULES = [
  {
    id: "styles/binding-missing",
    surface: "styles",
    defaultSeverity: "error",
    description:
      "The contract declares a token binding for this element/property that the stylesheet does not have.",
  },
  {
    id: "styles/binding-unexpected",
    surface: "styles",
    defaultSeverity: "warn",
    description:
      "The stylesheet binds a token for a property the contract does not declare at all for this element.",
  },
  {
    id: "styles/token-mismatch",
    surface: "styles",
    defaultSeverity: "error",
    description:
      "Both sides bind a token for this element/property, but to different tokens.",
  },
  {
    id: "styles/raw-value",
    surface: "styles",
    defaultSeverity: "warn",
    description:
      "The contract declares a token binding for this element/property, but the stylesheet hardcodes a literal value instead.",
  },
  {
    id: "styles/element-unmapped",
    surface: "styles",
    defaultSeverity: "review",
    description:
      "This anatomy element could not be confidently mapped to a stylesheet selector — a coverage note, never a style finding for its bindings.",
  },
  {
    id: "styles/variant-unmapped",
    surface: "styles",
    defaultSeverity: "review",
    description:
      "A declared style variant could not be confidently mapped to a stylesheet selector, so none of its bindings were checked — a coverage note, never a style finding.",
  },
  {
    id: "styles/design-binding-missing",
    surface: "styles",
    defaultSeverity: "review",
    description:
      "The contract declares a token binding, and no variable the design component binds anywhere in its tree maps to that token — component-level coverage: it says the design side never binds the token, not which element should. Element-level precision follows the design-side anatomy mapping. Requires a bindings gather (`gather --bindings` + `ingest --bindings`); a snapshot without `usedVars` is skipped silently, never reported. Three declared bindings are never reported, each stated on the run's `skipped` channel with its reason: one whose style property the active provider declares it cannot express as a node-level variable (see that provider's own `unbindableProperties`), one whose token resolves to zero (an unset value binds no variable), and one a `design.options.tokenMap` redirect sends to a different token than the contract names (out of reach by construction, whatever the design file does).",
  },
]

export const registry = createRegistry(RULES)

// ---------------------------------------------------------------------------
// Small, pure helpers.
// ---------------------------------------------------------------------------

function capitalize(value) {
  return value.charAt(0).toUpperCase() + value.slice(1)
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

// Does this census token resolve to zero? (issue #492) `0`, `0px`, `0rem`
// and `0%` are all the same nothing; anything non-numeric is not zero, and a
// token with no single flattened value is not judged at all.
const ZERO_VALUE = /^-?0(\.0+)?([a-z%]+)?$/i
function isZeroValue(token) {
  if (typeof token?.cssValue === "string")
    return ZERO_VALUE.test(token.cssValue.trim())
  return typeof token?.value === "number" && token.value === 0
}

// ---------------------------------------------------------------------------
// Building an in-memory index from one censused style file — the shape
// `sources/styles.mjs` returns is plain/JSON-stable; this module builds
// whatever lookup structures IT needs from that, the same division of labor
// `modules/tokens.mjs` draws between `cssVarCensus.vars` and its own
// `varsByName`/`tokenIdsByCandidate` maps.
// ---------------------------------------------------------------------------

// Exported for `cli/commands/scaffold.mjs` (issue #236): scaffold drafts
// `styles` in the OPPOSITE direction of this checker (from the stylesheet
// TO a contract, rather than comparing an authored one against it), but
// needs the exact same file index to find each element's selector —
// `spec/` may not import `modules/` (`__tests__/layering.test.js`), so the
// CLI layer (which may import both) wires this module's own lookup into
// `spec/scaffold.mjs`'s pure builder rather than a second, parallel index.
export function buildFileIndex(fileCensus) {
  const bySelector = new Map()
  const byParent = new Map()
  for (const entry of fileCensus.selectors) {
    const declarations = new Map(entry.declarations.map(d => [d.property, d]))
    bySelector.set(entry.selector, { ...entry, declarations })
    if (entry.parent !== null) {
      if (!byParent.has(entry.parent)) byParent.set(entry.parent, [])
      byParent.get(entry.parent).push(entry.selector)
    }
  }
  const topLevelSelectors = fileCensus.selectors
    .filter(entry => entry.parent === null)
    .map(entry => entry.selector)
  return { bySelector, byParent, topLevelSelectors }
}

// ---------------------------------------------------------------------------
// Element -> selector mapping — see the module docblock.
// ---------------------------------------------------------------------------

/**
 * @param {object} node the anatomy node (may be undefined)
 * @param {string} elementName
 * @param {{bySelector: Map, topLevelSelectors: string[]}} fileIndex
 * @returns {string|null} the resolved selector, or `null` when unmapped
 */
export function locateElementSelector(
  node,
  elementName,
  fileIndex,
  { rootSelector = null } = {},
) {
  // The class forms to look for: `codeClass` when declared, else the
  // element's own name and its kebab-case.
  const classes = node?.codeClass
    ? [`.${node.codeClass}`]
    : [...new Set([`.${elementName}`, `.${kebabCase(elementName)}`])]

  if (!node?.codeClass && elementName === "root") {
    if (fileIndex.bySelector.has(".root")) return ".root"
    if (fileIndex.topLevelSelectors.length === 1)
      return fileIndex.topLevelSelectors[0]
    return null
  }

  // Tier 1: the class as a selector of its own (`.icon {}` at the top
  // level). Tier 2: directly under the ROOT's own selector (`.button {
  // .icon {} }` → `.button .icon`, issue #378). Tier 3, for a stylesheet
  // whose root this contract cannot claim: the class as the LAST segment
  // of any descendant selector, unique across the file — so `.sm .label`
  // and `.lg .label` with no base `.label` is an ambiguity (unmapped),
  // never a guess at which variant is "the" element. An ancestor carrying
  // a pseudo-class (`.card:hover .image`) is a STATE's override of the
  // element, not its home, and is never a candidate here.
  const direct = classes.filter(cls => fileIndex.bySelector.has(cls))
  if (direct.length === 1) return direct[0]
  if (direct.length > 1) return null

  if (rootSelector) {
    const underRoot = classes
      .map(cls => `${rootSelector} ${cls}`)
      .filter(candidate => fileIndex.bySelector.has(candidate))
    if (underRoot.length === 1) return underRoot[0]
    if (underRoot.length > 1) return null
  }

  const nested = [...fileIndex.bySelector.keys()].filter(selector => {
    if (!classes.some(cls => selector.endsWith(` ${cls}`))) return false
    const ancestor = selector.slice(0, selector.lastIndexOf(" "))
    return !ancestor.includes(":")
  })
  return nested.length === 1 ? nested[0] : null
}

// The child's own class, as it would appear under another ancestor: the
// last segment of a descendant selector, or the selector itself.
function ownClass(elementSelector) {
  const segments = elementSelector.split(" ")
  return segments[segments.length - 1]
}

// A design-only interaction state (a prop marked `code: "none"`) is realized
// in code as a pseudo-class, never a class. The contract's state VALUE is the
// design vocabulary; these are the pseudo-class spellings each one may map
// to. A value with two spellings (`focus`) resolves only if exactly one is
// present — the same unique-or-null rule as every other candidate set here.
const STATE_PSEUDO_CLASSES = {
  hover: ["hover"],
  active: ["active"],
  pressed: ["active"],
  focus: ["focus", "focus-visible"],
  focused: ["focus", "focus-visible"],
  "focus-visible": ["focus-visible"],
  disabled: ["disabled"],
  checked: ["checked"],
}

/**
 * Candidate selectors for ONE `when` key/value under `parentSelector`, in
 * precedence tiers — each tier is tried alone, so a match in an earlier tier
 * is never made ambiguous by a later one.
 *
 * @param {string} parentSelector
 * @param {string} propName
 * @param {string|number|boolean} value
 * @param {object|undefined} prop the contract's own prop declaration
 * @returns {Set<string>[]}
 */
function variantCandidateTiers(parentSelector, propName, value, prop) {
  // A design-only axis (issue #363): `state: "hover"` is `:hover`, not
  // `.hover`. Only a `code: "none"` prop takes this route — a real boolean
  // `disabled` prop stays a class candidate, and if a stylesheet has both
  // `.root.disabled` and `.root:disabled` the class tier below is what a
  // prop-driven variant means.
  if (prop?.code === "none") {
    const pseudo = STATE_PSEUDO_CLASSES[kebabCase(String(value))] || []
    return [new Set(pseudo.map(name => `${parentSelector}:${name}`))]
  }

  const text = String(value)
  // PROP-PREFIXED FIRST (issue #184). A value-named class is ambiguous the
  // moment two enum props on one component share a value: `paragraph` has
  // `mb: "lead"` and `size: "lead"`, whose real classes are `.mbLead` and
  // `.lead`. Resolving the bare form for both checked the margin variant
  // against the font variant's CSS — producing a false `binding-missing` AND
  // an unexplained `binding-unexpected` on the same selector, a matched pair
  // of falsehoods that no contract change could fix.
  //
  // A SEPARATE tier rather than one merged set, because a component that has
  // both `.mbLead` and `.lead` would otherwise match twice and resolve to
  // nothing at all — trading a wrong answer for no answer.
  // STATE-PREFIXED forms ride along in every tier: `is`/`has` + the same
  // name, capitalized (`.hasElevation1`, `.isTight`, `.hasMediaBleed`) —
  // measured at 19 nested modifier classes across one real design system
  // after #363 landed, the single largest reason a variant still went
  // unmapped. Same tier as the unprefixed form, so `.lg` and `.isLg` on one
  // element is an ambiguity (unmapped), never a coin flip.
  // A kebab value (`extra-large`) joins as `.isExtraLarge`, never
  // `.isExtra-large` — the prefix forces camelCase on whatever follows.
  const pascal = name =>
    name
      .split("-")
      .map(part => capitalize(part))
      .join("")
  const stateForms = name => [
    `${parentSelector}.is${pascal(name)}`,
    `${parentSelector}.has${pascal(name)}`,
  ]
  const tiers = [
    new Set([
      `${parentSelector}.${propName}${capitalize(text)}`,
      `${parentSelector}.${kebabCase(propName)}-${kebabCase(text)}`,
      ...stateForms(`${propName}${capitalize(text)}`),
    ]),
  ]

  // A boolean variant is a class named after the PROP, not its value
  // (issue #363): `mb: true` is `.root.mb`, never `.root.true`.
  if (value === true) {
    tiers.push(
      new Set([
        `${parentSelector}.${propName}`,
        `${parentSelector}.${kebabCase(propName)}`,
        ...stateForms(propName),
      ]),
    )
    return tiers
  }

  // Two conventions, both real.
  //
  // A MODIFIER CLASS named after the variant's VALUE (`.cgButton.lg` from a
  // nested `&.lg`) is what actual component stylesheets use — measured across
  // a real design system: 86 nested modifier classes, and ZERO data-attribute
  // selectors. Supporting only the data-attribute form, as the first cut did,
  // left variant style parity silently checking nothing on every real
  // component. A convention that exists in a fixture but nowhere else is not
  // a convention.
  //
  // The data-attribute form stays supported: it is a legitimate way to express
  // a variant, and dropping it would just repeat the mistake in reverse.
  tiers.push(
    new Set([
      `${parentSelector}.${text}`,
      `${parentSelector}.${kebabCase(text)}`,
      ...stateForms(text),
      `${parentSelector}[data-${kebabCase(propName)}="${text}"]`,
      `${parentSelector}[data-${propName}="${text}"]`,
    ]),
  )
  return tiers
}

/**
 * Locate a variant's modifier selector — see the module docblock. `null`
 * means "unmapped": the caller reports it, it never guesses.
 *
 * A multi-key `when` (`{variant: "inverse", state: "hover"}`) resolves ONE
 * key at a time, each step nesting under the selector the previous step
 * found (`.root.inverse` → `.root.inverse:hover`). At every step exactly one
 * remaining key may resolve; none or more than one is unmapped.
 *
 * @param {string} elementSelector the element's own resolved selector
 * @param {Record<string, string|number|boolean>} when
 * @param {{byParent: Map, bySelector: Map, topLevelSelectors?: string[]}} fileIndex
 * @param {object} [options]
 * @param {object} [options.props] the contract's `props` — a `code: "none"`
 *   prop is a design-only state and resolves to a pseudo-class
 * @param {boolean} [options.isRoot] whether this is the anatomy `root`. Only
 *   the root may fall back to a TOP-LEVEL co-applied class (`.sm {}` beside
 *   `.chip {}`, both on one element — the CSS-modules convention, issue
 *   #363); a child element's same-named top-level class is almost always
 *   the root's modifier, and comparing against it would be a false match.
 * @returns {string|null}
 */
export function locateVariantSelector(
  elementSelector,
  when,
  fileIndex,
  { props = {}, isRoot = false, rootSelector = null } = {},
) {
  // A CHILD element's variant is commonly styled as a descendant of the
  // ROOT's modifier (`.sm { .label { … } }` → `.sm .label`, issue #378):
  // resolve the root's own variant for this `when`, then look for the
  // child beneath it. The child's OWN modifier forms (below) are still
  // tried first and win when present; the descendant form is the fallback
  // when they find nothing.
  const descendant = (() => {
    if (isRoot || !rootSelector) return null
    const rootVariant = locateVariantSelector(rootSelector, when, fileIndex, {
      props,
      isRoot: true,
    })
    if (rootVariant === null) return null
    const candidate = `${rootVariant} ${ownClass(elementSelector)}`
    return fileIndex.bySelector.has(candidate) ? candidate : null
  })()

  const remaining = new Set(Object.keys(when || {}))
  if (remaining.size === 0) return null
  let current = elementSelector

  const matchOne = (pool, candidates) => {
    const found = pool.filter(selector => candidates.has(selector))
    return found.length === 1 ? found[0] : null
  }
  const resolveKey = propName => {
    const nested = fileIndex.byParent.get(current) || []
    const tiers = variantCandidateTiers(
      current,
      propName,
      when[propName],
      props?.[propName],
    )
    for (const tier of tiers) {
      const hit = matchOne(nested, tier)
      if (hit) return hit
    }
    // Top-level co-applied class: only for the root, only on the first step
    // (a top-level class cannot nest under an already-found modifier), and
    // never for a pseudo-class state.
    if (
      isRoot &&
      current === elementSelector &&
      props?.[propName]?.code !== "none"
    ) {
      const topLevel = fileIndex.topLevelSelectors || []
      for (const tier of variantCandidateTiers("", propName, when[propName])) {
        const hit = matchOne(topLevel, tier)
        if (hit) return hit
      }
    }
    return null
  }

  // Deterministic order: class-shaped keys first, sorted; a design-only
  // state last, since a pseudo-class nests under the class chain
  // (`.root.inverse:hover`) and never the other way round.
  const isState = propName => props?.[propName]?.code === "none"
  const ordered = [...remaining].sort(
    (a, b) => Number(isState(a)) - Number(isState(b)) || compareEntities(a, b),
  )
  for (const propName of ordered) {
    const selector = resolveKey(propName)
    if (selector === null) return descendant
    current = selector
  }
  return current
}

function describeWhen(when) {
  return Object.keys(when)
    .sort(compareEntities)
    .map(key => `${key}=${JSON.stringify(when[key])}`)
    .join(", ")
}

// ---------------------------------------------------------------------------
// Box-grammar precedence — the schema's "individual > axis > all", applied
// identically to both the contract's authored intent and the stylesheet's
// observed declarations. See the module docblock's "BOX GRAMMARS" section.
// ---------------------------------------------------------------------------

const EDGE_FINEST = ["blockStart", "blockEnd", "inlineStart", "inlineEnd"]
const EDGE_FALLBACKS = {
  blockStart: ["blockStart", "block", "all"],
  blockEnd: ["blockEnd", "block", "all"],
  inlineStart: ["inlineStart", "inline", "all"],
  inlineEnd: ["inlineEnd", "inline", "all"],
}

const CORNER_FINEST = ["startStart", "startEnd", "endStart", "endEnd"]
const CORNER_FALLBACKS = {
  startStart: ["startStart", "all"],
  startEnd: ["startEnd", "all"],
  endStart: ["endStart", "all"],
  endEnd: ["endEnd", "all"],
}

const GAP_FINEST = ["row", "column"]
const GAP_FALLBACKS = {
  row: ["row", "all"],
  column: ["column", "all"],
}

// `border` carries every border sub-property; `border-top` and friends carry
// them for ONE edge. Both make a slot indeterminate rather than missing, for
// the same reason: the shorthand does not say which part satisfies which
// sub-property. Omitting the per-edge forms reported `border-top: var(--w)
// solid var(--c)` — a divider on a footer or header, one of the most ordinary
// things a stylesheet does — as a missing binding (issue #183).
const BORDER_SHORTHANDS = [
  "border",
  "border-top",
  "border-right",
  "border-bottom",
  "border-left",
]

const SINGLE_FINEST = ["_value"]
const SINGLE_FALLBACKS = { _value: ["_value"] }

// Each slot maps to a LIST of CSS spellings, logical first, then physical.
//
// Real stylesheets overwhelmingly use the physical properties: measured
// across a real design system, 109 declarations use `margin-bottom` /
// `padding-left` and 8 use `margin-block-end` / `padding-inline`. Recognizing
// only the logical form — which is what this originally did — reported
// `binding-missing` for a token the stylesheet plainly binds, on essentially
// every box-property binding in the codebase.
//
// The logical→physical mapping assumes a horizontal-tb, left-to-right writing
// mode, where block is vertical and inline is horizontal. That is an
// assumption, and it is the reason physical names are listed SECOND: a
// stylesheet that uses the logical form is matched on its own terms, and the
// physical fallback only applies when nothing logical was found.
function edgeCssNames(root, physical) {
  return {
    all: [root],
    block: [`${root}-block`],
    inline: [`${root}-inline`],
    blockStart: [`${root}-block-start`, physical.blockStart],
    blockEnd: [`${root}-block-end`, physical.blockEnd],
    inlineStart: [`${root}-inline-start`, physical.inlineStart],
    inlineEnd: [`${root}-inline-end`, physical.inlineEnd],
  }
}

// `margin`/`padding` prefix their physical edges; `inset`'s physical edges are
// the bare `top`/`right`/`bottom`/`left`.
const prefixedEdges = root => ({
  blockStart: `${root}-top`,
  blockEnd: `${root}-bottom`,
  inlineStart: `${root}-left`,
  inlineEnd: `${root}-right`,
})
const BARE_EDGES = {
  blockStart: "top",
  blockEnd: "bottom",
  inlineStart: "left",
  inlineEnd: "right",
}

// CSS's own logical border-width properties insert the axis BEFORE "width"
// (`border-block-width`, not `border-width-block`) — the one grammar whose
// css names cannot be built from the generic `${root}${suffix}` shape
// `edgeCssNames` uses for padding/margin/inset.
const BORDER_WIDTH_CSS_NAMES = {
  all: "border-width",
  block: "border-block-width",
  inline: "border-inline-width",
  blockStart: "border-block-start-width",
  blockEnd: "border-block-end-width",
  inlineStart: "border-inline-start-width",
  inlineEnd: "border-inline-end-width",
}

const CORNER_CSS_NAMES = {
  all: "border-radius",
  startStart: "border-start-start-radius",
  startEnd: "border-start-end-radius",
  endStart: "border-end-start-radius",
  endEnd: "border-end-end-radius",
}

const GAP_CSS_NAMES = { all: "gap", row: "row-gap", column: "column-gap" }

// Every token-bearing contract style property this checker understands, with
// how to read it off the contract (`path`, dot-navigated) and how to find it
// in the stylesheet (`cssNames`, keyed the same way as `fallbacks`).
// `border.style` is deliberately absent (plain string, never a token/raw
// `value` — see the module docblock).
export const PROPERTY_DEFS = [
  {
    key: "padding",
    path: ["padding"],
    finestSlots: EDGE_FINEST,
    fallbacks: EDGE_FALLBACKS,
    cssNames: edgeCssNames("padding", prefixedEdges("padding")),
  },
  {
    key: "margin",
    path: ["margin"],
    finestSlots: EDGE_FINEST,
    fallbacks: EDGE_FALLBACKS,
    cssNames: edgeCssNames("margin", prefixedEdges("margin")),
  },
  {
    key: "inset",
    path: ["inset"],
    finestSlots: EDGE_FINEST,
    fallbacks: EDGE_FALLBACKS,
    cssNames: edgeCssNames("inset", BARE_EDGES),
  },
  {
    key: "borderWidth",
    path: ["borderWidth"],
    finestSlots: EDGE_FINEST,
    fallbacks: EDGE_FALLBACKS,
    cssNames: BORDER_WIDTH_CSS_NAMES,
  },
  {
    key: "borderRadius",
    path: ["borderRadius"],
    finestSlots: CORNER_FINEST,
    fallbacks: CORNER_FALLBACKS,
    cssNames: CORNER_CSS_NAMES,
  },
  {
    key: "gap",
    path: ["gap"],
    finestSlots: GAP_FINEST,
    fallbacks: GAP_FALLBACKS,
    cssNames: GAP_CSS_NAMES,
  },
  {
    key: "border.width",
    path: ["border", "width"],
    finestSlots: SINGLE_FINEST,
    fallbacks: SINGLE_FALLBACKS,
    cssNames: { _value: "border-width" },
    shorthands: BORDER_SHORTHANDS,
  },
  {
    key: "border.color",
    path: ["border", "color"],
    finestSlots: SINGLE_FINEST,
    fallbacks: SINGLE_FALLBACKS,
    cssNames: { _value: "border-color" },
    // `border: 1px solid var(--c)` carries this slot's value inside the
    // shorthand. See `shorthands` in resolveCssFinest: its presence makes the
    // slot INDETERMINATE, never "missing".
    shorthands: BORDER_SHORTHANDS,
  },
  {
    key: "background",
    path: ["background"],
    finestSlots: SINGLE_FINEST,
    fallbacks: SINGLE_FALLBACKS,
    // A background TOKEN binds background-color, never the `background`
    // shorthand (this repo's own synthetic fixture establishes the
    // convention: `background: { token: … }` in the contract emits
    // `background-color: var(…)` in code) — documented here, not guessed
    // per-project.
    cssNames: { _value: "background-color" },
    // …but `background: var(--x)` is an ordinary way to set exactly that, and
    // the shorthand list is a SEPARATE question from which property a token
    // binds: it only decides whether an absent longhand means "missing" or
    // "indeterminate". Without it, `background:` read as a missing binding
    // while the structurally identical `border:` case did not — an asymmetry,
    // not a scope decision (issue #183).
    shorthands: ["background"],
  },
  {
    key: "color",
    path: ["color"],
    finestSlots: SINGLE_FINEST,
    fallbacks: SINGLE_FALLBACKS,
    cssNames: { _value: "color" },
  },
  {
    key: "maxWidth",
    path: ["maxWidth"],
    finestSlots: SINGLE_FINEST,
    fallbacks: SINGLE_FALLBACKS,
    cssNames: { _value: "max-width" },
  },
  {
    key: "font",
    path: ["font"],
    finestSlots: SINGLE_FINEST,
    fallbacks: SINGLE_FALLBACKS,
    cssNames: { _value: "font" },
  },
  {
    key: "fontFamily",
    path: ["fontFamily"],
    finestSlots: SINGLE_FINEST,
    fallbacks: SINGLE_FALLBACKS,
    cssNames: { _value: "font-family" },
  },
  {
    key: "fontSize",
    path: ["fontSize"],
    finestSlots: SINGLE_FINEST,
    fallbacks: SINGLE_FALLBACKS,
    cssNames: { _value: "font-size" },
  },
  {
    key: "fontWeight",
    path: ["fontWeight"],
    finestSlots: SINGLE_FINEST,
    fallbacks: SINGLE_FALLBACKS,
    cssNames: { _value: "font-weight" },
  },
  {
    key: "lineHeight",
    path: ["lineHeight"],
    finestSlots: SINGLE_FINEST,
    fallbacks: SINGLE_FALLBACKS,
    cssNames: { _value: "line-height" },
  },
]

function readPropPath(base, path) {
  let value = base
  for (const segment of path) {
    if (!isPlainObject(value)) return undefined
    value = value[segment]
  }
  return value
}

// A bare `value` (`{token}` or `"raw(…)"`) authored directly for a grammar
// property (`borderRadius`/`gap`'s `oneOf`) is treated as `{all: value}` —
// unifying the plain-value and grammar-object authoring shapes onto the same
// finest-slot machinery below.
function normalizeGrammarValue(rawValue) {
  if (rawValue === undefined) return {}
  if (typeof rawValue === "string") return { all: rawValue }
  if (isPlainObject(rawValue) && typeof rawValue.token === "string")
    return { all: rawValue }
  return rawValue
}

function classifyContractLeaf(value) {
  if (value === undefined) return undefined
  if (typeof value === "string") {
    return /^raw\(.+\)$/.test(value) ? { kind: "raw", raw: value } : undefined
  }
  if (isPlainObject(value) && typeof value.token === "string")
    return { kind: "token", tokenId: value.token }
  return undefined
}

function resolveContractFinest(rawValue, finestSlots, fallbacks) {
  // A SINGLE-SLOT (non-grammar) property's raw value IS the leaf — there is
  // no `{all, block, …}` wrapper to normalize into, and no fallback chain to
  // walk (the "_value" key never appears as an authored contract key).
  if (finestSlots.length === 1 && finestSlots[0] === "_value") {
    return { _value: classifyContractLeaf(rawValue) }
  }

  const grammarObj = normalizeGrammarValue(rawValue)
  const out = {}
  for (const slot of finestSlots) {
    let classified
    for (const key of fallbacks[slot]) {
      const leaf = grammarObj?.[key]
      if (leaf !== undefined) {
        classified = classifyContractLeaf(leaf)
        break
      }
    }
    out[slot] = classified
  }
  return out
}

// Exported for `cli/commands/scaffold.mjs` (issue #236) — see
// `buildFileIndex`'s note above; this is the same box-grammar resolution
// `compareProperty` uses, run for a selector scaffold has no contract value
// to compare against yet.
export function resolveCssFinest(
  declarations,
  finestSlots,
  fallbacks,
  cssNames,
  shorthands = [],
) {
  const out = {}
  for (const slot of finestSlots) {
    let found
    for (const key of fallbacks[slot]) {
      const spellings = cssNames[key]
      const candidates = Array.isArray(spellings) ? spellings : [spellings]
      for (const cssProp of candidates) {
        if (cssProp && declarations.has(cssProp)) {
          found = declarations.get(cssProp)
          break
        }
      }
      if (found !== undefined) break
    }
    // Nothing under this slot's own CSS names, but a SHORTHAND that can carry
    // it is declared (`border` for `border.color`). The shorthand's value does
    // not say which sub-property each part satisfies, so the slot is
    // indeterminate — reported as `compound` so `compareProperty` stays silent
    // rather than claiming the binding is missing. This is 14% of a real
    // design system's var-using declarations; getting it wrong would be the
    // check's single largest source of false findings.
    if (found === undefined) {
      for (const short of shorthands) {
        if (declarations.has(short)) {
          const decl = declarations.get(short)
          found =
            decl.kind === "literal"
              ? decl
              : {
                  kind: "compound",
                  varNames: decl.varNames || [],
                  raw: decl.raw,
                }
          break
        }
      }
    }
    out[slot] = found
  }
  return out
}

/**
 * Compare ONE property (base or a mapped variant's own subset) for one
 * element. Returns a list of `{rule, slots}` outcomes — `rule` one of
 * "missing" | "mismatch" | "raw" | "unexpected"; more than one may co-occur
 * when different finest slots land in different buckets (e.g. `blockStart`
 * missing while `blockEnd` mismatches) — each still a real, distinct fact,
 * not noise.
 *
 * @param {object} def one `PROPERTY_DEFS` entry
 * @param {*} contractRawValue whatever `readPropPath` found (may be `undefined`)
 * @param {Map<string, object>} declarations the mapped selector's declarations
 * @param {string} cssVarPrefix `conventions.cssVarPrefix`
 * @returns {Array<{rule: string, slots: string[], detail?: object[]}>}
 */
export function compareProperty(
  def,
  contractRawValue,
  declarations,
  cssVarPrefix,
) {
  const contractFinest = resolveContractFinest(
    contractRawValue,
    def.finestSlots,
    def.fallbacks,
  )
  const cssFinest = resolveCssFinest(
    declarations,
    def.finestSlots,
    def.fallbacks,
    def.cssNames,
    def.shorthands,
  )

  const anyContractSlot = def.finestSlots.some(
    slot => contractFinest[slot] !== undefined,
  )

  if (!anyContractSlot) {
    // `var` only — a compound value is indeterminate in this direction too:
    // it may well be satisfying a property the contract does declare
    // elsewhere in the shorthand.
    const unexpected = def.finestSlots.filter(
      slot => cssFinest[slot]?.kind === "var",
    )
    if (unexpected.length === 0) return []
    return [
      {
        rule: "unexpected",
        slots: unexpected,
        detail: unexpected.map(slot => ({
          slot,
          varName: cssFinest[slot].varName,
        })),
      },
    ]
  }

  const missing = []
  const mismatch = []
  const raw = []

  for (const slot of def.finestSlots) {
    const contractSlot = contractFinest[slot]
    if (contractSlot === undefined) continue // this slot: contract says nothing
    if (contractSlot.kind === "raw") continue // sanctioned escape hatch — silent

    // contractSlot.kind === "token"
    const expectedVar = candidateVarName(contractSlot.tokenId, cssVarPrefix)
    if (expectedVar === null) continue // tokens.mjs's own unmappable-token silence

    const cssSlot = cssFinest[slot]
    if (cssSlot === undefined) {
      missing.push(slot)
      continue
    }
    // A COMPOUND value (`border: 1px solid var(--c)`, `padding: var(--a)
    // var(--b)`, `calc(… var(--m) …)`) references a token but does not say
    // which slot it satisfies. Claiming "missing" here would be a false
    // finding on 14% of a real design system's var-using declarations;
    // claiming a match would be a guess. Stay silent for this slot.
    if (cssSlot.kind === "compound") continue
    if (cssSlot.kind === "literal") {
      raw.push({ slot, value: cssSlot.value })
      continue
    }
    if (cssSlot.varName === expectedVar) continue // match
    mismatch.push({
      slot,
      tokenId: contractSlot.tokenId,
      expectedVar,
      foundVar: cssSlot.varName,
    })
  }

  const outcomes = []
  if (missing.length) outcomes.push({ rule: "missing", slots: missing })
  if (mismatch.length)
    outcomes.push({
      rule: "mismatch",
      slots: mismatch.map(m => m.slot),
      detail: mismatch,
    })
  if (raw.length)
    outcomes.push({
      rule: "raw",
      slots: raw.map(r => r.slot),
      detail: raw,
    })
  return outcomes
}

// ---------------------------------------------------------------------------
// The checker.
// ---------------------------------------------------------------------------

function slotNote(def, slots) {
  return def.finestSlots.length > 1 ? ` [${slots.join(", ")}]` : ""
}

function emitOutcome(outcome, def, { emit, id, elementName, variantNote }) {
  const entity = `${id}.${elementName}`
  const note = slotNote(def, outcome.slots)

  if (outcome.rule === "missing") {
    emit("styles/binding-missing", {
      entity,
      message: `"${elementName}"${variantNote} declares a token for "${def.key}"${note} that the stylesheet does not bind`,
      data: { element: elementName, property: def.key, slots: outcome.slots },
    })
    return
  }

  if (outcome.rule === "unexpected") {
    emit("styles/binding-unexpected", {
      entity,
      message: `"${elementName}"${variantNote}'s stylesheet binds a token for "${def.key}"${note}, which the contract does not declare`,
      data: {
        element: elementName,
        property: def.key,
        slots: outcome.slots,
        vars: outcome.detail.map(d => d.varName),
      },
    })
    return
  }

  if (outcome.rule === "mismatch") {
    const pairs = outcome.detail
      .map(d => `${d.slot}: expected "${d.expectedVar}", found "${d.foundVar}"`)
      .join("; ")
    emit("styles/token-mismatch", {
      entity,
      message: `"${elementName}"${variantNote}'s "${def.key}"${note} binds a different token than the contract declares — ${pairs}`,
      data: {
        element: elementName,
        property: def.key,
        mismatches: outcome.detail,
      },
    })
    return
  }

  // outcome.rule === "raw"
  const pairs = outcome.detail.map(d => `${d.slot}: "${d.value}"`).join("; ")
  emit("styles/raw-value", {
    entity,
    message: `"${elementName}"${variantNote} declares a token for "${def.key}"${note}, but the stylesheet hardcodes ${pairs}`,
    data: { element: elementName, property: def.key, raw: outcome.detail },
  })
}

function processPropertySet(base, declarations, cssVarPrefix, ctx) {
  // Two contract spellings can name ONE CSS property: `border.width` and
  // `borderWidth` both read `border-width`. A stylesheet longhand that
  // satisfies the spelling the contract used must not also be "unexpected"
  // under the spelling it did not (issue #363 — a false `binding-unexpected`
  // on every outline-style variant). A def the contract leaves undeclared is
  // skipped when any of its CSS names is already addressed by a declared def.
  const addressedCssNames = new Set(
    PROPERTY_DEFS.filter(
      def => readPropPath(base, def.path) !== undefined,
    ).flatMap(def => Object.values(def.cssNames)),
  )
  for (const def of PROPERTY_DEFS) {
    const rawValue = readPropPath(base, def.path)
    if (rawValue === undefined) {
      const cssNames = Object.values(def.cssNames)
      if (cssNames.some(name => addressedCssNames.has(name))) continue
      // The unexpected direction reports a CSS name at most ONCE — the first
      // undeclared spelling claims it, so `border-width` with neither
      // spelling declared is not reported twice.
      for (const name of cssNames) addressedCssNames.add(name)
    }
    const outcomes = compareProperty(def, rawValue, declarations, cssVarPrefix)
    for (const outcome of outcomes) emitOutcome(outcome, def, ctx)
  }
}

/**
 * Compare every loaded contract's `styles` against its own censused
 * stylesheet and emit D5 findings. Pure — never reads fs/network, never
 * mutates its arguments.
 *
 * @param {Array<{id: string, file: string, contract: object}>} contracts
 *   `spec/contracts.mjs`'s `loadContracts(...).contracts`
 * @param {{files: Array<{file: string, selectors: object[]}>}} styleCensus
 *   `sources/styles.mjs`'s `censusStyles(...)` result (only `.files` is
 *   read; a caller decides what a failed census means for the run)
 * @param {object} [config] the project's (unresolved) config
 * @returns {object[]} findings, in `core/findings.mjs`'s deterministic order
 */
export function runStylesCheck(contracts, styleCensus, config = {}) {
  const {
    rules: rulesConfig,
    conventions: { cssVarPrefix },
  } = resolveConfig(config)
  const findings = []

  function emit(ruleId, { entity, message, data }) {
    const { severity } = resolveRuleConfig(ruleId, rulesConfig, registry)
    if (severity === "off") return
    findings.push(
      makeFinding({
        ruleId,
        severity,
        surface: registry.get(ruleId).surface,
        side: "code",
        entity,
        message,
        ...(data ? { data } : {}),
      }),
    )
  }

  const filesByPath = new Map(
    (styleCensus?.files || []).map(f => [f.file, buildFileIndex(f)]),
  )

  const sortedContracts = [...(contracts || [])].sort((a, b) =>
    compareEntities(a.id, b.id),
  )

  for (const { id, contract } of sortedContracts) {
    const stylesPath = contract?.sources?.code?.styles
    if (!stylesPath) continue // no style file declared — nothing to compare

    const fileIndex = filesByPath.get(stylesPath)
    if (!fileIndex) continue // style file missing/unreadable — a census diagnostic already says so

    const anatomy = isPlainObject(contract.anatomy) ? contract.anatomy : {}
    const stylesByElement = isPlainObject(contract.styles)
      ? contract.styles
      : {}

    // The root resolves FIRST — a child's descendant form (`.button .icon`)
    // and a child's variant under the root's modifier both need it.
    const rootSelector = isPlainObject(anatomy.root)
      ? locateElementSelector(anatomy.root, "root", fileIndex)
      : null

    // `$`-prefixed keys in `anatomy` are structure, not elements —
    // `$variants` (ADR-002 D2) is the only one, and it has no selector to map.
    const elementNames = Object.keys(anatomy)
      .filter(name => !name.startsWith("$"))
      .sort(compareEntities)

    for (const elementName of elementNames) {
      const node = anatomy[elementName]
      if (!isPlainObject(node) || node.type === "instance") continue // delegated elsewhere

      const elementSelector = locateElementSelector(
        node,
        elementName,
        fileIndex,
        { rootSelector },
      )
      if (elementSelector === null) {
        emit("styles/element-unmapped", {
          entity: `${id}.${elementName}`,
          message: `element "${elementName}" in "${id}" could not be confidently mapped to a selector in "${stylesPath}"`,
          data: { element: elementName },
        })
        continue
      }

      const elementStyles = isPlainObject(stylesByElement[elementName])
        ? stylesByElement[elementName]
        : {}
      const baseSelectorEntry = fileIndex.bySelector.get(elementSelector)

      processPropertySet(
        isPlainObject(elementStyles.base) ? elementStyles.base : {},
        baseSelectorEntry.declarations,
        cssVarPrefix,
        { emit, id, elementName, variantNote: "" },
      )

      const variants = Array.isArray(elementStyles.variants)
        ? elementStyles.variants
        : []

      variants.forEach(variant => {
        if (!isPlainObject(variant) || !isPlainObject(variant.when)) return

        const variantSelector = locateVariantSelector(
          elementSelector,
          variant.when,
          fileIndex,
          {
            props: contract.props,
            isRoot: elementName === "root",
            rootSelector,
          },
        )
        if (variantSelector === null) {
          emit("styles/variant-unmapped", {
            entity: `${id}.${elementName}`,
            message: `variant ${describeWhen(variant.when)} of "${elementName}" in "${id}" could not be confidently mapped to a selector in "${stylesPath}"`,
            data: { element: elementName, when: variant.when },
          })
          return
        }

        const variantEntry = fileIndex.bySelector.get(variantSelector)
        const variantProps = {}
        for (const key of Object.keys(variant)) {
          if (key === "when") continue
          variantProps[key] = variant[key]
        }

        processPropertySet(
          variantProps,
          variantEntry.declarations,
          cssVarPrefix,
          {
            emit,
            id,
            elementName,
            variantNote: ` (variant ${describeWhen(variant.when)})`,
          },
        )
      })
    }
  }

  return sortFindings(findings)
}

// ---------------------------------------------------------------------------
// Design-side bindings (issue #401) — COMPONENT-level, deliberately.
// A contract's `styles` are per anatomy element, but mapping an element to
// a design LAYER is #402's territory; until that lands, the honest claim
// this module can make is "the design component never binds this token
// anywhere in its tree." One finding per (contract, token), elements in
// `data`, so a token bound to three elements is one gap, not three.
// ---------------------------------------------------------------------------

// Every `{token}` binding in a contract's `styles`, wherever nested
// (edge values, corner values, borders, variants) — a deep walk for the
// one field name the schema gives token bindings, with the elements each
// token is declared for.
function declaredTokenBindings(styles) {
  const byToken = new Map()
  const record = (token, element, path) => {
    if (!byToken.has(token))
      byToken.set(token, { elements: new Set(), declarations: [] })
    const entry = byToken.get(token)
    entry.elements.add(element)
    // One entry PER DECLARATION SITE, never a union across the contract
    // (issue #492): the same token can be declared under a property the
    // design tool cannot express AND under one it can, and silencing the
    // second because of the first would hide real drift. Every key on the
    // way down is kept, not just the last, so `margin.blockEnd` is a MARGIN
    // binding — the provider names what it cannot express by property, not
    // by edge slot.
    entry.declarations.push({ element, path: [...path] })
  }
  const walk = (value, element, path) => {
    if (Array.isArray(value)) {
      for (const item of value) walk(item, element, path)
      return
    }
    if (value === null || typeof value !== "object") return
    if (typeof value.token === "string" && value.token.length > 0)
      record(value.token, element, path)
    for (const [key, child] of Object.entries(value)) {
      if (key.startsWith("_")) continue
      walk(child, element, [...path, key])
    }
  }
  for (const [element, styles_] of Object.entries(styles || {})) {
    if (element.startsWith("_")) continue
    walk(styles_, element, [])
  }
  return byToken
}

/**
 * The census's alias edges, reversed: target id -> the ids of the tokens
 * that alias it, every id passed through `fold`. Reads `aliasOf` and
 * `aliasChain` exactly as `tokens.mjs` collects its alias targets — a chain
 * link is a token this one resolves through, at any depth.
 *
 * @param {Array<{id: string, aliasOf?: string, aliasChain?: string[]}>} tokens
 * @param {(id: string) => string} [fold]
 * @returns {Map<string, Set<string>>}
 */
export function buildAliasIndex(tokens, fold = id => id) {
  const index = new Map()
  for (const token of tokens || []) {
    const aliasing = fold(token.id)
    const targets = [token.aliasOf, ...(token.aliasChain || [])]
    for (const target of targets) {
      if (!target) continue
      const folded = fold(target)
      if (!index.has(folded)) index.set(folded, new Set())
      index.get(folded).add(aliasing)
    }
  }
  return index
}

/**
 * Every id reachable from `folds` by walking UP the alias index — from a
 * bound token to the tokens that alias it, then theirs, at any depth — each
 * mapped to the bound id it was reached from. Diagnosis only, never a match
 * (issue #686): a component that binds a primitive where the contract
 * declares the semantic token aliasing it has bound the wrong tier, and the
 * finding stays — this only lets its message name the primitive and the fix.
 * Never downward: a bound token that aliases what the contract declares says
 * nothing about the declared one. The visited map is what makes a cyclic or
 * self-referential chain finish.
 *
 * @param {Iterable<string>} folds
 * @param {Map<string, Set<string>>} index from `buildAliasIndex`
 * @returns {Map<string, string>} `folds` (each to itself) plus everything
 *   above them, each to the bound id it was walked up from
 */
export function expandThroughAliases(folds, index) {
  const reached = new Map([...folds].map(fold => [fold, fold]))
  const queue = [...reached.keys()]
  while (queue.length > 0) {
    const current = queue.shift()
    for (const aliasing of index.get(current) || []) {
      if (reached.has(aliasing)) continue
      reached.set(aliasing, reached.get(current))
      queue.push(aliasing)
    }
  }
  return reached
}

/**
 * Compare each contract's declared token bindings against the variables its
 * design component actually binds (`usedVars`, merged by
 * `ingest --bindings`). Pure — every census arrives already loaded.
 *
 * THREE THINGS THIS RULE CANNOT CLAIM (issue #492, 2026-09-17). Each
 * would otherwise produce a finding no one can act on — the contract is
 * right, the stylesheet is right, the design file is right, and only the
 * comparison is wrong:
 *
 *   1. A PROPERTY THE DESIGN TOOL CANNOT EXPRESS AS A VARIABLE. Declared by
 *      the PROVIDER (`unbindableProperties`) and passed in, never inferred
 *      from what a census happens to contain: deriving it would silence real
 *      drift on a thin census, and would make a vanished finding
 *      unexplainable. A tool typically cannot bind line-height (authored as
 *      a literal on a text style) or a margin (flow spacing belongs to the
 *      PARENT layer, outside the component a contract addresses) — but WHICH
 *      properties those are is the provider's own statement, never this
 *      module's assumption.
 *   2. A TOKEN WHOSE VALUE IS ZERO. An unset gap binds no variable, so a
 *      contract declaring a zero-valued token is reported forever. Skipped
 *      by VALUE, not through the provider's list: "resolves to 0" is a fact
 *      about the value, not a class of property.
 *   3. A TOKEN A `tokenMap` REDIRECT PUT OUT OF REACH. When the project
 *      redirects a variable to a DIFFERENT token than the one the contract
 *      names — measured: `layout/section` → `system.layout.xl.section`
 *      against a contract declaring the family alias `system.layout.section`
 *      — no change to the design file can satisfy the rule. The redirect is
 *      the project's own correct answer for the TOKEN census, so this is
 *      reported on the `skipped` channel and never as drift.
 *
 * @param {Array<{id: string, contract: object, designMatchKey?: string|null}>} contracts
 * @param {{entries: Array<{matchKey: string, usedVars?: string[]}>}} designCensus
 * @param {{tokens: object[]}} tokenCensus the code-side token census — the
 *   match set `candidateTokenIds` maps design variable names into
 * @param {object} [config]
 * @param {{unbindableProperties?: string[]}} [provider] what the ACTIVE
 *   provider says it cannot express as a node-level variable (D12: the
 *   vocabulary is the provider's, so the list comes from it, not from here)
 * @returns {{findings: object[], skipped: Array<{token: string, entity: string, reason: string}>}}
 */
export function runDesignBindingsCheck(
  contracts,
  designCensus,
  tokenCensus,
  config = {},
  provider = {},
) {
  const { rules: rulesConfig } = resolveConfig(config)
  const ruleId = "styles/design-binding-missing"
  const { severity } = resolveRuleConfig(ruleId, rulesConfig, registry)
  if (severity === "off") return { findings: [], skipped: [] }

  const options = isPlainObject(config?.design?.options)
    ? config.design.options
    : {}
  const tokens = tokenCensus?.tokens || []

  // The three vocabularies in play never agree on spelling (measured on a
  // real project, 2026-08-30): the census says `system.fontWeight.semibold`
  // and `…elevation.1.…`, a contract may declare `system.font-weight.semibold`
  // and `…elevation-1.…`, and the design side binds `fontWeight/semibold`.
  // Everything is therefore compared on the FOLDED JOIN — segments split on
  // `.`/`/`, case and `-`/`_` folded, joined — the same normalization
  // `candidateVarName` applies one segment at a time.
  const foldSegments = id =>
    String(id)
      .replace(/^([^./]+)\/[^.]+/, "$1")
      .split(/[/.]/)
      .filter(Boolean)
      .map(segment => segment.replace(/[-_\s]/g, "").toLowerCase())
  // Joined WITHOUT a separator: the sides also disagree on where a
  // boundary falls (`elevation-1` is one contract segment, `elevation.1`
  // two census ones) — only the separator-free join bridges that.
  const fold = id => foldSegments(id).join("")

  // folded census id -> collapsed census id, plus which are composites
  // (typography, shadow): a composite has no single design variable — the
  // design side binds its parts — so it is never a bindings finding.
  const censusByFold = new Map()
  const compositeFolds = new Set()
  // Folded ids whose resolved value is zero (issue #492 case 2) — an unset
  // gap or offset binds no variable in the design tool, so a contract
  // declaring one can never be satisfied. `cssValue` is the census's own
  // already-flattened string; a unit on a zero is still zero.
  const zeroValuedFolds = new Set()
  // Folded ids that alias another token: a bound one of these is not a
  // primitive, so the binding finding's message must not call it one.
  const aliasingFolds = new Set()
  // last folded SEGMENT -> folded ids ending in it, for the single-segment
  // liberal match — segment-boundary-aware, so `section` can never match a
  // token merely CONTAINING the letters (`intersection`).
  const foldsByLastSegment = new Map()
  for (const token of tokens) {
    const collapsed = String(token.id).replace(/^([^./]+)\/[^.]+/, "$1")
    const segments = foldSegments(collapsed)
    const folded = segments.join("")
    censusByFold.set(folded, collapsed)
    if (token.$type === "typography" || token.$type === "shadow")
      compositeFolds.add(folded)
    if (isZeroValue(token)) zeroValuedFolds.add(folded)
    if (token.aliasOf || (token.aliasChain || []).length > 0)
      aliasingFolds.add(folded)
    const last = segments[segments.length - 1]
    if (!foldsByLastSegment.has(last)) foldsByLastSegment.set(last, [])
    foldsByLastSegment.get(last).push(folded)
  }
  // Built once per run: the census is fixed while the component loop is hot.
  const aliasIndex = buildAliasIndex(tokens, fold)

  const entriesByKey = new Map(
    (designCensus?.entries || []).map(entry => [entry.matchKey, entry]),
  )

  // What the provider says it cannot express as a node-level variable
  // (issue #492 case 1) — matched against every key on the path down to a
  // binding, so `margin` covers `margin.blockEnd`.
  const unbindable = new Set(
    (provider?.unbindableProperties || []).map(name => String(name)),
  )

  const findings = []
  const skipped = []
  for (const { id, contract, designMatchKey } of contracts || []) {
    if (!designMatchKey) continue
    const entry = entriesByKey.get(designMatchKey)
    // No census entry, or a snapshot from before the bindings gather —
    // nothing to compare, and silence is the honest answer.
    if (!entry || !Array.isArray(entry.usedVars)) continue

    // Which census tokens the design side's bound variables map to — the
    // candidate machinery for multi-segment names, and for a SINGLE-segment
    // name (`section`, `gutter`) a liberal last-segment match: this check
    // only asks "does ANY bound variable map to the declared token", so a
    // liberal answer errs toward silence, never toward a false finding.
    const boundFolds = new Set()
    // What each bound variable WOULD have mapped to with no `tokenMap` at
    // all (issue #492 case 3): a token in here but not in `boundFolds` was
    // reachable before the project's redirect and is not after — the
    // redirect is the project's own correct answer for the token census, so
    // that is a skip with a reason, never drift.
    const naturalFolds = new Map()
    for (const name of entry.usedVars) {
      for (const candidate of candidateTokenIds(name, null, tokens, options))
        boundFolds.add(fold(candidate))
      if (options.tokenMap) {
        const { tokenMap, ...withoutMap } = options
        for (const candidate of candidateTokenIds(
          name,
          null,
          tokens,
          withoutMap,
        )) {
          const folded = fold(candidate)
          if (!naturalFolds.has(folded)) naturalFolds.set(folded, name)
        }
      }
      const segments = String(name).split(/[/.]/).filter(Boolean)
      if (segments.length === 1) {
        const leaf = segments[0].replace(/[-_\s]/g, "").toLowerCase()
        for (const folded of foldsByLastSegment.get(leaf) || [])
          boundFolds.add(folded)
      }
    }

    // A component that binds a primitive while the contract declares the
    // semantic token aliasing it has bound the wrong tier: still a finding,
    // but one that can name the primitive it binds instead (issue #686).
    const aliasOrigins = expandThroughAliases(boundFolds, aliasIndex)

    const declared = declaredTokenBindings(contract?.styles)
    for (const [tokenId, { elements, declarations }] of [
      ...declared.entries(),
    ].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))) {
      const folded = fold(tokenId)
      // A declared id the census does not know (under ANY spelling) cannot
      // be translated into the design side's vocabulary — that is a
      // contract-vs-census question for the token rules, not a bindings
      // finding. Composites are skipped by construction (see above).
      if (!censusByFold.has(folded)) continue
      if (compositeFolds.has(folded)) continue
      if (boundFolds.has(folded)) continue

      // The three things this rule cannot claim — see the docblock. Each is
      // recorded with its reason rather than silently dropped: a reader has
      // to be able to tell what a clean result means.
      // Only when EVERY declaration site is under a property the tool
      // cannot express: one bindable site makes the token comparable, and
      // its absence from the design side is real drift.
      const blocking = declarations.map(({ path }) =>
        path.find(key => unbindable.has(key)),
      )
      const blockedBy = blocking.every(Boolean) ? blocking[0] : undefined
      if (blockedBy) {
        skipped.push({
          token: tokenId,
          entity: id,
          reason: `"${blockedBy}" is not something this design tool expresses as a node-level variable, so no bound variable could ever map to "${tokenId}"`,
        })
        continue
      }
      if (zeroValuedFolds.has(folded)) {
        skipped.push({
          token: tokenId,
          entity: id,
          reason: `"${tokenId}" resolves to zero, and an unset value binds no variable in the design tool`,
        })
        continue
      }
      const redirectedFrom = naturalFolds.get(folded)
      if (redirectedFrom !== undefined) {
        skipped.push({
          token: tokenId,
          entity: id,
          reason: `the design component binds "${redirectedFrom}", which design.options.tokenMap redirects to another token — "${tokenId}" is out of this comparison's reach by construction`,
        })
        continue
      }
      const subject = `contract "${id}" declares token "${tokenId}" (element(s) ${[...elements].sort().join(", ")})`
      const origin = aliasOrigins.get(folded)
      const boundAliasTarget =
        origin === undefined ? undefined : censusByFold.get(origin) || origin
      // "primitive" only when the bound token aliases nothing itself; a bound
      // semantic token under the declared one is just "token".
      const boundKind = aliasingFolds.has(origin) ? "token" : "primitive"
      findings.push(
        makeFinding({
          ruleId,
          severity,
          surface: "styles",
          side: "design",
          entity: id,
          message:
            boundAliasTarget === undefined
              ? `${subject}, and no variable the design component binds maps to it — component-level: the design tree never binds this token anywhere`
              : `${subject}, and the design component binds ${boundKind} "${boundAliasTarget}" directly; "${tokenId}" aliases it, so bind "${tokenId}"`,
          data: {
            token: tokenId,
            elements: [...elements].sort(),
            boundVariables: entry.usedVars.length,
            ...(boundAliasTarget === undefined ? {} : { boundAliasTarget }),
          },
        }),
      )
    }
  }
  return {
    findings: sortFindings(findings),
    skipped: skipped.sort((a, b) =>
      a.entity === b.entity
        ? compareEntities(a.token, b.token)
        : compareEntities(a.entity, b.entity),
    ),
  }
}
