/**
 * codegen.mjs — Code Connect generation FROM a contract (ADR-001 Phase 2d,
 * issue #105; moved into the Figma provider in ADR-003 Phase 5.1, closing
 * the one-release exemption `__tests__/layering.test.js`'s vendor guard
 * carried for it since Phase 5.0): a contract's `codegen` block plus its
 * `props` drive generation of the design-to-code binding file (e.g.
 * `*.figma.tsx` — no default, `conventions.codeConnectSuffix` is configured
 * per project, ADR-003 Amendment 1). Rebuilt against the CONTRACT rather than
 * v1's `*.component.yml` shape (v1's `src/lib/codegen-code-connect.mjs`,
 * deleted with the old engine) — same "the projection is generated, not
 * hand-authored and drift-checked" thesis, new fixed point (D1).
 *
 * Two layers, both PURE — no fs, no network, no clock, no randomness:
 *
 *   - `buildCodeConnectModel(contract, config, apiView)` — contract → an
 *     intermediate model. `apiView` is the caller's job to supply
 *     (`spec/contracts.mjs`'s `contractApiView(contract)`) rather than this
 *     module importing it directly: providers may import only `core/` (D12),
 *     never `spec/`, so `cli/commands/codegen.mjs` — allowed to import
 *     both — computes it once and passes it in. The model is the honest
 *     surface of "what the contract can drive": anything it cannot fill is
 *     recorded in `gaps`, never invented. `model.ok === false` means there
 *     was nothing to generate against at all (no `sources.code.path`, or no
 *     `conventions.codeConnectSuffix` configured) — the caller skips such a
 *     contract with a stated reason, the same "surface skips, it doesn't
 *     fail the run" convention `modules/tokens.mjs` documents.
 *   - `renderCodeConnect(model)` → the generated binding file's SOURCE text,
 *     already in this repo's own Prettier shape (no semicolons, double quotes, 2-space,
 *     arrow parens avoided) — see the module's own docblock note on why no
 *     `prettier` dependency is pulled in to format a CONSUMER's generated
 *     file: this engine has zero-to-few runtime deps (CLAUDE.md), so the
 *     renderer emits text that is already correctly shaped rather than
 *     formatting after the fact.
 *
 * WHAT THE CONTRACT DRIVES vs WHAT IT DOESN'T (surfaced as `model.gaps`,
 * never guessed):
 *
 *   - The prop map: every prop the contract declares becomes a
 *     `figma.<kind>("<designName>", …)` entry, keyed by its CODE name — see
 *     "PROP EXCLUSION / GAP RULES" below for the ones that don't.
 *   - The example child: `codegen.exampleContent` (a text child) or
 *     `codegen.example` in each of its three forms (`"authored"`,
 *     `{selfClose: true}`, `{comment: "…"}`). Absent either, the example
 *     child is not contract-driven — a gap, not a guess. A mapped `children`
 *     prop renders as the child instead, and any directive but `"authored"`
 *     set alongside it is a gap too (issue #486).
 *   - The Code Connect CONNECT TARGET (the design node this binds to) is a
 *     REAL Figma URL now that this module lives in the provider that knows
 *     `sources.design`'s shape (`{fileKey, nodeId}`, this provider's own
 *     `sourceSchema`) — `https://www.figma.com/design/<fileKey>?node-id=
 *     <hyphenated nodeId>`, confirmed against the consuming project this was
 *     validated against, whose hand-maintained `.figma.tsx` files all use
 *     exactly this shape. `sources.design` absent, or present but not
 *     matching `{fileKey, nodeId}`, is still a placeholder plus a gap — a
 *     shape this provider's `sourceSchema` doesn't bless is not this
 *     provider's to guess at (D12). The bare-string escape hatch (a literal
 *     URL used verbatim) is retired with this move: the validating project
 *     had no contract using it, and the reason it existed — no provider
 *     could produce a real target — stops being true here.
 *
 * PROP EXCLUSION / GAP RULES (`buildCodeConnectModel`'s per-prop pass):
 *   - `design: "none"` (code-only prop) → excluded, NO gap: this is a
 *     deliberate declaration, not a defect (mirrors `code: "none"` below).
 *   - `code: "none"` (design-only axis, e.g. an interaction state) → excluded,
 *     NO gap: there is no code prop to bind on the other side.
 *   - `type: "number"` or `type: "function"` → excluded WITH a gap: Code
 *     Connect's mapping helpers (`figma.string`/`.boolean`/`.enum`/
 *     `.instance`) have no sensible counterpart for either, so mapping one
 *     would be a guess, not a projection.
 *   - `design: "unverified"` → included, using the CODE name as a stand-in,
 *     WITH a gap: the projection isn't confirmed, so the generated mapping is
 *     a hypothesis a human must confirm, not asserted as fact.
 *   - `code: "unverified"` → included WITH a gap, same reasoning, the other
 *     direction.
 *   - `design: {name, reason}` → included, using `name` as the design-side
 *     property name, NO gap: a genuine, confirmed rename.
 *   - `design: {name, mechanism}` → included, and the MECHANISM decides the
 *     mapping helper instead of the contract's own type (issue #457):
 *     `toggle` → `figma.boolean`, `text` → `figma.string`, `instance` →
 *     `figma.instance`, whatever the code type is. The marker says the design
 *     side models this prop another way by construction, so a helper picked
 *     from the code type binds against a property that is not of that type —
 *     not a valid binding, and the contract itself already said so
 *     (`core/mechanisms.mjs`, the same map `modules/components.mjs` compares
 *     types through). `toggle` renders both branches
 *     (`{true: …, false: undefined}`): with `design.gates` naming the slot it
 *     hides, the true branch is `figma.instance(<gates>)` (issue #485);
 *     without it, what the true branch stands for lives in the design file,
 *     not in the contract, so it carries a gap.
 *   - Everything else → included, code name doubles as the design name.
 *
 * DETERMINISM: `buildCodeConnectModel` walks `apiView`'s already sorted prop
 * map (`spec/contracts.mjs`'s `contractApiView`, sorted via
 * `core/findings.mjs`'s `compareEntities`), so the SAME contract renders the
 * SAME text byte for byte on every run — no wall clock, no reliance on any
 * object's insertion order that isn't itself already deterministic.
 *
 * THE AUTHORED-EXAMPLE CUT (`comparableBindingSource`'s `maskExample`) exists
 * for ONE reason: a `codegen: example: "authored"` contract's example body is
 * hand-written, so `bindingStatus` must not treat a differing example body as
 * drift. It masks the `example` field's value on both sides of the parsed
 * binding and compares everything that frames it. The splice half — reading a committed
 * body back and re-inserting it — went with the deleted `codegen` command
 * (#400, #472).
 *
 * `providers/` may import `core/` (+ own siblings) and NOTHING else internal
 * (`__tests__/layering.test.js` enforces this) — never `spec/`, `sources/`,
 * or `modules/`. This is also the one file (alongside its `index.mjs`/
 * `normalize.mjs`/`agent/plan.mjs` siblings) the layering test's vendor
 * guard allows to mention Figma at all.
 */

