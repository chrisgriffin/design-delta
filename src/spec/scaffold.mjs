/**
 * scaffold.mjs — draft a contract from a component's props census (roadmap
 * item, `contract scaffold`). Mirrors `codegen.mjs`'s inverse direction:
 * codegen renders FROM a contract, this drafts one TO write.
 *
 * Pure: takes an already-extracted component (`{file, props}`, from
 * `sources/react/extract.mjs`) plus a title/id, and returns a contract
 * object ready to `JSON.stringify`. No fs, no config resolution — the caller
 * (`cli/commands/contract.mjs`) owns the census, the file resolution, and
 * the write.
 *
 * `sources.design` and `codegen` are deliberately OMITTED, not
 * placeholdered: the active design provider's own `buildCodeConnectModel`
 * already substitutes `DESIGN_TARGET_PLACEHOLDER` when `sources.design` is
 * absent, so writing a fake value here would only be a second, redundant
 * guess at a gap codegen already covers correctly.
 *
 * `anatomy` (issue #235, follow-on to #217) is drafted from the FRAMEWORK
 * ADAPTER's structural census (`sources/react/jsx.mjs`'s `StructuralNode`
 * tree), the same "render FROM a census" direction as `props` above — never
 * a second guess independent of what the code actually renders. Node names
 * are synthesized (the census carries no names, only shape). Any node the
 * adapter could not confidently resolve into a real `element`/`content`
 * value — an unresolved position, an unclassified expression, a nested
 * instance, or an `{identifier}` that isn't a declared prop — is still
 * written, never silently dropped, but carries `_scaffold: {todo: "…"}`
 * instead of a guessed value, so a human author can grep for what still
 * needs review. The contract schema already reserves `^_` keys for exactly
 * this kind of non-normative note (see e.g. `subcomponents` fixtures), so
 * this reuses that convention rather than inventing a second one — matching
 * `modules/anatomy.mjs`'s own rule that a partial answer must say what it did
 * not resolve rather than read as a complete one.
 *
 * A component the census declined as `divergent-roots` (issue #431) is the one
 * decline that still drafts an `anatomy`: it renders several trees with
 * different roots, and the adapter carries all of them (ADR-002 D5), so a base
 * tree plus a `$variants` entry per further branch describes what was read.
 * See `buildScaffoldAnatomyVariants`. Every other decline reason carries no
 * branches and still omits the block.
 *
 * `styles` (issue #236, follow-on to #235) is drafted from the CODE-SIDE
 * style census (`sources/styles.mjs`) alone. The element→selector mapping and
 * the box-grammar CSS resolution are NOT reimplemented here: they are
 * `modules/styles.mjs`'s own
 * `locateElementSelector`/`locateVariantSelector`/`resolveCssFinest` —
 * `spec/` may not import `modules/` (`__tests__/layering.test.js`), so
 * `cli/commands/scaffold.mjs`, which may import both, wires that module's
 * mapping into this one's pure `draftStyleProps`/`draftStyleProperty`. This
 * keeps a scaffolded `styles` block agreeing with `styles/element-unmapped`
 * by construction — one mapping rule, not two that could drift apart.
 *
 * A `var(--x)` declaration (issue #261) is resolved to a token binding
 * (`{token: "<id>"}`) when its name matches EXACTLY ONE token in the
 * project's own token census — the same "reuse the check's own rule rather
 * than reimplement it" move the element→selector mapping above already
 * makes: the caller builds the var-name→token-id(s) lookup from
 * `modules/tokens.mjs`'s own `candidateVarNames` (the exact hypothesis
 * `tokens/token-untracked` already runs), so a scaffolded binding can never
 * disagree with that check about what "accounted for" means. A var matching
 * ZERO or 2+ tokens is left for a human via the same `_scaffold: {todo:
 * "…"}` convention — several tokens can legitimately share one CSS var (see
 * #191), and guessing among them would be exactly the kind of guess this
 * module's docblock forbids elsewhere. A plain literal still becomes the
 * schema's `raw(...)` escape hatch, unchanged.
 */

import { isContentNode, isStructuralNode } from "../core/census.mjs"
import { ANATOMY_VARIANTS_KEY, CONTRACT_SCHEMA_VERSION } from "./contracts.mjs"

const CONTRACT_SCHEMA_URL =
  "https://chrisgriffin.io/schemas/design-delta/contract.schema.json"

