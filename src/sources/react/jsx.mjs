/**
 * jsx.mjs — the code-side structural census for anatomy parity (ADR-001 D5,
 * Phase 2c, issue #104): walks a component's RETURNED JSX and produces a
 * plain, tag/children/content tree — the sibling `sources/react/extract.mjs`
 * builds for props, applied to structure instead.
 *
 * Same lazy `typescript` load as `sources/react/extract.mjs` — this module reuses
 * that module's own `loadTypeScript` directly (a sibling import WITHIN
 * `sources/`, which the layering rule below allows), since "try to require a
 * module by name, return `null` instead of throwing" has no room for a
 * second, divergent implementation to be worth avoiding. `compilerOptions`,
 * by contrast, is a SMALL, DELIBERATE duplicate of `extract.mjs`'s own copy:
 * a config object this small is cheaper to repeat
 * than to import, and this module's compiler needs (source-only, no type
 * resolution beyond finding JSX children) never has to stay in lockstep with
 * `extract.mjs`'s own (which resolves types for prop classification).
 *
 * `sources/` may import `core/` (+ own siblings) and NOTHING else internal
 * (`__tests__/layering.test.js` enforces this) — never `spec/`, `modules/`.
 * That is exactly why this module is CONTRACT-BLIND: it has no idea what an
 * "anatomy" is, what `presentIf` means, or what a `codeClass` is. It states
 * only what the JSX plainly says, in the vocabulary below, and hands the
 * judgment about what that means for one contract to `modules/anatomy.mjs`,
 * the one layer allowed to know both sides.
 *
 * ---------------------------------------------------------------------------
 * THE CENSUS SHAPE
 * ---------------------------------------------------------------------------
 *
 * One component censuses to EITHER:
 *
 *   `{file, resolvable: true, root: StructuralNode}` — the walker found
 *   exactly one statically-certain returned tree, and `root` describes it; or
 *
 *   `{file, resolvable: true, root, partial: true, unresolvedAt: string[]}` —
 *   the component renders SEVERAL branches sharing a root, and `root` is
 *   their intersection: what every branch agrees on, with each disagreement
 *   marked unresolved. `unresolvedAt` names those positions, and reporting it
 *   is mandatory rather than cosmetic — a partial answer presented as a
 *   complete one is the same false-finding class as guessing a branch. An
 *   intersection that found NO disagreement is a complete answer and must not
 *   carry these fields; or
 *
 *   `{file, resolvable: false, reason, branches?: StructuralNode[]}` — the
 *   walker found a real component but its render shape has no single static
 *   answer (see "DECLINE REASONS" below). `branches` is the BRANCH-BEARING
 *   form (ADR-002 D5): for a "divergent-roots" component the candidate trees
 *   are carried here, in source order, rather than discarded — they are the
 *   only record of what such a component renders, and a variant-keyed
 *   contract is matched against them structurally in a later step. It is
 *   present ONLY when every rendering branch resolved: a list holding some of
 *   the branches reads as all of them, which is the same false-finding class
 *   as guessing which branch counts. Carrying it changes no decline and no
 *   finding — a declined component is still declined, for the same reason.
 *   This is NOT a failure: `extractJsxComponents` never puts these in
 *   `diagnostics`, the same way `sources/styles.mjs`'s "element unmapped"
 *   case is a fact about the input, not a bug in the census. `ok:false` is
 *   reserved for genuine extraction failure (missing `typescript`, missing
 *   file, no component found at all) — the same three failure classes
 *   `extract.mjs` already distinguishes.
 *
 * A `StructuralNode` is one of:
 *
 *   {kind: "element",   tag: "button",  children: StructuralNode[]}
 *   {kind: "component",  name: "Icon",   children: StructuralNode[]}
 *   {kind: "text",       value: "Submit"}
 *   {kind: "expression", prop: "label"}
 *   {kind: "unknown"}
 *   {kind: "unresolved"}
 *
 * "element" is a lowercase JSX tag (a real DOM element); "component" is an
 * uppercase (or dotted) tag — a nested custom component, whose OWN internal
 * structure this module never follows (that is either irrelevant, if the
 * contract treats the position as an `instance` node delegated to the
 * child's own contract, or a case `modules/anatomy.mjs` declines on — either
 * way, not this layer's call to make). "text" is a literal JSX text child OR
 * a literal string inside a `{"…"}` expression container. "expression" is
 * `{identifier}` — the ONE content shape this module resolves a name for,
 * which is deliberately what makes `{children}` fall out for free (it is
 * just `{kind: "expression", prop: "children"}`, never a name filtered out by
 * convention — matching how `extract.mjs`'s own docblock describes
 * `children` falling out of its intersection walk). "unknown" is any other
 * expression child (`{formatPrice(x)}`, `{props.label}`, a template literal,
 * …) — NOT a decline reason on its own (see below); it just means
 * `modules/anatomy.mjs`'s content-binding check has nothing it can safely
 * compare, so it stays silent for that one node without poisoning the rest
 * of the tree's STRUCTURE, which this module could still resolve.
 *
 * "unresolved" is the STRUCTURAL counterpart: a position that exists but whose
 * contents this module refuses to name, because the branches of a multi-tree
 * component disagreed there. It counts as a structural child — the position is
 * real, only its contents are unknown — and `modules/anatomy.mjs` asserts
 * nothing about it. An element/component node may also carry
 * `childrenResolved: false` with `children: []`, meaning the branches rendered
 * DIFFERENT NUMBERS of children: that is "not known", never "renders nothing",
 * and the two must never be collapsed.
 *
 * Whitespace-only JSX text and an empty `{/* comment *‍/}` expression
 * container are dropped entirely — they carry no structural or content
 * information, and keeping them would make trivial reformatting (an added
 * blank line) look like a structural change.
 *
 * ---------------------------------------------------------------------------
 * DECLINE REASONS — the whole bar this module exists to hold (issue #104)
 * ---------------------------------------------------------------------------
 *
 * Measured across 81 real components before this module was built: 4 have a
 * conditional inside JSX, 11 render via `.map()`, 25 render `{children}`,
 * 18 have an early return. `{children}` is handled, not declined (above);
 * every other pattern here declines the WHOLE component — never a subtree —
 * because once ANY of them is true, there is no single tree this module can
 * honestly hand `modules/anatomy.mjs`, and a partial answer built by
 * guessing which branch "counts" is exactly the false-finding class this
 * check exists to avoid:
 *
 *   - "multiple-returns": more than one branch RENDERING SOMETHING is
 *     reachable in the component's own scope, and they either share a root
 *     element or include a branch with no nameable root. A branch that
 *     renders nothing (`return null`, `return undefined`, a bare `return;`)
 *     is NOT one of them — it contributes no structure, so counting it as a
 *     competing tree declined components whose markup is unambiguous. That
 *     was issue #156: the early-return guard is the most common multi-return
 *     shape there is, and it was the one costing the most coverage.
 *   - "divergent-roots": every rendering branch resolves to a plain JSX root
 *     and those roots are DIFFERENT elements, so no common structure exists
 *     to describe. Split out of "multiple-returns" because the two have
 *     different futures: several trees sharing a root can be reconciled by
 *     comparing only what is invariant across them, whereas divergent roots
 *     cannot be resolved by any resolver change — they need a variant-keyed
 *     contract, which is a schema decision. Reporting them as one reason hid
 *     which components were waiting on which. This is the ONE reason that
 *     carries `branches` (above) — a variant-keyed contract has to be matched
 *     against the trees, so throwing them away made that step impossible.
 *   - "no-jsx-returned": either zero returns exist in a block body (the
 *     component's shape could not be resolved to a candidate at all), or
 *     every return renders nothing, or the sole rendering return's argument
 *     is not a JSX element/self-closing element (a bare identifier, a
 *     string).
 *   - "conditional-render": a ternary or `&&`/`||`/`??` is the WHOLE returned
 *     expression, so the component has no determinate root. As a JSX CHILD
 *     these no longer decline (issue #165): a ternary child becomes an
 *     `unresolved` position, and a logical one withholds its parent's child
 *     list, because either way the rest of the tree is still knowable.
 *   - "fragment": a Fragment (`<>…</>` or `<React.Fragment>`) appears as the
 *     root or anywhere nested — a component's real root when this happens is
 *     more than one element with no single wrapping node, which is a shape
 *     this module does not try to resolve (a real anatomy contract expects
 *     exactly one `root`).
 *   - "unsupported-shape": the sole return's argument is some other
 *     expression this module does not attempt to classify (a bare call
 *     expression, a template literal, …) — "any shape the walker cannot
 *     fully resolve" (the issue's own words), the catch-all this module
 *     leans on rather than ever guessing a new one open-endedly.
 *
 * Determinism: the walk is strictly source order (JSX children are read in
 * the order they appear, never re-sorted — order IS the signal this check
 * exists to compare) and the FIRST decline reason encountered in that same
 * source order wins when more than one applies. Components are sorted by
 * file. No wall clock, no randomness.
 */