import { resolveConventions } from "../../core/config.mjs"
import { designMechanismType } from "../../core/mechanisms.mjs"
import { isNodeId, nodeIdToUrlSegment } from "./normalize.mjs"
import { loadTypeScript } from "./typescript.mjs"

// ---------------------------------------------------------------------------
// Path derivation — plain string ops, deliberately NOT `node:path`: a
// contract's `sources.code.path` is always documented as a repo-relative
// POSIX path (forward slashes), same convention `spec/contracts.mjs`'s
// `toPosixRelative` exists to guarantee elsewhere — `node:path`'s
// platform-sensitive `basename` would be the wrong tool for a string that is
// never actually a filesystem path on THIS machine.
// ---------------------------------------------------------------------------

function stripKnownExtension(path) {
  return path.replace(/\.[jt]sx?$/, "")
}

/**
 * The generated binding file's own path: alongside the contract's
 * `sources.code.path`, same basename, `conventions.codeConnectSuffix` instead
 * of the source's extension.
 *
 * @param {string} codePath
 * @param {string} codeConnectSuffix
 * @returns {string}
 */
export function deriveOutputPath(codePath, codeConnectSuffix) {
  return `${stripKnownExtension(codePath)}${codeConnectSuffix}`
}

/**
 * The relative import the generated file uses to reach the component — valid
 * because the generated file always lives in the SAME directory as the
 * source it binds (see `deriveOutputPath`).
 *
 * @param {string} codePath
 * @returns {string}
 */
export function deriveImportPath(codePath) {
  const base = codePath.split("/").pop()
  return `./${stripKnownExtension(base)}`
}

// ---------------------------------------------------------------------------
// The connect target — see the module docblock's "WHAT THE CONTRACT DRIVES"
// section for why this is (almost) always a placeholder.
// ---------------------------------------------------------------------------

export const DESIGN_TARGET_PLACEHOLDER = "REPLACE_WITH_DESIGN_NODE_REFERENCE"

function resolveDesignTarget(contract) {
  const design = contract?.sources?.design

  if (design === undefined) {
    return {
      value: DESIGN_TARGET_PLACEHOLDER,
      gap: "no sources.design declared — the Code Connect target is a placeholder; fill in the design node reference once this component has one",
    }
  }

  const fileKey = design?.fileKey
  const nodeId = design?.nodeId
  if (typeof fileKey === "string" && fileKey.length > 0 && isNodeId(nodeId)) {
    return {
      value: `https://www.figma.com/design/${fileKey}?node-id=${nodeIdToUrlSegment(nodeId)}`,
      gap: null,
    }
  }

  return {
    value: DESIGN_TARGET_PLACEHOLDER,
    gap: "sources.design does not match this provider's sourceSchema ({fileKey, nodeId}) — replace the placeholder with the real design node reference",
  }
}

// ---------------------------------------------------------------------------
// Per-prop pass — see the module docblock's "PROP EXCLUSION / GAP RULES".
// ---------------------------------------------------------------------------

// Code Connect's own mapping helpers (`figma.string`/`.boolean`/`.enum`/
// `.instance`) have no counterpart for either — mapping one would be
// invention, not projection.
const UNSUPPORTED_PROP_TYPES = new Set(["number", "function"])

