/**
 * index.mjs — the Figma provider (ADR-001 D12, ADR-003 Phase 5.1): the ONE
 * file, alongside its `normalize.mjs`/`codegen.mjs`/`agent/plan.mjs`
 * siblings, allowed to name Figma at all (`__tests__/layering.test.js`'s
 * vendor guard). Exports the fixed 5-member interface D12 defines —
 * `name`, `capabilities`, `sourceSchema`, `censusComponents`,
 * `censusTokens` — plus `designAddress`/`sourceFileKey`/`componentAddress`/
 * `buildGatherPlan`/`validateDesignComponents`/`componentProps`/
 * `buildTokenGatherPlan`/`validateDesignTokens`, additions this repo's own
 * wiring needs and D12 does not forbid (D12 fixes the interface's REQUIRED
 * members, not an exhaustive export list).
 *
 * Every one of those additions exists for the SAME reason: `cli/` is
 * deliberately exempt from the vendor guard because it never hardcodes an
 * import to a provider (`providers/index.mjs`'s config-key loader is the
 * only path in) — so `cli/commands/gather.mjs`/`ingest.mjs`/`audit.mjs`
 * reach every one of these through the LOADED provider object, never a
 * static `import … from "../../providers/figma/…"`. `designAddress` in
 * particular is what lets `core/`/`spec/`/`modules/` never learn
 * `sources.design`'s shape is `{fileKey, nodeId}` at all — `audit.mjs` calls
 * it once per contract and once per census entry, and hands `modules/
 * components.mjs` only the resulting opaque match-key strings. `modules/`
 * still never imports `providers/` (the layering test enforces this); it
 * only ever compares two plain strings a caller already resolved.
 */

import {
  censusBindingsFromExecuteResult,
  censusBindingsFromRaw,
  censusComponentsFromRaw,
  censusLayersFromRaw,
  censusTokensFromRaw,
  censusUnitOf,
  indexTokens,
  componentProps as figmaComponentProps,
  isNodeId,
  normalizeNodeId,
  validateDesignComponents,
  validateDesignTokens,
  configSchema,
  validateDesignOptions,
} from "./normalize.mjs"
import {
  buildGatherPlan as buildFigmaGatherPlan,
  buildTokenGatherPlan as buildFigmaTokenGatherPlan,
  buildBindingsGatherPlan as buildFigmaBindingsGatherPlan,
} from "./agent/plan.mjs"

export const name = "figma"

export const capabilities = {
  components: true,
  // Confirmed live (ADR-003 Phase 5.3's own validation): `get_variable_defs`
  // succeeds via the agent/MCP path on this account's `org`-tier plan, even
  // though the REST variables endpoint is Enterprise-gated (docs/adr/ADR-003-
  // figma-provider.md's Context section) — the two paths have different
  // entitlements. Real census, not a declared skip.
  tokens: true,
}

/**
 * JSON Schema for a contract's `sources.design` block, ADR-003's
 * `sourceSchema` blessing: `{fileKey, nodeId}` and nothing else. Both
 * `node-id` separators validate — a URL gives an author a hyphen
 * (`?node-id=41-250`), the gather path and the retired v1 `baseline.json`
 * both return a colon (`41:250`) — `normalizeNodeId` canonicalizes
 * downstream; the schema only confirms the SHAPE is a nodeId at all.
 */
export const sourceSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  additionalProperties: false,
  required: ["fileKey", "nodeId"],
  properties: {
    fileKey: { type: "string", minLength: 1 },
    nodeId: { type: "string", pattern: "^\\d+[:-]\\d+$" },
  },
}

/**
 * `sources.design` (an opaque object, per `contract.schema.json`) → a
 * provider-owned match key, or `null` when it's absent or doesn't match
 * `sourceSchema`'s shape (checked structurally here rather than via a
 * compiled Ajv validator — the shape is two required string fields, cheap
 * enough that pulling in a schema compile for it would be more machinery
 * than the check is worth).
 *
 * @param {unknown} source `contract.sources.design`
 * @returns {string|null}
 */