// Anatomy node keys must match the contract schema's
// `^[A-Za-z][A-Za-z0-9]*$` — strip everything else, and prefix a stripped
// name that no longer starts with a letter (a component named "3D" isn't
// realistic, but a dotted tag like "Foo.Bar" strips to "FooBar", which still
// starts with a letter, so this is a defensive fallback, not the common
// path).
function sanitizeNodeName(raw) {
  const stripped = raw.replace(/[^A-Za-z0-9]/g, "")
  if (stripped === "") return "node"
  return /^[A-Za-z]/.test(stripped) ? stripped : `n${stripped}`
}

function lowerFirst(text) {
  return text.length === 0 ? text : text[0].toLowerCase() + text.slice(1)
}

// The base (pre-dedup) name for a STRUCTURAL child, chosen so the common
// case reads naturally in the written JSON: an element's own tag
// (`"button"`), a nested component's name lower-cased (`"Icon"` ->
// `"icon"`), and a generic name for a position the census refused to name.
// Content children never reach here — they become the parent's `content`
// binding, not a node of their own (#351).
function baseNameFor(node) {
  if (node.kind === "element") return node.tag
  if (node.kind === "component") return lowerFirst(node.name)
  return "unresolved"
}

// Every synthesized name is unique across the WHOLE flat `anatomy` map, not
// just among siblings — the contract's own `children` arrays reference names
// by string with no scoping, so two different subtrees both producing
// "label" would silently collide and one would overwrite the other.
function makeNamer() {
  const used = new Set(["root"])
  return function claim(base) {
    const safe = sanitizeNodeName(base)
    if (!used.has(safe)) {
      used.add(safe)
      return safe
    }
    let n = 2
    while (used.has(`${safe}${n}`)) n++
    const name = `${safe}${n}`
    used.add(name)
    return name
  }
}

/**
 * The DOM attributes `scaffold` drafts into `anatomy.<node>.attributes`
 * (issue #376): the ones that carry meaning to a user or to assistive
 * technology, never the ones that carry meaning to the framework. Stated as
 * a list, not a pattern, so the judgment is readable. `className`, `style`,
 * `key`, `ref`, event handlers and `data-*` are deliberately absent — a
 * contract that pinned those would be asserting implementation, not
 * intent. A value the census could not resolve (`{unresolved: true}`) is
 * not drafted and is not a todo either: a contract that does not pin an
 * attribute is a valid contract.
 */
export const SCAFFOLD_ATTRIBUTES = Object.freeze([
  "role",
  "type",
  "tabindex",
  "tabIndex",
  "alt",
  "for",
  "htmlFor",
  "lang",
  "title",
])

function draftAttributes(node) {
  const drafted = {}
  for (const name of Object.keys(node.attributes || {}).sort()) {
    const value = node.attributes[name]
    if (typeof value !== "string") continue
    if (!name.startsWith("aria-") && !SCAFFOLD_ATTRIBUTES.includes(name))
      continue
    drafted[name] = value
  }
  return Object.keys(drafted).length > 0 ? drafted : undefined
}

/**
 * Draft an `anatomy` block from one component's structural census
 * (`sources/react/jsx.mjs`'s `{kind, ...}` tree). Pure and deterministic —
 * same input, same output, same node-naming order every time (a depth-first
 * walk in the same source order the census itself preserves).
 *
 * @param {object} root a resolvable/partial census's `component.root`
 * @param {Set<string>} propNames the component's own declared prop names
 *   (from the props census this same scaffold run already holds) — an
 *   `expression` node's `{identifier}` is only ever a real prop reference
 *   when it names one of these. `jsx.mjs` classifies ANY bare identifier as
 *   `expression`, including a local variable or a `children` prop that
 *   arrived via a `node_modules` intersection arm `extract.mjs` deliberately
 *   does not walk — binding those as `{$prop: name}` would write a contract
 *   `contracts.mjs`'s own `unknown-content-prop` check then rejects, betraying
 *   this function's own "passes validation once written" guarantee.
 * @returns {object} a flat `{name: anatomyNode}` map, always containing
 *   `"root"`, ready to assign to a contract's `anatomy` key
 */
