/**
 * contracts.mjs — the SPEC side of the engine (ADR-001 D1/D2/D13, Phase 1): load a
 * project's component contracts off disk, validate them, and expose the one
 * reduced view the checkers consume. The contract is the fixed point every
 * check compares against (D1), so this module is the gate everything
 * downstream stands on: a contract that loads here is one the props/API
 * checker, the style checker and the codegen may treat as true.
 *
 * Three responsibilities, in order:
 *
 *   1. PARSE — `*.contract.json`. JSON is the only accepted serialization
 *      (D2, tightened 2026-07-31): `_`-prefixed keys carry the reasoning
 *      authoring reasoning). Both extensions parse to the same shape, and a
 *      contract authored either way validates identically.
 *   2. VALIDATE — `schema/contract.schema.json` first, then the SEMANTIC
 *      rules JSON Schema structurally cannot express, because every one of
 *      them is a cross-reference between two parts of the same document:
 *      `styles` naming an element `anatomy` never declared, a `children`
 *      entry with no node behind it, a cycle in the anatomy tree, a
 *      `{$prop: …}` binding or a `presentIf` naming a prop that isn't
 *      declared, an enum prop whose `default` isn't one of its own `values`,
 *      a style variant's `when` naming an undeclared prop or an out-of-set
 *      value, an `instanceOf: "#/subcomponents/X"` pointing at nothing, two
 *      `anatomy.$variants` entries claiming the same root element, and a
 *      duplicate `id` across the set. A schema can say each piece is
 *      well-formed; only this can say they agree with each other.
 *   3. REDUCE — `contractApiView` hands the props/API checker a small, stable
 *      prop map and nothing else. It is deliberately narrow: it is the
 *      boundary the checkers depend on, so it should change rarely.
 *
 * NEVER THROWS on bad input. A missing file, malformed JSON, a
 * non-object document, a schema violation and a semantic violation all
 * degrade to `{ok: false, …, diagnostics}` — the same honest-degradation rule
 * `sources/code.mjs` follows, and for the same reason: the CALLER decides what
 * a failed load means for the run. In `loadContracts` one bad file never
 * aborts the set; it contributes diagnostics and every other contract still
 * loads, so `design-delta contracts` reports every problem in one pass rather
 * than a fix-one-rerun-repeat loop.
 *
 * `spec/` may import `core/` + node builtins + external packages and NOTHING
 * else internal (`__tests__/layering.test.js` enforces this) — never
 * `sources/`, `modules/`, or `src/lib/` (v1).
 *
 * Determinism (the working-method gate, ADR-001): every directory walk sorts
 * its entries before recursing, contracts sort by `id` (natural, via
 * `core/findings.mjs`'s `compareEntities`) then by file, and diagnostics sort
 * by file → path → code → message. No wall clock, no randomness, and nothing
 * anywhere depends on filesystem iteration order, which Node does not
 * guarantee.
 *
 * `^_` COMMENT KEYS: the schema permits them at every level (they carry the
 * authoring reasoning v1 kept in YAML `#` comments). They are validated as
 * part of the document but STRIPPED from the returned contract — a comment is
 * an authoring note, never data a checker should ever see. Stripping before
 * validation would instead hide a typo'd real key behind a leading underscore.
 *
 * `$` SIGIL KEYS: the second reserved prefix, and the mirror image of the
 * first. `anatomy.$variants` (ADR-002 D2) is the only one, and unlike a
 * comment it must SURVIVE loading, because a later stage reads it. Both
 * prefixes are safe inside a map of node names because the schema constrains a
 * node name to `^[A-Za-z][A-Za-z0-9]*$` — so this module's semantic rules
 * enumerate anatomy NODES (`anatomyNodes`), never raw keys. Not being a node
 * does not make `$variants` unchecked: the nodes INSIDE it get the same
 * per-node rules the base map gets, one path prefix apart (issue #430).
 */

import { existsSync, readFileSync, readdirSync } from "node:fs"
import { dirname, isAbsolute, join } from "node:path"
import { fileURLToPath } from "node:url"

import Ajv from "ajv/dist/2020.js"
import addFormats from "ajv-formats"

import {
  resolveConventions,
  resolvePaths,
  renderPath,
} from "../core/config.mjs"
import { compareEntities } from "../core/findings.mjs"
import { toPosixRelative, collectFilesSorted } from "../core/paths.mjs"
import { compareStrings } from "../core/text.mjs"

// ---------------------------------------------------------------------------
// Schema location + compilation
// ---------------------------------------------------------------------------

// Resolved from THIS module's own real location (src/spec/contracts.mjs),
// never from the project being audited — for a consumer this file lives only
// under node_modules/design-delta/, exactly as `core/config.mjs`
// and v1's `validate-component-specs.mjs` resolve their package-anchored
// schema paths. A bare relative default would only ever resolve when the
// audited project happened to BE this package's own repo.
const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..")

/** Absolute path to the shipped contract schema, openable from any cwd. */
export const CONTRACT_SCHEMA_FILE = join(
  PACKAGE_ROOT,
  "schema",
  "contract.schema.json",
)

const CONTRACT_SCHEMA = JSON.parse(readFileSync(CONTRACT_SCHEMA_FILE, "utf8"))

/**
 * The contract-schema version this engine reads (issue #365) — the schema's
 * own top-level `version`, so there is exactly one place it lives. An
 * integer, not semver: this package is `0.x` and promises no compatibility,
 * so the honest model is a count of BREAKING schema changes. It bumps only
 * when a field is removed, renamed, re-typed, or made required; an additive
 * optional field never bumps it, because an older contract still validates.
 */