export function designAddress(source) {
  if (source === null || typeof source !== "object" || Array.isArray(source))
    return null
  const keys = Object.keys(source)
  // Matches `sourceSchema`'s `additionalProperties: false` exactly — a
  // source carrying an extra key isn't this provider's shape either,
  // opaque or not.
  if (
    keys.length !== 2 ||
    !keys.includes("fileKey") ||
    !keys.includes("nodeId")
  )
    return null
  const { fileKey, nodeId } = source
  if (typeof fileKey !== "string" || fileKey.length === 0) return null
  if (!isNodeId(nodeId)) return null
  return `${fileKey}:${normalizeNodeId(nodeId)}`
}

/**
 * Just the file key half of `sources.design`, or `null` when unresolvable —
 * `gather`'s plan needs to know WHICH files to gather (the union of every
 * contract's file key, ADR-003's "census scope replaces `config.fileKeys`"),
 * before there is any census to match a full `designAddress` against.
 *
 * @param {unknown} source `contract.sources.design`
 * @returns {string|null}
 */
export function sourceFileKey(source) {
  if (source === null || typeof source !== "object") return null
  const { fileKey } = source
  return typeof fileKey === "string" && fileKey.length > 0 ? fileKey : null
}

/**
 * The same match key a `design-components.json` entry resolves to —
 * `designAddress` and this MUST agree, since the whole coverage check is
 * "does one side's key exist in the other side's key set."
 *
 * @param {{fileKey: string, nodeId: string}} component a normalized
 *   `designComponent` record (already `:`-normalized by `normalize.mjs`)
 * @returns {string}
 */
export function componentAddress(component) {
  return `${component.fileKey}:${component.nodeId}`
}

/**
 * Raw → normalized component census for ONE gathered file. `ctx.fileKey`
 * and `ctx.payload` come straight off a validated raw envelope
 * (`{provider, providerVersion, planHash, fileKey, gatheredAt, payload}`) —
 * `ingest` calls this once per raw file and concatenates the results.
 *
 * @param {{fileKey: string, payload: unknown}} ctx
 * @returns {{components: object[], skipped: number, payloadValid: boolean}}
 *   `payloadValid: false` means `ctx.payload` isn't this provider's
 *   expected shape at all (not the same as a valid, empty census) — the
 *   caller's job to report as "couldn't check," never as a silent 0.
 */
export function censusComponents(ctx) {
  return censusComponentsFromRaw(ctx?.fileKey, ctx?.payload)
}

/**
 * Raw → normalized token census for ONE gathered node (ADR-003 Phase 5.3).
 * `ctx.payload` comes straight off a validated raw envelope — `ingest
 * --tokens` calls this once per raw file (one per addressed contract's
 * `{fileKey, nodeId}`, since `get_variable_defs` has no bulk per-file form)
 * and combines the results, deduplicated by name.
 *
 * @param {{payload: unknown}} ctx
 * @returns {{tokens: object[], skipped: number, payloadValid: boolean}}
 *   `payloadValid: false` means `ctx.payload` isn't this provider's
 *   expected shape at all — the caller's job to report as "couldn't check,"
 *   never as a silent 0.
 */
export function censusTokens(ctx) {
  return censusTokensFromRaw(ctx?.payload, {
    tool: ctx?.tool,
    index: ctx?.index,
  })
}

/**
 * Build the cross-file lookup `censusTokens` resolves a color-plus-opacity
 * pair through (issue #517) — see `normalize.mjs`'s `indexTokens`. The
 * engine never reads it: `ingest` builds it from every raw token payload and
 * hands it straight back (D12).
 *
 * @param {Array<{payload: unknown, tool?: string}>} payloads
 * @returns {object} opaque to the caller
 */
export { indexTokens }

/**
 * The style properties this design tool cannot express as a node-level
 * variable (issue #492, 2026-09-17). `modules/styles.mjs`'s bindings
 * comparison reads this and skips such a binding with a stated reason
 * instead of reporting drift no one can act on — the contract is right, the
 * stylesheet is right, and the design file is right.
 *
 * DECLARED, never inferred from a census: a rule that learned the limit from
 * "nothing in this census binds one" would go quiet on a thin census and
 * silence real drift, and a finding that vanished for that reason could not
 * be explained to anyone.
 *
 *   - `lineHeight` — authored as a literal percentage on a text style. In an
 *     83-entry census of a real project, no component binds a line-height
 *     variable, because there is nothing to bind.
 *   - `margin` — Figma has no per-node margin. Flow spacing between siblings
 *     is the PARENT frame's auto-layout `itemSpacing`, which lives on a
 *     layer outside the component a contract addresses, so no variable that
 *     component's own tree binds can ever map to the token.
 *
 * @type {string[]}
 */