export function buildScaffoldAnatomy(root, propNames) {
  const anatomy = {}
  const claim = makeNamer()

  function visit(node, name) {
    const entry = {}
    anatomy[name] = entry

    if (node.kind === "element") {
      entry.type = "container"
      entry.element = node.tag
      const attributes = draftAttributes(node)
      if (attributes) entry.attributes = attributes
    } else if (node.kind === "component") {
      // A nested custom component is a delegated instance, never followed
      // further — `modules/anatomy.mjs`'s own rule for `type: "instance"`:
      // its own contract owns its structure.
      entry.type = "instance"
      entry.instanceOf = node.name
      entry._scaffold = { todo: "confirm instanceOf names the right contract" }
      return
    } else if (node.kind === "text") {
      entry.type = "text"
      entry.content = node.value
    } else if (node.kind === "expression" && propNames.has(node.prop)) {
      entry.type = "text"
      entry.content = { $prop: node.prop }
    } else if (node.kind === "expression") {
      // `{identifier}` names something that isn't a declared prop — a local
      // variable, or `children` arriving through an unwalked intersection
      // arm. Never guess a binding the contract would then reject.
      entry.type = "text"
      entry._scaffold = {
        todo: `content here binds "${node.prop}", which is not a declared prop — fill in by hand`,
      }
    } else if (node.kind === "unresolved") {
      // The census could not name this position at all (a multi-branch
      // component disagreed here) — a node still marks the position exists,
      // but nothing about it is guessed.
      entry.type = "container"
      entry._scaffold = {
        todo: "structure here could not be resolved from the code — fill in by hand",
      }
      return
    } else {
      // "unknown": a real content position whose expression this module's
      // census could not classify (e.g. a function call) — the position is
      // real, but no literal/prop binding can be drafted for it.
      entry.type = "text"
      entry._scaffold = {
        todo: "content here could not be classified from the code — fill in by hand",
      }
    }

    if (node.childrenResolved === false) {
      // The branches of a multi-tree component rendered different NUMBERS of
      // children here — not "no children", an unresolved COUNT (see
      // `sources/react/jsx.mjs`'s docblock). Say so rather than writing an
      // empty `children: []` that would read as "renders nothing".
      entry.children = []
      entry._scaffold = {
        ...entry._scaffold,
        todo: "child count here could not be resolved from the code — fill in by hand",
      }
      return
    }

    const children = node.children || []
    if (children.length === 0) return

    // Content children become this node's OWN `content` binding; only
    // structural children become `children` entries. `modules/anatomy.mjs`
    // compares `children` against the code's structural children alone, so a
    // content child written as a child node has nothing to pair with and is
    // reported absent — scaffold's output failing scaffold's own audit
    // (#351). The split itself is `core/census.mjs`'s, shared with the
    // checker so the two cannot drift apart.
    const structural = children.filter(isStructuralNode)
    const contentChildren = children.filter(isContentNode)

    if (contentChildren.length > 0 && entry.content === undefined) {
      applyContent(entry, contentChildren)
    }

    if (structural.length === 0) return
    entry.children = structural.map(child => {
      const childName = claim(baseNameFor(child))
      visit(child, childName)
      return childName
    })
  }

  // One node carries ONE `content`, so a position rendering several content
  // children has no honest single binding to draft — say so rather than
  // picking one and presenting the guess as read from the code.
  function applyContent(entry, contentChildren) {
    if (contentChildren.length > 1) {
      entry._scaffold = {
        ...entry._scaffold,
        todo: `content here renders ${contentChildren.length} values, which one \`content\` binding cannot express — fill in by hand`,
      }
      return
    }
    const [child] = contentChildren
    if (child.kind === "text") {
      entry.content = child.value
      return
    }
    if (child.kind === "expression" && propNames.has(child.prop)) {
      entry.content = { $prop: child.prop }
      return
    }
    // Either `{identifier}` naming something that is not a declared prop (a
    // local, or a `children` prop from an unwalked intersection arm), or an
    // expression the census could not classify at all. Never guess a binding
    // the contract's own `unknown-content-prop` check would then reject.
    entry._scaffold = {
      ...entry._scaffold,
      todo:
        child.kind === "expression"
          ? `content here binds "${child.prop}", which is not a declared prop — fill in by hand`
          : "content here could not be classified from the code — fill in by hand",
    }
  }

  visit(root, "root")
  return anatomy
}

// The `when` a drafted variant carries. `when` is free text a HUMAN writes
// (ADR-002 D4) — the engine is static, so the condition that selects a branch
// is not something this module can read out of the code. Drafting a
// plausible-looking one ("href is set") would put an invented fact in the
// contract, so the placeholder says plainly that it is not filled in, and the
// `_scaffold` marker beside it is what makes that greppable, exactly like
// every other value this module refuses to guess.
const VARIANT_WHEN_PLACEHOLDER = "TODO: say when this branch renders"
const VARIANT_WHEN_TODO =
  "`when` is documentation for a human reader, never a condition this engine evaluates (design-delta's ADR-002 D4) — say when this branch renders"