export const CONTRACT_SCHEMA_VERSION = CONTRACT_SCHEMA.version

// `allErrors` so one bad contract reports every problem in a single load;
// `verbose` so each ajv error carries `parentSchema`/`schema`/`params`, which
// is what lets `humanizeError` name the allowed keys straight from the schema
// node that rejected the value — no hand-authored error annotations to keep in
// sync (v1's approach), so the schema reads as plain JSON Schema on its own.
const ajv = new Ajv({ allErrors: true, verbose: true, strict: false })
addFormats(ajv)
const runContractSchema = ajv.compile(CONTRACT_SCHEMA)

// The real filesystem, used unless a caller injects one.
const defaultFs = { existsSync, readFileSync, readdirSync }

const isPlainObject = value =>
  value != null && typeof value === "object" && !Array.isArray(value)

// ---------------------------------------------------------------------------
// Diagnostics — ONE shape, matching `sources/code.mjs`'s established contract:
// a stable machine `code`, a human `message`, plus the locators a reader needs
// to find the problem (`file`, the in-document `path`, and `contractId` once
// the document has parsed far enough to have one).
// ---------------------------------------------------------------------------

function compareDiagnostics(a, b) {
  return (
    compareStrings(a.file || "", b.file || "") ||
    compareEntities(a.path || "", b.path || "") ||
    compareStrings(a.code, b.code) ||
    compareStrings(a.message, b.message)
  )
}

// Every diagnostic serializes with its keys in ONE order regardless of which
// check produced it — a parse failure, a schema violation and a semantic
// violation are all the same kind of thing to a reader, and `--json` output
// that shuffled key order per diagnostic kind would be needlessly hard to
// diff. Absent keys are omitted rather than set to `undefined`, the same
// JSON-stability convention `core/findings.mjs`'s `makeFinding` follows.
const DIAGNOSTIC_KEY_ORDER = ["code", "file", "contractId", "path", "message"]

function normalizeDiagnostic(diagnostic) {
  const out = {}
  for (const key of DIAGNOSTIC_KEY_ORDER) {
    if (diagnostic[key] !== undefined) out[key] = diagnostic[key]
  }
  for (const key of Object.keys(diagnostic).sort()) {
    if (!(key in out) && diagnostic[key] !== undefined)
      out[key] = diagnostic[key]
  }
  return out
}

function sortDiagnostics(diagnostics) {
  return diagnostics.map(normalizeDiagnostic).sort(compareDiagnostics)
}

// ---------------------------------------------------------------------------
// ajv error -> one human-readable diagnostic message
//
// A deliberately independent copy of `core/config.mjs`'s humanizer rather than
// an import: that one is private there (it is part of how `loadConfig` throws,
// not an exported service), and the two humanize different vocabularies — this
// one has to explain the contract schema's `if/then/else` and `not` branches,
// which the config schema has none of. Same shape of output, different rules.
// ---------------------------------------------------------------------------

// Sub-errors from inside a FAILING oneOf/anyOf branch describe the branch, not
// the value itself (ajv emits "must match exactly one schema in oneOf"
// alongside every branch's own rejection); and an `if` keyword error only
// reports which conditional branch was selected, which the branch's own error
// already says in plain terms. Both are noise on top of a real message.
function isBranchNoise(error) {
  return (
    /\/(oneOf|anyOf)\/\d+\//.test(error.schemaPath) || error.keyword === "if"
  )
}

function humanizeError(error) {
  const path = renderPath(error.instancePath) || "contract"

  if (error.keyword === "additionalProperties") {
    const allowed = Object.keys(error.parentSchema?.properties || {})
      .sort()
      .join(", ")
    return `unknown key '${error.params.additionalProperty}' in ${path}${
      allowed ? ` — allowed: ${allowed}` : ""
    }`
  }

  if (error.keyword === "enum" || error.keyword === "const") {
    const allowed =
      error.keyword === "const"
        ? String(error.params.allowedValue)
        : (error.params.allowedValues || []).join(", ")
    return `${path} must be one of: ${allowed}`
  }

  if (error.keyword === "required") {
    return `${path} is missing required property '${error.params.missingProperty}'`
  }

  // The schema's one `if/then/else` pair: `values` is required for
  // `type: enum` and forbidden otherwise. The `else` branch rejects via
  // `not: {required: [...]}`, whose raw ajv message ("must NOT be valid") says
  // nothing at all — name the offending key instead.
  if (error.keyword === "not" && Array.isArray(error.schema?.required)) {
    const forbidden = error.schema.required.map(key => `'${key}'`).join(", ")
    return `${path} must not declare ${forbidden} here`
  }

  if (error.keyword === "propertyNames") {
    return `${path} has an invalid key: ${error.message}`
  }

  return `${path} ${error.message}`
}

function schemaDiagnostics(errors, { file, contractId }) {
  const relevant = (errors || []).filter(error => !isBranchNoise(error))
  const out = []
  const seen = new Set()
  for (const error of relevant) {
    const message = humanizeError(error)
    if (seen.has(message)) continue
    seen.add(message)
    out.push({
      code: "schema-violation",
      file,
      ...(contractId ? { contractId } : {}),
      path: renderPath(error.instancePath),
      message,
    })
  }
  return out
}