export const unbindableProperties = ["lineHeight", "margin"]

/**
 * `gather`'s plan — see `agent/plan.mjs`. Re-exported rather than imported a
 * second way so `cli/commands/gather.mjs` reaches it only through the
 * loaded provider object.
 *
 * @param {string[]} fileKeys
 * @param {string} rawDir
 * @returns {{provider: string, tool: string, targets: object[], planHash: string}}
 */
export function buildGatherPlan(fileKeys, rawDir) {
  return buildFigmaGatherPlan(fileKeys, rawDir)
}

/**
 * Schema-validate a `design-components.json` document before `ingest`
 * writes it — see `normalize.mjs`. Re-exported for the same reason as
 * `buildGatherPlan`.
 *
 * @param {unknown} snapshot
 * @returns {{valid: boolean, errors: string[]}}
 */
export { validateDesignComponents }

/**
 * One design census entry's props, in the SAME shape a code census entry's
 * `props` carries (ADR-003 Phase 5.2) — see `normalize.mjs`'s
 * `componentProps`. `cli/commands/audit.mjs` calls this once per matched
 * design component and hands the result to `modules/components.mjs` as
 * `designCensus.entries[].props`, so that module's ONE prop-parity algorithm
 * runs unchanged against either side.
 *
 * @param {object} designComponent one `design-components.json` entry
 * @returns {Array<{name: string, type: string, values?: string[]}>}
 */
export function componentProps(designComponent) {
  return figmaComponentProps(designComponent)
}

/**
 * `gather --tokens`'s plan — see `agent/plan.mjs`. Re-exported for the same
 * reason as `buildGatherPlan`.
 *
 * @param {string[]} addresses every `designAddress` string resolved across
 *   the loaded contracts
 * @param {string} rawDir
 * @returns {{provider: string, tool: string, targets: object[], planHash: string}}
 */
export function buildTokenGatherPlan(addresses, rawDir) {
  return buildFigmaTokenGatherPlan(addresses, rawDir)
}

/**
 * Schema-validate a `design-tokens.json` document before `ingest --tokens`
 * writes it — see `normalize.mjs`. Re-exported for the same reason as
 * `validateDesignComponents`.
 *
 * @param {unknown} snapshot
 * @returns {{valid: boolean, errors: string[]}}
 */
export { validateDesignTokens }

/**
 * Per snapshot, the engine version whose ingest-time normalization LAST
 * changed what a stored value looks like (issue #458), and — for a snapshot
 * that carries no `engineVersion` at all — how to tell from the stored
 * values which side of that change it is on. `audit` reports a snapshot as
 * needing a re-ingest when it is older: the rules that read it may expect a
 * form the engine that wrote it never produced.
 *
 * `staleShape` exists because 0.18.1 itself stamped no version: a snapshot
 * it wrote and one 0.18.0 wrote are indistinguishable by provenance and
 * only the values tell them apart. Measured on a real project's census the
 * day this shipped — re-ingested by 0.18.1, no version, every TIMING value
 * already `<n>s`; a version-only rule called it stale, wrongly.
 *
 * Move `version` (and rewrite `staleShape`) whenever `normalize.mjs`
 * changes the OUTPUT of an existing record; never for an additive field a
 * reader treats as optional. `tokens`: 0.18.1 rendered a TIMING variable as
 * `<n>s` (issue #447) — the stale form is a TIMING record whose `value` is
 * still a bare number. No such change has touched the components snapshot.
 */
export const normalizationSince = {
  tokens: {
    version: "0.18.1",
    staleShape: snapshot =>
      (snapshot?.tokens || []).some(
        token =>
          token?.resolvedType === "TIMING" &&
          /^-?\d*\.?\d+$/.test(String(token.value)),
      ),
  },
}

/**
 * ADR-003 Amendment 3's optional sixth member, built now that Amendment 4
 * gives it a real shape to validate: `tokenMap`, `codeAuthoritativeGroups`,
 * `ignoreVariables`. `validateDesignOptions` is what `audit` calls; the
 * schema itself is exported so a consumer's editor (and this repo's own
 * schema check) can see it.
 */
