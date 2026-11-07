/**
 * normalize.mjs — the Figma provider's raw → normalized transforms (ADR-003
 * Phase 5.1). `providers/` may import only `core/` (D12); this file owns the
 * one place `hashJson` (`core/state.mjs`) gets called on Figma-shaped data,
 * per D6's "hashing happens Node-side in the normalizer, never inside the
 * design tool's own sandbox."
 *
 * NODE ID: a contract author copies a URL and gets a hyphen
 * (`?node-id=41-250`); the gather path and the retired v1 `baseline.json`
 * both return a colon (`41:250`, confirmed live against a real gather in
 * this phase's own validation). `normalizeNodeId` canonicalizes to `:` —
 * the one form every match in this provider compares against — and
 * `nodeIdToUrlSegment` reverses it for rendering a real Figma URL, since
 * that is the only form Figma's own UI accepts.
 *
 * CENSUS TRANSFORM (`censusComponentsFromRaw`): `list_file_components_for_
 * code_connect`'s raw shape, confirmed live against a real Figma file in
 * this phase's own validation — `{name, nodeId, type, pageId, pageName,
 * hasVariants, properties, childInstanceTags, instanceCount, dependencies,
 * assetKey}`, where `properties` is a map keyed by property name, each
 * entry `{name, type: "VARIANT"|"BOOLEAN"|"TEXT"|"SLOT", key,
 * variantOptions?, defaultValue?}`. The gather-determinism spike
 * (docs/spikes/gather-determinism.md) found this endpoint needs NO
 * normalization allowlist — no rounding, no re-ordering — so this transform
 * only RESHAPES the raw fields into the engine's own vocabulary
 * (`schema/design-components.schema.json`), it never adjusts a value. Only
 * `type: "COMPONENT_SET"` or `"COMPONENT"` entries are census units, per
 * the same spike; a raw entry of any other type is skipped, not guessed
 * into one.
 *
 * TOKEN CENSUS TRANSFORM (`censusTokensFromRaw`, ADR-003 Phase 5.3, structured
 * since issue #380): two file-level Desktop Bridge payloads —
 * `figma_get_variables` (every local variable with `resolvedType`, typed
 * per-mode values, alias target, collection) and `figma_get_text_styles`
 * (every local text style with unit-bearing `lineHeight`/`letterSpacing`) —
 * plus the legacy per-node `get_variable_defs` flat map, which still
 * ingests. Every record keeps a comparable string `value` (the snapshot
 * schema's one required value field, unchanged) and carries the structure
 * alongside, so a reader from before #380 still works and a reader after it
 * can compare per DTCG type. `modules/tokens.mjs` matches by NAME candidate
 * first (ADR-003 Amendment 4) and by value as coverage.
 */

import { compareStrings } from "../../core/text.mjs"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import Ajv from "ajv/dist/2020.js"
import addFormats from "ajv-formats"

import { hashJson } from "../../core/state.mjs"

// ---------------------------------------------------------------------------
// The design-components.json schema — loaded the same way core/state.mjs
// loads state.schema.json: package-root anchored, never cwd-anchored, so
// this resolves correctly from inside a consumer's node_modules too.
// ---------------------------------------------------------------------------

const PACKAGE_ROOT = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
)

export const DESIGN_COMPONENTS_SCHEMA_FILE = join(
  PACKAGE_ROOT,
  "schema",
  "design-components.schema.json",
)

const DESIGN_COMPONENTS_SCHEMA = JSON.parse(
  readFileSync(DESIGN_COMPONENTS_SCHEMA_FILE, "utf8"),
)

const ajv = new Ajv({ allErrors: true, strict: false })
addFormats(ajv)
const runDesignComponentsSchema = ajv.compile(DESIGN_COMPONENTS_SCHEMA)

/**
 * Schema-validate a `design-components.json` document before `ingest`
 * writes it — the same "never write invalid" discipline `core/state.mjs`
 * applies to `state.json`.
 *
 * @param {unknown} snapshot
 * @returns {{valid: boolean, errors: string[]}}
 */
export function validateDesignComponents(snapshot) {
  const valid = runDesignComponentsSchema(snapshot)
  if (valid) return { valid: true, errors: [] }
  const errors = (runDesignComponentsSchema.errors || []).map(
    err => `${err.instancePath || "(root)"} ${err.message}`,
  )
  return { valid: false, errors }
}

// ---------------------------------------------------------------------------
// The design-tokens.json schema (ADR-003 Phase 5.3) — the second of D7's two
// design-side snapshots, loaded the same package-root-anchored way.
// ---------------------------------------------------------------------------

export const DESIGN_TOKENS_SCHEMA_FILE = join(
  PACKAGE_ROOT,
  "schema",
  "design-tokens.schema.json",
)

const DESIGN_TOKENS_SCHEMA = JSON.parse(
  readFileSync(DESIGN_TOKENS_SCHEMA_FILE, "utf8"),
)

const runDesignTokensSchema = ajv.compile(DESIGN_TOKENS_SCHEMA)

/**
 * Schema-validate a `design-tokens.json` document before `ingest --tokens`
 * writes it.
 *
 * @param {unknown} snapshot
 * @returns {{valid: boolean, errors: string[]}}
 */
export function validateDesignTokens(snapshot) {
  const valid = runDesignTokensSchema(snapshot)
  if (valid) return { valid: true, errors: [] }
  const errors = (runDesignTokensSchema.errors || []).map(
    err => `${err.instancePath || "(root)"} ${err.message}`,
  )
  return { valid: false, errors }
}

// ---------------------------------------------------------------------------
// design.options (ADR-003 Amendment 3, built for Amendment 4's needs)
// ---------------------------------------------------------------------------