import { existsSync } from "node:fs"

import { loadTypeScript, hasExportModifier } from "./extract.mjs"
import { unwrapHoc } from "./hoc.mjs"
import { toPosixRelative } from "../../core/paths.mjs"
import { compareStrings } from "../../core/text.mjs"

const defaultFs = { existsSync }

/**
 * Every `reason` this adapter can put on a declined component, and every
 * `kind` it can put on a census node — the CANONICAL lists (issue #164).
 *
 * These exist because `docs/framework-adapter-contract.md` presents itself as
 * the normative surface a non-React adapter (ADR-001 D16) implements against,
 * and it drifted from this module twice in one afternoon without any CI job
 * noticing. Declaring the values in one exported place lets
 * `__tests__/docs-parity.test.js` bind the doc, this module's own docblock,
 * and the code to the same list, so they cannot disagree silently.
 *
 * They are NOT derivable by scraping this file: a reason reaches a component
 * through four different mechanisms — a literal at a `declinedResult` call, a
 * `{reason}` returned by `resolveBranch`, a string returned by
 * `classifyMultiTree` and passed through a variable, and a mutable
 * `declineRef.reason` assigned deep in the walker. That is precisely the
 * "a static grep is not verification" trap, so the list is declared rather
 * than inferred.
 *
 * Adding a reason or node kind means adding it here AND to both docs; the
 * test fails otherwise, which is the whole point.
 */