function kindForType(type) {
  if (type === "enum") return "enum"
  if (type === "boolean") return "boolean"
  if (type === "slot") return "instance"
  return "string" // "string", and the engine's own safe fallback
}

/**
 * One prop → `{included, prop?, gaps}`. Never throws; an unmappable prop is
 * excluded with a gap explaining why, never silently dropped.
 */
function buildProp(name, entry) {
  if (entry.design === "none") return { included: false, gaps: [] }
  if (entry.code === "none") return { included: false, gaps: [] }

  if (UNSUPPORTED_PROP_TYPES.has(entry.type)) {
    return {
      included: false,
      gaps: [
        `prop "${name}": type "${entry.type}" has no Code Connect mapping — excluded`,
      ],
    }
  }

  const gaps = []
  let designName = name

  if (entry.design === "unverified") {
    gaps.push(
      `prop "${name}": design mapping is unverified — generated using code name "${name}"; confirm the design property name before treating this as final`,
    )
  } else if (entry.design && typeof entry.design === "object") {
    designName = entry.design.name
  }

  if (entry.code === "unverified") {
    gaps.push(
      `prop "${name}": code projection is unverified — confirm this prop exists on the component before treating this mapping as final`,
    )
  }

  // A declared MECHANISM decides the helper, not the contract's own type
  // (issue #457): the marker says the design side models this prop another
  // way by construction, so the design property really carries the implied
  // type and a helper picked from the CODE type would not be a valid binding
  // at all. This is the same redirection `modules/components.mjs` applies to
  // the type comparison (issue #439), reading the one map both share.
  const impliedType = designMechanismType(entry.design)
  const mechanism =
    impliedType === undefined ? undefined : entry.design.mechanism
  const kind = kindForType(impliedType ?? entry.type)

  // A toggle is a boolean BESIDE the region it hides, so its binding is the
  // two-branch form — and what the true branch renders is the thing the
  // toggle stands for, which the contract carries only when it names the
  // design slot the toggle gates (issue #485).
  const gates =
    mechanism === "toggle" && typeof entry.design.gates === "string"
      ? entry.design.gates
      : undefined
  if (mechanism === "toggle" && gates === undefined) {
    gaps.push(
      `prop "${name}": design mechanism "toggle" maps to figma.boolean's true/false branches — the true branch's content is not derivable from the contract; replace the placeholder with what the toggle stands for`,
    )
  }

  const prop = {
    name,
    designName,
    kind,
    ...(kind === "enum" ? { values: [...(entry.values || [])] } : {}),
    ...(mechanism === undefined ? {} : { mechanism }),
    ...(gates === undefined ? {} : { gates }),
  }

  return { included: true, prop, gaps }
}

// ---------------------------------------------------------------------------
// The example child — `codegen.exampleContent` / `codegen.example`'s three
// forms. See the module docblock.
// ---------------------------------------------------------------------------

function buildExampleFromDirective(directive) {
  if (directive === "authored") {
    return { kind: "authored", text: null, gap: null }
  }
  if (directive && directive.selfClose === true) {
    return { kind: "selfClose", text: null, gap: null }
  }
  if (directive && typeof directive.comment === "string") {
    return { kind: "comment", text: directive.comment, gap: null }
  }
  // Schema-valid input never reaches here; never guess a shape the schema
  // itself doesn't produce.
  return {
    kind: "gap",
    text: null,
    gap: `codegen.example has an unrecognized shape: ${JSON.stringify(directive)}`,
  }
}

function buildExample(codegen, { childrenIsMappedProp = false } = {}) {
  const directive = codegen?.example
  const exampleContent = codegen?.exampleContent
  const hasContent = typeof exampleContent === "string"

  // `children` mapped as a prop AND a literal text child would render
  // `<C children={children}>Continue</C>` — invalid React, since the two
  // conflict and the literal child wins. The schema is explicit that
  // `exampleContent` is for "when children are arbitrary nodes rather than a
  // MODELED prop", so a contract doing both has a real conflict. The mapped
  // prop takes precedence (it is the thing the design side actually binds)
  // and the conflict is reported rather than silently emitting broken JSX.
  //
  // `example: "authored"` is the exception (issue #486): a hand-written body
  // is the escape hatch for a render that cannot produce a compiling example,
  // and it renders whatever child the author writes, so it falls through to
  // the directive handling below. The other two directive forms would
  // replace or drop the child the design side binds, so they conflict the
  // same way `exampleContent` does — reported, never silently discarded.
  if (childrenIsMappedProp && directive !== "authored") {
    const conflicts = []
    if (hasContent)
      conflicts.push(
        "codegen.exampleContent is set but `children` is also a mapped prop — the example renders {children}; remove exampleContent, it applies only when children are arbitrary nodes",
      )
    if (directive !== undefined)
      conflicts.push(
        'codegen.example is set but `children` is also a mapped prop — the example renders {children} and ignores the directive; remove it, or use example: "authored" to hand-write the body',
      )
    return { kind: "prop", text: null, gap: conflicts.join("; ") || null }
  }

  if (directive !== undefined && hasContent) {
    // Mutually exclusive per the schema's own description, but JSON Schema
    // cannot express that constraint structurally — a contract setting both
    // made a mistake worth surfacing, not silently resolving. `example` wins:
    // it is the more specific of the two directives.
    return {
      ...buildExampleFromDirective(directive),
      gap: 'codegen.exampleContent and codegen.example are both set (mutually exclusive per schema) — "example" wins; remove one',
    }
  }

  if (directive !== undefined) return buildExampleFromDirective(directive)

  if (hasContent) return { kind: "text", text: exampleContent, gap: null }

  return {
    kind: "gap",
    text: null,
    gap: "no codegen.exampleContent or codegen.example directive — the example child is not derivable from the contract",
  }
}