/**
 * What this provider accepts under `design.options`. Three keys, all
 * optional, all empty by default — every one shapes the design-name →
 * token-id CANDIDATE step in `modules/tokens.mjs`, none names a project's
 * tokens in the engine. Vocabulary is deliberately provider-neutral: the
 * only Figma-specific fact is that a variable name segments on `/`, and
 * that is already this provider's normalized output.
 */
export const configSchema = {
  type: "object",
  additionalProperties: false,
  patternProperties: { "^_": {} },
  properties: {
    tokenMap: {
      type: "object",
      description:
        'Explicit `"<variable name>": "<token id>"` overrides — the answer whenever present. `null` declares the variable has no code token at all (it is then neither compared nor reported). An object of `"<mode name>": "<token id>"` pairs each of the variable\'s modes with its own token, for a code side that keeps one token per mode (`{"sm": ["acme.layout.sm.gutter", "acme.layout.gutter"], "lg": "acme.layout.lg.gutter"}`, where the base token aliases the smallest tier): each mode is compared with each of its tokens, and a mode on one side only is `tokens/design-mode-missing`.',
      additionalProperties: {
        oneOf: [
          { type: "string", minLength: 1 },
          { type: "null" },
          {
            type: "object",
            minProperties: 1,
            additionalProperties: {
              oneOf: [
                { type: "string", minLength: 1 },
                {
                  type: "array",
                  minItems: 1,
                  items: { type: "string", minLength: 1 },
                },
              ],
            },
          },
        ],
      },
    },
    codeAuthoritativeGroups: {
      type: "array",
      description:
        "Token-id prefixes (`system.print`) whose tokens have no design counterpart by construction; candidates under them are dropped before uniqueness is judged.",
      items: { type: "string", minLength: 1 },
    },
    codeOnlyGroups: {
      type: "array",
      description:
        "Token-id prefixes (`system.layout`) that are code-only by design — no `tokens/code-token-undesigned` finding is raised for a token under one. Unlike `codeAuthoritativeGroups`, name matching still runs for them.",
      items: { type: "string", minLength: 1 },
    },
    includePrivateComponents: {
      type: "boolean",
      default: false,
      description:
        "Count the design tool's PRIVATE components — a name, or any `/`-separated path segment, starting with `.` or `_` — under `coverage/design-only` (issue #460). Off by default: such a component is excluded from the published library by the tool's own convention, exists only as an internal composition helper, and can never have a code counterpart, so a contract for it is not missing.",
    },
    ignoreVariables: {
      type: "array",
      description:
        "Design variable names to skip entirely — a substring, or `/…/` for a regular expression. For a gathered file that carries another library's variables.",
      items: { type: "string", minLength: 1 },
    },
    units: {
      type: "object",
      description:
        'The unit a bare-number variable is in, by name prefix (`"letterSpacing": "%"`) — a design tool\'s FLOAT carries none, so the project declares it; the engine never infers one from the value. `%` is a fraction of the font size (compared as em), `px`/`rem` are lengths, `em` is as written, `ms`/`s` make it a duration (a TIMING variable needs none — it is rendered in seconds with its unit). The longest matching prefix wins.',
      additionalProperties: { enum: ["%", "px", "em", "rem", "ms", "s"] },
    },
  },
}

const runConfigSchema = ajv.compile(configSchema)

/**
 * Validate a project's `design.options` block against `configSchema`. Same
 * `{valid, errors}` shape as `validateDesignTokens`.
 *
 * @param {unknown} options
 * @returns {{valid: boolean, errors: string[]}}
 */
export function validateDesignOptions(options) {
  if (options === undefined) return { valid: true, errors: [] }
  const valid = runConfigSchema(options)
  if (valid) return { valid: true, errors: [] }
  const errors = (runConfigSchema.errors || []).map(
    err => `${err.instancePath || "(root)"} ${err.message}`,
  )
  return { valid: false, errors }
}

// ---------------------------------------------------------------------------
// nodeId
// ---------------------------------------------------------------------------

const NODE_ID_RE = /^(\d+)[:-](\d+)$/

/**
 * Whether `nodeId` matches the shape this provider recognizes at all
 * (either separator) — the one place that shape is spelled out. Every
 * other check against a nodeId's validity (`sourceSchema`'s own `pattern`
 * excepted, which Ajv needs as a literal) goes through this.
 *
 * @param {unknown} nodeId
 * @returns {boolean}
 */
export function isNodeId(nodeId) {
  return typeof nodeId === "string" && NODE_ID_RE.test(nodeId)
}

/**
 * @param {string} nodeId either separator
 * @returns {string} the canonical `:`-separated form; returns the input
 *   unchanged if it doesn't match the expected shape (never throws — an
 *   unrecognized nodeId is a data problem for the caller to report, not
 *   this function's to guess at).
 */
export function normalizeNodeId(nodeId) {
  if (typeof nodeId !== "string") return nodeId
  const match = nodeId.match(NODE_ID_RE)
  return match ? `${match[1]}:${match[2]}` : nodeId
}

/**
 * @param {string} nodeId either separator
 * @returns {string} the hyphenated form a real Figma URL's `node-id` query
 *   param uses — confirmed against the consuming project this was validated
 *   against, whose hand-maintained `.figma.tsx` files all use this exact
 *   shape.
 */
export function nodeIdToUrlSegment(nodeId) {
  return normalizeNodeId(nodeId).replace(":", "-")
}

// ---------------------------------------------------------------------------
// Census transform
// ---------------------------------------------------------------------------

// Each census-unit type, in the engine's own vocabulary (issue #658): a
// `variant-set`'s gathered children are its VARIANTS, each a whole component,
// while a `component`'s are its own layers. `modules/anatomy.mjs` needs that
// one fact to know which node a contract's `root` children sit under, and
// must never learn the raw type strings that carry it here (ADR-001 D12).
const CENSUS_UNITS = { COMPONENT_SET: "variant-set", COMPONENT: "component" }
const CENSUS_UNIT_TYPES = new Set(Object.keys(CENSUS_UNITS))