// What tells one rendered branch apart from another: its root element, and
// nothing else (ADR-002 D4). A custom-component root is keyed by its name for
// the same reason `baseNameFor` reads it — that is what the code renders
// there.
function rootLabelOf(node) {
  if (node?.kind === "element") return node.tag
  if (node?.kind === "component") return node.name
  return null
}

// `a` -> "asA", `Link` -> "asLink" — the shape ADR-002 D2 writes by hand,
// derived from the one thing that identifies the branch. Always matches the
// schema's node casing (`^[A-Za-z][A-Za-z0-9]*$`): `sanitizeNodeName` already
// guarantees a non-empty string starting with a letter.
function variantNameFor(label) {
  const safe = sanitizeNodeName(label)
  return `as${safe[0].toUpperCase()}${safe.slice(1)}`
}

// Deep equality over two DRAFTED anatomy nodes — plain JSON (objects, arrays,
// strings), which is all one ever holds. A variant carries only the nodes that
// DIFFER from the base (ADR-002 D3), so "differ" needs exactly one definition.
function sameDraftedNode(a, b) {
  if (a === b) return true
  if (a === null || b === null) return false
  if (typeof a !== "object" || typeof b !== "object") return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  if (Array.isArray(a))
    return (
      a.length === b.length &&
      a.every((item, index) => sameDraftedNode(item, b[index]))
    )
  const keys = Object.keys(a)
  if (keys.length !== Object.keys(b).length) return false
  return keys.every(
    key => Object.hasOwn(b, key) && sameDraftedNode(a[key], b[key]),
  )
}

/**
 * Draft an `anatomy` block for a component the structural census declined as
 * `divergent-roots` — it renders several trees with DIFFERENT roots, so no
 * single tree describes it, but the adapter carries every candidate tree
 * (ADR-002 D5) and a variant-keyed contract is exactly what those describe.
 *
 * Omitting this block used to be the honest answer and is no longer: with the
 * branches in hand, omitting DISCARDS what the census read. So the first
 * branch becomes the base anatomy and each later one a `$variants` entry
 * holding only the nodes that differ from it (D3, partial override) — a node
 * the base already describes identically is inherited, never repeated.
 *
 * Every other decline reason still omits `anatomy` entirely: they carry no
 * branches, so there is still nothing to draft and the "omit, don't guess"
 * rule stands untouched.
 *
 * @param {object[]} branches the census's `component.branches` — every tree
 *   the component renders, in source order
 * @param {Set<string>} propNames see `buildScaffoldAnatomy`
 * @returns {object|null} an anatomy map — the base nodes, plus `$variants`
 *   when at least one later branch could be drafted as one — or `null` when
 *   there are not two branches to compare
 */
export function buildScaffoldAnatomyVariants(branches, propNames) {
  if (!Array.isArray(branches) || branches.length < 2) return null

  const [baseBranch, ...rest] = branches
  const anatomy = buildScaffoldAnatomy(baseBranch, propNames)

  const claimed = new Set([rootLabelOf(baseBranch)])
  const claimName = makeNamer()
  const variants = {}
  const undraftable = []

  for (const branch of rest) {
    const label = rootLabelOf(branch)
    // Two variants declaring the same root element are ambiguous and the
    // LOADER rejects the whole contract (`ambiguous-variant-root`), since
    // nothing can say which rendered branch is which. Drafting one anyway
    // would hand the author a contract that does not load, so the branch is
    // reported instead — the same "say what could not be resolved" rule the
    // rest of this module follows. A root the census could not name is the
    // same case: it has nothing to be told apart by either.
    if (label === null || claimed.has(label)) {
      undraftable.push(label === null ? "an unnamed root" : `"${label}"`)
      continue
    }
    claimed.add(label)

    const drafted = buildScaffoldAnatomy(branch, propNames)
    const overrides = {}
    for (const name of Object.keys(drafted)) {
      if (sameDraftedNode(drafted[name], anatomy[name])) continue
      overrides[name] = drafted[name]
    }
    variants[claimName(variantNameFor(label))] = {
      when: VARIANT_WHEN_PLACEHOLDER,
      _scaffold: { todo: VARIANT_WHEN_TODO },
      ...overrides,
    }
  }

  // Unreachable while the classifier only calls a component `divergent-roots`
  // for roots that DIFFER, but a `$variants` holding nothing but a note is not
  // a block worth writing — the base anatomy alone is the honest answer.
  if (Object.keys(variants).length === 0) return anatomy

  if (undraftable.length > 0) {
    variants._scaffold = {
      todo: `branch(es) rendering ${undraftable.join(", ")} are not drafted — another variant already claims that root, and variants are told apart by their root element alone (design-delta's ADR-002 D4), so a second one could not be told from the first; fill in by hand`,
    }
  }
  anatomy[ANATOMY_VARIANTS_KEY] = variants
  return anatomy
}