// ---------------------------------------------------------------------------
// Semantic validation — the cross-references JSON Schema cannot express.
//
// Every rule below relates one part of the document to another part of the
// SAME document. A schema can only say "this is a string"; only this can say
// "…and there is an element by that name".
// ---------------------------------------------------------------------------

// Walk the anatomy from `root`, following `children`, and report every node
// the walk never reaches. Safe against cycles (the visited set stops them), so
// this runs independently of the cycle check.
function unreachableNodes(anatomy) {
  const visited = new Set()
  const queue = ["root"]
  while (queue.length > 0) {
    const name = queue.shift()
    if (visited.has(name)) continue
    if (!Object.prototype.hasOwnProperty.call(anatomy, name)) continue
    visited.add(name)
    const node = anatomy[name]
    const children = Array.isArray(node?.children) ? node.children : []
    for (const child of children) queue.push(child)
  }
  return Object.keys(anatomy)
    .filter(name => !visited.has(name))
    .sort(compareEntities)
}

// Rotate a cycle so it always starts at its alphabetically-smallest node —
// the same loop discovered from two different entry points is ONE cycle, and
// reporting it twice would be noise.
function canonicalCycle(cycle) {
  let best = 0
  for (let i = 1; i < cycle.length; i++) {
    if (compareStrings(cycle[i], cycle[best]) < 0) best = i
  }
  return [...cycle.slice(best), ...cycle.slice(0, best)]
}

// Depth-first search with the classic three colors: a back edge to a node
// still on the stack (grey) IS a cycle. Nodes are visited in sorted order so
// the reported cycle is the same on every run and every machine.
function findCycles(anatomy) {
  const state = new Map() // name -> "grey" | "black"
  const stack = []
  const found = new Map() // canonical key -> cycle path

  function visit(name) {
    if (!Object.prototype.hasOwnProperty.call(anatomy, name)) return
    if (state.get(name) === "black") return
    if (state.get(name) === "grey") {
      const start = stack.indexOf(name)
      const cycle = canonicalCycle(stack.slice(start))
      found.set(cycle.join(" -> "), cycle)
      return
    }
    state.set(name, "grey")
    stack.push(name)
    const children = Array.isArray(anatomy[name]?.children)
      ? [...anatomy[name].children].sort(compareEntities)
      : []
    for (const child of children) visit(child)
    stack.pop()
    state.set(name, "black")
  }

  for (const name of Object.keys(anatomy).sort(compareEntities)) visit(name)

  return [...found.keys()].sort(compareStrings).map(key => found.get(key))
}

const SUBCOMPONENT_POINTER = "#/subcomponents/"

// `anatomy` is a map of node NAMES plus two reserved sigils, neither of which
// is a node: `^_` comment keys, and `$`-prefixed keys — of which `$variants`
// (ADR-002 D2) is the only one the schema admits. A node name is constrained
// to `^[A-Za-z][A-Za-z0-9]*$`, so no sigil key can ever collide with one,
// which is the whole reason the ADR chose a sigil over a plain key.
export const ANATOMY_VARIANTS_KEY = "$variants"

/** `anatomy` with its sigil keys removed — the plain node map, nothing else. */
export function anatomyNodes(anatomy) {
  const nodes = {}
  for (const key of Object.keys(anatomy)) {
    if (key.startsWith("$")) continue
    nodes[key] = anatomy[key]
  }
  return nodes
}

/**
 * One variant's node map: everything it declares EXCEPT `when`, which is a
 * human note and never a node (ADR-002 D4), and its `^_` comment keys. The
 * schema already forbids a node named `when`, so dropping it here cannot hide
 * a real node.
 */
function variantNodes(variant) {
  const nodes = {}
  if (!isPlainObject(variant)) return nodes
  for (const key of Object.keys(variant)) {
    if (key === "when" || key.startsWith("_")) continue
    nodes[key] = variant[key]
  }
  return nodes
}

/**
 * The rules that relate ONE anatomy node to the rest of the document. Run over
 * the base node map, then once per `$variants` entry: a variant is a partial
 * override (ADR-002 D3), so it resolves to its own full node set and every
 * node it declares answers to exactly the same rules, with the same codes.
 *
 * `pathAt` renders a diagnostic path from a suffix relative to the node map,
 * so a variant's diagnostics name the variant
 * (`anatomy.$variants.asLink.root.children[1]`) rather than a base-anatomy
 * path that has no such node.
 *
 * `resolvedNames` is the UNION of base and every variant's nodes: a node any
 * branch renders is a node that can legitimately be parented.
 */