/**
 * What kind of census unit a design component is, in the engine's own
 * vocabulary — `"variant-set"` or `"component"` — or `null` for a type that
 * is not a census unit at all. Read from the record's own `type`, so a
 * snapshot written before `unit` existed answers the same way.
 *
 * @param {{type?: string}} component a raw or normalized component entry
 * @returns {"variant-set"|"component"|null}
 */
export function censusUnitOf(component) {
  return CENSUS_UNITS[component?.type] ?? null
}

function normalizeVariantProperties(properties) {
  const out = {}
  for (const prop of Object.values(properties || {})) {
    if (prop?.type !== "VARIANT") continue
    out[prop.name] = [...(prop.variantOptions || [])]
  }
  return Object.keys(out).length > 0 ? out : undefined
}

function normalizePropertyDefinitions(properties) {
  const out = {}
  for (const prop of Object.values(properties || {})) {
    if (prop === null || typeof prop !== "object") continue
    if (prop.type === "VARIANT") continue
    if (typeof prop.key !== "string") continue
    if (typeof prop.name !== "string") continue
    out[prop.key] = { type: prop.type, name: prop.name }
  }
  return Object.keys(out).length > 0 ? out : undefined
}

// ADR-003 Phase 5.2's own vocabulary bridge — Figma's raw property `type`
// values that `normalizePropertyDefinitions` carries through verbatim, mapped
// onto the SAME type vocabulary `sources/react/extract.mjs` classifies a code
// prop into. VARIANT has no entry here: it becomes `enum` via
// `variantProperties` instead, a set-of-options concept `componentProps`
// handles separately.
const PROP_TYPE_MAP = { BOOLEAN: "boolean", TEXT: "string", SLOT: "slot" }

/**
 * One normalized `designComponent` (`schema/design-components.schema.json`'s
 * `variantProperties`/`propertyDefinitions`) reduced to the SAME `{name,
 * type, values?}` prop shape `sources/react/extract.mjs` returns for a code
 * component — the whole point of ADR-003 Phase 5.2: `modules/components.mjs`
 * runs its ONE existing prop-parity algorithm against either side unchanged,
 * because both sides hand it data in this one shape. Never carries
 * `required`/`default`: Figma component properties have no code-shaped
 * "optional" concept, so the comparisons that need those fields (`components/
 * prop-default-mismatch`/`prop-optionality-mismatch`) naturally never fire
 * design-side rather than inventing a value the data doesn't support.
 *
 * @param {{variantProperties?: object, propertyDefinitions?: object}} designComponent
 * @returns {Array<{name: string, type: string, values?: string[]}>} sorted by
 *   name, the same determinism convention every census here keeps
 */
export function componentProps(designComponent) {
  const props = []
  for (const [name, values] of Object.entries(
    designComponent?.variantProperties || {},
  )) {
    if (!Array.isArray(values)) continue
    props.push({ name, type: "enum", values: [...values] })
  }
  for (const def of Object.values(designComponent?.propertyDefinitions || {})) {
    if (typeof def?.name !== "string") continue
    const type = PROP_TYPE_MAP[def.type]
    if (!type) continue
    props.push({ name: def.name, type })
  }
  return props.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
}

/**
 * One raw `list_file_components_for_code_connect` entry → this schema's
 * `designComponent` shape, or `null` when the entry isn't a census unit
 * (a variant child never reaches this function at all — the endpoint
 * itself never returns one as a top-level entry, per the spike).
 *
 * `fileKey` is carried on every entry (not a document-level field): D7 fixes
 * exactly TWO snapshot files project-wide, but a real consuming project can
 * address several distinct Figma files across its own contracts — one
 * `design-components.json` combines every configured file's census, so the
 * join key against a contract's `sources.design` has to live per-entry.
 *
 * @param {object} raw one entry from the raw payload array
 * @param {string} fileKey which file this entry was gathered from
 * @returns {object|null}
 */
function normalizeComponent(raw, fileKey) {
  if (!CENSUS_UNIT_TYPES.has(raw?.type)) return null
  if (typeof raw?.nodeId !== "string" || typeof raw?.name !== "string")
    return null

  const variantProperties = normalizeVariantProperties(raw.properties)
  const propertyDefinitions = normalizePropertyDefinitions(raw.properties)

  const record = {
    fileKey,
    nodeId: normalizeNodeId(raw.nodeId),
    name: raw.name,
    type: raw.type,
    ...(variantProperties ? { variantProperties } : {}),
    ...(propertyDefinitions ? { propertyDefinitions } : {}),
    rawProps: {
      pageId: raw.pageId,
      pageName: raw.pageName,
      hasVariants: raw.hasVariants,
      childInstanceTags: raw.childInstanceTags,
      instanceCount: raw.instanceCount,
      dependencies: raw.dependencies,
      assetKey: raw.assetKey,
    },
  }

  // `unit` is derived from `type` alone, which the hash already covers, so it
  // sits outside the hash: adding it moves no existing `treeHash`.
  return { ...record, unit: censusUnitOf(raw), treeHash: hashJson(record) }
}

/**
 * The raw `list_file_components_for_code_connect` payload (a plain array)
 * for ONE file → its `designComponent` records. Never throws: a malformed
 * raw ENTRY is skipped, not fatal to the rest of the file's census
 * (`skipped` names how many, the same "surface skips, it doesn't fail the
 * run" convention every other census here follows). The caller (`ingest`)
 * concatenates this across every gathered file into the one combined
 * `design-components.json`.
 *
 * `payloadValid: false` is a DIFFERENT case from a valid, empty array: the
 * whole payload isn't the shape this provider's gather tool produces at
 * all — a raw envelope whose `payload` this provider doesn't recognize. An
 * empty `components` array here means "checked, nothing there" everywhere
 * else this census feeds into (D7's own convention), so the caller must be
 * able to tell that apart from "couldn't check this file at all" rather
 * than silently reporting a false 0.
 *
 * @param {string} fileKey
 * @param {unknown} payload the raw envelope's `payload` field
 * @returns {{components: object[], skipped: number, payloadValid: boolean}}
 */
