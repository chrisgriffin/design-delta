/**
 * snapshot.mjs — `design-delta snapshot` (roadmap #216, slice a): write
 * `state.json` with per-entity code/spec hashes. The ONLY command that
 * writes state — `audit`/`verify`/`lint`/`report` are unchanged by this
 * file's existence, preserving the audit path's read-only guarantee
 * (CLAUDE.md).
 *
 * Scope: CONTRACTED COMPONENTS only, for this slice. A token's own DTCG
 * entry already IS both its code and its spec (D3 — `tokens.mjs`'s own
 * docblock), so a distinct codeHash/specHash pair does not describe a token
 * the same way it describes a component; token entities are deliberately
 * left out here rather than guessed at, and are a natural extension once a
 * concrete "new since last run" consumer (the future #243) needs them.
 * `lastRunByScope.tokens` is therefore never written by this slice.
 *
 * An orphan contract (no `sources.code.path`) is skipped with a stated
 * reason, the same "surface skips, it doesn't fail the run" convention
 * `audit.mjs` already follows.
 */

import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"

import { resolvePaths, resolveRunConfig } from "../../core/config.mjs"
import { hashJson } from "../../core/state.mjs"
import { loadProvider } from "../../providers/index.mjs"
import { loadContracts, stripCommentKeys } from "../../spec/contracts.mjs"
import { resolveFramework } from "../../sources/frameworks.mjs"
import { readDesignSnapshot } from "../design-snapshot.mjs"
import { parseFlags } from "../flags.mjs"

const FLAG_SPEC = { boolean: ["--json"], value: [] }

/**
 * Compute a `component:<id>` entity state for every loaded contract with a
 * readable `sources.code.path` — the same per-contract `extractComponent`
 * pass `snapshot` writes to disk, factored out so a read-only consumer
 * (`audit`/`verify`'s `isNew`, issue #243) can compute the CURRENT state to
 * diff against a prior `state.json`, without duplicating the hash recipe
 * (`docs/state-shape.md`).
 *
 * @param {Array<{id: string, contract: object}>} contracts
 * @param {{root: string}} options
 * @returns {{entities: object, skipped: Array<{id: string, reason: string}>}}
 */
export function buildEntityStates(contracts, { root, config, designHashFor }) {
  const { extractComponent } = resolveFramework(config)
  const entities = {}
  const skipped = []
  const now = new Date().toISOString()

  for (const { id, contract } of contracts) {
    const codePath = contract?.sources?.code?.path
    if (!codePath) {
      skipped.push({ id, reason: "no sources.code.path" })
      continue
    }

    const absPath = join(root, codePath)
    const result = extractComponent(absPath, { label: codePath, root })
    if (!result.ok) {
      skipped.push({
        id,
        reason: result.diagnostics[0]?.message || "component could not be read",
      })
      continue
    }

    // The design census's own hash for this contract's design counterpart
    // (issue #481) — present only when a provider is configured, the
    // snapshot reads, and `sources.design` resolves; omitted otherwise,
    // never null.
    const designHash = designHashFor?.(contract)
    entities[`component:${id}`] = {
      codeHash: hashJson(result.component.props),
      specHash: hashJson(stripCommentKeys(contract)),
      ...(typeof designHash === "string" ? { designHash } : {}),
      lastSeen: now,
    }
  }

  return { entities, skipped }
}

/**
 * A `contract → designHash` lookup over the committed design census, or
 * `null` when there is nothing to look up: no `design.provider`, the
 * provider failed to load, or `design-components.json` is absent or
 * invalid. The hash is the provider's own per-component `treeHash`, read
 * verbatim — this engine never hashes a design tool's payload itself. Keyed
 * by the provider's address for a component, matched against its address
 * for a contract's `sources.design`, so the vocabulary stays the provider's
 * (D12). Async only because a provider loads lazily.
 *
 * "Never gathered" is silent and "gathered but invalid" is not (D7): a
 * configured provider that failed to load, or a census that is present but
 * unparseable or fails its schema, comes back as `reason`, and the caller
 * says so — otherwise a broken census would write a state file with every
 * `designHash` missing, and the next good run would report every entity as
 * `designHash changed` for no real reason.
 *
 * @param {object} config
 * @param {string} root
 * @returns {Promise<{designHashFor: ((contract: object) => string|undefined)|null, reason?: string}>}
 */