/**
 * Classify ONE already-censused CSS declaration
 * (`sources/styles.mjs`'s `{kind: "var"|"literal"|"compound", …}`) into what
 * scaffold can honestly draft. A literal becomes the schema's `raw(...)`
 * escape hatch (`$defs/rawValue`) — a genuine, expressible fact. A `var`
 * whose name matches exactly one token (via `resolveTokenBinding`, issue
 * #261) becomes that token's binding — an equally genuine fact, not a guess,
 * since the caller's lookup is the same hypothesis `tokens/token-untracked`
 * already runs. A `var` matching zero or 2+ tokens, or a `compound` value, is
 * left for a human.
 *
 * @param {{kind: string, varName?: string, raw?: string}} [decl]
 * @param {(varName: string) => string[]} resolveTokenBinding every censused
 *   token id whose derived CSS var name equals `varName` — the caller's
 *   lookup (`cli/commands/scaffold.mjs`), never built here: `spec/` may not
 *   import `modules/tokens.mjs`'s `candidateVarNames`
 *   (`__tests__/layering.test.js`)
 * @returns {{status: "absent"|"raw"|"token"|"unresolved", value?: *, note?: string, matches?: string[]}}
 */
function classifyDeclForScaffold(decl, resolveTokenBinding) {
  if (decl === undefined) return { status: "absent" }
  if (decl.kind === "literal")
    return { status: "raw", value: `raw(${decl.value})` }
  if (decl.kind === "var") {
    const tokenIds = resolveTokenBinding(decl.varName)
    if (tokenIds.length === 1)
      return { status: "token", value: { token: tokenIds[0] } }
    return {
      status: "unresolved",
      note: `var(${decl.varName})`,
      ...(tokenIds.length > 1 ? { matches: tokenIds } : {}),
    }
  }
  return {
    status: "unresolved",
    note: "a compound value mixing var() with other text",
  }
}

/**
 * Draft ONE contract style property's value from its resolved finest-slot
 * declarations (`modules/styles.mjs`'s `resolveCssFinest` — the same
 * box-grammar precedence `compareProperty` applies, run in the opposite
 * direction: FROM what the stylesheet declares).
 *
 * ALL-OR-NOTHING per property: if any finest slot resolves to a var/compound
 * value scaffold cannot express, the WHOLE property is left for a human
 * rather than drafting half of it — a partial grammar (one edge written as
 * `raw()`, another silently absent because it's token-bound) would read as
 * "the other edges have no styling" instead of "unresolved", which is a
 * worse lie than writing nothing.
 *
 * @param {{key: string, finestSlots: string[]}} def one `PROPERTY_DEFS` entry
 *   (`modules/styles.mjs`) — only `key`/`finestSlots` are read
 * @param {Object<string, object|undefined>} resolvedSlots
 *   `resolveCssFinest`'s result for this def against one selector
 * @param {(varName: string) => string[]} resolveTokenBinding see
 *   `classifyDeclForScaffold`
 * @returns {{value: *, todo: string|null, tokenBindings: number}} `value` is
 *   `undefined` when nothing was found, or something was found but couldn't
 *   be resolved; `tokenBindings` counts how many slots resolved to a token
 *   (issue #261's `--json` count)
 */
export function draftStyleProperty(def, resolvedSlots, resolveTokenBinding) {
  const singleSlot =
    def.finestSlots.length === 1 && def.finestSlots[0] === "_value"
  const out = {}
  let found = false
  let tokenBindings = 0
  for (const slot of def.finestSlots) {
    const classified = classifyDeclForScaffold(
      resolvedSlots[slot],
      resolveTokenBinding,
    )
    if (classified.status === "unresolved") {
      const todo = classified.matches
        ? `${def.key} (${classified.note}) matches multiple tokens (${classified.matches.join(", ")}) — fill in by hand`
        : `${def.key} (${classified.note}) is token-bound — fill in by hand`
      return { value: undefined, todo, tokenBindings: 0 }
    }
    if (classified.status === "raw" || classified.status === "token") {
      out[slot] = classified.value
      found = true
      if (classified.status === "token") tokenBindings++
    }
  }
  if (!found) return { value: undefined, todo: null, tokenBindings: 0 }
  return { value: singleSlot ? out._value : out, todo: null, tokenBindings }
}