export function censusComponentsFromRaw(fileKey, payload) {
  if (!Array.isArray(payload)) {
    return { components: [], skipped: 0, payloadValid: false }
  }

  const components = []
  let skipped = 0

  for (const raw of payload) {
    const normalized = normalizeComponent(raw, fileKey)
    if (normalized) components.push(normalized)
    else skipped++
  }

  return { components, skipped, payloadValid: true }
}

// ---------------------------------------------------------------------------
// Token census transform (ADR-003 Phase 5.3; structured since issue #380).
// ---------------------------------------------------------------------------

// Two structured payload shapes, one legacy one. Dispatched on the
// envelope's `tool` when it says, else on the payload's own shape — a raw
// file gathered before #380 carries `tool: "get_variable_defs"` or nothing.

function round4(value) {
  return Math.round(Number(value) * 1e4) / 1e4
}

function hexByte(channel) {
  return Math.round(Math.max(0, Math.min(1, channel)) * 255)
    .toString(16)
    .padStart(2, "0")
}

// Figma's `{r, g, b, a}` (0–1 floats) → `#rrggbb`, or `#rrggbbaa` when the
// alpha is not 1 — the same spelling `resolvedValuesByMode` reports.
function rgbaToHex({ r, g, b, a = 1 }) {
  const hex = `#${hexByte(r)}${hexByte(g)}${hexByte(b)}`
  return a >= 1 ? hex.toUpperCase() : `${hex}${hexByte(a)}`.toUpperCase()
}

// A COLOR variable whose alias has its opacity bound to a FLOAT variable
// (issue #517): the tool stores the mode value as `{color, opacity}`, each
// side an alias or a literal, and resolves it to `null` — it cannot follow an
// alias into another library file. Both halves are named here so
// `resolveColorOpacityPair` can look them up in the cross-file index.
function colorOpacityPair(raw) {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null
  if (!("color" in raw) || !("opacity" in raw)) return null
  return { color: raw.color, opacity: raw.opacity }
}

// One half of a pair → a concrete value, following the index as far as the
// aliases go: a pair's opacity commonly aliases a variable that itself
// aliases a library primitive (measured: `opacity/scrim` → `opacity/90`).
// `null` means it could not be resolved (an alias into a file this gather
// never covered), which is reported, never guessed at. The hop limit ends a
// cycle; an alias chain this long is already unreadable.
function resolveHalf(half, lookup) {
  let value = half
  for (let hop = 0; hop < 10; hop++) {
    if (value === null || value === undefined) return null
    if (typeof value !== "object" || value.type !== "VARIABLE_ALIAS")
      return value
    value = lookup?.(value.id) ?? null
  }
  return null
}

// Figma states an opacity variable in PERCENT — the one measured sample
// (`opacity/scrim` = 90 rendering as alpha 0.9) is the vendor's own scale,
// and this file is the only place allowed to know it.
function opacityToAlpha(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return null
  const alpha = value / 100
  return alpha >= 0 && alpha <= 1 ? alpha : null
}

// `{color, opacity}` → the same `#RRGGBBAA` string a plain color mode value
// renders as, or `null` when either half is unresolvable.
function resolveColorOpacityPair(pair, lookup) {
  const color = resolveHalf(pair.color, lookup)
  const alpha = opacityToAlpha(resolveHalf(pair.opacity, lookup))
  if (alpha === null) return null
  if (color === null || typeof color !== "object" || !("r" in color))
    return null
  return rgbaToHex({ ...color, a: (color.a ?? 1) * alpha })
}

// A raw per-mode value → the JSON-stable typed form the snapshot carries.
function typedVariableValue(raw, resolvedType) {
  if (raw && typeof raw === "object" && raw.type === "VARIABLE_ALIAS")
    return { alias: raw.id }
  if (resolvedType === "COLOR" && raw && typeof raw === "object")
    return rgbaToHex(raw)
  // The tool's TIMING type is SECONDS (issue #447). Rendered with its unit
  // here, where the vendor's type vocabulary lives, so the engine reads a
  // plain `<n>s` duration and never learns the word TIMING.
  if (resolvedType === "TIMING" && typeof raw === "number")
    return `${round4(raw)}s`
  if (typeof raw === "number") return round4(raw)
  return raw
}

// The one string every reader can still compare (`value` is required and a
// string in the snapshot schema): the default mode's resolved value.
function renderVariableValue(typed) {
  if (typed === null || typed === undefined) return null
  if (typeof typed === "object") return null // an unresolved alias — no value of its own
  return String(typed)
}

function legacyTokenValue(raw) {
  // An EMPTY string is not a value, it is the absence of one — a gradient
  // paint style has no single scalar the flat shape can carry, and the tool
  // returns "" for it. Persisting that wrote a census row asserting nothing,
  // which `tokens/design-value-untracked` then reported as a value mismatch
  // — the outcome of a comparison the engine never performed (issue #347).
  if (typeof raw === "string") return raw.trim() === "" ? null : raw
  if (typeof raw === "number" || typeof raw === "boolean") return String(raw)
  return null // an object/array/null value — not this tool's documented shape
}

function censusLegacyTokens(payload) {
  const tokens = []
  let skipped = 0
  for (const [name, raw] of Object.entries(payload)) {
    const value = legacyTokenValue(raw)
    if (value === null) {
      skipped++
      continue
    }
    tokens.push({ name, kind: "variable", value })
  }
  return { tokens, skipped, payloadValid: true }
}