export const DECLINE_REASONS = Object.freeze([
  "conditional-render",
  "divergent-roots",
  "fragment",
  "multiple-returns",
  "no-jsx-returned",
  "unsupported-shape",
])

export const CENSUS_NODE_KINDS = Object.freeze([
  "component",
  "element",
  "expression",
  "text",
  "unknown",
  "unresolved",
])

const TYPESCRIPT_MISSING_MESSAGE =
  'install typescript to run the anatomy check (it is an optional peer dependency — "npm install --save-dev typescript")'

function compilerOptions(ts) {
  return {
    allowJs: false,
    checkJs: false,
    jsx: ts.JsxEmit.ReactJSX,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.CommonJS,
    moduleResolution:
      ts.ModuleResolutionKind.Node10 ?? ts.ModuleResolutionKind.NodeJs,
    esModuleInterop: true,
    skipLibCheck: true,
    noEmit: true,
    strict: false,
    strictNullChecks: false,
  }
}

// ---------------------------------------------------------------------------
// 1. Find the exported component function — deliberately looser than
//    `extract.mjs`'s `findComponentPropsParam` (no destructured/typed-params
//    requirement): this module needs the function's BODY, not its props
//    type, so it recognizes every component `extract.mjs` does plus a few it
//    doesn't (a plain `(props: Props)` parameter, say) — a superset never a
//    mismatch, since `modules/anatomy.mjs` only acts on files BOTH censuses
//    found (a contract's declared code path present in the jsx census).
// ---------------------------------------------------------------------------

// Find the component this file exports.
//
// Measured against a real design system before trusting any one form: of 100
// components, ZERO used `export function X`, 91 used `export const X = …`, and
// 55 declared `const X = …` and exported it on the last line via
// `export default X`. Handling only the inline-export forms — which is what
// this function originally did — failed to find a component in 69 of those
// 100 files, so the whole anatomy check would have silently covered under a
// third of the codebase.
//
// So this resolves in three passes, most-specific first, and follows a
// default export back to its declaration.
function findComponentFunction(ts, sourceFile) {
  // Pass 1: inline-exported function or arrow — `export function X`,
  // `export const X = () => …`, `export default function X`.
  for (const statement of sourceFile.statements) {
    if (
      ts.isFunctionDeclaration(statement) &&
      hasExportModifier(ts, statement) &&
      statement.body
    ) {
      return statement
    }
    if (ts.isVariableStatement(statement) && hasExportModifier(ts, statement)) {
      const initializer = firstFunctionInitializer(ts, statement)
      if (initializer) return initializer
    }
  }

  // Pass 2: `export default <Identifier>` pointing at a `const X = …`
  // declared earlier in the file — the dominant real-world shape.
  const defaultExportName = findDefaultExportName(ts, sourceFile)
  if (defaultExportName) {
    for (const statement of sourceFile.statements) {
      if (!ts.isVariableStatement(statement)) continue
      for (const declaration of statement.declarationList.declarations) {
        if (
          ts.isIdentifier(declaration.name) &&
          declaration.name.text === defaultExportName
        ) {
          const initializer = declaration.initializer
          if (
            initializer &&
            (ts.isArrowFunction(initializer) ||
              ts.isFunctionExpression(initializer))
          ) {
            return initializer
          }
          const unwrapped = unwrapHoc(ts, initializer)
          if (unwrapped) return unwrapped.fn
        }
      }
      if (
        ts.isFunctionDeclaration(statement) &&
        statement.name?.text === defaultExportName &&
        statement.body
      ) {
        return statement
      }
    }
    // A default-exported function DECLARATION (`function X() {}` … `export
    // default X`) is a separate statement kind — check those too.
    for (const statement of sourceFile.statements) {
      if (
        ts.isFunctionDeclaration(statement) &&
        statement.name?.text === defaultExportName &&
        statement.body
      ) {
        return statement
      }
    }
  }

  return null
}

// `export default X` -> "X". Only a bare identifier: `export default () => …`
// is handled by pass 1's own traversal, and anything else (a call, an object)
// is not a component this walker can follow.
function findDefaultExportName(ts, sourceFile) {
  for (const statement of sourceFile.statements) {
    if (ts.isExportAssignment(statement) && !statement.isExportEquals) {
      if (ts.isIdentifier(statement.expression))
        return statement.expression.text
    }
  }
  return null
}

function firstFunctionInitializer(ts, statement) {
  for (const declaration of statement.declarationList.declarations) {
    const initializer = declaration.initializer
    if (!initializer) continue
    if (
      ts.isArrowFunction(initializer) ||
      ts.isFunctionExpression(initializer)
    ) {
      return initializer
    }
    // `forwardRef(fn)` / `memo(fn)` — a CALL, not an arrow. Only the wrapped
    // function matters here: this reader wants the returned element tree, and
    // the wrapper's type arguments are `extract.mjs`'s concern (`hoc.mjs`).
    const unwrapped = unwrapHoc(ts, initializer)
    if (unwrapped) return unwrapped.fn
  }
  return null
}