export { configSchema, validateDesignOptions }

/**
 * Whether the design tool treats this component as PRIVATE (issue #460): a
 * name, or any `/`-separated path segment of it, starting with `.` or `_`.
 * That is the tool's own convention for "not published from the library" —
 * an internal composition helper (`.Header`, `Group / .divider`) that can
 * never have a code counterpart, so `coverage/design-only` skips it unless
 * `design.options.includePrivateComponents` says otherwise. Vendor
 * convention, so it lives here; the census entry only ever says `private`.
 *
 * @param {{name?: string}} component a `design-components.json` entry
 * @returns {boolean}
 */
export function isPrivateComponent(component) {
  const name = typeof component?.name === "string" ? component.name : ""
  return name
    .split("/")
    .map(segment => segment.trim())
    .some(segment => segment.startsWith(".") || segment.startsWith("_"))
}

/**
 * What kind of census unit this component is (issue #658): `"variant-set"`
 * when its gathered layer tree's children are its variants, `"component"`
 * when they are its own layers. Derived from the entry's own `type`, so a
 * snapshot from before `ingest` wrote `unit` answers the same way. Vendor
 * vocabulary, so it lives here; the census entry only ever says `unit`.
 *
 * @param {{type?: string}} component a `design-components.json` entry
 * @returns {"variant-set"|"component"|null}
 */
export function censusUnit(component) {
  return censusUnitOf(component)
}

/**
 * `gather --bindings`'s plan (issue #401) — see `agent/plan.mjs`.
 * Re-exported for the same reason as `buildGatherPlan`.
 *
 * @param {string[]} addresses every `designAddress` string resolved across
 *   the loaded contracts
 * @param {string} rawDir
 * @returns {{provider: string, tool: string, targets: object[], planHash: string}}
 */
export function buildBindingsGatherPlan(addresses, rawDir) {
  return buildFigmaBindingsGatherPlan(addresses, rawDir)
}

/**
 * Raw deep-component payload → the variable names the component binds
 * (issue #401) — see `normalize.mjs`'s `censusBindingsFromRaw`.
 * `ingest --bindings` calls this once per raw file and merges the result
 * onto the matching `design-components.json` entry as `usedVars`.
 *
 * @param {{payload: unknown}} ctx
 * @returns {{usedVars: string[], payloadValid: boolean}}
 */
export function censusBindings(ctx) {
  return censusBindingsFromRaw(ctx?.payload)
}

/**
 * One BATCH bindings payload → one census record per node it covers (issue
 * #417) — see `normalize.mjs`'s `censusBindingsFromExecuteResult`. The
 * bindings plan now gathers a whole file in one call, so `ingest --bindings`
 * calls this once per raw file that carries no single `nodeId` of its own and
 * merges each record onto its own `design-components.json` entry. A record
 * carrying `error` is reported by the caller rather than merged.
 *
 * @param {{payload: unknown}} ctx
 * @returns {{entries: object[], payloadValid: boolean}}
 */
export function censusBindingsBatch(ctx) {
  return censusBindingsFromExecuteResult(ctx?.payload)
}

/**
 * Raw deep-component payload → the component's normalized layer tree (issue
 * #402) — see `normalize.mjs`'s `censusLayersFromRaw`. The SAME raw envelope
 * `censusBindings` reads: one gather, two censuses, so the layer tree costs
 * no extra plan target. `ingest --bindings` merges the result onto the
 * matching `design-components.json` entry as `layers`, and `modules/
 * anatomy.mjs` compares a contract's declared anatomy against it.
 *
 * @param {{payload: unknown}} ctx
 * @returns {{layers: object|null, payloadValid: boolean}}
 */
export function censusLayers(ctx) {
  return censusLayersFromRaw(ctx?.payload)
}

/**
 * Binding-file status (issue #400) — see `codegen.mjs`'s `bindingPath`/
 * `bindingStatus`. The CLI reads the committed file (fs stays out of the
 * provider) and `modules/components.mjs` turns the statuses into findings;
 * the deleted `codegen` command's compare semantics live on here unchanged.
 */
export { bindingPath, bindingStatus } from "./codegen.mjs"