// `figma_get_variables` (format: full): `{data: {variables: [...],
// variableCollections: [...]}}`, or the same two arrays at the top level.
/**
 * Every variable in these payloads, by the two ids another file's alias can
 * name it with: its own `id`, and `<key>/<id-ish>` — the form a SUBSCRIBED
 * library variable's alias carries (measured: `bg/scrim/default`'s opacity
 * alias is `VariableID:<opacity/90's key>/3263:143`). Values are the raw
 * per-mode ones, reduced to the variable's default mode, since a pair's two
 * halves are single values, not mode maps.
 *
 * Opaque to the engine: `cli/commands/ingest.mjs` builds it from every raw
 * token payload and hands it back to `censusTokens` unread (D12).
 */
export function indexTokens(payloads) {
  const valueById = new Map()
  const nameById = new Map()
  for (const entry of payloads || []) {
    const payload = entry?.payload ?? entry
    const data =
      payload?.data && typeof payload.data === "object" ? payload.data : payload
    const variables = Array.isArray(data?.variables) ? data.variables : []
    const collections = new Map(
      (Array.isArray(data?.variableCollections)
        ? data.variableCollections
        : []
      ).map(collection => [collection.id, collection]),
    )
    for (const variable of variables) {
      if (typeof variable?.id !== "string") continue
      const collection = collections.get(variable.variableCollectionId)
      const byMode = variable.valuesByMode || {}
      const defaultValue =
        byMode[collection?.defaultModeId] ?? Object.values(byMode)[0]
      // An alias resolves one more hop through the index itself at read time
      // — recorded as the alias so a chain across files still resolves.
      // ONLY the key form. A bare `VariableID:1:2` is unique inside its own
      // file and nowhere else, so indexing one across files makes a local
      // alias resolve to whatever unrelated variable another file happens to
      // number the same (measured: `fontSize/26` resolved to `borderWidth/2`).
      // Local ids stay local — `censusVariables` resolves those from its own
      // payload and only falls back to this index.
      if (typeof variable.key !== "string" || variable.key === "") continue
      const id = `key:${variable.key}`
      if (defaultValue !== undefined && !valueById.has(id))
        valueById.set(id, defaultValue)
      if (typeof variable.name === "string" && !nameById.has(id))
        nameById.set(id, variable.name)
    }
  }
  // A SUBSCRIBED library variable's alias id is `VariableID:<key>/<local
  // part>`, where the local part belongs to the alias, not the target — the
  // key before the "/" is the only half that identifies it. An id with no
  // "/" is local to its own file and never resolves here.
  const lookup = map => ({
    get(id) {
      if (typeof id !== "string") return undefined
      const slash = id.indexOf("/")
      if (slash < 0) return undefined
      return map.get(`key:${id.slice("VariableID:".length, slash)}`)
    },
  })
  return { valueById: lookup(valueById), nameById: lookup(nameById) }
}

function censusVariables(payload, index) {
  const data =
    payload?.data && typeof payload.data === "object" ? payload.data : payload
  const variables = Array.isArray(data?.variables) ? data.variables : null
  if (!variables) return null
  const collections = new Map(
    (Array.isArray(data.variableCollections)
      ? data.variableCollections
      : []
    ).map(collection => [collection.id, collection]),
  )
  const nameById = new Map(
    variables.map(variable => [variable.id, variable.name]),
  )
  // This payload's own variables first — a bare `VariableID:…` is local to
  // the file it was gathered from — then the cross-file index, which only
  // answers the `<key>/…` form a subscribed library variable's alias carries.
  const valueById = new Map()
  for (const variable of variables) {
    const collection = collections.get(variable.variableCollectionId)
    const byMode = variable.valuesByMode || {}
    const value = byMode[collection?.defaultModeId] ?? Object.values(byMode)[0]
    if (value !== undefined) valueById.set(variable.id, value)
  }
  const valueLookup = id =>
    valueById.has(id) ? valueById.get(id) : index?.valueById?.get(id)
  const nameLookup = id => nameById.get(id) ?? index?.nameById?.get(id)
  const tokens = []
  const unresolvedPairs = new Set()
  let skipped = 0
  for (const variable of variables) {
    if (typeof variable?.name !== "string" || variable.name === "") {
      skipped++
      continue
    }
    const collection = collections.get(variable.variableCollectionId)
    const modeNames = new Map(
      (collection?.modes || []).map(mode => [mode.modeId, mode.name]),
    )
    const values = {}
    let aliasOf
    for (const [modeId, raw] of Object.entries(variable.valuesByMode || {})) {
      const modeName = modeNames.get(modeId) || modeId
      // A color-plus-opacity pair (issue #517) is resolved here, through the
      // cross-file index, before the ordinary typed path — its own
      // `resolvedValuesByMode` is `null`, and `rgbaToHex` on the pair itself
      // would render `#NANNANNAN`.
      const pair =
        variable.resolvedType === "COLOR" ? colorOpacityPair(raw) : null
      if (pair) {
        const resolved = resolveColorOpacityPair(pair, valueLookup)
        if (resolved === null) {
          unresolvedPairs.add(variable.name)
          continue
        }
        values[modeName] = resolved
        if (pair.color?.type === "VARIABLE_ALIAS")
          aliasOf = nameLookup(pair.color.id) || aliasOf || pair.color.id
        continue
      }
      const typed = typedVariableValue(raw, variable.resolvedType)
      if (typed && typeof typed === "object" && typed.alias) {
        aliasOf = nameLookup(typed.alias) || typed.alias
        // Prefer the tool's own resolution of the alias for this mode. It
        // cannot follow one into another library file (measured: an alias to
        // a subscribed variable resolves to `null`), so the cross-file index
        // answers those — before #517 the whole variable was dropped for want
        // of a value.
        const resolved = variable.resolvedValuesByMode?.[modeName]?.value
        const viaIndex =
          resolved === undefined || resolved === null
            ? resolveHalf(raw, valueLookup)
            : resolved
        values[modeName] =
          viaIndex !== null && viaIndex !== undefined
            ? typedVariableValue(viaIndex, variable.resolvedType)
            : typed
      } else {
        values[modeName] = typed
      }
    }
    const defaultMode =
      modeNames.get(collection?.defaultModeId) || Object.keys(values)[0]
    const value = renderVariableValue(values[defaultMode])
    if (value === null) {
      skipped++
      continue
    }
    const token = {
      name: variable.name,
      kind: "variable",
      value,
      resolvedType: variable.resolvedType,
      values,
    }
    if (collection?.name) token.collection = collection.name
    if (aliasOf) token.aliasOf = aliasOf
    tokens.push(token)
  }
  return {
    tokens,
    skipped,
    payloadValid: true,
    ...(unresolvedPairs.size > 0
      ? {
          unresolved: [...unresolvedPairs].sort(compareStrings).map(name => ({
            name,
            reason:
              "its value is a color alias with a bound opacity, and one of the two points at a variable no gathered file carries — gather every file this one subscribes to, or the pair cannot be resolved",
          })),
        }
      : {}),
  }
}