function isFunctionLike(ts, node) {
  return (
    ts.isArrowFunction(node) ||
    ts.isFunctionExpression(node) ||
    ts.isFunctionDeclaration(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isGetAccessorDeclaration(node) ||
    ts.isSetAccessorDeclaration(node)
  )
}

// Every `return` reachable in `fn`'s OWN scope — never descending into a
// nested function/arrow (an event handler, a `.map` callback), which is a
// different scope's returns, not this component's.
function collectReturnStatements(ts, node, out) {
  if (!node) return
  if (ts.isReturnStatement(node)) {
    out.push(node)
    return
  }
  if (isFunctionLike(ts, node)) return // a nested scope — do not descend
  ts.forEachChild(node, child => collectReturnStatements(ts, child, out))
}

// The candidate expression(s) this component's body could return — a single
// concise arrow body is exactly one candidate; a block body is every
// `return`'s own argument (`undefined` for a bare `return;`).
function findReturnedCandidates(ts, fn) {
  if (!ts.isBlock(fn.body)) return [fn.body]
  const returns = []
  collectReturnStatements(ts, fn.body, returns)
  return returns.map(r => r.expression)
}

function unwrapParens(ts, node) {
  let current = node
  while (current && ts.isParenthesizedExpression(current))
    current = current.expression
  return current
}

function isLogicalConditional(ts, node) {
  return (
    ts.isBinaryExpression(node) &&
    [
      ts.SyntaxKind.AmpersandAmpersandToken,
      ts.SyntaxKind.BarBarToken,
      ts.SyntaxKind.QuestionQuestionToken,
    ].includes(node.operatorToken.kind)
  )
}

function isJsxElementLike(ts, node) {
  return Boolean(
    node && (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)),
  )
}

// ---------------------------------------------------------------------------
// 2. The tree walk — see the module docblock's "DECLINE REASONS".
// ---------------------------------------------------------------------------

// Returned by `classifyExpressionChild` for a child whose COUNT cannot be
// known — `{cond && <X/>}` (zero or one) or `{items.map(…)}` (zero to many).
// Distinct from `{kind: "unresolved"}`, which is a position that definitely
// exists and whose contents are merely unknown: here it is the number of
// positions that is unknown, so no position can be invented and the parent's
// whole child list is withheld instead (issue #165).
const VARIABLE_COUNT = Symbol("variable-count")

function normalizeJsxWhitespace(text) {
  return text.replace(/\s+/g, " ").trim()
}

// One JSX expression CHILD (`{…}`) — classifies to a StructuralNode, or sets
// `declineRef.reason` and returns null. `declineRef` is a single mutable slot
// shared across the whole walk so the FIRST reason encountered (source
// order) wins, deterministically.
function classifyExpressionChild(ts, jsxExpression, declineRef) {
  const expr = jsxExpression.expression
  if (!expr) return null // `{/* comment */}` or an empty container — nothing

  const unwrapped = unwrapParens(ts, expr)

  // A ternary child renders exactly one node ONLY when BOTH arms are a JSX
  // element. Then the branches disagree about which node sits here, never
  // about whether one does, so the position is real and its count known:
  // mark it unresolved in place and keep the surrounding structure.
  //
  // Any other arm makes the count variable and the position uninventable —
  // `{cond ? <Icon/> : null}` renders ZERO OR ONE, a very common idiom, and
  // `{cond ? <A/> : <><X/><Y/></>}` renders many. Claiming a definite position
  // for those shifts every following sibling by one whenever the empty arm is
  // taken, which is the invented structure `VARIABLE_COUNT` exists to refuse.
  // A text arm renders no STRUCTURAL child at all, so it falls here too.
  if (ts.isConditionalExpression(unwrapped)) {
    const bothJsx =
      isJsxElementLike(ts, unwrapParens(ts, unwrapped.whenTrue)) &&
      isJsxElementLike(ts, unwrapParens(ts, unwrapped.whenFalse))
    return bothJsx ? { kind: "unresolved" } : VARIABLE_COUNT
  }

  // `cond && <X/>` renders ZERO OR ONE node, so the parent's child count is
  // not knowable. Nothing can be aligned positionally around it, so the whole
  // child list is withheld rather than a position invented for something that
  // may not render at all.
  if (isLogicalConditional(ts, unwrapped)) return VARIABLE_COUNT

  if (ts.isJsxFragment(unwrapped)) {
    declineRef.reason = declineRef.reason || "fragment"
    return null
  }

  if (isJsxElementLike(ts, unwrapped))
    return buildNode(ts, unwrapped, declineRef)

  if (ts.isCallExpression(unwrapped)) {
    const callee = unwrapped.expression
    // `.map(...)` renders zero-to-many nodes — the same unknowable count as a
    // logical conditional, for the same reason (issue #165).
    if (ts.isPropertyAccessExpression(callee) && callee.name.text === "map")
      return VARIABLE_COUNT
    return { kind: "unknown" } // some other call — content-only, doesn't affect structure
  }

  if (ts.isIdentifier(unwrapped))
    return { kind: "expression", prop: unwrapped.text }

  if (
    ts.isStringLiteral(unwrapped) ||
    ts.isNoSubstitutionTemplateLiteral(unwrapped)
  )
    return { kind: "text", value: unwrapped.text }

  return { kind: "unknown" }
}