// ---------------------------------------------------------------------------
// The model
// ---------------------------------------------------------------------------

/**
 * Build the Code Connect model for one contract. Pure; never throws.
 *
 * `model.ok === false` means there is nothing to generate against (no
 * `sources.code.path`, or no `conventions.codeConnectSuffix` configured —
 * the latter has no default, matching `stylesSuffix`'s own pattern) — the
 * caller should skip this contract, not call `renderCodeConnect` on the
 * result.
 *
 * @param {object} contract an already-loaded contract (`spec/contracts.mjs`'s
 *   `loadContract`/`loadContracts` — comment keys already stripped)
 * @param {object} [config] the project's (unresolved) config — only
 *   `conventions.codeConnectSuffix` is read from it
 * @param {object} [apiView] `spec/contracts.mjs`'s `contractApiView(contract)`
 *   — this module cannot compute it itself (providers may import only
 *   `core/`, never `spec/`); the caller (`cli/commands/codegen.mjs`) always
 *   supplies it. Omitted is treated as "no props," not an error — the
 *   guarantee this function never throws matters more than catching a
 *   caller bug that its own test suite already covers.
 * @returns {{ok: true, contractId: string, componentName: string, codePath: string, outputPath: string, importPath: string, className: boolean, domPassthrough: string|null, designTarget: string, props: Array<{name: string, designName: string, kind: string, values?: Array}>, example: {kind: string, text: string|null}, gaps: string[]} | {ok: false, contractId?: string, reason: string}}
 */
export function buildCodeConnectModel(
  contract,
  config = {},
  apiView = {},
  { namedExport = false } = {},
) {
  const codePath = contract?.sources?.code?.path
  if (typeof codePath !== "string" || codePath === "") {
    return {
      ok: false,
      contractId: typeof contract?.id === "string" ? contract.id : undefined,
      reason:
        "no sources.code.path — nothing to generate a Code Connect binding against",
    }
  }

  const { codeConnectSuffix } = resolveConventions(config)
  if (!codeConnectSuffix) {
    return {
      ok: false,
      contractId: contract.id,
      reason:
        "no conventions.codeConnectSuffix configured — nothing to name a Code Connect binding against",
    }
  }

  const codegen = contract.codegen || {}

  const gaps = []
  const props = []
  for (const name of Object.keys(apiView)) {
    const result = buildProp(name, apiView[name])
    gaps.push(...result.gaps)
    if (result.included) props.push(result.prop)
  }

  const target = resolveDesignTarget(contract)
  if (target.gap) gaps.push(target.gap)

  const example = buildExample(codegen, {
    childrenIsMappedProp: props.some(p => p.name === "children"),
  })
  if (example.gap) gaps.push(example.gap)

  return {
    ok: true,
    contractId: contract.id,
    componentName: contract.title,
    codePath,
    outputPath: deriveOutputPath(codePath, codeConnectSuffix),
    importPath: deriveImportPath(codePath),
    // Whether the component is a NAMED export (`export const X`), which the
    // code census reports; a default import of a named export does not
    // compile (issue #453). Defaults to a default import when unknown.
    namedExport: namedExport === true,
    className: codegen.className === true,
    domPassthrough:
      typeof codegen.domPassthrough === "string"
        ? codegen.domPassthrough
        : null,
    designTarget: target.value,
    props,
    example: { kind: example.kind, text: example.text },
    gaps,
  }
}

// ---------------------------------------------------------------------------
// Rendering — model -> the generated binding file's source text.
// ---------------------------------------------------------------------------

function renderHeader(model) {
  const lines = [
    "/**",
    " * GENERATED by design-delta from the contract named below — do not",
    " * hand-edit the props mapping or import; they are derived from it.",
    ` * Source contract: ${model.contractId}`,
  ]
  if (model.className) {
    lines.push(" * Accepts a `className` passthrough (not design-controlled).")
  }
  if (model.domPassthrough) {
    lines.push(` * Passes through native \`<${model.domPassthrough}>\` props.`)
  }
  if (model.example.kind === "authored") {
    lines.push(
      " * The example body below is HAND-AUTHORED — design-delta never",
    )
    lines.push(" * regenerates it; only the framing around it is generated.")
  }
  lines.push(" */")
  return lines.join("\n")
}

// The one thing a `toggle` binding cannot derive, marked in the generated
// file itself the same way the example gap is — a reader of the file sees
// the same gap `model.gaps` reports.
const TOGGLE_TRUE_BRANCH_GAP =
  "/* GAP: replace with what this toggle stands for */"