// Render a text style the way `get_variable_defs` used to, so `value` stays
// a comparable string; the structure rides alongside in `style`.
function renderTextStyle(style) {
  const unit = measure =>
    measure && typeof measure === "object"
      ? `${round4(measure.value)}${measure.unit === "PERCENT" ? "%" : measure.unit === "PIXELS" ? "px" : ""}`
      : String(measure ?? "auto")
  return `Font(family: "${style.fontFamily}", style: ${style.fontStyle}, size: ${round4(style.fontSize)}, lineHeight: ${unit(style.lineHeight)}, letterSpacing: ${unit(style.letterSpacing)})`
}

// `figma_get_text_styles`: `{data: {styles: [...]}}` or `{styles: [...]}`.
function censusTextStyles(payload) {
  const data =
    payload?.data && typeof payload.data === "object" ? payload.data : payload
  const styles = Array.isArray(data?.styles) ? data.styles : null
  if (!styles) return null
  const tokens = []
  let skipped = 0
  for (const style of styles) {
    if (
      typeof style?.name !== "string" ||
      style.name === "" ||
      typeof style.fontSize !== "number"
    ) {
      skipped++
      continue
    }
    const measure = raw =>
      raw && typeof raw === "object"
        ? { value: round4(raw.value), unit: String(raw.unit) }
        : undefined
    const structured = {
      fontFamily: style.fontFamily,
      fontStyle: style.fontStyle,
      fontSize: round4(style.fontSize),
      ...(measure(style.lineHeight)
        ? { lineHeight: measure(style.lineHeight) }
        : {}),
      ...(measure(style.letterSpacing)
        ? { letterSpacing: measure(style.letterSpacing) }
        : {}),
      ...(style.textCase ? { textCase: style.textCase } : {}),
      ...(style.textDecoration ? { textDecoration: style.textDecoration } : {}),
    }
    tokens.push({
      name: style.name,
      kind: "textStyle",
      value: renderTextStyle(structured),
      style: structured,
    })
  }
  return { tokens, skipped, payloadValid: true }
}

/**
 * One raw envelope's `payload` → `designToken` records. Never throws.
 *
 * Three shapes (issue #380): `figma_get_variables` output (structured
 * variables, one file), `figma_get_text_styles` output (structured text
 * styles, one file), and the legacy per-node `get_variable_defs` flat
 * `{name: "value"}` map. `tool` from the envelope decides when present;
 * otherwise the payload's own shape does. Every record carries `kind` and a
 * comparable string `value`; the structured fields ride alongside for the
 * per-type canonical comparison.
 *
 * `payloadValid: false` is the same distinct case `censusComponentsFromRaw`
 * makes: a payload that is none of the three shapes is "couldn't census
 * this file," never a silent empty census.
 *
 * @param {unknown} payload the raw envelope's `payload` field
 * @param {{tool?: string}} [options]
 * @returns {{tokens: object[], skipped: number, payloadValid: boolean}}
 */
export function censusTokensFromRaw(payload, { tool, index } = {}) {
  const isPlainObject =
    payload !== null && typeof payload === "object" && !Array.isArray(payload)
  if (!isPlainObject) return { tokens: [], skipped: 0, payloadValid: false }

  if (tool === "figma_get_variables" || (!tool && censusVariables(payload)))
    return (
      censusVariables(payload, index) || {
        tokens: [],
        skipped: 0,
        payloadValid: false,
      }
    )
  if (tool === "figma_get_text_styles" || (!tool && censusTextStyles(payload)))
    return (
      censusTextStyles(payload) || {
        tokens: [],
        skipped: 0,
        payloadValid: false,
      }
    )
  return censusLegacyTokens(payload)
}

// ---------------------------------------------------------------------------
// Bindings census (issue #401): a deep-component payload → the deduplicated,
// sorted list of variable NAMES the component's tree binds. The deep tool
// reports `boundVariables` with names resolved at every level; this walks
// the whole payload and collects every name it can read, defensively —
// a string value, a `{name}` object, or an array of either — because the
// binding value's exact wrapper is the tool's own vocabulary, while the
// NAME inside it is what the engine's design census speaks.
//
// The SAME payload also answers a second question (issue #403): which variant
// COMBINATIONS a component set actually enumerates. `variantProperties` (from
// the component-listing tool) says which options each property offers, never
// which of their combinations were published — and the deep tool is the one
// gather surface that returns the set's variant children, whose names carry
// Figma's canonical `Prop=Value, Prop2=Value2` assignment. So both fields come
// off one payload and one pass, rather than adding a fourth gather target.
// ---------------------------------------------------------------------------