function checkAnatomyNodes(
  nodes,
  {
    pathAt,
    resolvedNames,
    knownNodes,
    propNames,
    knownProps,
    subcomponentNames,
    push,
  },
) {
  for (const name of Object.keys(nodes).sort(compareEntities)) {
    const node = nodes[name]
    if (!isPlainObject(node)) continue

    const children = Array.isArray(node.children) ? node.children : []
    children.forEach((child, index) => {
      if (resolvedNames.has(child)) return
      push({
        code: "unknown-anatomy-child",
        path: pathAt(`${name}.children[${index}]`),
        message: `anatomy node "${name}" lists child "${child}", which is not declared in anatomy${
          knownNodes ? ` (declared: ${knownNodes})` : ""
        }`,
      })
    })

    if (isPlainObject(node.content) && typeof node.content.$prop === "string") {
      const bound = node.content.$prop
      if (!propNames.has(bound)) {
        push({
          code: "unknown-content-prop",
          path: pathAt(`${name}.content.$prop`),
          message: `anatomy node "${name}" binds its content to prop "${bound}", which is not declared in props${
            knownProps ? ` (declared: ${knownProps})` : ""
          }`,
        })
      }
    }

    if (typeof node.presentIf === "string" && !propNames.has(node.presentIf)) {
      push({
        code: "unknown-present-if-prop",
        path: pathAt(`${name}.presentIf`),
        message: `anatomy node "${name}" is conditional on prop "${node.presentIf}", which is not declared in props${
          knownProps ? ` (declared: ${knownProps})` : ""
        }`,
      })
    }

    if (
      typeof node.instanceOf === "string" &&
      node.instanceOf.startsWith(SUBCOMPONENT_POINTER)
    ) {
      const target = node.instanceOf.slice(SUBCOMPONENT_POINTER.length)
      if (!subcomponentNames.has(target)) {
        const known = [...subcomponentNames].sort(compareEntities).join(", ")
        push({
          code: "unknown-subcomponent",
          path: pathAt(`${name}.instanceOf`),
          message: `anatomy node "${name}" instantiates "${node.instanceOf}", but no subcomponent "${target}" is declared${
            known ? ` (declared: ${known})` : ""
          }`,
        })
      }
    }
  }
}

/** `"a"`, `"a" and "b"`, `"a", "b" and "c"` — a readable list of names. */
function joinNames(names) {
  const quoted = names.map(name => `"${name}"`)
  if (quoted.length < 2) return quoted.join("")
  return `${quoted.slice(0, -1).join(", ")} and ${quoted[quoted.length - 1]}`
}

/**
 * The semantic rules for one component BODY — the contract itself, or one of
 * its `subcomponents`, which carry the same `props`/`anatomy`/`styles` shape
 * and therefore deserve the same scrutiny (a broken anatomy reference inside a
 * subcomponent is exactly as wrong as one at the top level).
 *
 * `prefix` is the in-document path the body sits at ("" for the contract,
 * "subcomponents.Header" for a subcomponent), so every diagnostic names the
 * exact location regardless of nesting depth.
 */