/**
 * Draft a flat set of contract style properties — a `base`, or one variant's
 * own overrides — from one selector's declarations. Pure: the caller
 * (`cli/commands/scaffold.mjs`) supplies `resolveDef`, a thunk over
 * `modules/styles.mjs`'s `resolveCssFinest` against whatever selector it
 * already located, since `spec/` may not import `modules/`
 * (`__tests__/layering.test.js`).
 *
 * @param {Array<{key: string, path: string[], finestSlots: string[]}>} propertyDefs
 *   `modules/styles.mjs`'s `PROPERTY_DEFS`
 * @param {(def: object) => object} resolveDef
 * @param {(varName: string) => string[]} resolveTokenBinding see
 *   `classifyDeclForScaffold`
 * @returns {{props: object, todos: string[], tokenBindingCount: number}}
 *   `props` nests grammar properties under their schema path (e.g.
 *   `border.width`); `todos` names every property scaffold found but could
 *   not resolve; `tokenBindingCount` sums every resolved token binding
 *   (issue #261's `--json` count)
 */
export function draftStyleProps(propertyDefs, resolveDef, resolveTokenBinding) {
  const props = {}
  const todos = []
  let tokenBindingCount = 0
  for (const def of propertyDefs) {
    const { value, todo, tokenBindings } = draftStyleProperty(
      def,
      resolveDef(def),
      resolveTokenBinding,
    )
    if (todo) {
      todos.push(todo)
      continue
    }
    if (value === undefined) continue
    tokenBindingCount += tokenBindings
    let cur = props
    for (let i = 0; i < def.path.length - 1; i++) {
      cur[def.path[i]] = cur[def.path[i]] || {}
      cur = cur[def.path[i]]
    }
    cur[def.path[def.path.length - 1]] = value
  }
  return { props, todos, tokenBindingCount }
}

/**
 * @param {object} options
 * @param {string} options.title PascalCase component name (the caller
 *   validates this against the contract schema's own
 *   `^[A-Z][A-Za-z0-9]*$` pattern before calling this)
 * @param {string} options.id kebab-case contract id, derived from `title`
 * @param {string} options.codePath repo-relative path to the component file
 * @param {object[]} options.props the census's prop list —
 *   `{name, type, values?, default?, required}` — already in the contract's
 *   own prop vocabulary (both share `boolean|string|number|enum|slot|function`)
 * @param {object} [options.anatomy] a `buildScaffoldAnatomy` result, or a
 *   `buildScaffoldAnatomyVariants` one for a component whose branches render
 *   different roots; omitted entirely (not placeholdered) when the structural
 *   census declined the whole component and carried nothing to draft from —
 *   same "omit, don't guess" rule as `sources.design`
 * @param {string} [options.stylesPath] repo-relative path to the component's
 *   style file, set whenever one censused cleanly — independent of whether
 *   `styles` itself drafted any content, so a later `audit --styles` finds
 *   the same file this scaffold run read
 * @param {object} [options.styles] a `styles` block (issue #236, element-major
 *   `base`/`variants`), omitted entirely when no anatomy element mapped to a
 *   selector — same "omit, don't guess" rule as `anatomy`/`sources.design`
 * @returns {object} a contract object that passes `contracts` validation
 *   once written
 */
export function buildScaffoldContract({
  title,
  id,
  codePath,
  props,
  anatomy,
  stylesPath,
  styles,
}) {
  const contractProps = {}
  for (const prop of props) {
    const entry = { type: prop.type }
    if (prop.values) entry.values = prop.values
    if (prop.default !== undefined) entry.default = prop.default
    entry.required = prop.required === true
    contractProps[prop.name] = entry
  }

  return {
    $schema: CONTRACT_SCHEMA_URL,
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    id,
    title,
    sources: {
      code: {
        path: codePath,
        ...(stylesPath ? { styles: stylesPath } : {}),
      },
    },
    props: contractProps,
    ...(anatomy ? { anatomy } : {}),
    ...(styles ? { styles } : {}),
  }
}