function collectBoundVariableNames(value, names) {
  if (Array.isArray(value)) {
    for (const item of value) collectBoundVariableNames(item, names)
    return
  }
  if (value === null || typeof value !== "object") return
  for (const [key, child] of Object.entries(value)) {
    if (key === "boundVariables" && child && typeof child === "object") {
      collectNamesFrom(child, names)
    } else {
      collectBoundVariableNames(child, names)
    }
  }
}

function collectNamesFrom(value, names) {
  if (typeof value === "string" && value.length > 0) {
    // A bare string binding is a NAME only when it is not an opaque
    // variable id — the deep tool emits `VariableID:…` for a LIBRARY
    // variable it cannot resolve locally (measured live, 2026-08-30:
    // a components file consuming a design-system library resolves zero
    // names, `_variableMapSize: 0`). An id ingested as a name would poison
    // the census with strings no candidate mapping can ever match.
    if (!value.startsWith("VariableID:")) names.add(value)
    return
  }
  if (Array.isArray(value)) {
    for (const item of value) collectNamesFrom(item, names)
    return
  }
  if (value === null || typeof value !== "object") return
  if (typeof value.name === "string" && value.name.length > 0) {
    names.add(value.name)
    return
  }
  // An object without a `name` (the `{id}` / `{type, id}` alias wrappers)
  // carries no name to collect — descending into it would harvest its id
  // string as if it were one.
  if (typeof value.id === "string") return
  for (const child of Object.values(value)) collectNamesFrom(child, names)
}

// The deep tool wraps the tree — accept either the node itself or a wrapper
// carrying it under a conventional key. Shared by both censuses that read a
// deep-component payload (bindings, #401; layers, #402), so the two can never
// disagree about which envelopes they can read.
function nodeRootOf(payload) {
  const root =
    payload && typeof payload === "object" && !Array.isArray(payload)
      ? (payload.component ?? payload.node ?? payload.tree ?? payload)
      : null
  const isNodeish =
    root &&
    typeof root === "object" &&
    ("id" in root || "name" in root || "children" in root || "type" in root)
  return isNodeish ? root : null
}

// One variant child's NAME → its property assignment, or `null` when the name
// is not an assignment at all. Figma's canonical form is `Prop=Value` pairs
// joined by `, `, and it forbids `,` and `=` inside a property name or value
// precisely so this name stays parseable; spaces around either separator are
// tolerated, and a value may itself contain them. A name that does not parse
// is an ordinary layer name, never a combination to guess at.
function parseVariantChildName(name) {
  if (typeof name !== "string" || !name.includes("=")) return null
  const assignment = {}
  for (const part of name.split(",")) {
    const at = part.indexOf("=")
    if (at < 0) return null
    const property = part.slice(0, at).trim()
    const value = part.slice(at + 1).trim()
    if (property === "" || value === "") return null
    assignment[property] = value
  }
  return Object.keys(assignment).length > 0 ? assignment : null
}

// Key order is the comparison's own vocabulary, not the payload's: a
// combination is a SET of assignments, so two children naming the same pairs
// in different orders are one combination.
function sortObjectKeys(object) {
  return Object.fromEntries(
    Object.keys(object)
      .sort(compareStrings)
      .map(key => [key, object[key]]),
  )
}

// Variant-child NAMES → the deduplicated, sorted combinations they enumerate.
// Shared by both bindings censuses (the deep-component envelope reads the
// names off the tree's direct children, the in-plugin result document gets
// them as a list), so the two can never disagree about what a combination is.
function variantCombinationsFromNames(names) {
  const byKey = new Map()
  for (const name of names) {
    const assignment = parseVariantChildName(name)
    if (!assignment) continue
    const combination = sortObjectKeys(assignment)
    byKey.set(JSON.stringify(combination), combination)
  }
  return [...byKey.keys()].sort(compareStrings).map(key => byKey.get(key))
}

/**
 * One raw bindings envelope's `payload` → the variable names its tree
 * binds, and the variant combinations its DIRECT children enumerate.
 * `payloadValid: false` when the payload is not an object shaped like a node
 * tree at all — same "couldn't census" discipline as every other census here.
 *
 * `variantCombinations` reads only direct children on purpose: those are a
 * component set's variant children, and a deeper layer that happens to be
 * named `state=hover` is a layer of ONE variant, not a combination of the
 * set. A variant-less component simply has none, which is a real, empty
 * answer — the caller decides whether an empty list is worth recording (see
 * `cli/commands/ingest.mjs`, which records it only for a `COMPONENT_SET`).
 *
 * @param {unknown} payload the raw envelope's `payload` field
 * @returns {{usedVars: string[], variantCombinations: object[], payloadValid: boolean}}
 */
export function censusBindingsFromRaw(payload) {
  const root = nodeRootOf(payload)
  if (!root)
    return { usedVars: [], variantCombinations: [], payloadValid: false }

  const names = new Set()
  collectBoundVariableNames(root, names)

  return {
    usedVars: [...names].sort(compareStrings),
    variantCombinations: variantCombinationsFromNames(
      (Array.isArray(root.children) ? root.children : []).map(
        child => child?.name,
      ),
    ),
    payloadValid: true,
  }
}

/**
 * The in-plugin RESULT DOCUMENT one bindings target now produces (issue
 * #417) → one census record per node it covers. Where the deep-component
 * envelope above carries a whole node tree for ONE node, this carries an
 * already-walked answer for EVERY node of one file, keyed by node id:
 * `{name, type, nodes, usedVars, unresolved, variantChildren?}`.
 *
 * `usedVars` still goes through the same name collection the tree census
 * uses, so the `VariableID:` rejection guard covers this shape too: the
 * script resolves names in-plugin and reports what it could not resolve
 * separately, and an id that reaches `usedVars` anyway is a bug upstream,
 * never a name to census. A node the script could not find carries `error`
 * instead — reported by the caller, never merged as an empty answer.
 *
 * @param {unknown} payload the raw envelope's `payload` field
 * @returns {{entries: Array<{nodeId: string, usedVars?: string[], variantCombinations?: object[], error?: string}>, payloadValid: boolean}}
 */