function checkComponentBody(body, { prefix, subcomponentNames, push }) {
  const at = suffix => (prefix ? `${prefix}.${suffix}` : suffix)

  const declared = isPlainObject(body.anatomy) ? body.anatomy : {}
  const anatomy = anatomyNodes(declared)
  const variants = isPlainObject(declared[ANATOMY_VARIANTS_KEY])
    ? declared[ANATOMY_VARIANTS_KEY]
    : {}
  const variantNames = Object.keys(variants)
    .filter(name => !name.startsWith("_"))
    .sort(compareEntities)
  const props = isPlainObject(body.props) ? body.props : {}
  const styles = isPlainObject(body.styles) ? body.styles : {}
  const anatomyNames = new Set(Object.keys(anatomy))
  const propNames = new Set(Object.keys(props))

  // Every node ANY branch renders (ADR-002 D3): the base tree plus each
  // variant's overrides. `children` and `styles` resolve against this union,
  // because a node only one branch renders is still a real node — styling it
  // or parenting it is legitimate, not a typo. The base-only set stays what
  // the tree-shaped rules (cycles, reachability, a missing `root`) walk: a
  // variant overrides a base tree, so with no base tree there is nothing to
  // walk.
  const nodesByVariant = new Map(
    variantNames.map(name => [name, variantNodes(variants[name])]),
  )
  const resolvedNames = new Set(anatomyNames)
  for (const nodes of nodesByVariant.values()) {
    for (const name of Object.keys(nodes)) resolvedNames.add(name)
  }

  const knownElements = [...anatomyNames].sort(compareEntities).join(", ")
  const knownNodes = [...resolvedNames].sort(compareEntities).join(", ")
  const knownProps = [...propNames].sort(compareEntities).join(", ")

  // --- styles keys name a declared element ---------------------------------
  for (const element of Object.keys(styles).sort(compareEntities)) {
    if (resolvedNames.has(element)) continue
    push({
      code: "unknown-style-element",
      path: at(`styles.${element}`),
      message: `styles declares element "${element}", which is not in anatomy${
        knownNodes ? ` (declared: ${knownNodes})` : " (anatomy is empty)"
      }`,
    })
  }

  // --- anatomy: children resolve, content/presentIf/instanceOf resolve ------
  // Base nodes first, then each variant's — same checks, same codes, one path
  // prefix apart (issue #430).
  const nodeContext = {
    resolvedNames,
    knownNodes,
    propNames,
    knownProps,
    subcomponentNames,
    push,
  }

  checkAnatomyNodes(anatomy, {
    ...nodeContext,
    pathAt: suffix => at(`anatomy.${suffix}`),
  })

  for (const variant of variantNames) {
    checkAnatomyNodes(nodesByVariant.get(variant), {
      ...nodeContext,
      pathAt: suffix =>
        at(`anatomy.${ANATOMY_VARIANTS_KEY}.${variant}.${suffix}`),
    })
  }

  // --- anatomy: acyclic, and every node reachable from `root` ---------------
  // A `$variants`-only anatomy still has to answer for a missing `root`: a
  // variant is a PARTIAL OVERRIDE (ADR-002 D3), so with no base tree there is
  // nothing for it to override.
  if (anatomyNames.size > 0 || variantNames.length > 0) {
    for (const cycle of findCycles(anatomy)) {
      push({
        code: "anatomy-cycle",
        path: at("anatomy"),
        message: `anatomy has a cycle: ${[...cycle, cycle[0]].join(" -> ")}`,
      })
    }

    if (!anatomyNames.has("root")) {
      push({
        code: "missing-anatomy-root",
        path: at("anatomy"),
        message: `anatomy has no "root" node, so no node is reachable${
          knownElements ? ` (declared: ${knownElements})` : ""
        }`,
      })
    } else {
      for (const orphan of unreachableNodes(anatomy)) {
        push({
          code: "unreachable-anatomy-node",
          path: at(`anatomy.${orphan}`),
          message: `anatomy node "${orphan}" is unreachable from "root" — no node lists it as a child`,
        })
      }
    }
  }

  // --- no two shapes can claim the same root element ------------------------
  // A variant is matched to a rendered branch STRUCTURALLY, by root element
  // (ADR-002 D4) — `when` is a note for a human reader, and this engine is
  // static, so nothing else is available to tell two shapes apart. Two
  // variants claiming the same element, or a variant claiming the BASE
  // anatomy's, leave the matcher no way to choose, so the contract is
  // rejected here rather than one of them silently winning — or, for the
  // base case, rather than the component declining later with a message that
  // reads as "unresolvable" instead of "ambiguous" (issue #442).
  const claimantsByElement = new Map()
  for (const name of variantNames) {
    const root = variants[name]?.root
    const element = isPlainObject(root) ? root.element : undefined
    if (typeof element !== "string") continue
    if (!claimantsByElement.has(element)) claimantsByElement.set(element, [])
    claimantsByElement.get(element).push(name)
  }
  for (const element of [...claimantsByElement.keys()].sort(compareStrings)) {
    const claimants = claimantsByElement.get(element)
    if (claimants.length < 2) continue
    push({
      code: "ambiguous-variant-root",
      path: at(`anatomy.${ANATOMY_VARIANTS_KEY}`),
      message: `anatomy variants ${joinNames(claimants)} declare the same root element "${element}" — variants are told apart by their root element, so nothing can say which rendered branch is which`,
    })
  }
  const baseRoot = anatomy.root
  const baseElement = isPlainObject(baseRoot) ? baseRoot.element : undefined
  if (typeof baseElement === "string") {
    for (const name of claimantsByElement.get(baseElement) ?? []) {
      push({
        code: "ambiguous-variant-root",
        path: at(`anatomy.${ANATOMY_VARIANTS_KEY}.${name}`),
        message: `anatomy variant "${name}" declares the base anatomy's root element "${baseElement}" — a variant is told apart from the base by its root element, so nothing can say which rendered branch is the base and which is "${name}"`,
      })
    }
  }

  // --- an enum prop's default is one of its own values ----------------------
  for (const name of Object.keys(props).sort(compareEntities)) {
    const prop = props[name]
    if (!isPlainObject(prop)) continue
    if (prop.type !== "enum" || !Array.isArray(prop.values)) continue
    // An explicit `null` default means "no default" (legitimate alongside
    // `nullable: true`), never a value that must appear in `values`.
    if (prop.default === undefined || prop.default === null) continue
    if (prop.values.includes(prop.default)) continue
    push({
      code: "invalid-prop-default",
      path: at(`props.${name}.default`),
      message: `prop "${name}" defaults to ${JSON.stringify(prop.default)}, which is not one of its values (${prop.values.map(v => JSON.stringify(v)).join(", ")})`,
    })
  }

  // --- a style variant's `when` names declared props and in-set values ------
  for (const element of Object.keys(styles).sort(compareEntities)) {
    const elementStyles = styles[element]
    if (!isPlainObject(elementStyles)) continue
    const variants = Array.isArray(elementStyles.variants)
      ? elementStyles.variants
      : []
    variants.forEach((variant, index) => {
      if (!isPlainObject(variant) || !isPlainObject(variant.when)) return
      for (const propName of Object.keys(variant.when).sort(compareEntities)) {
        const where = at(
          `styles.${element}.variants[${index}].when.${propName}`,
        )
        const prop = props[propName]
        if (!isPlainObject(prop)) {
          push({
            code: "unknown-variant-prop",
            path: where,
            message: `style variant for "${element}" applies when "${propName}" is ${JSON.stringify(variant.when[propName])}, but "${propName}" is not declared in props${
              knownProps ? ` (declared: ${knownProps})` : ""
            }`,
          })
          continue
        }
        // Membership is only decidable for an enum prop — a boolean, string or
        // number prop declares no value set to check against.
        if (prop.type !== "enum" || !Array.isArray(prop.values)) continue
        const value = variant.when[propName]
        if (prop.values.includes(value)) continue
        push({
          code: "invalid-variant-value",
          path: where,
          message: `style variant for "${element}" applies when "${propName}" is ${JSON.stringify(value)}, which is not one of that prop's values (${prop.values.map(v => JSON.stringify(v)).join(", ")})`,
        })
      }
    })
  }
}

/**
 * Every semantic diagnostic for one already-schema-valid contract. Pure; takes
 * a parsed object and returns a sorted list (empty when the contract is
 * internally consistent).
 *
 * @param {object} contract a contract that has already passed the JSON Schema
 * @param {{file?: string}} [context] locator echoed onto each diagnostic
 * @returns {object[]}
 */
