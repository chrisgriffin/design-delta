/**
 * movers.mjs — `design-delta movers` (roadmap #216 slice (c), ADR-001 D6):
 * a read-only derived query over `state.json`. Recomputes the live
 * `codeHash`/`specHash` for every contracted component (via
 * `snapshot.mjs`'s `computeComponentEntities`, the same walk `snapshot`
 * itself uses) and diffs it against what the prior `snapshot` run recorded,
 * so the two never drift into disagreeing about what a hash even is.
 *
 * Never writes `state.json` — that stays `snapshot`'s alone (CLAUDE.md's
 * audit-path read-only guarantee).
 */

import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

import { resolvePaths, resolveRunConfig } from "../../core/config.mjs"
import {
  computeComponentEntities,
  resolveDesignHashLookup,
} from "./snapshot.mjs"
import { parseFlags } from "../flags.mjs"

const FLAG_SPEC = { boolean: ["--json"], value: [] }

// `"component:button"` -> `{kind: "component", id: "button"}`. `split` (not
// a two-group regex) so an id that itself contains a colon still round-trips.
function splitEntityKey(key) {
  const [kind, ...rest] = key.split(":")
  return { kind, id: rest.join(":") }
}

// Every hash `state.json` carries per entity, in the order a reason names
// them. `designHash` (issue #481) is absent for an entity with no design
// counterpart, and absent-then-present is a change like any other.
const HASHES = ["codeHash", "specHash", "designHash"]

function reasonFor(priorEntity, currentEntity) {
  const changed = HASHES.filter(
    hash => priorEntity[hash] !== currentEntity[hash],
  )
  if (changed.length === 0) return null
  if (changed.length === 1) return `${changed[0]} changed`
  return `${changed.slice(0, -1).join(", ")} and ${changed[changed.length - 1]} changed`
}

/**
 * Run the `movers` subcommand. Returns the exit code; never calls
 * `process.exit` (matches every other subcommand — see `main.mjs`).
 *
 * @param {string[]} cmdArgv this subcommand's own argv (globals already removed)
 * @param {{globalOpts: object, io: {stdout: object, stderr: object}, bus: object}} ctx
 * @returns {number}
 */
export async function runMovers(cmdArgv, ctx) {
  const { io, globalOpts = {}, bus } = ctx
  const { opts, errors } = parseFlags(cmdArgv, FLAG_SPEC)

  if (errors.length > 0) {
    for (const error of errors)
      io.stderr.write(`design-delta movers: ${error}\n`)
    return 1
  }

  const { config, error } = resolveRunConfig(globalOpts.config)
  if (error) {
    io.stderr.write(`design-delta movers: ${error}\n`)
    return 1
  }

  const root = process.cwd()
  const { stateFile } = resolvePaths(config)
  const stateAbs = join(root, stateFile)

  if (!existsSync(stateAbs)) {
    if (opts.json) {
      io.stdout.write(
        `${JSON.stringify({ command: "movers", moved: [], sinceRun: null }, null, 2)}\n`,
      )
    } else {
      io.stdout.write("no prior run recorded, nothing to compare\n")
    }
    return 0
  }

  let priorState
  try {
    priorState = JSON.parse(readFileSync(stateAbs, "utf8"))
  } catch (err) {
    io.stderr.write(`design-delta movers: ${stateFile}: ${err.message}\n`)
    return 1
  }

  const { designHashFor, reason: designReason } = await resolveDesignHashLookup(
    config,
    root,
  )
  if (designReason)
    io.stderr.write(
      `design-delta movers: designHash not compared — ${designReason}\n`,
    )
  const { entities: currentEntities } = computeComponentEntities(config, root, {
    designHashFor,
    onProgress: bus,
  })

  const moved = []
  for (const [key, priorEntity] of Object.entries(priorState.entities || {})) {
    const currentEntity = currentEntities[key]
    if (!currentEntity) continue
    const reason = reasonFor(priorEntity, currentEntity)
    if (!reason) continue
    moved.push({ ...splitEntityKey(key), reason })
  }

  const sinceRun = priorState.lastRun ?? null

  if (opts.json) {
    io.stdout.write(
      `${JSON.stringify({ command: "movers", moved, sinceRun }, null, 2)}\n`,
    )
  } else if (moved.length === 0) {
    io.stdout.write(`no entities changed since ${sinceRun}\n`)
  } else {
    io.stdout.write(
      `${moved.length} entit${moved.length === 1 ? "y" : "ies"} changed since ${sinceRun}\n`,
    )
    for (const entity of moved)
      io.stdout.write(`  ${entity.kind}:${entity.id} — ${entity.reason}\n`)
  }

  return 0
}