function renderPropEntry(prop) {
  const target = JSON.stringify(prop.designName)
  if (prop.kind === "enum") {
    const body = prop.values
      .map(v => `      ${JSON.stringify(v)}: ${JSON.stringify(v)},`)
      .join("\n")
    return `    ${prop.name}: figma.enum(${target}, {\n${body}\n    }),`
  }
  // A `toggle` mechanism's boolean hides a region rather than passing a
  // value, so the binding needs both branches (issue #457). The true branch
  // renders the design slot the contract says the toggle gates (issue #485);
  // with none named it is a GAP, not a guess.
  if (prop.mechanism === "toggle")
    return [
      `    ${prop.name}: figma.boolean(${target}, {`,
      prop.gates === undefined
        ? `      true: undefined ${TOGGLE_TRUE_BRANCH_GAP},`
        : `      true: figma.instance(${JSON.stringify(prop.gates)}),`,
      "      false: undefined,",
      "    }),",
    ].join("\n")
  if (prop.kind === "boolean")
    return `    ${prop.name}: figma.boolean(${target}),`
  if (prop.kind === "instance")
    return `    ${prop.name}: figma.instance(${target}),`
  return `    ${prop.name}: figma.string(${target}),`
}

// Omitted entirely when nothing is mapped — a conformant propless Code
// Connect file carries only `example`, so emitting an empty `props: {}` would
// be a spurious diff against it.
function renderPropsBlock(props) {
  if (props.length === 0) return null
  return `  props: {\n${props.map(renderPropEntry).join("\n")}\n  },`
}

function renderExample(model) {
  const paramNames = model.props.map(p => p.name)
  const destructure = paramNames.length ? `{ ${paramNames.join(", ")} }` : ""
  // `children` is structurally the element's CHILD in JSX, never an
  // attribute — emitting `children={children}` alongside a child is invalid
  // React and the child silently wins. Every other prop is an attribute.
  const attrProps = model.props.filter(p => p.name !== "children")
  const attrs = attrProps.map(p => `${p.name}={${p.name}}`).join(" ")
  const openAttrs = attrs ? ` ${attrs}` : ""
  const name = model.componentName

  let element
  switch (model.example.kind) {
    case "selfClose":
      element = `<${name}${openAttrs} />`
      break
    case "comment":
      element = `<${name}${openAttrs}>{/* ${model.example.text} */}</${name}>`
      break
    case "text":
      element = `<${name}${openAttrs}>${model.example.text}</${name}>`
      break
    case "prop":
      // `children` is a mapped prop: the design side binds it, so the example
      // renders it rather than a literal.
      element = `<${name}${openAttrs}>{children}</${name}>`
      break
    case "authored":
      // A placeholder scaffold only, for the case where no committed file
      // exists yet; once one does, `bindingStatus` cuts the hand-written body
      // out rather than comparing it (`maskExample`).
      // The note lives INSIDE the element: two JSX siblings inside the
      // arrow's parentheses are a syntax error (issue #453 — 77 of a real
      // project's 99 renders failed to parse on exactly that).
      element = `<${name}${openAttrs}>{/* AUTHORED — replace this scaffold by hand */}</${name}>`
      break
    case "gap":
    default:
      element = `<${name}${openAttrs}>${name} content{/* GAP: no example directive */}</${name}>`
      break
  }

  return `  example: (${destructure}) => (\n    ${element}\n  ),`
}

/**
 * Render a model built by `buildCodeConnectModel` to the generated binding
 * file's source text. Deterministic: the same model renders byte-identical text on every
 * call. Throws if `model.ok !== true` — a caller's job is to skip such a
 * model, never to render it.
 *
 * @param {object} model from `buildCodeConnectModel`
 * @returns {string}
 */
export function renderCodeConnect(model) {
  if (!model?.ok) {
    throw new Error(
      `renderCodeConnect: cannot render — ${model?.reason || "invalid model"}`,
    )
  }

  const propsBlock = renderPropsBlock(model.props)
  const exampleBlock = renderExample(model)
  const inner = propsBlock ? `${propsBlock}\n${exampleBlock}` : exampleBlock

  return `${renderHeader(model)}
import figma from "@figma/code-connect"

import ${model.namedExport ? `{ ${model.componentName} }` : model.componentName} from "${model.importPath}"

figma.connect(${model.componentName}, ${JSON.stringify(model.designTarget)}, {
${inner}
})
`
}

// ---------------------------------------------------------------------------
// Binding-file status (issue #400) — the read-only successor to the deleted
// `codegen` command's compare. The provider owns every Code Connect fact
// (what the file should contain, how an authored example is masked); the
// CLI owns the filesystem; `modules/components.mjs` turns statuses into
// findings. Nothing here writes.
// ---------------------------------------------------------------------------

