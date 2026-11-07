/**
 * gather.mjs — `design-delta gather` (ADR-003 Phase 5.1 components + Phase
 * 5.3 tokens): prints the PLAN an agent needs to census the design side.
 * The engine is a deterministic Node CLI with no agent inside it, so this
 * command never calls a design tool itself — it only decides WHAT to
 * gather (which tool, which targets, where to write each raw response) and
 * prints that as one JSON document. An agent reads the plan, runs the named
 * tool, and writes each raw response verbatim; `design-delta ingest` is
 * what turns those raw files into the normalized D7 snapshots `audit`/
 * `verify` read.
 *
 *   design-delta gather [--tokens] [--config <path>]
 *
 * No `--tokens`: the COMPONENT plan (unchanged since Phase 5.1) — one
 * target per addressed contract's FILE KEY, since the component-listing
 * tool has a bulk per-file form. `--tokens`: the TOKEN plan (Phase 5.3) —
 * one target per addressed contract's `{fileKey, nodeId}` INSTEAD, since
 * the variable-lookup tool has no bulk form at all, only per-node. The two
 * are separate plans (different MCP tool, different target shape, different
 * output files) rather than one combined document — an agent runs one or
 * the other, matching how `ingest`/`ingest --tokens` already write to two
 * distinct snapshot files.
 *
 * Scope is the union of every loaded contract's `sources.design` (ADR-003:
 * "census scope replaces `config.fileKeys`") — never a config list, so an
 * address a contract doesn't reference is never gathered, and one it does
 * is never missed. A contract with no `sources.design`, or one that doesn't
 * match the active provider's `sourceSchema`, contributes nothing to either
 * plan — silently, the same "surface skips, it doesn't fail the run"
 * convention every other census here follows.
 *
 * Exit codes: 0 once a plan is printed (including the vacuous "nothing to
 * gather" plan, `targets: []`, when no contract resolves an address — that
 * is a legitimate project state, not a failure); 1 when `design.provider`
 * is unset or names an unknown provider, since the user explicitly asked
 * this command to do something it structurally cannot without one.
 *
 * Stream invariant (D8): this command always writes ONE JSON document to
 * stdout and nothing else — there is no human-formatted variant, since the
 * plan's one consumer is an agent, not a person reading a terminal.
 */

import { join } from "node:path"

import { resolveConfig, resolveRunConfig } from "../../core/config.mjs"
import { loadContracts } from "../../spec/contracts.mjs"
import { loadProvider } from "../../providers/index.mjs"
import { parseFlags } from "../flags.mjs"

const FLAG_SPEC = { boolean: ["--tokens", "--bindings"], value: [] }

/**
 * Run the subcommand. Returns the exit code; never calls `process.exit`, so
 * tests drive it in-process exactly as they drive `main.mjs`'s `run`.
 *
 * @param {string[]} cmdArgv this subcommand's own argv (globals already removed)
 * @param {{globalOpts: object, io: {stdout: object, stderr: object}, bus: object}} ctx
 * @returns {Promise<number>}
 */
export async function runGather(cmdArgv, ctx) {
  const { io, globalOpts = {}, bus } = ctx
  const { opts, errors } = parseFlags(cmdArgv, FLAG_SPEC)

  if (errors.length > 0) {
    for (const error of errors)
      io.stderr.write(`design-delta gather: ${error}\n`)
    return 1
  }

  const { config, error } = resolveRunConfig(globalOpts.config)
  if (error) {
    io.stderr.write(`design-delta gather: ${error}\n`)
    return 1
  }

  const loaded = await loadProvider(config)
  if (!loaded.ok) {
    io.stderr.write(`design-delta gather: ${loaded.reason}\n`)
    return 1
  }
  const { provider } = loaded

  const root = process.cwd()
  const contractsResult = loadContracts(config, { root, onProgress: bus })
  const { paths } = resolveConfig(config)
  const rawDir = join(paths.snapshotDir, "raw")

  // `design.files` (issue #413): config-listed files JOIN the contract-
  // derived scope — additive, never a replacement, so ADR-003's orphan-proof
  // derivation stands and a file no contract references yet still gathers.
  const configFiles = (
    Array.isArray(config?.design?.files) ? config.design.files : []
  ).filter(file => typeof file === "string" && file.length > 0)

  if (opts.bindings) {
    const addresses = contractsResult.contracts
      .map(({ contract }) => provider.designAddress(contract?.sources?.design))
      .filter(address => typeof address === "string" && address.length > 0)
    const plan = provider.buildBindingsGatherPlan(addresses, rawDir)
    io.stdout.write(JSON.stringify(plan, null, 2) + "\n")
    return 0
  }

  if (opts.tokens) {
    const addresses = contractsResult.contracts
      .map(({ contract }) => provider.designAddress(contract?.sources?.design))
      .filter(address => typeof address === "string" && address.length > 0)
      // A bare file identifier contributes its file to the token plan's
      // per-file targets (the plan only reads the file half of an address).
      .concat(configFiles)
    const plan = provider.buildTokenGatherPlan(addresses, rawDir)
    io.stdout.write(JSON.stringify(plan, null, 2) + "\n")
    return 0
  }

  const fileKeys = contractsResult.contracts
    .map(({ contract }) => provider.sourceFileKey(contract?.sources?.design))
    .filter(fileKey => typeof fileKey === "string" && fileKey.length > 0)
    .concat(configFiles)
  const plan = provider.buildGatherPlan(fileKeys, rawDir)

  io.stdout.write(JSON.stringify(plan, null, 2) + "\n")
  return 0
}