export function checkContractSemantics(contract, { file } = {}) {
  const diagnostics = []
  const contractId = typeof contract?.id === "string" ? contract.id : undefined
  const push = diagnostic =>
    diagnostics.push({
      ...diagnostic,
      ...(file ? { file } : {}),
      ...(contractId ? { contractId } : {}),
    })

  const subcomponents = isPlainObject(contract.subcomponents)
    ? contract.subcomponents
    : {}
  const subcomponentNames = new Set(Object.keys(subcomponents))

  checkComponentBody(contract, { prefix: "", subcomponentNames, push })

  // --- invalidVariantCombinations names declared enum props and in-set values
  //
  // The same two diagnostics a style variant's `when` gets, for the same
  // reason and in the same vocabulary: both fields are a partial prop
  // configuration, so an entry naming an undeclared prop or an out-of-set
  // value is a contract that contradicts itself. Without this it would be
  // SILENTLY unsatisfiable instead — `components/variant-combinations-mismatch`
  // (issue #403) matches an entry against the contract's own enum props, so
  // one naming anything else can never match and would quietly assert
  // nothing, which is exactly the shape of drift this engine exists to catch.
  const contractProps = isPlainObject(contract.props) ? contract.props : {}
  const declaredProps = [...Object.keys(contractProps)]
    .sort(compareEntities)
    .join(", ")
  const combinations = Array.isArray(contract.invalidVariantCombinations)
    ? contract.invalidVariantCombinations
    : []
  combinations.forEach((combination, index) => {
    if (!isPlainObject(combination)) return
    for (const propName of Object.keys(combination).sort(compareEntities)) {
      const where = `invalidVariantCombinations[${index}].${propName}`
      const prop = contractProps[propName]
      const value = combination[propName]
      if (!isPlainObject(prop) || prop.type !== "enum") {
        push({
          code: "unknown-variant-prop",
          path: where,
          message: `invalidVariantCombinations forbids "${propName}" = ${JSON.stringify(value)}, but "${propName}" is not a declared enum prop${
            declaredProps ? ` (declared: ${declaredProps})` : ""
          }`,
        })
        continue
      }
      if (!Array.isArray(prop.values) || prop.values.includes(value)) continue
      push({
        code: "invalid-variant-value",
        path: where,
        message: `invalidVariantCombinations forbids "${propName}" = ${JSON.stringify(value)}, which is not one of that prop's values (${prop.values.map(v => JSON.stringify(v)).join(", ")})`,
      })
    }
  })

  for (const name of Object.keys(subcomponents).sort(compareEntities)) {
    const body = subcomponents[name]
    if (!isPlainObject(body)) continue
    checkComponentBody(body, {
      prefix: `subcomponents.${name}`,
      subcomponentNames,
      push,
    })
  }

  return sortDiagnostics(diagnostics)
}

// ---------------------------------------------------------------------------
// `^_` comment-key stripping — see the module docblock for why this happens
// AFTER validation, never before.
// ---------------------------------------------------------------------------

/**
 * Deep copy of `value` with every own key starting with `_` removed. Returns a
 * NEW structure; never mutates its argument.
 *
 * @param {*} value
 * @returns {*}
 */
export function stripCommentKeys(value) {
  if (Array.isArray(value)) return value.map(stripCommentKeys)
  if (isPlainObject(value)) {
    const out = {}
    for (const key of Object.keys(value)) {
      if (key.startsWith("_")) continue
      out[key] = stripCommentKeys(value[key])
    }
    return out
  }
  return value
}

// ---------------------------------------------------------------------------
// `_scaffold` markers — read off the RAW document, before stripping
// ---------------------------------------------------------------------------

