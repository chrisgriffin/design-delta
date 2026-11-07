/**
 * plan.mjs — builds the gather PLAN `design-delta gather` prints (ADR-003:
 * "gather is a planner, not a fetcher" — the engine is a deterministic Node
 * CLI with no agent inside it, so it cannot call an MCP tool itself). An
 * agent reads this plan, runs the named tool with the given args, and
 * writes each raw response verbatim to the given output path — it computes
 * no hashes; D6 requires that to happen only in `ingest`'s Node-side
 * normalizer.
 *
 * The tool `buildGatherPlan` names, `list_file_components_for_code_connect`,
 * is the one the gather-determinism spike (#88, docs/spikes/gather-
 * determinism.md) validated: byte-identical across five gathers of the same
 * file, and the cheapest of the candidates issue #88 named.
 *
 * `buildTokenGatherPlan` (ADR-003 Phase 5.3) names `get_variable_defs`
 * instead — a per-NODE tool, unlike the component plan's per-FILE one, since
 * Figma's MCP surface has no bulk "every variable in this file" call. One
 * target per addressed contract's `{fileKey, nodeId}`, not one per file key.
 */

import { hashJson } from "../../../core/state.mjs"
import { normalizeNodeId } from "../normalize.mjs"

const TOOL = "list_file_components_for_code_connect"
// Issue #380: the token census reads STRUCTURE, from two file-level tools on
// the Desktop Bridge (any plan tier — no Variables REST scope needed):
// every local variable with `resolvedType`, typed per-mode values, alias
// targets and collection; and every local text style with its unit-bearing
// fields. `get_variable_defs` (per node, rendered prose) is no longer
// planned — its envelopes still ingest, for a project that gathered before.
const VARIABLES_TOOL = "figma_get_variables"
const TEXT_STYLES_TOOL = "figma_get_text_styles"
// Issue #401, retargeted by #417: per-component variable BINDINGS. The
// deep-component tool this named first
// (`figma_get_component_for_development_deep`) reports `boundVariables` as opaque
// `VariableID:…` strings whenever the bound variables are LIBRARY imports —
// which is every real consumer's shape, measured live twice (2026-08-30 and
// 2026-09-08: `_variableMapSize: 0`, zero names resolved, on both sampled
// components). Resolving each bound id INSIDE the plugin does resolve them
// (9/9 and 13/13, nothing unresolved), so the plan runs a script instead of
// reading a tool's pre-rendered view. The remote connector's
// `get_variable_defs` was measured too and is not a substitute: it drops the
// bindings on hidden, prop-toggled nodes and mixes text styles in as
// variables. Legacy envelopes from the old tool still ingest.
const BINDINGS_TOOL = "figma_execute"

/**
 * @param {string[]} fileKeys every file key `sourceFileKey` resolved across
 *   the loaded contracts — the "census scope replaces `config.fileKeys`"
 *   union (ADR-003)
 * @param {string} rawDir where to write each raw response — a `raw/`
 *   subdirectory of `paths.snapshotDir`, kept apart from the normalized D7
 *   snapshots `ingest` writes there so a stray raw file is never mistaken
 *   for one
 * @returns {{provider: string, tool: string, targets: Array<{fileKey: string, args: {fileKey: string}, outputPath: string}>, planHash: string}}
 */
export function buildGatherPlan(fileKeys, rawDir) {
  const targets = [...new Set(fileKeys)].sort().map(fileKey => ({
    fileKey,
    args: { fileKey },
    outputPath: `${rawDir}/${fileKey}.json`,
  }))

  const plan = { provider: "figma", tool: TOOL, targets }
  return { ...plan, planHash: hashJson(plan) }
}

/**
 * The TOKEN plan (issue #380 — file-level, structured). Two targets per
 * distinct file key: the file's variables, and its local text styles. Both
 * are Desktop Bridge tools that read the file the agent has open, so each
 * target names the file for the agent to open, and `args` are exactly the
 * tool arguments (`format: "full"`, `resolveAliases: true` so every alias
 * arrives already resolved as well as by reference).
 *
 * @param {string[]} addresses every `designAddress` string resolved across
 *   the loaded contracts (`${fileKey}:${nodeId}`) — only the file keys are
 *   used now, but the input stays the address list so `gather` needs no
 *   provider-specific knowledge to call this
 * @param {string} rawDir see `buildGatherPlan`
 * @returns {{provider: string, tool: string, targets: Array<{fileKey: string, tool: string, args: object, outputPath: string}>, planHash: string}}
 */
export function buildTokenGatherPlan(addresses, rawDir) {
  const fileKeys = [
    ...new Set(addresses.map(address => address.split(":")[0])),
  ].sort()
  const targets = fileKeys.flatMap(fileKey => [
    {
      fileKey,
      tool: VARIABLES_TOOL,
      args: {
        fileUrl: `https://www.figma.com/design/${fileKey}`,
        format: "full",
        verbosity: "full",
        resolveAliases: true,
      },
      outputPath: `${rawDir}/${fileKey}-variables.json`,
    },
    {
      fileKey,
      tool: TEXT_STYLES_TOOL,
      args: { fileUrl: `https://www.figma.com/design/${fileKey}` },
      outputPath: `${rawDir}/${fileKey}-text-styles.json`,
    },
  ])

  const plan = { provider: "figma", tool: VARIABLES_TOOL, targets }
  return { ...plan, planHash: hashJson(plan) }
}

