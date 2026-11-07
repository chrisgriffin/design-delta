/**
 * report.mjs — export a run's findings as ARTIFACTS (issue #179).
 *
 * `audit` answers "what is drifting right now?" on a terminal. `report`
 * answers the same question in a form you can keep: a file to commit, attach
 * to a PR, or hand to someone who was not at the terminal. It runs the same
 * checks and renders them more than one way.
 *
 * WHY IT RUNS `audit` RATHER THAN RE-COMPOSING THE CHECKS. `verify` already
 * established this and its reasoning applies unchanged: a second assembly
 * would drift from the first the moment a surface is added, and then the
 * report and the audit would disagree about what was checked — which is a
 * worse failure for a tool whose entire product is agreement.
 *
 * ADDING AN ARTIFACT TYPE is one entry in `FORMATS` plus a pure renderer in
 * `core/report.mjs`. The table is the extension point, deliberately: every
 * format shares one findings payload, one ordering, and one severity
 * vocabulary, so a second artifact cannot quietly grow its own idea of what
 * the run found. Markdown and terminal are the two that exist; the shape is
 * built for more.
 *
 * DETERMINISM. The renderers are pure and take a pre-formatted timestamp;
 * this layer owns the clock and the filesystem. Same run, same inputs, same
 * bytes — except the one line that says when it ran, which `--no-timestamp`
 * removes for byte-comparison in CI.
 */

import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, isAbsolute, join } from "node:path"

import {
  resolvePaths,
  resolveReport,
  resolveRunConfig,
} from "../../core/config.mjs"
import {
  renderFindingsHuman,
  renderFindingsMarkdown,
  renderFindingsPrComment,
  renderFindingsSarif,
  renderDecisionsHuman,
  renderHealthScoreLine,
  renderSeveritySummary,
} from "../../core/report.mjs"
import { parseFlags } from "../flags.mjs"
import { runAudit } from "./audit.mjs"
import { gatherHealthScore, sink } from "../gather-health-score.mjs"

const FLAG_SPEC = {
  boolean: [
    "--components",
    "--tokens",
    "--styles",
    "--anatomy",
    "--code-only",
    "--no-timestamp",
  ],
  value: ["--format", "--out"],
}

/**
 * Every artifact this command can emit.
 *
 * `terminal` is the one that writes to stdout instead of a file — it has no
 * `file` entry, which is how the writer below tells them apart, rather than
 * special-casing the name.
 */
const FORMATS = {
  terminal: {
    render: (result, ctx) => {
      const decisions = renderDecisionsHuman(result.decided)
      return [
        renderHealthScoreLine(ctx.healthScore, ctx.healthScorePillars),
        renderSeveritySummary(result.findings || []),
        "",
        renderFindingsHuman(result.findings || [], {
          noneMessage: "No findings.",
        }),
        ...(decisions ? ["", decisions] : []),
      ]
        .filter(line => line !== null)
        .join("\n")
    },
  },
  md: {
    file: "drift-report.md",
    render: (result, ctx) => renderFindingsMarkdown(result, ctx),
  },
  sarif: {
    file: "drift-report.sarif",
    render: result => renderFindingsSarif(result.findings || []),
  },
  "pr-comment": {
    file: "drift-report-pr-comment.md",
    render: (result, ctx) => renderFindingsPrComment(result, ctx),
  },
}

const DEFAULT_FORMATS = ["md", "terminal"]

function formatTimestamp(timeZone) {
  // The ONE piece of nondeterminism in this command, isolated here so the
  // renderers stay pure and `--no-timestamp` can remove it entirely.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    dateStyle: "short",
    timeStyle: "short",
    hour12: false,
  }).format(new Date())
}