/**
 * A binding file's source as a tree, reduced to what a formatter cannot
 * change (issue #609). Both sides are parsed as TSX by `typescript` and walked
 * into one canonical string; two files are the same binding when theirs are
 * equal. This replaced a character scan whose declared ceiling — a quoted
 * NUMERIC key, a PAIR of apostrophes in element text — #588 could only
 * announce as `compare-unreliable`. Parsed, neither is special: a property key
 * is its name however it is quoted, and a run of element text is one node
 * however a formatter wraps it.
 *
 * What a formatter owns has nothing to hold on to: comments and whitespace
 * are trivia, parentheses unwrap, a stray `;` is an empty statement and drops,
 * trailing commas are not nodes, a string literal is its value whatever the
 * quotes, and element text loses its whitespace (with a comment-only `{…}` or
 * a `{" "}` child dropped beside it). Everything else is the node's kind, its
 * children, and the few non-child fields that carry meaning (an operator,
 * `let`/`const`, a `type`-only import).
 *
 * Key ORDER is normalized too (issue #456), in the three places the renderer
 * derives it from the same arbitrary prop order — every object inside the
 * `props` initializer (each `figma.enum` value map included), the example's
 * destructured parameter, and an example element's attributes — because none
 * of those orderings mean anything to Code Connect, and the engine's own
 * prop-parity check already compares enum values as a set. An attribute run
 * is sorted only when every attribute in it is `name={name}`, the one shape
 * the renderer emits: a spread's position decides what it overrides, so
 * anything else keeps its order (a false `match` is worse than a false
 * `stale`).
 *
 * Imports the EXAMPLE needs are not drift (issue #459): every import other
 * than `@figma/code-connect` and the one binding the identifier
 * `figma.connect(<Ident>, …)` names is dropped. The component's own import,
 * path and style, is still compared.
 *
 * A toggle's `figma.boolean` branch VALUES are example content (issue #477):
 * the render can only emit `undefined` for what the toggle stands for, so a
 * value is neutralized to `undefined` unless it is `undefined` or a mapped
 * `figma.instance("…")` — the one value a contract derives (`design.gates`,
 * issue #485), and so the one a file can get wrong. The branch keys count.
 *
 * So is a string-literal attribute on an example element (issue #487): a prop
 * the design side does not model is declared `design: "none"` and the render
 * omits it, so a required one has to be supplied by hand for the example to
 * compile. Every attribute the renderer emits is `name={name}`, still compared.
 *
 * `maskExample` cuts the `example` value out entirely, for an authored
 * contract whose body is hand-written and never itself drift.
 *
 * @param {string} source
 * @param {object} ts a loaded `typescript` module (`./typescript.mjs`)
 * @param {{maskExample?: boolean}} [options]
 * @returns {string}
 */
export function comparableBindingSource(
  source,
  ts,
  { maskExample = false } = {},
) {
  const file = ts.createSourceFile(
    "binding.tsx",
    String(source ?? ""),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  )
  const connect = findConnectCall(ts, file)
  const target = connect?.arguments[0]
  const options = connect
    ? [...connect.arguments].reverse().find(ts.isObjectLiteralExpression)
    : undefined
  const field = name =>
    options?.properties.find(
      p => ts.isPropertyAssignment(p) && keyText(ts, p.name) === name,
    )?.initializer
  const example = field("example")
  const ctx = {
    ts,
    component: target && ts.isIdentifier(target) ? target.text : null,
    props: field("props"),
    example,
    exampleFn: example && ts.skipParentheses(example),
    maskExample,
  }
  return JSON.stringify(canonical(ctx, file, {}))
}

// `figma.<method>(…)`, as the render writes it.
function isFigmaCall(ts, node, method) {
  return (
    ts.isCallExpression(node) &&
    ts.isPropertyAccessExpression(node.expression) &&
    ts.isIdentifier(node.expression.expression) &&
    node.expression.expression.text === "figma" &&
    node.expression.name.text === method
  )
}

function findConnectCall(ts, node) {
  if (isFigmaCall(ts, node, "connect")) return node
  return ts.forEachChild(node, child => findConnectCall(ts, child))
}

// A property name as the object sees it, whatever its quoting: `size`,
// `"size"` and `'size'` are one key, and so are `400` and `"400"`. Undefined
// for a computed key, which is compared as written.
function keyText(ts, name) {
  if (ts.isIdentifier(name) || ts.isPrivateIdentifier(name)) return name.text
  if (ts.isStringLiteralLike(name)) return name.text
  if (ts.isNumericLiteral(name)) return String(Number(name.text))
  return undefined
}

function keepsImport(ctx, node) {
  const { ts } = ctx
  const from = node.moduleSpecifier
  if (ts.isStringLiteral(from) && from.text === "@figma/code-connect")
    return true
  const clause = node.importClause
  if (!clause || !ctx.component) return false
  const names = clause.name ? [clause.name.text] : []
  const bindings = clause.namedBindings
  if (bindings && ts.isNamespaceImport(bindings)) names.push(bindings.name.text)
  if (bindings && ts.isNamedImports(bindings))
    for (const element of bindings.elements) names.push(element.name.text)
  return names.includes(ctx.component)
}

// A toggle branch value a contract can derive, and so one still compared.
function keepsBranch(ts, value) {
  const node = ts.skipParentheses(value)
  if (ts.isIdentifier(node) && node.text === "undefined") return true
  return (
    isFigmaCall(ts, node, "instance") &&
    node.arguments.length > 0 &&
    ts.isStringLiteralLike(node.arguments[0])
  )
}