/**
 * The in-plugin resolution script one bindings target carries (issue #417).
 * It walks each addressed node's whole tree — hidden nodes included, on
 * purpose: a hidden node is a `presentIf` part of the component, and a census
 * that skips it under-reports what the component binds — and resolves every
 * bound id through the plugin's own variable API, which reaches library
 * imports the read-only tools cannot. An id that will not resolve is reported
 * as `unresolved` rather than passed off as a name, so an unresolvable gather
 * is visibly empty instead of quietly wrong.
 *
 * `nodes` is the count of nodes walked — the measurement's own sanity check
 * that the walk reached the whole tree. `layers` is that same walk's SHAPE
 * (issue #462, Chris 2026-09-17): the tree `censusLayers` (issue #402) reads,
 * which the deep-component envelope used to carry and this one dropped, so
 * the design side of the anatomy surface had no gather path at all. The walk
 * already visits every node to collect what it binds — returning the shape
 * alongside the count costs the walk nothing and only adds payload.
 *
 * An INSTANCE's own children are NOT returned: its subtree is another
 * component's contract to answer for, and `normalize.mjs`'s `normalizeLayer`
 * records it as `childrenResolved: false` either way. The walk still descends
 * into it for `usedVars` — what a component binds includes what its instances
 * bind — so only the emitted tree stops there.
 *
 * A `COMPONENT_SET` also returns its variant children's names, so
 * `variantCombinations` (#403) keeps coming off this one pass.
 *
 * The collector descends through a plain MAP of aliases, not just an alias
 * or an array of them (issue #468): `boundVariables.componentProperties` is
 * `{[propertyName]: VariableAlias}` — a map carrying no `id` of its own — so
 * a collector that recognized only arrays and `{id}` objects dropped every
 * variable bound to a component property, silently, without even recording
 * it as `unresolved`. `normalize.mjs`'s legacy `collectNamesFrom` descends
 * the same way; the two censuses have to agree about what a component binds.
 */
function bindingsScript(nodeIds) {
  return `const NODE_IDS = ${JSON.stringify(nodeIds)}
const out = {}
for (const id of NODE_IDS) {
  const root = await figma.getNodeByIdAsync(id)
  if (!root) {
    out[id] = { error: "not found" }
    continue
  }
  const names = new Set()
  const unresolved = new Set()
  let nodes = 0
  const collect = async value => {
    if (Array.isArray(value)) {
      for (const item of value) await collect(item)
      return
    }
    if (!value || typeof value !== "object") return
    if (value.id) {
      const variable = await figma.variables.getVariableByIdAsync(value.id)
      if (variable) names.add(variable.name)
      else unresolved.add(value.id)
      return
    }
    for (const item of Object.values(value)) await collect(item)
  }
  const walk = async node => {
    nodes++
    const bound = node.boundVariables || {}
    for (const key of Object.keys(bound)) await collect(bound[key])
    const layer = { name: node.name, type: node.type }
    if ("children" in node) {
      const children = []
      for (const child of node.children) children.push(await walk(child))
      if (node.type !== "INSTANCE") layer.children = children
    }
    return layer
  }
  const layers = await walk(root)
  out[id] = {
    name: root.name,
    type: root.type,
    nodes,
    layers,
    usedVars: [...names].sort(),
    unresolved: [...unresolved],
  }
  if (root.type === "COMPONENT_SET")
    out[id].variantChildren = root.children.map(child => child.name)
}
return out`
}

/**
 * The BINDINGS plan (issue #401, retargeted by #417): one target per addressed
 * FILE — not per node — since one `figma_execute` call resolves every node in
 * the file the agent has open. The agent opens the file, runs the target's
 * script, and writes the result verbatim; `ingest --bindings` merges each
 * node's variable names onto the matching `design-components.json` entry as
 * `usedVars`.
 *
 * @param {string[]} addresses every `designAddress` string resolved across
 *   the loaded contracts (`${fileKey}:${nodeId}`)
 * @param {string} rawDir see `buildGatherPlan`
 * @returns {{provider: string, tool: string, targets: Array<{fileKey: string, nodeIds: string[], tool: string, args: object, fileUrl: string, outputPath: string}>, planHash: string}}
 */
export function buildBindingsGatherPlan(addresses, rawDir) {
  const byFile = new Map()
  for (const address of [...new Set(addresses)].sort()) {
    const at = address.indexOf(":")
    const fileKey = address.slice(0, at)
    const nodeId = normalizeNodeId(address.slice(at + 1))
    if (!byFile.has(fileKey)) byFile.set(fileKey, new Set())
    byFile.get(fileKey).add(nodeId)
  }

  const targets = [...byFile.keys()].sort().map(fileKey => {
    const nodeIds = [...byFile.get(fileKey)].sort()
    return {
      fileKey,
      nodeIds,
      tool: BINDINGS_TOOL,
      args: { code: bindingsScript(nodeIds) },
      fileUrl: `https://www.figma.com/design/${fileKey}`,
      outputPath: `${rawDir}/${fileKey}-bindings.json`,
    }
  })

  const plan = { provider: "figma", tool: BINDINGS_TOOL, targets }
  return { ...plan, planHash: hashJson(plan) }
}