// RFC 6901 segment escaping — "~" and "/" are the only characters a JSON
// Pointer segment must encode.
function escapePointerSegment(segment) {
  return String(segment).replace(/~/g, "~0").replace(/\//g, "~1")
}

/**
 * Depth-first walk of a contract document for every `_scaffold` key,
 * returning its JSON Pointer path. Keys are visited in sorted order at each
 * level so two runs over the same contract always report markers in the same
 * order, independent of object key insertion order. Does not recurse into a
 * `_scaffold` value itself — it is a todo note, never a container another
 * marker could hide inside.
 *
 * Lives HERE, not in the module that reports the markers, because the loader
 * is the last place they exist: `stripCommentKeys` removes every `^_` key,
 * `_scaffold` included, so anything deriving markers from a loaded contract
 * is guaranteed to find none (issue #350).
 *
 * @param {*} value a RAW contract document — pre-`stripCommentKeys`
 * @param {string} [pointer]
 * @returns {string[]} JSON Pointer paths, sorted by walk order
 */
function findScaffoldMarkers(value, pointer = "") {
  if (value === null || typeof value !== "object") return []
  if (Array.isArray(value)) {
    return value.flatMap((item, index) =>
      findScaffoldMarkers(item, `${pointer}/${index}`),
    )
  }
  const markers = []
  for (const key of Object.keys(value).sort()) {
    const childPointer = `${pointer}/${escapePointerSegment(key)}`
    if (key === "_scaffold") {
      markers.push(childPointer)
      continue
    }
    markers.push(...findScaffoldMarkers(value[key], childPointer))
  }
  return markers
}

// ---------------------------------------------------------------------------
// The reduced view the checkers consume
// ---------------------------------------------------------------------------

/**
 * The props/API checker's whole input: prop name → `{type, values, default,
 * required, design, code}`, in sorted key order. Deliberately small and
 * stable — it is the boundary the checkers depend on, so widening it later is
 * cheap but narrowing it is not.
 *
 * `required` is always present and defaults to TRUE, matching the schema's own
 * default (v1's semantics, where an unmarked key was required and a trailing
 * `?` made it optional). Every other optional field is OMITTED when absent
 * rather than set to `undefined`, so the view stays JSON-stable — the same
 * convention `core/findings.mjs`'s `makeFinding` follows for `data`.
 *
 * @param {object} contract a loaded contract
 * @returns {Record<string, {type: string, values?: Array, default?: *, required: boolean, design?: *, code?: string}>}
 */
export function contractApiView(contract) {
  const props = isPlainObject(contract?.props) ? contract.props : {}
  const view = {}
  for (const name of Object.keys(props).sort(compareEntities)) {
    const prop = props[name]
    if (!isPlainObject(prop)) continue
    const entry = { type: prop.type }
    if (Array.isArray(prop.values)) entry.values = [...prop.values]
    if (prop.default !== undefined) entry.default = prop.default
    entry.required = prop.required === undefined ? true : prop.required
    if (prop.design !== undefined) entry.design = prop.design
    if (prop.code !== undefined) entry.code = prop.code
    view[name] = entry
  }
  return view
}

// ---------------------------------------------------------------------------
// Loading one contract
// ---------------------------------------------------------------------------

/**
 * Load, parse and fully validate ONE contract file. Never throws: every
 * failure mode — missing file, unreadable file, malformed JSON, a non-object
 * document, a schema violation, a semantic violation —
 * returns `{ok: false, contract: null, diagnostics}`.
 *
 * @param {string} filePath path to a `.contract.json` file
 * @param {object} [options]
 * @param {{existsSync: Function, readFileSync: Function}} [options.fs]
 *   injectable fs (default real `node:fs`)
 * @param {string} [options.label] what to call this file in diagnostics —
 *   defaults to `filePath`; `loadContracts` passes a project-relative path so
 *   output is portable across machines
 * @returns {{ok: boolean, contract: object|null, scaffoldMarkers?: string[], diagnostics: object[]}}
 *   `scaffoldMarkers` (present only when `ok`) are the JSON Pointer paths of
 *   every `_scaffold` key in the RAW document — the loaded `contract` no
 *   longer has any, since `stripCommentKeys` removed them (issue #350)
 */
export function loadContract(filePath, { fs = defaultFs, label } = {}) {
  const file = label || filePath
  const fail = diagnostic => ({
    ok: false,
    contract: null,
    diagnostics: sortDiagnostics([{ file, ...diagnostic }]),
  })

  if (!fs.existsSync(filePath)) {
    return fail({
      code: "missing-contract-file",
      message: `no contract file at ${filePath}`,
    })
  }

  let raw
  try {
    raw = fs.readFileSync(filePath, "utf8")
  } catch (err) {
    return fail({
      code: "read-error",
      message: `could not read ${filePath}: ${err.message}`,
    })
  }

  let doc
  try {
    doc = JSON.parse(raw)
  } catch (err) {
    return fail({
      code: "invalid-json",
      message: `invalid JSON in ${filePath}: ${err.message}`,
    })
  }

  if (!isPlainObject(doc)) {
    return fail({
      code: "invalid-contract-shape",
      message: `${filePath} must contain a single contract object (got ${
        doc === null ? "null" : Array.isArray(doc) ? "array" : typeof doc
      })`,
    })
  }

  // Validated BEFORE stripping `^_` keys — see the module docblock.
  const contractId = typeof doc.id === "string" ? doc.id : undefined

  // Schema version gate (issue #365). A contract authored against a NEWER
  // schema than this engine reads is refused before validation: the schema
  // would reject fields it has never heard of, and "unknown key" is the
  // wrong diagnosis for "upgrade the engine". Anything non-integer falls
  // through to the schema, whose own error names the type.
  const authoredVersion = doc.schemaVersion
  if (
    Number.isInteger(authoredVersion) &&
    authoredVersion > CONTRACT_SCHEMA_VERSION
  ) {
    return fail({
      code: "contract-schema-newer",
      ...(contractId ? { contractId } : {}),
      path: "schemaVersion",
      message: `${file} was authored against contract schema v${authoredVersion}, but this engine reads v${CONTRACT_SCHEMA_VERSION} — upgrade design-delta`,
    })
  }

  if (!runContractSchema(doc)) {
    const diagnostics = schemaDiagnostics(runContractSchema.errors, {
      file,
      contractId,
    })
    // An OLDER contract that no longer validates is stale, not malformed —
    // say so once, ahead of the schema errors, so the reader knows the fix
    // is a migration rather than a typo hunt. An older contract that still
    // validates is fine and says nothing: the change since was additive.
    if (
      Number.isInteger(authoredVersion) &&
      authoredVersion < CONTRACT_SCHEMA_VERSION
    ) {
      diagnostics.push({
        code: "contract-schema-outdated",
        file,
        ...(contractId ? { contractId } : {}),
        path: "schemaVersion",
        message: `${file} was authored against contract schema v${authoredVersion}; this engine reads v${CONTRACT_SCHEMA_VERSION}, and the contract no longer validates against it — the schema errors reported with this one are what changed`,
      })
    }
    return {
      ok: false,
      contract: null,
      diagnostics: sortDiagnostics(diagnostics),
    }
  }

  const semantic = checkContractSemantics(doc, { file })
  if (semantic.length > 0)
    return { ok: false, contract: null, diagnostics: semantic }

  // Markers come off `doc`, NOT off the stripped result — `stripCommentKeys`
  // is about to delete every `^_` key, `_scaffold` among them.
  return {
    ok: true,
    contract: stripCommentKeys(doc),
    scaffoldMarkers: findScaffoldMarkers(doc),
    diagnostics: [],
  }
}

// ---------------------------------------------------------------------------
// Discovering + loading the whole set
// ---------------------------------------------------------------------------

// JSON is the ONE contract serialization (D2, tightened by Chris 2026-07-31:
// "Drop YAML. Let's just not support it and keep it lean."). YAML's only real
// advantage for an authored spec is comments, and `_`-prefixed keys already
// carry those — so a second serialization bought terser punctuation in
// exchange for two parse paths and a parity test whose only purpose was
// proving they agreed.
//
// The configured `conventions.contractSuffix` names that one serialization
// (".contract.json" by default). Kept as a function returning a list so
// discovery has a single shape to iterate, and so a project whose suffix
// omits the extension still resolves.
function acceptedSuffixes(contractSuffix) {
  const base = contractSuffix.endsWith(".json")
    ? contractSuffix.slice(0, -".json".length)
    : contractSuffix
  return [...new Set([contractSuffix, `${base}.json`])].sort(compareStrings)
}

/**
 * Every contract file under the configured `paths.contractsDir`, absolute and
 * sorted. A missing directory is zero contracts, never a crash (a project that
 * has not authored any contracts yet is a legitimate state — the CALLER
 * decides whether "none" is a problem).
 *
 * @param {object} config the project's (unresolved) config
 * @param {object} [options]
 * @param {string} [options.root] project root a relative `contractsDir`
 *   resolves against (default `process.cwd()`)
 * @param {{existsSync: Function, readdirSync: Function}} [options.fs]
 * @returns {{dir: string, files: string[]}} `dir` is the resolved absolute
 *   contracts directory; `files` are absolute paths in sorted order
 */
export function findContractFiles(
  config,
  { root = process.cwd(), fs = defaultFs } = {},
) {
  const { contractsDir } = resolvePaths(config)
  const { contractSuffix } = resolveConventions(config)
  const dir = isAbsolute(contractsDir) ? contractsDir : join(root, contractsDir)
  return {
    dir,
    files: collectFilesSorted(dir, acceptedSuffixes(contractSuffix), fs),
  }
}

/**
 * Discover, load and validate every contract in the project. A single bad file
 * NEVER aborts the set: it contributes diagnostics and every other contract
 * still loads, so one run reports every problem.
 *
 * Beyond the per-file checks, this is the only place the cross-FILE rule can
 * be enforced: a duplicate `id`. The id is the key every finding, report row
 * and exemption refers to, so two files claiming the same one makes every
 * downstream reference ambiguous.
 *
 * @param {object} config the project's (unresolved) config
 * @param {object} [options]
 * @param {string} [options.root] see `findContractFiles`
 * @param {{existsSync: Function, readFileSync: Function, readdirSync: Function}} [options.fs]
 * @param {{start?: Function, update?: Function, done?: Function, skip?: Function}} [options.onProgress]
 *   a `core/progress.mjs`-shaped bus, called if given — this module never
 *   imports a renderer itself (ADR-001 D8)
 * @returns {{ok: boolean, dir: string, files: string[], contracts: Array<{id: string, file: string, contract: object, scaffoldMarkers: string[]}>, diagnostics: object[]}}
 *   `files` is every discovered file (project-relative, sorted), whether or
 *   not it loaded; `contracts` holds only the ones that loaded cleanly, sorted
 *   by `id` then by `file`
 */
export function loadContracts(
  config,
  { root = process.cwd(), fs = defaultFs, onProgress } = {},
) {
  const { dir, files } = findContractFiles(config, { root, fs })
  const relDir = toPosixRelative(root, dir) || dir

  onProgress?.start?.("contracts", `scanning ${relDir}`)

  const contracts = []
  const diagnostics = []
  const labels = []

  for (const fileAbs of files) {
    const file = toPosixRelative(root, fileAbs)
    labels.push(file)
    onProgress?.update?.("contracts", file)
    const result = loadContract(fileAbs, { fs, label: file })
    diagnostics.push(...result.diagnostics)
    if (result.ok)
      contracts.push({
        id: result.contract.id,
        file,
        contract: result.contract,
        scaffoldMarkers: result.scaffoldMarkers,
      })
  }

  // Cross-file: one `id`, one contract.
  const byId = new Map()
  for (const entry of contracts) {
    if (!byId.has(entry.id)) byId.set(entry.id, [])
    byId.get(entry.id).push(entry.file)
  }
  for (const id of [...byId.keys()].sort(compareEntities)) {
    const owners = byId.get(id).sort(compareStrings)
    if (owners.length < 2) continue
    for (const file of owners) {
      diagnostics.push({
        code: "duplicate-contract-id",
        file,
        contractId: id,
        path: "id",
        message: `contract id "${id}" is declared by ${owners.length} files: ${owners.join(", ")}`,
      })
    }
  }

  contracts.sort(
    (a, b) => compareEntities(a.id, b.id) || compareStrings(a.file, b.file),
  )
  const sorted = sortDiagnostics(diagnostics)

  if (sorted.length > 0)
    onProgress?.skip?.("contracts", `${sorted.length} diagnostic(s)`)
  else onProgress?.done?.("contracts", `${contracts.length} contract(s)`)

  return {
    ok: sorted.length === 0,
    dir,
    files: labels,
    contracts,
    diagnostics: sorted,
  }
}