function buildChildren(ts, children, declineRef) {
  const out = []
  let variableCount = false
  for (const child of children) {
    if (declineRef.reason) return { nodes: out, variableCount }

    if (ts.isJsxText(child)) {
      const normalized = normalizeJsxWhitespace(child.text)
      if (normalized !== "") out.push({ kind: "text", value: normalized })
      continue
    }

    if (isJsxElementLike(ts, child)) {
      const built = buildNode(ts, child, declineRef)
      if (built) out.push(built)
      continue
    }

    if (ts.isJsxFragment(child)) {
      declineRef.reason = declineRef.reason || "fragment"
      return { nodes: out, variableCount }
    }

    if (ts.isJsxExpression(child)) {
      const node = classifyExpressionChild(ts, child, declineRef)
      if (node === VARIABLE_COUNT) {
        variableCount = true
        continue
      }
      if (node) out.push(node)
      continue
    }
    // Anything else (a stray comment token, etc.) carries nothing — skip.
  }
  return { nodes: out, variableCount }
}

// A JSX tag name is an Identifier, a dotted PropertyAccessExpression
// (`Foo.Bar`), or a namespaced name (`svg:foo`) — read structurally rather
// than via `.getText()`, which needs source-text access this walker has no
// other reason to depend on.
function tagNameText(ts, tagNameNode) {
  if (ts.isIdentifier(tagNameNode)) return tagNameNode.text
  if (ts.isPropertyAccessExpression(tagNameNode))
    return `${tagNameText(ts, tagNameNode.expression)}.${tagNameNode.name.text}`
  if (ts.isJsxNamespacedName?.(tagNameNode))
    return `${tagNameNode.namespace.text}:${tagNameNode.name.text}`
  return "unknown"
}

// A returned expression that renders NOTHING — `return null`, `return
// undefined`, or a bare `return;`. Such a branch contributes no structure, so
// it is not a competing tree and must not be counted as one (issue #156).
// Counting it was the reason an early-return guard clause — the single most
// common multi-return shape in real components — declined a component whose
// markup is otherwise completely unambiguous.
function rendersNothing(ts, candidate) {
  if (candidate === undefined) return true // a bare `return;`
  const expr = unwrapParens(ts, candidate)
  if (!expr) return true
  return (
    expr.kind === ts.SyntaxKind.NullKeyword ||
    (ts.isIdentifier(expr) && expr.text === "undefined")
  )
}

// The root tag of a returned branch, or null when the branch is not a plain
// JSX element (a ternary, a call, a fragment) and therefore has no single root
// this can name.
function rootTagOf(ts, candidate) {
  const expr = unwrapParens(ts, candidate)
  if (!isJsxElementLike(ts, expr)) return null
  return tagNameText(
    ts,
    ts.isJsxSelfClosingElement(expr)
      ? expr.tagName
      : expr.openingElement.tagName,
  )
}

// How a genuinely multi-tree component is handled (issue #156). Three answers:
//
//   "intersectable" — every branch resolves to a plain JSX root and they are
//     ALL the same element. A common structure exists, so the branches are
//     intersected and only what is invariant across them is asserted.
//   "divergent-roots" — every branch has a plain root but they DIFFER, so no
//     common structure exists. `button` returning a `Link` or a `button`
//     depending on `href` is the canonical case, and no resolver change fixes
//     it — only a variant-keyed contract, which the carried `branches` are
//     matched against (ADR-002 D5).
//   "multiple-returns" — some branch has no nameable root (a ternary, a call).
//     Neither claim can be made about it, so the weaker, older reason stands.
function classifyMultiTree(ts, candidates) {
  const roots = candidates.map(candidate => rootTagOf(ts, candidate))
  if (roots.some(root => root === null)) return "multiple-returns"
  return new Set(roots).size > 1 ? "divergent-roots" : "intersectable"
}