export async function runReport(cmdArgv, ctx) {
  const { io, globalOpts = {}, bus } = ctx
  const { opts, errors } = parseFlags(cmdArgv, FLAG_SPEC)

  if (errors.length > 0) {
    for (const error of errors)
      io.stderr.write(`design-delta report: ${error}\n`)
    return 1
  }

  const requested = opts.format
    ? String(opts.format)
        .split(",")
        .map(name => name.trim())
        .filter(Boolean)
    : DEFAULT_FORMATS

  const unknown = requested.filter(name => !FORMATS[name])
  if (unknown.length > 0) {
    io.stderr.write(
      `design-delta report: unknown format(s) ${unknown.join(", ")} — known: ${Object.keys(FORMATS).join(", ")}\n`,
    )
    return 1
  }

  const { config, error } = resolveRunConfig(globalOpts.config)
  if (error) {
    io.stderr.write(`design-delta report: ${error}\n`)
    return 1
  }

  // Run the audit for its payload.
  // Scope flags pass straight through under their ORIGINAL spelling: this
  // command re-invokes `audit`'s own parser, which expects the dashed form.
  const SCOPE_FLAGS = {
    components: "--components",
    tokens: "--tokens",
    styles: "--styles",
    anatomy: "--anatomy",
    codeOnly: "--code-only",
  }
  const passthrough = [
    "--json",
    ...Object.entries(SCOPE_FLAGS)
      .filter(([key]) => opts[key] === true)
      .map(([, flag]) => flag),
  ]
  const captured = sink()
  const auditCode = await runAudit(passthrough, {
    io: { stdout: captured.stream, stderr: io.stderr },
    globalOpts,
    bus,
  })

  let result
  try {
    result = JSON.parse(captured.writes.join(""))
  } catch {
    io.stderr.write(
      "design-delta report: the audit produced no readable result\n",
    )
    return auditCode || 1
  }

  const { reportDir } = resolvePaths(config)
  const reportConfig = resolveReport(config)
  // Health score (issue #219) — same computation `verify` uses, over the SAME
  // audit result this command already ran above, so the score `report`
  // renders and the one `verify` gates on can never disagree about what was
  // scored. `report` has no `--json` flag of its own (see the module
  // docblock in docs/cli.md), so this surfaces in the rendered artifacts
  // instead of a raw payload.
  //
  // Skipped entirely when a scope flag narrowed the run: a pillar whose
  // surface never ran reads its zero-denominator as "nothing to grade" and
  // awards full marks (`core/health-score.mjs`'s `pillarScore`), so
  // `report --components` would otherwise print a score with Token
  // Health/Consistency both maxed out regardless of actual token drift —
  // the same "a numerator over a denominator that wasn't scoped the same
  // way is not a measurement" reasoning `verify --staged` already applies.
  const narrowedScope = ["components", "tokens", "styles", "anatomy"].some(
    key => opts[key] === true,
  )
  const health = narrowedScope
    ? { total: null, pillars: null }
    : await gatherHealthScore(result, { io, globalOpts, bus })
  const renderCtx = {
    actions: reportConfig.actions || {},
    healthScore: health.total,
    healthScorePillars: health.pillars,
    ...(opts.noTimestamp
      ? {}
      : { generatedAt: formatTimestamp(reportConfig.timeZone || "UTC") }),
  }

  const root = process.cwd()
  const written = []

  for (const name of requested) {
    const format = FORMATS[name]
    const body = format.render(result, renderCtx)

    if (!format.file) {
      io.stdout.write(`${body}\n`)
      continue
    }

    const target = opts.out ? String(opts.out) : join(reportDir, format.file)
    const absolute = isAbsolute(target) ? target : join(root, target)
    try {
      mkdirSync(dirname(absolute), { recursive: true })
      writeFileSync(absolute, `${body}\n`)
      written.push(target)
    } catch (err) {
      io.stderr.write(
        `design-delta report: could not write ${target}: ${err.message}\n`,
      )
      return 1
    }
  }

  // Say where the artifacts went, on stderr so stdout stays exactly the
  // rendered report for anything piping it.
  for (const path of written) io.stderr.write(`wrote ${path}\n`)

  return 0
}