function isToggleBranch(ts, node, key) {
  const map = node.parent
  const call = map?.parent
  return (
    (key === "true" || key === "false") &&
    ts.isObjectLiteralExpression(map) &&
    call !== undefined &&
    isFigmaCall(ts, call, "boolean") &&
    call.arguments[1] === map
  )
}

// `name={name}` — the one attribute shape the renderer emits.
function isSelfBound(ts, attr) {
  const value = attr.initializer
  return (
    ts.isJsxAttribute(attr) &&
    ts.isIdentifier(attr.name) &&
    value !== undefined &&
    ts.isJsxExpression(value) &&
    value.expression !== undefined &&
    ts.isIdentifier(value.expression) &&
    value.expression.text === attr.name.text
  )
}

const byText = (a, b) => (a < b ? -1 : a > b ? 1 : 0)

function sorted(items) {
  return items
    .map(item => [JSON.stringify(item), item])
    .sort((a, b) => byText(a[0], b[0]))
    .map(([, item]) => item)
}

const UNDEFINED = ["id", "undefined"]

// One node → nested arrays, or null when it is formatting only. `mode.sort`
// is set inside `props`, `mode.example` inside the example.
function canonical(ctx, node, mode) {
  const { ts } = ctx
  if (node === ctx.example) {
    if (ctx.maskExample) return ["masked example"]
    mode = { ...mode, example: true }
  }
  if (node === ctx.props) mode = { ...mode, sort: true }
  const children = parent => {
    const out = []
    ts.forEachChild(parent, child => {
      const item = canonical(ctx, child, mode)
      if (item !== null) out.push(item)
    })
    return out
  }

  if (ts.isParenthesizedExpression(node))
    return canonical(ctx, node.expression, mode)
  if (node.kind === ts.SyntaxKind.EmptyStatement) return null
  if (ts.isImportDeclaration(node) && !keepsImport(ctx, node)) return null
  if (ts.isIdentifier(node) || ts.isPrivateIdentifier(node))
    return ["id", node.text]
  // Before the literal check: TypeScript's literal kinds span JSX text too.
  if (ts.isJsxText(node)) {
    const text = node.text.replace(/\s+/g, "")
    return text ? ["text", text] : null
  }
  if (ts.isStringLiteralLike(node)) return ["str", node.text]
  if (ts.isNumericLiteral(node)) return ["num", String(Number(node.text))]
  if (
    ts.isLiteralExpression(node) ||
    ts.isTemplateHead(node) ||
    ts.isTemplateMiddle(node) ||
    ts.isTemplateTail(node)
  )
    return [node.kind, node.text]
  if (
    ts.isJsxExpression(node) &&
    (ts.isJsxElement(node.parent) || ts.isJsxFragment(node.parent))
  ) {
    const value = node.expression && ts.skipParentheses(node.expression)
    if (!value || (ts.isStringLiteralLike(value) && value.text.trim() === ""))
      return null
  }
  if (ts.isPropertyAssignment(node)) {
    const key = keyText(ts, node.name)
    const value =
      isToggleBranch(ts, node, key) && !keepsBranch(ts, node.initializer)
        ? UNDEFINED
        : canonical(ctx, node.initializer, mode)
    return [
      "prop",
      key === undefined ? canonical(ctx, node.name, mode) : ["key", key],
      value,
    ]
  }
  if (mode.sort && ts.isObjectLiteralExpression(node))
    return [node.kind, ...sorted(children(node))]
  if (
    ts.isObjectBindingPattern(node) &&
    node.parent?.parent === ctx.exampleFn &&
    ctx.exampleFn !== undefined
  )
    return [node.kind, ...sorted(children(node))]
  if (mode.example && ts.isJsxAttributes(node)) {
    const kept = node.properties.filter(
      attr =>
        !(
          ts.isJsxAttribute(attr) &&
          attr.initializer !== undefined &&
          ts.isStringLiteral(attr.initializer)
        ),
    )
    const items = kept.map(attr => canonical(ctx, attr, mode))
    const selfBound = kept.length > 0 && kept.every(a => isSelfBound(ts, a))
    return [node.kind, ...(selfBound ? sorted(items) : items)]
  }

  const out = [node.kind]
  if (typeof node.operator === "number") out.push(node.operator)
  if (typeof node.keywordToken === "number") out.push(node.keywordToken)
  if (node.isTypeOnly === true) out.push("type")
  if (ts.isHeritageClause(node)) out.push(node.token)
  if (ts.isVariableDeclarationList(node))
    out.push(node.flags & (ts.NodeFlags.BlockScoped | ts.NodeFlags.Using))
  return out.concat(children(node))
}

// What a consumer without the optional peer is told, in the provider's own
// words (`modules/components.mjs` has none for it).
const TYPESCRIPT_NOT_INSTALLED = {
  id: "typescript-not-installed",
  detail:
    'the comparison parses both sides with `typescript`, an optional peer dependency that is not installed here, and the two differ as text — install it ("npm install --save-dev typescript") to compare this binding',
}