// The intersection of two structural trees: what BOTH branches agree on, with
// every disagreement replaced by `{kind: "unresolved"}` rather than a guess
// (issue #156, stage 2). `unresolvedAt` collects the positions that diverged,
// so `modules/anatomy.mjs` can state what it did not compare — a partial
// comparison that reads as a complete one is the exact false-finding class
// this module exists to avoid, so the reporting is not optional.
//
// THE DANGEROUS CASE, handled deliberately: children lists of DIFFERENT
// lengths. Aligning them positionally would synthesize a tree matching
// NEITHER branch — inventing structure. So the whole children list is marked
// unresolved instead, via `childrenResolved: false`. Lossier and honest beats
// tidier and wrong.
function intersectNodes(a, b) {
  const unresolved = () => ({ kind: "unresolved" })

  if (!a || !b || a.kind !== b.kind) return unresolved()

  if (a.kind === "text")
    return a.value === b.value ? { kind: "text", value: a.value } : unresolved()
  if (a.kind === "expression")
    return a.prop === b.prop
      ? { kind: "expression", prop: a.prop }
      : unresolved()
  if (a.kind === "unknown") return { kind: "unknown" }

  if (a.kind === "element" && a.tag !== b.tag) return unresolved()
  if (a.kind === "component" && a.name !== b.name) return unresolved()

  const node =
    a.kind === "element"
      ? { kind: "element", tag: a.tag }
      : { kind: "component", name: a.name }

  // Attributes (issue #364) survive the fold only where every branch agrees:
  // same literal on both sides is kept; present on one side, or differing,
  // is `{unresolved: true}`; an unresolved SET on either side stays
  // unresolved — the same "carry the flag forward" rule `childrenResolved`
  // needs below, for the same reason.
  if (a.kind === "element") {
    const names = new Set([
      ...Object.keys(a.attributes || {}),
      ...Object.keys(b.attributes || {}),
    ])
    if (names.size > 0) {
      node.attributes = {}
      for (const name of [...names].sort()) {
        const av = a.attributes?.[name]
        const bv = b.attributes?.[name]
        node.attributes[name] =
          typeof av === "string" && av === bv ? av : { unresolved: true }
      }
    }
    if (a.attributesResolved === false || b.attributesResolved === false)
      node.attributesResolved = false
  }

  const aChildren = a.children || []
  const bChildren = b.children || []
  // `childrenResolved: false` must SURVIVE the fold across three or more
  // branches. Each call builds a fresh node, so without carrying the flag
  // forward a first fold could set it and a second could silently drop it —
  // comparing two already-emptied lists, finding the lengths equal, and
  // emitting `children: []` with no flag. A checker then reads that as
  // "renders nothing" and reports every declared child missing, which is the
  // precise false finding this whole path exists to prevent.
  if (
    a.childrenResolved === false ||
    b.childrenResolved === false ||
    aChildren.length !== bChildren.length
  ) {
    node.children = []
    node.childrenResolved = false
    return node
  }

  node.children = aChildren.map((child, index) =>
    intersectNodes(child, bChildren[index]),
  )
  return node
}

// The literal a JSX attribute initializer carries, or `{unresolved: true}`.
function literalAttributeValue(ts, initializer) {
  if (initializer === undefined) return "true" // bare `disabled`
  if (ts.isStringLiteral(initializer)) return initializer.text
  if (ts.isJsxExpression(initializer) && initializer.expression) {
    const expr = initializer.expression
    if (ts.isStringLiteral(expr) || ts.isNoSubstitutionTemplateLiteral(expr))
      return expr.text
    if (expr.kind === ts.SyntaxKind.TrueKeyword) return "true"
    if (expr.kind === ts.SyntaxKind.FalseKeyword) return "false"
    if (ts.isNumericLiteral(expr)) return expr.text
  }
  return { unresolved: true }
}

function buildNode(ts, node, declineRef) {
  if (declineRef.reason) return null

  const isSelfClosing = ts.isJsxSelfClosingElement(node)
  const tagNameNode = isSelfClosing ? node.tagName : node.openingElement.tagName
  const tagText = tagNameText(ts, tagNameNode)
  const isComponent = /^[A-Z]/.test(tagText) || tagText.includes(".")

  const { nodes: children, variableCount } = isSelfClosing
    ? { nodes: [], variableCount: false }
    : buildChildren(ts, node.children, declineRef)
  if (declineRef.reason) return null

  const built = isComponent
    ? { kind: "component", name: tagText, children }
    : { kind: "element", tag: tagText, children }

  // DOM attributes (issue #364) — on ELEMENTS only; a component's props are
  // its own contract's business. A literal value is recorded as written; a
  // bare attribute (`<input disabled />`) is `"true"`, which is what the
  // framework passes; anything computed is `{unresolved: true}` — the
  // attribute exists, its value is not this layer's to guess. A spread
  // (`{...rest}`) makes the whole SET unknowable: any attribute at all may
  // arrive through it, so `attributesResolved: false` says the absence of
  // one here means nothing.
  if (!isComponent) {
    const attributes = {}
    let attributesResolved = true
    const opening = isSelfClosing ? node : node.openingElement
    for (const attr of opening.attributes.properties) {
      if (ts.isJsxSpreadAttribute(attr)) {
        attributesResolved = false
        continue
      }
      if (!ts.isJsxAttribute(attr)) continue
      const name = ts.isJsxNamespacedName?.(attr.name)
        ? `${attr.name.namespace.text}:${attr.name.name.text}`
        : attr.name.text
      attributes[name] = literalAttributeValue(ts, attr.initializer)
    }
    if (Object.keys(attributes).length > 0) built.attributes = attributes
    if (!attributesResolved) built.attributesResolved = false
  }

  // A child of unknowable count makes every sibling position meaningless to
  // compare — the resolved siblings are dropped ALONG WITH it, exactly as the
  // multi-branch intersection drops a whole child list whose lengths differ.
  // Keeping the ones before it would invent an alignment that holds only when
  // the variable region happens to render nothing.
  if (variableCount) {
    built.children = []
    built.childrenResolved = false
  }
  return built
}

