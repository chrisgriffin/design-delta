/**
 * verify.mjs — the `design-delta verify` subcommand (ADR-001, issue #105):
 * one composed pass/fail gate a consuming project wires into its CI.
 *
 *   design-delta verify [--json] [--staged] [--config <path>] [--fail-on <severity>] [--fail-below <score>]
 *
 * Three checks, in order, because each is meaningless without the one before it:
 *
 *   1. Every contract loads and validates (schema + the cross-reference rules
 *      `spec/contracts.mjs` enforces).
 *   2. Every contract↔code surface runs, and no finding resolves at or above
 *      `--fail-on`'s severity (default `error`, matching the pre-#227 gate).
 *   3. The run's health score (issue #219, `core/health-score.mjs`) is at or
 *      above `--fail-below`, when given.
 *
 * `--fail-on <error|warn|review|none>` (issue #227) picks the threshold: a
 * severity gates when it's that severity or worse, `SEVERITIES`' worst-first
 * order deciding "worse." `none` relaxes the finding check entirely — only
 * an invalid contract can still fail the run.
 *
 * `--fail-below <score>` (issue #219) is a SEPARATE gate, not a replacement
 * for `--fail-on`: a project can be below its severity threshold (no errors)
 * and still below its score threshold (a pile of warn-severity raw values), or
 * the reverse. Both are checked and either can fail the run on its own —
 * composing, not overriding, exactly as the issue's plan requires. The score
 * itself is computed from `audit`'s findings AND `lint`'s (the Consistency
 * pillar is lint-only) via `cli/gather-health-score.mjs`, which reuses both
 * subcommands wholesale for the same "one assembly of what ran" reason `audit`
 * itself is reused below rather than re-composed.
 *
 * `--staged` (issue #220) is handed straight to `audit` — the gate scopes to
 * the staged change exactly the way the report does, for the same reason step
 * 2 reuses `audit` wholesale rather than re-composing it: two assemblies of
 * "what was checked" drift, and then the gate and the report disagree. Step 1
 * is deliberately NOT scoped — a contract that does not validate is a defect
 * in the fixed point every other check compares against, staged or not.
 *
 * WHY THIS IS A SEPARATE COMMAND AND NOT `audit --check`. They differ in their
 * DEFAULT, and the default is the whole point of each:
 *
 *   - `audit` reports. It exits 0 no matter what it found, unless you ask for
 *     a gate with `--check`. Editing a config must never silently turn an
 *     informational run into a red pipeline — a rule the old engine learned
 *     the hard way and this one inherits.
 *   - `verify` gates. It exists to fail, so it needs no flag to do its job,
 *     and an invalid CONTRACT fails it too — which `audit` tolerates, since a
 *     broken contract there is a diagnostic about coverage rather than a
 *     defect in the code.
 *
 * DIAGNOSTICS DO NOT GATE. A surface that could not be read (no tokens file,
 * `typescript` not installed, a stylesheet that would not parse) is reported
 * and does not fail the run: "we could not look" is not "we looked and it is
 * wrong." Only a real finding at `error` severity fails. The one exception is
 * step 1 — a contract that does not validate is a defect in the thing every
 * other check compares against, so it fails outright.
 *
 * NEEDS NO DESIGN TOOL. Per ADR-001 D15 the first release checks contract↔code
 * only, so this gate runs with no credentials, no network, and no provider
 * configured — something the old engine's `verify` never managed, since its
 * conformance path always wanted a Figma census to be complete.
 */

import {
  SEVERITIES,
  SEVERITY_RANK,
  countBySeverity,
  sortFindings,
} from "../../core/findings.mjs"
import { resolvePaths, resolveRunConfig } from "../../core/config.mjs"
import { loadContracts } from "../../spec/contracts.mjs"
import { PILLAR_LABELS, PILLAR_MAX } from "../../core/health-score.mjs"
import { parseFlags } from "../flags.mjs"
import { runAudit } from "./audit.mjs"
import { gatherHealthScore, sink } from "../gather-health-score.mjs"

const FLAG_SPEC = {
  boolean: ["--json", "--staged"],
  value: ["--fail-on", "--fail-below"],
}

// What `--fail-on` accepts: any resolved severity a finding may carry, worst-
// first (SEVERITIES), plus "none" to relax the gate to contract-validity
// only. Default "error" preserves the pre-#227 gate exactly.
const FAIL_ON_VALUES = [...SEVERITIES, "none"]
const DEFAULT_FAIL_ON = "error"

// `--fail-below` is unset by default — no score gate unless a project asks
// for one, the same "editing a config must never silently turn an
// informational run into a red pipeline" rule `audit`'s own docblock states.
function parseFailBelow(raw) {
  if (raw === undefined) return { value: null }
  const value = Number(raw)
  if (!Number.isInteger(value) || value < 0 || value > 100) {
    return { error: raw }
  }
  return { value }
}