/**
 * Where this contract's binding file lives, or null when the contract or
 * config gives this provider nothing to bind (no `sources.code.path`, no
 * `conventions.codeConnectSuffix`) — null means "not applicable", the same
 * silence-on-no-configuration posture as every opt-in surface.
 *
 * @param {object} contract
 * @param {object} [config]
 * @returns {string|null} repo-relative path
 */
export function bindingPath(contract, config = {}) {
  const codePath = contract?.sources?.code?.path
  if (typeof codePath !== "string" || codePath === "") return null
  const { codeConnectSuffix } = resolveConventions(config)
  if (!codeConnectSuffix) return null
  return deriveOutputPath(codePath, codeConnectSuffix)
}

/**
 * Compare one contract's committed binding file against what the contract
 * renders. Pure — `committed` is the file's content (or null when absent),
 * read by the caller.
 *
 * An authored example body (`codegen.example: "authored"`) is cut out of
 * BOTH sides before comparing (`maskExample`), exactly as the deleted
 * `codegen --check` did: the body is hand-written and never itself drift;
 * everything else about the file still is.
 *
 * A contract with no `sources.design` is NOT applicable (issue #448): a Code
 * Connect binding is `figma.connect(<design node url>, …)`, so a contract
 * with no design node has nothing to bind to and "missing" is its only
 * possible state, not drift. `buildCodeConnectModel` still renders such a
 * contract with a placeholder target and a gap — that is the codegen path's
 * honest "here is what the contract cannot fill", a different question from
 * whether a committed file is expected.
 *
 * The comparison is STRUCTURAL, not textual (issue #452): both sides are
 * parsed and reduced by `comparableBindingSource` (issue #609) — comments,
 * whitespace, semicolons, parentheses, trailing commas and key quoting never
 * count — because a consumer's Prettier rewraps the one-line
 * `figma.connect(<Name>, "<url>", {` past any print width, and byte equality
 * made every formatted binding read as stale. Measured: 0 of 99 renders were
 * Prettier-stable in a real project.
 *
 * It is also order-insensitive across the orderings the renderer invents
 * (issue #456) — see `comparableBindingSource`. A hand-authored file that
 * listed the same props or the same enum values in another order is
 * semantically identical, and used to read as stale: 5 measured cases in a
 * real project.
 *
 * The parse needs `typescript`, an optional peer, loaded only here and only
 * when the two sides differ as text: byte-identical text is `match` with no
 * parse at all. Without it the status is `compare-unreliable` (issue #588's
 * status, issue #609's one remaining cause) carrying `ceiling` — never a
 * crash, and never a `stale` the engine could not see.
 *
 * @param {object} contract
 * @param {object} [config]
 * @param {object} [apiView] `contractApiView(contract)`
 * @param {string|null} [committed]
 * @param {{namedExport?: boolean, tsModuleName?: string}} [options]
 *   `namedExport` is what the code census knows about the component — see
 *   `buildCodeConnectModel`; `tsModuleName` overrides the module the parse
 *   loads (default `"typescript"`), so a test can exercise its absence
 * @returns {{applicable: false, reason: string} | {applicable: true, outputPath: string, status: "missing"|"stale"|"match"|"compare-unreliable", authored: boolean, expected: string, ceiling?: Array<{id: string, detail: string}>}}
 *   `expected` is the rendered text this contract says the file should hold —
 *   the very text the comparison was made against, carried out so a consumer
 *   can diff against it (issue #579). Rendered once here and never again
 *   downstream; nothing writes it. `ceiling` is present only on
 *   `compare-unreliable` and says why no comparison was possible (issue
 *   #588) — today only `typescript-not-installed`.
 */
export function bindingStatus(
  contract,
  config = {},
  apiView = {},
  committed = null,
  options = {},
) {
  const model = buildCodeConnectModel(contract, config, apiView, options)
  if (!model.ok) return { applicable: false, reason: model.reason }

  const design = contract?.sources?.design
  if (design === undefined || design === null)
    return {
      applicable: false,
      reason:
        "no sources.design — there is no design node to bind to, so no binding file is expected",
    }

  const authored = model.example.kind === "authored"
  // Rendered before the missing branch, not inside the comparison: a consumer
  // with no file at all is the one who most needs to be told what to write,
  // and the model is already `ok` here (issue #579). One render serves both
  // the comparison and the finding.
  const generated = renderCodeConnect(model)
  if (committed === null || committed === undefined)
    return {
      applicable: true,
      outputPath: model.outputPath,
      status: "missing",
      authored,
      expected: generated,
    }

  const compared = (status, ceiling) => ({
    applicable: true,
    outputPath: model.outputPath,
    status,
    authored,
    expected: generated,
    ...(ceiling ? { ceiling } : {}),
  })
  // Identical text needs no parser; anything else does (issue #609).
  if (committed === generated) return compared("match")
  const ts = loadTypeScript(options.tsModuleName)
  if (!ts) return compared("compare-unreliable", [TYPESCRIPT_NOT_INSTALLED])
  const reduce = text =>
    comparableBindingSource(text, ts, { maskExample: authored })
  return compared(reduce(generated) === reduce(committed) ? "match" : "stale")
}