// ---------------------------------------------------------------------------
// 3. One component.
// ---------------------------------------------------------------------------

// Every position in a BUILT tree that the walker declined to name, in source
// order — derived from the tree itself rather than collected during the walk.
//
// One post-pass serves both producers (the multi-branch intersection and the
// variable-subtree walk), so their reporting cannot drift apart, and each node
// is visited once, which is what makes the list naturally duplicate-free.
// A withheld child list stops the descent: nothing below it is known, so
// naming positions inside it would invent detail.
function collectUnresolvedPaths(node, path = "root", out = []) {
  if (!node) return out
  if (node.kind === "unresolved") {
    out.push(path)
    return out
  }
  if (node.childrenResolved === false) {
    out.push(`${path} children`)
    return out
  }
  for (const [index, child] of (node.children || []).entries())
    collectUnresolvedPaths(child, `${path} > ${index}`, out)
  return out
}

function resolvedResult(file, root) {
  // Derived from the tree, so a producer cannot forget to report what it
  // withheld — that reporting is what makes a partial answer honest. Present
  // ONLY when something actually went unnamed: a tree with nothing withheld is
  // a complete answer, and flagging it would make `modules/anatomy.mjs` hedge
  // on structure it can fully trust.
  const unresolvedAt = collectUnresolvedPaths(root)
  return {
    ok: true,
    component: {
      file,
      resolvable: true,
      root,
      ...(unresolvedAt.length > 0 ? { partial: true, unresolvedAt } : {}),
    },
    diagnostics: [],
  }
}

// `extra` carries the DIVERGENT-ROOTS branch trees (ADR-002 D5) and nothing
// else today — a decline stays a decline, with the same reason it always had.
function declinedResult(file, reason, extra) {
  return {
    ok: true,
    component: { file, resolvable: false, reason, ...extra },
    diagnostics: [],
  }
}

function failedResult(code, file, message) {
  return { ok: false, component: null, diagnostics: [{ code, file, message }] }
}

// Resolve ONE returned branch to a structural tree, or to the reason it could
// not be. Shared by the single-return path and by each branch of a multi-tree
// component, so both apply identical rules — a branch is not held to a weaker
// standard just because it has siblings.
//
// @returns {{root: object}|{reason: string}}
function resolveBranch(ts, candidate) {
  const expr = unwrapParens(ts, candidate)

  if (ts.isConditionalExpression(expr) || isLogicalConditional(ts, expr))
    return { reason: "conditional-render" }
  if (ts.isJsxFragment(expr)) return { reason: "fragment" }
  if (!isJsxElementLike(ts, expr)) return { reason: "unsupported-shape" }

  const declineRef = { reason: null }
  const root = buildNode(ts, expr, declineRef)
  if (declineRef.reason) return { reason: declineRef.reason }
  return { root }
}

// Every rendering branch resolved to its own tree, in source order — or the
// FIRST branch reason that stopped one from resolving. All-or-nothing on
// purpose: a branch is not held to a weaker standard for having siblings, and
// a list holding only the branches that happened to resolve would read as the
// component's whole set of branches.
//
// @returns {{trees: object[]}|{reason: string}}
function resolveBranches(ts, candidates) {
  const trees = []
  for (const candidate of candidates) {
    const branch = resolveBranch(ts, candidate)
    if (branch.reason) return { reason: branch.reason }
    trees.push(branch.root)
  }
  return { trees }
}

/**
 * Census one component's rendered JSX. Never throws — see the module
 * docblock's census shape.
 *
 * @param {string} filePath path to a component's `.tsx` file
 * @param {object} [options]
 * @param {object} [options.ts] an already-loaded `typescript` module,
 *   injectable so tests can supply their own (or omit to exercise the
 *   "not installed" path)
 * @param {string} [options.tsModuleName] module name to lazily require when
 *   `ts` is not given (default `"typescript"`)
 * @param {{existsSync: Function}} [options.fs] injectable fs for this
 *   module's own existence check (default real `node:fs`)
 * @param {string} [options.label] what to call this file in the returned
 *   census/diagnostics — defaults to `filePath`
 * @returns {{ok: boolean, component: object|null, diagnostics: object[]}}
 */