export async function resolveDesignHashLookup(config, root) {
  const configured =
    typeof config?.design?.provider === "string" &&
    config.design.provider.length > 0
  if (!configured) return { designHashFor: null }
  const loaded = await loadProvider(config)
  if (!loaded.ok) return { designHashFor: null, reason: loaded.reason }
  const provider = loaded.provider
  const { snapshotDir } = resolvePaths(config)
  const { snapshot, reason } = readDesignSnapshot(
    join(root, snapshotDir, "design-components.json"),
    provider.validateDesignComponents,
  )
  if (!snapshot) return { designHashFor: null, ...(reason ? { reason } : {}) }
  const byAddress = new Map()
  for (const component of snapshot.components || []) {
    if (typeof component?.treeHash !== "string") continue
    byAddress.set(provider.componentAddress(component), component.treeHash)
  }
  return {
    designHashFor: contract => {
      const source = contract?.sources?.design
      if (!source) return undefined
      const key = provider.designAddress(source)
      return key ? byAddress.get(key) : undefined
    },
  }
}

/**
 * Compute the live, current-code-and-contract entity map — the same
 * `component:<id>` → `{codeHash, specHash, lastSeen}` shape `state.json`
 * stores. Exported so `movers.mjs` can recompute "what the hashes are right
 * now" and diff it against what a prior `snapshot` run recorded, without a
 * second, drifting copy of this walk.
 *
 * @param {object} config
 * @param {string} root
 * @param {{onProgress?: object}} [options]
 * @returns {{entities: object, skipped: {id: string, reason: string}[], now: string}}
 */
export function computeComponentEntities(
  config,
  root,
  { onProgress, designHashFor } = {},
) {
  const contractsResult = loadContracts(config, { root, onProgress })

  const now = new Date().toISOString()
  const { entities, skipped } = buildEntityStates(contractsResult.contracts, {
    root,
    config,
    designHashFor,
  })

  return { entities, skipped, now }
}

/**
 * Run the `snapshot` subcommand. Returns the exit code; never calls
 * `process.exit` (matches every other subcommand — see `main.mjs`).
 *
 * @param {string[]} cmdArgv this subcommand's own argv (globals already removed)
 * @param {{globalOpts: object, io: {stdout: object, stderr: object}, bus: object}} ctx
 * @returns {number}
 */
export async function runSnapshot(cmdArgv, ctx) {
  const { io, globalOpts = {}, bus } = ctx
  const { opts, errors } = parseFlags(cmdArgv, FLAG_SPEC)

  if (errors.length > 0) {
    for (const error of errors)
      io.stderr.write(`design-delta snapshot: ${error}\n`)
    return 1
  }

  const { config, error } = resolveRunConfig(globalOpts.config)
  if (error) {
    io.stderr.write(`design-delta snapshot: ${error}\n`)
    return 1
  }

  const root = process.cwd()
  const { designHashFor, reason: designReason } = await resolveDesignHashLookup(
    config,
    root,
  )
  if (designReason)
    io.stderr.write(
      `design-delta snapshot: designHash not recorded — ${designReason}\n`,
    )
  const { entities, skipped, now } = computeComponentEntities(config, root, {
    onProgress: bus,
    designHashFor,
  })

  const state = {
    $schema: "https://chrisgriffin.io/schemas/design-delta/state.schema.json",
    entities,
    lastRun: now,
    lastRunByScope: { components: now },
  }

  const { stateFile } = resolvePaths(config)
  const outputAbs = join(root, stateFile)
  mkdirSync(dirname(outputAbs), { recursive: true })
  writeFileSync(outputAbs, `${JSON.stringify(state, null, 2)}\n`)

  const counts = {
    entities: Object.keys(entities).length,
    skipped: skipped.length,
  }

  if (opts.json) {
    io.stdout.write(
      `${JSON.stringify({ command: "snapshot", output: stateFile, counts, skipped, ...(designReason ? { designSkipped: designReason } : {}) }, null, 2)}\n`,
    )
  } else {
    io.stdout.write(
      `wrote ${stateFile} (${counts.entities} entit${counts.entities === 1 ? "y" : "ies"}, ${counts.skipped} skipped)\n`,
    )
    for (const skip of skipped)
      io.stdout.write(`  SKIP  ${skip.id}: ${skip.reason}\n`)
  }

  return 0
}
