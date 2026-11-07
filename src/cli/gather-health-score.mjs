/**
 * gather-health-score.mjs — the one place `verify`/`report` turn an already-
 * run `audit` result into a health score (issue #219).
 *
 * `core/health-score.mjs`'s `computeHealthScore` is pure: findings + counts
 * in, numbers out. It needs findings from TWO surfaces — `audit`'s own (three
 * of the four pillars) and `lint`'s (the Consistency pillar's three rules,
 * which only `lint` ever emits — `audit` does not run the lint surface, by
 * design; see `cli/commands/lint.mjs`'s own docblock). This module is the
 * `cli/` composition that bridges that gap, the exact same "reuse the
 * subcommand wholesale via a captured stdout sink" pattern `verify.mjs`
 * already uses to reuse `audit` — so a second, drifting assembly of "what did
 * this project's lint surface find" never has to exist.
 *
 * Config is already known-valid by the time this runs: `runAudit` validates
 * every rule id in `rules`/`exemptions` against the FULL registry (which
 * includes `lint/*`) before it does anything else, and both `verify` and
 * `report` only reach this after that audit run already succeeded. So a
 * `lint` run here failing to produce parseable JSON is not a config problem —
 * it is treated as "no lint findings" rather than a second failure path the
 * caller has to handle, the same leniency `verify.mjs`'s own audit-JSON
 * parse already extends for the same reason.
 */

import { runLint } from "./commands/lint.mjs"
import { computeHealthScore } from "../core/health-score.mjs"

// A stdout sink: a command that runs another command for its findings, not
// its report, captures and discards the inner rendering rather than
// interleaving it with its own output. Shared by `verify`/`report`/`map`.
export function sink() {
  const writes = []
  return { stream: { write: c => (writes.push(c), true) }, writes }
}

/**
 * @param {{findings: object[], counts: object}} auditResult the already-
 *   parsed `audit --json` payload the caller ran itself
 * @param {{io: {stdout: object, stderr: object}, globalOpts: object, bus: object}} ctx
 * @returns {Promise<{total: number, pillars: object}>}
 */
export async function gatherHealthScore(auditResult, { io, globalOpts, bus }) {
  const captured = sink()
  await runLint(["--json"], {
    io: { stdout: captured.stream, stderr: io.stderr },
    globalOpts,
    bus,
  })

  let lint = { findings: [] }
  try {
    lint = JSON.parse(captured.writes.join("")) || lint
  } catch {
    lint = { findings: [] }
  }

  return computeHealthScore({
    findings: [...(auditResult.findings || []), ...(lint.findings || [])],
    counts: auditResult.counts || {},
  })
}
