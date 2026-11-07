/**
 * ingest.mjs — `design-delta ingest <raw…>` (ADR-003 Phase 5.1 components +
 * Phase 5.3 tokens): validates, normalizes, and hashes an agent's raw
 * gather output, then writes a D7 design-side snapshot. This is the ONE
 * place hashing happens for the design side (D6) — the agent that ran
 * `gather`'s plan wrote each raw response verbatim and computed nothing, so
 * the normalizer here is the sole source of every `treeHash`.
 *
 *   design-delta ingest <raw-file...> [--tokens] [--config <path>] [--json]
 *
 * Each `<raw-file>` is one envelope a `gather` plan named as an output path
 * — `{provider, providerVersion, planHash, fileKey, gatheredAt, payload}`
 * (token envelopes also carry `nodeId`, since `gather --tokens` plans one
 * target per node, not per file) — read relative to `process.cwd()`. A raw
 * file that doesn't parse as JSON, or doesn't match this shape, is SKIPPED
 * with a stated reason (the same "surface skips, it doesn't fail the run"
 * convention every other census here follows) — one bad file never blocks
 * ingesting the rest.
 *
 * No `--tokens`: every surviving file's `payload` is handed to the active
 * provider's `censusComponents`, combined and sorted by `fileKey` then
 * `nodeId`, and written to `design-components.json`. `--tokens`: handed to
 * `censusTokens` instead, DEDUPLICATED by name (raw file PATHS are sorted
 * before processing, so which file "wins" a name collision is independent
 * of argument order, matching the components path's own order-independence
 * invariant), sorted by name, and written to `design-tokens.json` — a
 * separate file, since D7 fixes two independent design-side snapshots.
 * Either way the assembled snapshot is schema-validated before a single
 * byte is written — this command never writes an invalid snapshot.
 *
 * A PARTIAL GATHER never drops another pass's fields (issue #418). The three
 * passes share one pair of snapshots, and `usedVars`/`variantCombinations`/
 * `layers` (`BINDINGS_OWNED_FIELDS`) belong to the bindings pass alone, so a
 * components-only ingest CARRIES them forward from the
 * previous `design-components.json` by address rather than overwriting them
 * with nothing; a bindings-only ingest with no census to merge onto fails
 * outright, naming the pass that has to run first. See `carryForwardBindings`
 * and `ingestBindings` for why one carries and the other fails.
 *
 * Exit codes: 0 once the snapshot is written (even when every raw file was
 * skipped and the census is empty — a legitimate state to report, not a
 * failure); 1 when no raw files were given at all, when `design.provider`
 * is unset or unknown, when `--bindings` has no `design-components.json` to
 * merge onto, or when the assembled snapshot fails its own schema (a
 * normalizer bug, not a data problem — every raw envelope already validated).
 *
 * Two stream invariants (D8), matching every other subcommand here:
 *   - progress goes to stderr, via the injected bus, never to stdout.
 *   - `--json` writes ONE JSON document to stdout and nothing else.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"

import { resolveConfig, resolveRunConfig } from "../../core/config.mjs"
import { packageVersion } from "../../core/version.mjs"
import { loadProvider } from "../../providers/index.mjs"
import { parseFlags } from "../flags.mjs"
import { compareStrings } from "../../core/text.mjs"

const FLAG_SPEC = {
  boolean: ["--json", "--tokens", "--bindings"],
  value: [],
  positional: true,
}

// The envelope wrapper's shape is provider-agnostic (ADR-003's mechanics
// section) — only `payload`'s internal shape is the provider's concern,
// validated implicitly by `censusComponents` skipping what it can't read.
function readEnvelope(root, rawPath) {
  let raw
  try {
    raw = readFileSync(join(root, rawPath), "utf8")
  } catch (err) {
    return { error: `could not read: ${err.message}` }
  }

  let envelope
  try {
    envelope = JSON.parse(raw)
  } catch (err) {
    return { error: `not valid JSON: ${err.message}` }
  }

  if (
    envelope === null ||
    typeof envelope !== "object" ||
    typeof envelope.provider !== "string" ||
    typeof envelope.fileKey !== "string" ||
    !("payload" in envelope)
  ) {
    return {
      error:
        "does not match the raw envelope shape ({provider, fileKey, payload, ...})",
    }
  }

  return { envelope }
}

// A token envelope is one of: a file-level structured gather (issue #380 —
// `tool` names `figma_get_variables` or `figma_get_text_styles`), or the
// legacy per-node `get_variable_defs` gather, which carried `nodeId`. An
// envelope with neither cannot have come from any token plan.
const FILE_LEVEL_TOKEN_TOOLS = new Set([
  "figma_get_variables",
  "figma_get_text_styles",
])
function readTokenEnvelope(root, rawPath) {
  const result = readEnvelope(root, rawPath)
  if (result.error) return result
  const { envelope } = result
  const fileLevel = FILE_LEVEL_TOKEN_TOOLS.has(envelope.tool)
  if (!fileLevel && typeof envelope.nodeId !== "string") {
    return {
      error:
        "does not match the raw TOKEN envelope shape ({provider, fileKey, tool: figma_get_variables|figma_get_text_styles, payload, ...} or the legacy {..., nodeId, payload})",
    }
  }
  return result
}

// What the envelopes say about WHEN and HOW the design side was gathered
// (issue #389) — kept, not dropped, so a reader of the snapshot (and of
// every report built on it) can tell a fresh gather from a months-old
// committed file. `gatheredAt` is the LATEST across the envelopes that
// ingested (a gather is as fresh as its newest file); `planHash` and
// `providerVersion` are recorded only when every envelope agrees, since a
// mixed set has no single answer. Nothing here reads the clock.
//
// `engineVersion` is this package's own version (issue #458): normalization
// happens HERE, at ingest, so a snapshot's stored values are only as current
// as the engine that wrote them — `audit` reads this against the provider's
// `normalizationSince` to say when a committed snapshot needs re-ingesting.
function collectProvenance(envelopes) {
  // Any form `Date.parse` accepts is admitted, then RE-EMITTED as RFC 3339
  // UTC (`toISOString`), the one spelling the snapshot schema's
  // `format: date-time` accepts — an agent-written `"2026-08-29"` must not
  // abort the whole ingest as "an invalid snapshot". Newest by TIME, never
  // by string: `…T10:00+05:00` is earlier than `…T09:00Z`, and a
  // lexicographic sort would say otherwise.
  const dates = envelopes
    .map(envelope => envelope.gatheredAt)
    .filter(value => typeof value === "string")
    .map(value => Date.parse(value))
    .filter(time => !Number.isNaN(time))
    .sort((a, b) => a - b)
    .map(time => new Date(time).toISOString())
  const agreed = key => {
    const values = new Set(
      envelopes
        .map(envelope => envelope[key])
        .filter(v => typeof v === "string"),
    )
    return values.size === 1 ? [...values][0] : undefined
  }
  const provenance = {
    files: envelopes.length,
    engineVersion: packageVersion(),
  }
  if (dates.length > 0) provenance.gatheredAt = dates[dates.length - 1]
  const planHash = agreed("planHash")
  if (planHash) provenance.planHash = planHash
  const providerVersion = agreed("providerVersion")
  if (providerVersion) provenance.providerVersion = providerVersion
  return provenance
}

function compareComponents(a, b) {
  if (a.fileKey !== b.fileKey) return a.fileKey < b.fileKey ? -1 : 1
  if (a.nodeId !== b.nodeId) return a.nodeId < b.nodeId ? -1 : 1
  return 0
}

// The committed `design-components.json`, as it stands BEFORE this ingest
// writes over it. `missing` separates "no census yet" (the first ingest of a
// project — nothing to preserve) from "a census exists but can't be read",
// which the two partial-gather guards below answer differently.
function readComponentsSnapshot(root, config) {
  const { paths } = resolveConfig(config)
  const path = join(root, paths.snapshotDir, "design-components.json")
  try {
    return { snapshot: JSON.parse(readFileSync(path, "utf8")) }
  } catch (err) {
    return { error: err.message, missing: err.code === "ENOENT" }
  }
}

// Every field on a `design-components.json` entry the BINDINGS pass owns —
// all read off the one deep-component payload that pass gathers, and none
// producible by the components pass. Listed once so #418's carry-forward
// cannot silently miss a field added later (issue #403 added the second,
// issue #402 the third). `usedVars` and `variantCombinations` are arrays;
// `layers` is a tree object — the carry check below accepts either shape.
const BINDINGS_OWNED_FIELDS = ["usedVars", "variantCombinations", "layers"]

// Issue #418 — the three gather passes share ONE `design-components.json`,
// and the `BINDINGS_OWNED_FIELDS` are written by the BINDINGS pass alone:
// `censusComponents` has no access to a node tree and never produces them. So
// assembling this snapshot from a components-only gather — the normal case
// for a session that can reach the component-listing tool but not the
// deep-component one — used to drop `usedVars` from every component that had
// it, silently and unrecoverably (raw envelopes are gitignored, and `audit`
// reads a snapshot without `usedVars` as "no bindings gather yet", not as
// data loss).
//
// So the components pass carries the bindings pass's fields forward instead
// of overwriting them, matched by the same address the merge itself used. A
// previous record whose address is no longer in the census can't be carried
// anywhere — that is COUNTED and reported rather than either dropped in
// silence or made fatal: a component legitimately deleted from the design
// file would otherwise wedge every future ingest behind an error no re-gather
// could clear.
function carryForwardBindings(root, config, provider, components) {
  const { snapshot, error, missing } = readComponentsSnapshot(root, config)
  if (error) {
    return missing
      ? { carried: 0, dropped: 0 }
      : {
          carried: 0,
          dropped: 0,
          skipped: {
            file: "design-components.json",
            reason: `the previous snapshot could not be read (${error}) — no bindings-pass fields from an earlier \`ingest --bindings\` could be carried forward`,
          },
        }
  }

  const previous = new Map()
  for (const component of Array.isArray(snapshot?.components)
    ? snapshot.components
    : []) {
    const owned = {}
    for (const field of BINDINGS_OWNED_FIELDS) {
      const value = component?.[field]
      if (value && typeof value === "object") owned[field] = value
    }
    if (Object.keys(owned).length > 0)
      previous.set(provider.componentAddress(component), owned)
  }

  let carried = 0
  for (const component of components) {
    const address = provider.componentAddress(component)
    if (!previous.has(address)) continue
    Object.assign(component, previous.get(address))
    previous.delete(address)
    carried++
  }

  if (previous.size === 0) return { carried, dropped: 0 }
  return {
    carried,
    dropped: previous.size,
    skipped: {
      file: "design-components.json",
      reason: `${previous.size} previous bindings-pass record(s) match no component in this gather (${[...previous.keys()].join(", ")}) — re-run \`design-delta gather --bindings\` + \`design-delta ingest --bindings\` if those components still exist`,
    },
  }
}

// Component path (ADR-003 Phase 5.1) — one raw file per addressed FILE KEY,
// every entry kept (no dedup: two different nodes are two different
// components, even when a raw file is malformed the same way twice).
function ingestComponents(root, rawPaths, provider, config) {
  const components = []
  const skipped = []
  const ingested = []
  let filesIngested = 0

  for (const rawPath of rawPaths) {
    const { envelope, error: readError } = readEnvelope(root, rawPath)
    if (readError) {
      skipped.push({ file: rawPath, reason: readError })
      continue
    }
    const result = provider.censusComponents({
      fileKey: envelope.fileKey,
      payload: envelope.payload,
    })
    if (!result.payloadValid) {
      // A different case from a valid, empty payload: this envelope's
      // `payload` isn't the shape this provider's gather tool produces at
      // all, so nothing here could be checked — never reported as a
      // silent, false "0 components, all clean."
      skipped.push({
        file: rawPath,
        reason:
          "payload does not match this provider's expected shape (a plain array) — nothing could be censused",
      })
      continue
    }
    filesIngested++
    ingested.push(envelope)
    components.push(...result.components)
    if (result.skipped > 0) {
      skipped.push({
        file: rawPath,
        reason: `${result.skipped} raw entr(y/ies) skipped — not a census-unit type (COMPONENT_SET/COMPONENT), or missing a required field (nodeId/name)`,
      })
    }
  }

  components.sort(compareComponents)
  const bindings = carryForwardBindings(root, config, provider, components)
  if (bindings.skipped) skipped.push(bindings.skipped)

  return {
    snapshotFile: "design-components.json",
    snapshot: { components, provenance: collectProvenance(ingested) },
    unit: "component",
    count: components.length,
    filesIngested,
    bindings,
    skipped,
    validate: snapshot => provider.validateDesignComponents(snapshot),
  }
}

// Token path (ADR-003 Phase 5.3) — one raw file per addressed NODE, since
// `get_variable_defs` has no bulk per-file form; DEDUPLICATED by name, since
// the same variable is typically bound within many different nodes' trees.
// Raw paths are sorted before processing (never in argument order) so a
// name collision resolves the same way regardless of how the caller ordered
// its arguments — the same order-independence invariant the component path
// gets for free from never needing to dedupe at all.
function ingestTokens(root, rawPaths, provider) {
  const sortedPaths = [...rawPaths].sort(compareStrings)
  const byName = new Map()
  const skipped = []
  const ingested = []
  let filesIngested = 0

  // Two passes when the provider offers an index (issue #517): a variable in
  // ONE gathered file can be an alias into another, and a census that only
  // ever sees one payload at a time cannot resolve it. The index is the
  // provider's own structure and is handed back unread (D12) — a provider
  // without one censuses exactly as before.
  const envelopes = []
  for (const rawPath of sortedPaths) {
    const { envelope, error: readError } = readTokenEnvelope(root, rawPath)
    if (readError) {
      skipped.push({ file: rawPath, reason: readError })
      continue
    }
    envelopes.push({ rawPath, envelope })
  }
  const index = provider.indexTokens
    ? provider.indexTokens(
        envelopes.map(({ envelope }) => ({
          payload: envelope.payload,
          tool: envelope.tool,
        })),
      )
    : undefined

  for (const { rawPath, envelope } of envelopes) {
    const result = provider.censusTokens({
      payload: envelope.payload,
      tool: envelope.tool,
      index,
    })
    if (!result.payloadValid) {
      skipped.push({
        file: rawPath,
        reason:
          "payload does not match this provider's expected shape (figma_get_variables or figma_get_text_styles output, or a legacy flat name/value map) — nothing could be censused",
      })
      continue
    }
    filesIngested++
    ingested.push(envelope)
    for (const token of result.tokens) {
      if (!byName.has(token.name)) byName.set(token.name, token)
    }
    if (result.skipped > 0) {
      skipped.push({
        file: rawPath,
        reason: `${result.skipped} raw entr(y/ies) skipped — no name, no resolvable value, or not this tool's documented shape`,
      })
    }
    // An entry the provider could name a reason for is reported with that
    // reason, rather than folded into the count above (issue #517).
    for (const unresolved of result.unresolved || []) {
      skipped.push({
        file: rawPath,
        reason: `"${unresolved.name}": ${unresolved.reason}`,
      })
    }
  }

  const tokens = [...byName.values()].sort((a, b) =>
    compareStrings(a.name, b.name),
  )
  return {
    snapshotFile: "design-tokens.json",
    snapshot: { tokens, provenance: collectProvenance(ingested) },
    unit: "token",
    count: tokens.length,
    filesIngested,
    skipped,
    validate: snapshot => provider.validateDesignTokens(snapshot),
  }
}

// Bindings path (issue #401, plus the layer tree of #402) — one raw file per
// addressed FILE since issue #417 retargeted the gather, and one per addressed
// NODE before it; both shapes ingest, told apart by whether the envelope
// carries a single `nodeId`. Unlike the other two paths this one MERGES into
// an existing design-components.json rather than assembling a snapshot from
// scratch: `usedVars`/`layers` are fields OF a component entry, and a bindings
// gather without a component census has nothing to attach to. The per-node
// shape carries a whole node tree, so one envelope feeds two censuses and the
// layer tree costs no extra gather target; the per-file shape carries an
// already-walked answer instead, so it merges `usedVars`/`variantCombinations`
// and leaves `layers` to whatever an earlier gather recorded.
function ingestBindings(root, rawPaths, provider, config) {
  const { snapshot, error } = readComponentsSnapshot(root, config)
  if (error) {
    // The other half of issue #418's guard: this gather covers only the
    // bindings pass, and the fields the COMPONENTS pass owns cannot be
    // carried forward from anywhere — there is no census to merge onto and
    // `usedVars`/`layers` are fields OF a component entry, not documents of
    // their own. Nothing is written, and the message names the pass to run.
    return {
      fatal: `this gather covers only the bindings pass — its fields are fields of a component entry and there is no design-components.json to merge them onto (${error}). Run the components pass first: \`design-delta gather\` then \`design-delta ingest <raw-file...>\`.`,
    }
  }

  const byAddress = new Map(
    (snapshot.components || []).map(component => [
      provider.componentAddress(component),
      component,
    ]),
  )

  const skipped = []
  let filesIngested = 0
  let merged = 0

  // Merge one node's census record onto its own entry. Returns the reason it
  // could not be, or `null` on success — so both envelope shapes below report
  // a miss identically.
  const mergeRecord = (fileKey, record, payload) => {
    const address = provider.designAddress({ fileKey, nodeId: record.nodeId })
    const component = address ? byAddress.get(address) : undefined
    if (!component)
      return `no design-components.json entry matches ${fileKey}:${record.nodeId} — component census and bindings gather disagree on scope`

    component.usedVars = record.usedVars
    // Recorded only for a component SET, and only when the payload actually
    // yielded combinations (issue #403): an empty list on a variant-less
    // component would read as "this set publishes no combination at all",
    // which is the false finding the absent-means-not-gathered convention
    // exists to prevent.
    if (
      component.type === "COMPONENT_SET" &&
      record.variantCombinations?.length > 0
    )
      component.variantCombinations = record.variantCombinations
    // The component's layer tree, for the design side of the anatomy surface
    // (issue #402). Two shapes carry it: the per-node deep-component payload,
    // censused a second way through the provider, and — since issue #462 —
    // the per-file result's own record, where the bindings walk returns the
    // tree it already traversed. Either way a missing tree leaves whatever
    // the entry already had, never an empty one, which `modules/anatomy.mjs`
    // would read as "carries no layers".
    const layerResult = payload
      ? provider.censusLayers?.({ payload })
      : undefined
    if (layerResult?.payloadValid && layerResult.layers)
      component.layers = layerResult.layers
    else if (record.layers) component.layers = record.layers
    merged++
    return null
  }

  for (const rawPath of [...rawPaths].sort(compareStrings)) {
    const { envelope, error: readError } = readEnvelope(root, rawPath)
    if (readError) {
      skipped.push({ file: rawPath, reason: readError })
      continue
    }

    // Two envelope shapes, told apart structurally rather than by tool name:
    // one carrying a single `nodeId` is the per-NODE gather (issue #401, the
    // deep-component tool), and one without it is the per-FILE gather that
    // replaced it (issue #417) — a result document covering every node of the
    // file at once. The provider owns both censuses; the CLI only picks by
    // whether the envelope addresses one node or a file.
    if (typeof envelope.nodeId !== "string") {
      const batch = provider.censusBindingsBatch?.({
        payload: envelope.payload,
      })
      if (!batch?.payloadValid) {
        skipped.push({
          file: rawPath,
          reason:
            "does not match either raw BINDINGS envelope shape ({provider, fileKey, payload: {<nodeId>: {...}}, ...} or the per-node {..., nodeId, payload})",
        })
        continue
      }
      if (batch.entries.length === 0) {
        skipped.push({
          file: rawPath,
          reason:
            "carries no node results — the gather ran but covered no addressed node",
        })
        continue
      }
      let mergedHere = 0
      for (const record of batch.entries) {
        // A node the script could not resolve is reported, never merged as an
        // empty answer: an absent `usedVars` reads as "not gathered yet",
        // which is the truth, where an empty one would read as "binds
        // nothing".
        const reason =
          record.error != null
            ? `${envelope.fileKey}:${record.nodeId}: ${record.error}`
            : mergeRecord(envelope.fileKey, record, null)
        if (reason) skipped.push({ file: rawPath, reason })
        else mergedHere++
      }
      if (mergedHere > 0) filesIngested++
      continue
    }

    const result = provider.censusBindings({ payload: envelope.payload })
    if (!result.payloadValid) {
      skipped.push({
        file: rawPath,
        reason:
          "payload does not match this provider's expected shape (a node tree) — nothing could be censused",
      })
      continue
    }
    const reason = mergeRecord(
      envelope.fileKey,
      { ...result, nodeId: envelope.nodeId },
      envelope.payload,
    )
    if (reason) skipped.push({ file: rawPath, reason })
    else filesIngested++
  }

  return {
    snapshotFile: "design-components.json",
    snapshot,
    unit: "component",
    count: merged,
    filesIngested,
    skipped,
    validate: s => provider.validateDesignComponents(s),
  }
}

/**
 * Run the subcommand. Returns the exit code; never calls `process.exit`, so
 * tests drive it in-process exactly as they drive `main.mjs`'s `run`.
 *
 * @param {string[]} cmdArgv this subcommand's own argv (globals already removed)
 * @param {{globalOpts: object, io: {stdout: object, stderr: object}, bus: object}} ctx
 * @returns {Promise<number>}
 */