export function extractJsxComponent(
  filePath,
  { ts: injectedTs, tsModuleName, fs = defaultFs, label } = {},
) {
  const file = label || filePath
  const ts = injectedTs || loadTypeScript(tsModuleName)

  if (!ts)
    return failedResult(
      "typescript-not-installed",
      file,
      TYPESCRIPT_MISSING_MESSAGE,
    )

  if (!fs.existsSync(filePath))
    return failedResult(
      "missing-component-file",
      file,
      `no component file at ${file}`,
    )

  let program
  let sourceFile
  try {
    program = ts.createProgram([filePath], compilerOptions(ts))
    sourceFile = program.getSourceFile(filePath)
  } catch (err) {
    return failedResult(
      "typescript-error",
      file,
      `TypeScript could not process ${file}: ${err.message}`,
    )
  }

  if (!sourceFile)
    return failedResult(
      "missing-source-file",
      file,
      `TypeScript could not load ${file}`,
    )

  const fn = findComponentFunction(ts, sourceFile)
  if (!fn)
    // Worded IDENTICALLY to `extract.mjs`'s own `no-component-found` (issue
    // #155). Both phases parse the same file and reach this same conclusion
    // independently, so a consumer saw one fact reported twice, in two
    // different sentences. `core/findings.mjs`'s `dedupeDiagnostics` collapses
    // them at the point the phases meet — but only when the whole triple
    // matches, so the wording agreeing is what makes that collapse happen. The
    // two modules stay deliberately parallel rather than sharing a constant
    // (see this file's docblock); `__tests__/sources-react-parity.test.js`
    // pins the agreement instead, so drift fails a test rather than silently
    // resurrecting the duplicate.
    return failedResult(
      "no-component-found",
      file,
      `no exported component is declared in ${file}`,
    )

  const candidates = findReturnedCandidates(ts, fn)
  if (candidates.length === 0) return declinedResult(file, "no-jsx-returned")

  // Branches that render nothing are dropped BEFORE counting, so an early
  // `return null` guard no longer makes an otherwise unambiguous component
  // look like it has two competing trees (issue #156).
  const rendering = candidates.filter(
    candidate => !rendersNothing(ts, candidate),
  )
  if (rendering.length === 0) return declinedResult(file, "no-jsx-returned")
  if (rendering.length > 1) {
    const kind = classifyMultiTree(ts, rendering)

    // The roots DIFFER, so there is still no single tree to hand
    // `modules/anatomy.mjs` and the decline stands unchanged. The candidate
    // trees are carried alongside it rather than discarded (ADR-002 D5): they
    // are the only record of what this component renders, and a variant-keyed
    // contract is matched against them structurally in a later step. When a
    // branch cannot be resolved on its own, NOTHING is carried — see
    // `resolveBranches` — since a partial list would read as the whole set.
    if (kind === "divergent-roots") {
      const resolved = resolveBranches(ts, rendering)
      return declinedResult(
        file,
        kind,
        resolved.trees ? { branches: resolved.trees } : undefined,
      )
    }

    if (kind !== "intersectable") return declinedResult(file, kind)

    // Every branch shares a root, so a common structure exists. Resolve each
    // independently — a branch that itself declines (a `.map()` inside it, a
    // nested Fragment) declines the whole component, exactly as a single
    // return would, since nothing is gained by intersecting a tree this
    // module could not resolve in the first place.
    const resolved = resolveBranches(ts, rendering)
    if (resolved.reason) return declinedResult(file, resolved.reason)

    const root = resolved.trees.reduce((acc, tree) => intersectNodes(acc, tree))
    return resolvedResult(file, root)
  }

  const only = resolveBranch(ts, rendering[0])
  if (only.reason) return declinedResult(file, only.reason)
  return resolvedResult(file, only.root)
}

// ---------------------------------------------------------------------------
// 4. Every component.
// ---------------------------------------------------------------------------

/**
 * Census every component in `files`. A single bad file never aborts the set
 * (same rule `extract.mjs`'s `extractComponents` follows). A missing
 * `typescript` install is reported once via `skipped: true`, exactly as
 * `extractComponents` does — nothing in the set could extract, so nothing is
 * worth a per-file diagnostic.
 *
 * @param {string[]} files paths to component `.tsx` files
 * @param {object} [options]
 * @param {object} [options.ts]
 * @param {string} [options.tsModuleName]
 * @param {{existsSync: Function}} [options.fs]
 * @param {string} [options.root] when given, each component's `file` label is
 *   made relative to this and POSIX-normalized
 * @param {{start?: Function, update?: Function, done?: Function, skip?: Function}} [options.onProgress]
 * @returns {{ok: boolean, skipped: boolean, components: object[], diagnostics: object[]}}
 */
export function extractJsxComponents(
  files,
  { ts: injectedTs, tsModuleName, fs = defaultFs, root, onProgress } = {},
) {
  const ts = injectedTs || loadTypeScript(tsModuleName)
  if (!ts) {
    onProgress?.skip?.("anatomy", TYPESCRIPT_MISSING_MESSAGE)
    return {
      ok: false,
      skipped: true,
      components: [],
      diagnostics: [
        {
          code: "typescript-not-installed",
          message: TYPESCRIPT_MISSING_MESSAGE,
        },
      ],
    }
  }

  const sorted = [...files].sort(compareStrings)
  onProgress?.start?.("anatomy", `censusing ${sorted.length} file(s)`)

  const components = []
  const diagnostics = []
  for (const file of sorted) {
    const label = root ? toPosixRelative(root, file) : file
    onProgress?.update?.("anatomy", label)
    const result = extractJsxComponent(file, { ts, fs, label })
    diagnostics.push(...result.diagnostics)
    if (result.ok) components.push(result.component)
  }

  components.sort((a, b) => compareStrings(a.file, b.file))

  if (diagnostics.length > 0)
    onProgress?.skip?.("anatomy", `${diagnostics.length} diagnostic(s)`)
  else onProgress?.done?.("anatomy", `${components.length} component(s)`)

  return {
    ok: diagnostics.length === 0,
    skipped: false,
    components,
    diagnostics,
  }
}