export async function runVerify(cmdArgv, ctx) {
  const { io, globalOpts = {}, bus } = ctx
  const { opts, errors } = parseFlags(cmdArgv, FLAG_SPEC)

  if (errors.length > 0) {
    for (const error of errors)
      io.stderr.write(`design-delta verify: ${error}\n`)
    return 1
  }

  const failOn = opts.failOn || DEFAULT_FAIL_ON
  if (!FAIL_ON_VALUES.includes(failOn)) {
    io.stderr.write(
      `design-delta verify: invalid --fail-on "${failOn}" — must be one of ${FAIL_ON_VALUES.join(", ")}\n`,
    )
    return 1
  }

  const failBelow = parseFailBelow(opts.failBelow)
  if (failBelow.error !== undefined) {
    io.stderr.write(
      `design-delta verify: invalid --fail-below "${failBelow.error}" — must be an integer from 0 to 100\n`,
    )
    return 1
  }
  if (opts.staged && failBelow.value !== null) {
    io.stderr.write(
      "design-delta verify: --fail-below is not supported with --staged — the health score's pillars are not consistently scoped to the staged change (Token Health's denominator and Consistency's lint pass are always project-wide), so a staged score would not mean what --fail-below claims it means. Run --fail-below without --staged.\n",
    )
    return 1
  }

  const { config, error } = resolveRunConfig(globalOpts.config)
  if (error) {
    io.stderr.write(`design-delta verify: ${error}\n`)
    return 1
  }

  const root = process.cwd()
  const { contractsDir } = resolvePaths(config)

  // --- 1. contracts must validate -------------------------------------
  const contracts = loadContracts(config, { root })
  const contractsOk = contracts.diagnostics.length === 0

  // --- 2. every contract↔code surface ----------------------------------
  // Reuse `audit` wholesale rather than re-composing four checks here: a
  // second assembly would drift from the first the moment a surface is added,
  // and then the gate and the report would disagree about what was checked.
  const captured = sink()
  await runAudit(opts.staged ? ["--json", "--staged"] : ["--json"], {
    io: { stdout: captured.stream, stderr: io.stderr },
    globalOpts,
    bus,
  })

  let audit = { findings: [], diagnostics: [] }
  try {
    audit = JSON.parse(captured.writes.join("")) || audit
  } catch {
    io.stderr.write(
      "design-delta verify: could not read the audit result — treating the run as failed.\n",
    )
    return 1
  }

  const findings = sortFindings(audit.findings || [])
  const counts = countBySeverity(findings)

  // Severities `--fail-on <severity>` gates on: that severity and everything
  // worse than it (SEVERITIES is worst-first, so this is a prefix). "none"
  // gates on nothing — only an invalid contract can still fail the run.
  const gatingSeverities =
    failOn === "none"
      ? []
      : SEVERITIES.filter(s => SEVERITY_RANK[s] >= SEVERITY_RANK[failOn])
  const gatingFindings = findings.filter(f =>
    gatingSeverities.includes(f.severity),
  )
  const reportedSeverities = SEVERITIES.filter(
    s => !gatingSeverities.includes(s),
  )

  // --- 3. health score, when --fail-below asks for one -------------------
  // Skipped entirely under --staged: the score's pillars mix a staged-scoped
  // numerator with project-wide denominators (Token Health, Consistency),
  // so a "staged score" would be a number, not a measurement — the same
  // reasoning `--fail-below` + `--staged` already refuses above.
  const { total: healthScore, pillars: healthScorePillars } = opts.staged
    ? { total: null, pillars: null }
    : await gatherHealthScore(audit, { io, globalOpts, bus })
  const belowScoreGate =
    failBelow.value !== null && healthScore < failBelow.value
  const failed = !contractsOk || gatingFindings.length > 0 || belowScoreGate

  if (opts.json) {
    io.stdout.write(
      `${JSON.stringify(
        {
          ok: !failed,
          failOn,
          failBelow: failBelow.value,
          contracts: {
            ok: contractsOk,
            checked: (contracts.contracts || []).length,
            diagnostics: contracts.diagnostics,
          },
          findings: { counts, total: findings.length },
          healthScore,
          healthScorePillars,
          // Reported, never gating — see the module docblock.
          diagnostics: audit.diagnostics || [],
        },
        null,
        2,
      )}\n`,
    )
    return failed ? 1 : 0
  }

  const lines = []
  lines.push(
    contractsOk
      ? `OK    ${(contracts.contracts || []).length} contract(s) valid`
      : `FAIL  ${contracts.diagnostics.length} contract diagnostic(s) under ${contractsDir}`,
  )
  for (const diagnostic of contracts.diagnostics) {
    lines.push(`        ${diagnostic.file} ${diagnostic.message}`)
  }

  lines.push(
    gatingFindings.length > 0
      ? `FAIL  ${gatingFindings.length} finding(s) at "${failOn}" severity or above`
      : failOn === "none"
        ? "OK    findings never fail the gate (--fail-on none)"
        : `OK    no findings at "${failOn}" severity or above`,
  )
  for (const finding of gatingFindings) {
    lines.push(`        ${finding.ruleId}  ${finding.entity}`)
  }

  const reportedParts = reportedSeverities
    .filter(s => counts[s] > 0)
    .map(s => `${counts[s]} ${s}`)
  if (reportedParts.length > 0) {
    lines.push(`      (${reportedParts.join(", ")} — reported, not gating)`)
  }
  const skipped = (audit.diagnostics || []).length
  if (skipped > 0) {
    lines.push(
      `      (${skipped} diagnostic(s) — a surface that could not be read does not fail the gate)`,
    )
  }

  if (opts.staged) {
    lines.push(
      "      health score: not computed under --staged (pillars are not staged-scoped — run without --staged for a score)",
    )
  } else {
    const pillarSummary = Object.keys(PILLAR_MAX)
      .map(
        key =>
          `${PILLAR_LABELS[key]} ${healthScorePillars[key]}/${PILLAR_MAX[key]}`,
      )
      .join(", ")
    lines.push(`      health score: ${healthScore}/100 (${pillarSummary})`)
    if (failBelow.value !== null) {
      lines.push(
        belowScoreGate
          ? `FAIL  health score ${healthScore} below --fail-below ${failBelow.value}`
          : `OK    health score ${healthScore} meets --fail-below ${failBelow.value}`,
      )
    }
  }

  lines.push("")
  lines.push(failed ? "verify FAILED" : "verify passed")
  io.stdout.write(`${lines.join("\n")}\n`)

  return failed ? 1 : 0
}