export async function runIngest(cmdArgv, ctx) {
  const { io, globalOpts = {} } = ctx
  const { opts, errors } = parseFlags(cmdArgv, FLAG_SPEC)

  if (errors.length > 0) {
    for (const error of errors)
      io.stderr.write(`design-delta ingest: ${error}\n`)
    return 1
  }

  const rawPaths = opts.positional || []
  if (rawPaths.length === 0) {
    io.stderr.write("design-delta ingest: no raw file(s) given.\n")
    return 1
  }

  const { config, error } = resolveRunConfig(globalOpts.config)
  if (error) {
    io.stderr.write(`design-delta ingest: ${error}\n`)
    return 1
  }

  const loaded = await loadProvider(config)
  if (!loaded.ok) {
    io.stderr.write(`design-delta ingest: ${loaded.reason}\n`)
    return 1
  }
  const { provider } = loaded

  const root = process.cwd()
  const ingested = opts.bindings
    ? ingestBindings(root, rawPaths, provider, config)
    : opts.tokens
      ? ingestTokens(root, rawPaths, provider)
      : ingestComponents(root, rawPaths, provider, config)

  // A partial gather this command structurally cannot complete (issue #418):
  // nothing is written, so the previous snapshot survives intact.
  if (ingested.fatal) {
    io.stderr.write(`design-delta ingest: ${ingested.fatal}\n`)
    return 1
  }

  const {
    snapshotFile,
    snapshot,
    unit,
    count,
    filesIngested,
    bindings,
    skipped,
    validate,
  } = ingested

  const { valid, errors: schemaErrors } = validate(snapshot)
  if (!valid) {
    io.stderr.write(
      `design-delta ingest: assembled an invalid ${snapshotFile}:\n${schemaErrors.map(e => `  - ${e}`).join("\n")}\n`,
    )
    return 1
  }

  const { paths } = resolveConfig(config)
  const snapshotPath = join(root, paths.snapshotDir, snapshotFile)
  mkdirSync(dirname(snapshotPath), { recursive: true })
  writeFileSync(snapshotPath, `${JSON.stringify(snapshot, null, 2)}\n`)

  const result = {
    command: "ingest",
    snapshotPath: join(paths.snapshotDir, snapshotFile),
    counts: {
      [`${unit}s`]: count,
      filesIngested,
      // Only the components path can carry another pass's fields forward
      // (issue #418) — the token snapshot shares no field with any other
      // pass, and the bindings path IS the pass that owns them.
      ...(bindings
        ? {
            bindingsCarriedForward: bindings.carried,
            bindingsDropped: bindings.dropped,
          }
        : {}),
      skipped: skipped.length,
    },
    skipped,
  }

  io.stdout.write(
    opts.json
      ? `${JSON.stringify(result, null, 2)}\n`
      : `design-delta ingest: wrote ${result.snapshotPath} (${count} ${unit}(s) from ${filesIngested} raw file(s), ${skipped.length} skipped${bindings?.carried ? `, ${bindings.carried} bindings record(s) carried forward` : ""})\n`,
  )

  return 0
}