export function censusBindingsFromExecuteResult(payload) {
  if (payload === null || typeof payload !== "object" || Array.isArray(payload))
    return { entries: [], payloadValid: false }

  // The keys ARE the node ids the plan asked for, so a document whose keys
  // are not node ids is not a result document at all — a node tree (the
  // per-node envelope's own shape) reaching here would otherwise be censused
  // key by key into a pile of per-key errors instead of one clear "wrong
  // shape". An empty document is a real, empty answer; the caller decides
  // what to say about it.
  const nodeIds = Object.keys(payload)
  if (!nodeIds.every(isNodeId)) return { entries: [], payloadValid: false }

  const entries = []
  for (const nodeId of [...nodeIds].sort(compareStrings)) {
    const result = payload[nodeId]
    if (
      result === null ||
      typeof result !== "object" ||
      Array.isArray(result)
    ) {
      entries.push({ nodeId, error: "not a per-node result object" })
      continue
    }
    if (typeof result.error === "string" && result.error.length > 0) {
      entries.push({ nodeId, error: result.error })
      continue
    }
    const names = new Set()
    collectNamesFrom(
      Array.isArray(result.usedVars) ? result.usedVars : [],
      names,
    )
    // The layer tree the same walk produced (issue #462) — normalized here,
    // through the SAME `normalizeLayer` the deep-component envelope's census
    // used, so `layers` means exactly what it meant before #417 dropped it.
    // A result from before #462 carries none, and the entry says nothing
    // about layers rather than saying "no layers" — the absent-means-not-
    // gathered convention `modules/anatomy.mjs` reads.
    const layers = normalizeLayer(result.layers)
    entries.push({
      nodeId,
      usedVars: [...names].sort(compareStrings),
      variantCombinations: variantCombinationsFromNames(
        Array.isArray(result.variantChildren) ? result.variantChildren : [],
      ),
      ...(layers ? { layers } : {}),
    })
  }
  return { entries, payloadValid: true }
}

// ---------------------------------------------------------------------------
// Layer census (issue #402): the SAME deep-component payload the bindings
// census reads, censused a second way — the component's LAYER TREE, so
// `modules/anatomy.mjs` can compare a contract's declared anatomy against the
// design component as well as against the code. No second gather: the tree is
// already in the envelope `gather --bindings` planned, and `ingest --bindings`
// merges both fields onto the same census entry.
//
// The normalized node is `{name, type?, children?, childrenResolved?}`, in the
// ENGINE's own vocabulary — the same reduction reasoning `componentProps`
// applies to props (ADR-003 Phase 5.2): the module runs one comparison against
// whichever side hands it this shape, and never learns a design tool's raw
// node types. `type` is the contract's own `anatomy.<node>.type` enum, so the
// two are directly comparable; a raw type with no engine equivalent is carried
// UNCLASSIFIED (no `type` at all) rather than guessed into one.
// ---------------------------------------------------------------------------

const LAYER_TYPE_MAP = {
  FRAME: "container",
  GROUP: "container",
  SECTION: "container",
  COMPONENT: "container",
  COMPONENT_SET: "container",
  TEXT: "text",
  VECTOR: "vector",
  BOOLEAN_OPERATION: "vector",
  INSTANCE: "instance",
  LINE: "line",
  ELLIPSE: "ellipse",
  RECTANGLE: "rectangle",
  POLYGON: "polygon",
  STAR: "star",
}

// The types that cannot hold layers at all: a node of one of these reporting
// no `children` reports the truth, not a gap. Every OTHER type can, so absent
// children there is NOT KNOWN rather than "none" — including an unclassified
// type, where the engine does not know what the node even is.
const LEAF_LAYER_TYPES = new Set([
  "text",
  "glyph",
  "vector",
  "line",
  "ellipse",
  "rectangle",
  "polygon",
  "star",
])

// `childrenResolved: false` means NOT KNOWN — the same word, with the same
// meaning, the code-side census already uses for a child list it could not
// resolve, so the comparison module needs no second concept for it. Three
// things earn it here: an INSTANCE (whose subtree is another component's
// contract to answer for, never this one's), a non-leaf node the tool
// reported no `children` array for at all (absent is not the same as empty),
// and a node some of whose children could not be censused.
function normalizeLayer(raw) {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null
  if (typeof raw.name !== "string" || raw.name === "") return null

  const type = LAYER_TYPE_MAP[raw.type]
  const layer = { name: raw.name, ...(type ? { type } : {}) }

  if (type === "instance") return { ...layer, childrenResolved: false }
  if (!Array.isArray(raw.children))
    return LEAF_LAYER_TYPES.has(type)
      ? layer
      : { ...layer, childrenResolved: false }

  const children = []
  let dropped = 0
  for (const child of raw.children) {
    const normalized = normalizeLayer(child)
    if (normalized) children.push(normalized)
    else dropped++
  }
  return {
    ...layer,
    children,
    ...(dropped > 0 ? { childrenResolved: false } : {}),
  }
}

/**
 * One raw deep-component envelope's `payload` → the component's normalized
 * layer tree. `payloadValid: false` is the same distinct case every other
 * census here makes: not a node tree at all, so nothing could be censused.
 * `layers: null` with `payloadValid: true` is the other case — a tree was
 * read, but its root carries no name to census it under.
 *
 * @param {unknown} payload the raw envelope's `payload` field
 * @returns {{layers: object|null, payloadValid: boolean}}
 */
export function censusLayersFromRaw(payload) {
  const root = nodeRootOf(payload)
  if (!root) return { layers: null, payloadValid: false }
  return { layers: normalizeLayer(root), payloadValid: true }
}
