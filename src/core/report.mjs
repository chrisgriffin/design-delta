/**
 * report.mjs — small terminal-rendering helpers over the D5 finding shape
 * (ADR-001 D4 lists `core/report.mjs` as "markdown + JSON + terminal
 * renderers over findings"). Phase 1 needs only the plain-text terminal view
 * `audit` renders with; the combined markdown/JSON report view lands with
 * Phase 4's `report` subcommand, once more than one surface feeds it — this
 * file grows then rather than being over-built now for renderers nothing
 * calls yet.
 *
 * Pure: takes an already-computed findings list and renders text. No fs, no
 * network, no config resolution — a caller decides what to compare and which
 * config governs it; this only decides how the RESULT reads on a terminal.
 * `core/`: imports nothing outside `core/` (ADR-001 D4).
 */

import {
  SEVERITIES,
  countBySeverity,
  groupFindingsBySeverityAndRule,
  sortFindings,
} from "./findings.mjs"
import { PILLAR_LABELS, PILLAR_MAX } from "./health-score.mjs"

/**
 * Render a findings list as human-readable terminal text, worst first and
 * grouped so it is actionable: severity, then rule (biggest pile on top),
 * then every entity that rule fired on. A reader sees "13 errors, 8 of them
 * prop-type-mismatch, on these components" without scrolling past 400
 * reviews to find them. No trailing newline — callers add their own.
 * Reuses `groupFindingsBySeverityAndRule`'s ordering directly, so this
 * never re-derives or re-sorts anything itself.
 *
 *     ERROR — 13
 *       components/prop-type-mismatch (8)
 *         card-grid      [design]: prop "mb" is typed "boolean" …
 *         content-image  [design]: prop "src" is typed "string" …
 *
 * @param {object[]} findings
 * @param {{noneMessage?: string}} [options] `noneMessage` renders in place of
 *   an empty list, so a clean run's output is a stated fact ("No findings.")
 *   rather than silence
 * @returns {string}
 */
export function renderFindingsHuman(findings, { noneMessage } = {}) {
  if (findings.length === 0) return noneMessage || "No findings."

  const lines = []
  for (const group of groupFindingsBySeverityAndRule(findings)) {
    if (lines.length > 0) lines.push("")
    lines.push(`${group.severity.toUpperCase()} — ${group.findings.length}`)
    for (const { ruleId, findings: ruleFindings } of group.rules) {
      lines.push(`  ${ruleId} (${ruleFindings.length})`)
      const width = Math.max(...ruleFindings.map(f => f.entity.length))
      for (const finding of ruleFindings) {
        lines.push(
          `    ${finding.entity.padEnd(width)}  [${finding.side}]: ${finding.message}`,
        )
      }
    }
  }
  return lines.join("\n")
}

const DECISION_KINDS = ["waived", "tracked", "accepted"]

/**
 * The "Decisions" section: every exempted finding, grouped by the decision
 * that covers it, one line each with its reason and issue. `null` when
 * nothing was exempted, so callers add no empty heading.
 *
 *     DECISIONS — 3
 *       tracked (1)
 *         header/nav  components/binding-file-stale — rebuild pending (owner/repo#12)
 *
 * @param {object[]} [decided] findings carrying `decision: {kind, reason, issue}`
 * @returns {string|null}
 */
export function renderDecisionsHuman(decided) {
  if (!decided || decided.length === 0) return null
  const lines = [`DECISIONS — ${decided.length}`]
  for (const kind of DECISION_KINDS) {
    const group = decided.filter(finding => finding.decision.kind === kind)
    if (group.length === 0) continue
    lines.push(`  ${kind} (${group.length})`)
    const width = Math.max(...group.map(f => f.entity.length))
    for (const { entity, ruleId, decision } of group) {
      const reason = decision.reason ? ` — ${decision.reason}` : ""
      const issue = decision.issue ? ` (${decision.issue})` : ""
      lines.push(`    ${entity.padEnd(width)}  ${ruleId}${reason}${issue}`)
    }
  }
  return lines.join("\n")
}

/**
 * "N error(s), N warn(s), N review(s)" — the fixed-column severity summary a
 * finding-emitting command renders. Always in `SEVERITIES` order and always
 * names every severity (even at zero, via `countBySeverity`), so scanning
 * output across runs never has to account for a missing column.
 *
 * @param {object[]} findings
 * @returns {string}
 */
export function renderSeveritySummary(findings) {
  const counts = countBySeverity(findings)
  return `${counts.error} error(s), ${counts.warn} warn(s), ${counts.review} review(s)`
}

// One line of pillar detail, in `PILLAR_MAX`'s fixed order, shared by every
// renderer below (issue #219) — "value discipline 55/60, token health 18/20, …".
function pillarBreakdown(pillars) {
  return Object.keys(PILLAR_MAX)
    .map(key => `${PILLAR_LABELS[key]} ${pillars[key]}/${PILLAR_MAX[key]}`)
    .join(", ")
}

/**
 * "Health score: N/100 (value discipline …/60, …)" — a caller passes
 * `undefined` when no score was computed for this render (never a partial
 * `{total}` with no `pillars`), in which case this returns `null` rather than
 * a line naming a score that does not exist.
 *
 * @param {number} [total]
 * @param {object} [pillars]
 * @returns {string|null}
 */
export function renderHealthScoreLine(total, pillars) {
  if (typeof total !== "number" || !pillars) return null
  return `Health score: ${total}/100 (${pillarBreakdown(pillars)})`
}

// ---------------------------------------------------------------------------
// Markdown — the first exported ARTIFACT (issue: report command).
//
// A renderer here is pure: findings in, a string out. It never writes a file,
// never reads config from disk, and never asks what time it is — `generatedAt`
// is passed IN so the same inputs always produce the same bytes, which is the
// determinism gate ADR-001 sets for every surface. The command layer owns the
// clock and the filesystem.
//
// Adding another artifact type (HTML, CSV, a JSON shape someone else consumes)
// means adding a sibling function here and one entry in the command's format
// table — deliberately, so a new format cannot accidentally acquire its own
// idea of ordering, grouping, or severity vocabulary.
// ---------------------------------------------------------------------------

function escapeCell(text) {
  // A finding message can contain a literal `|`, which would silently split a
  // markdown table cell and shift every column after it.
  return String(text).replace(/\|/g, "\\|").replace(/\n/g, " ")
}

/**
 * One phrase per design snapshot: gathered when, or why not. Exported so the
 * terminal renderer can share the exact wording.
 *
 * @param {object|undefined} provenance `audit --json`'s `provenance` block
 * @returns {string}
 */
export function renderDesignBasis(provenance) {
  if (!provenance || typeof provenance !== "object")
    return "none — no design provider configured"
  if (typeof provenance.notConsulted === "string")
    return `not consulted (${provenance.notConsulted}) — a design provider is configured but this run did not read it`
  if (typeof provenance.unavailable === "string")
    return `unavailable — ${provenance.unavailable}`
  const parts = []
  const describe = (label, entry) => {
    if (entry === undefined) return
    if (entry === null) parts.push(`${label}: no snapshot`)
    else if (typeof entry.gatheredAt === "string")
      parts.push(`${label} gathered ${entry.gatheredAt}`)
    else
      parts.push(
        `${label}: committed snapshot, gather date unknown (ingested before provenance was recorded)`,
      )
    // Ingested by an engine older than the rules reading it (issue #458):
    // the basis line says so, because the findings under it may be wrong.
    if (entry && typeof entry.normalizationStale === "string")
      parts[parts.length - 1] +=
        " — normalization stale, re-ingest (see diagnostics)"
  }
  describe("components", provenance.designComponents)
  describe("tokens", provenance.designTokens)
  return parts.length > 0 ? parts.join("; ") : "none"
}

function severityLine(findings) {
  const counts = countBySeverity(findings)
  return SEVERITIES.map(s => `${counts[s]} ${s}`).join(" · ")
}

/**
 * Render one GFM table with every column padded to its widest cell — the
 * shape Prettier's markdown formatter produces, so a consumer that commits
 * the report and runs Prettier sees a diff proportional to what changed,
 * not a whole-file repad (issue #369: 520+/525- across 181 KB for 11 real
 * lines). `align` is per column: `"right"` right-justifies the cells and
 * ends the delimiter in `:`.
 *
 * ponytail: width is `String.length`, code points not terminal columns; a
 * CJK or emoji cell will still repad under Prettier's string-width. None
 * of this engine's own output contains one today.
 *
 * @param {string[]} header
 * @param {string[][]} rows already-escaped cell text
 * @param {{align?: Array<"left"|"right">}} [options]
 * @returns {string[]} the table's lines
 */
function renderMarkdownTable(header, rows, { align = [] } = {}) {
  // A whitespace run inside a cell is folded to one space by every CommonMark
  // renderer AND by Prettier — so it must be folded here first, or the
  // padded width is computed against text the formatter will shorten.
  rows = rows.map(row => row.map(cell => cell.replace(/\s+/g, " ").trim()))
  const widths = header.map((cell, column) =>
    Math.max(
      3, // a delimiter is at least `---`
      cell.length,
      ...rows.map(row => row[column].length),
    ),
  )
  const pad = (cell, column) =>
    align[column] === "right"
      ? cell.padStart(widths[column])
      : cell.padEnd(widths[column])
  const line = cells => `| ${cells.map(pad).join(" | ")} |`
  const delimiter = widths.map((width, column) =>
    align[column] === "right" ? `${"-".repeat(width - 1)}:` : "-".repeat(width),
  )
  return [line(header), `| ${delimiter.join(" | ")} |`, ...rows.map(line)]
}

/**
 * Render a full drift report as markdown.
 *
 * Structure is fixed and scannable: what ran, what it found in one line, then
 * findings grouped by severity, rule, and entity (worst first), then the diagnostics that explain
 * anything the run could NOT check. Diagnostics come last but are never
 * omitted — a report that shows only findings reads as "this is everything",
 * when a skipped surface means it is not.
 *
 * @param {object} result the `audit --json` payload
 * @param {object} [options]
 * @param {string} [options.generatedAt] a pre-formatted timestamp. Passed in,
 *   never read from the clock here — see the section docblock.
 * @param {Record<string,string>} [options.actions] `report.actions` from config:
 *   prose per finding `side` describing what fixing it looks like.
 * @param {number} [options.healthScore] 0-100, see `renderHealthScoreLine`
 * @param {object} [options.healthScorePillars] the four pillar sub-scores
 * @returns {string} markdown, no trailing newline
 */
export function renderFindingsMarkdown(result, options = {}) {
  const { generatedAt, actions = {}, healthScore, healthScorePillars } = options
  const findings = result?.findings || []
  const diagnostics = result?.diagnostics || []
  const lines = ["# Design drift report", ""]

  if (generatedAt) lines.push(`_Generated ${generatedAt}_`, "")

  // The design side's basis (issue #389), UNCONDITIONALLY — a reader must be
  // able to tell a fresh gather from a months-old committed snapshot without
  // anyone hand-writing a line, and "no design side" is a stated fact too.
  lines.push(`_Design side: ${renderDesignBasis(result?.provenance)}_`, "")

  // --- what ran, so a reader knows the scope of "no findings" -------------
  lines.push("## Summary", "")
  lines.push(
    `**${findings.length} finding(s)** — ${severityLine(findings)}`,
    "",
  )

  const scoreLine = renderHealthScoreLine(healthScore, healthScorePillars)
  if (scoreLine) lines.push(`**${scoreLine}**`, "")

  const counts = result?.counts || {}
  const countRows = Object.entries(counts).filter(([key]) => key !== "findings")
  if (countRows.length > 0) {
    lines.push(
      ...renderMarkdownTable(
        ["censused", "count"],
        countRows.map(([key, value]) => [key, String(value)]),
        { align: ["left", "right"] },
      ),
      "",
    )
  }

  const skipped = result?.skipped || {}
  const skippedKeys = Object.keys(skipped)
  if (skippedKeys.length > 0) {
    lines.push("### Not checked", "")
    for (const key of skippedKeys) lines.push(`- **${key}** — ${skipped[key]}`)
    lines.push("")
  }

  // --- findings, by severity then rule then entity ---------------------
  lines.push("## Findings", "")
  if (findings.length === 0) {
    lines.push("None.", "")
  } else {
    for (const group of groupFindingsBySeverityAndRule(findings)) {
      lines.push(`### ${group.severity} — ${group.findings.length}`, "")
      for (const { ruleId, findings: ruleFindings } of group.rules) {
        lines.push(`#### \`${ruleId}\` (${ruleFindings.length})`, "")
        // One action line per SIDE actually present under this rule, not the
        // side of whichever finding happened to sort first. A rule can mix
        // sides (`components/prop-unexpected` fires on `code` and `design`),
        // and `report.actions` is documented as prose shown per finding
        // `side`, so attributing one side's advice to the whole table tells
        // a reader to fix design rows in code.
        const sides = [...new Set(ruleFindings.map(f => f.side))].sort()
        const actionLines = sides
          .filter(side => actions[side])
          .map(side => `> **${side}** — ${actions[side]}`)
        if (actionLines.length > 0) lines.push(...actionLines, "")
        lines.push(
          ...renderMarkdownTable(
            ["side", "entity", "detail"],
            ruleFindings.map(finding => [
              escapeCell(finding.side),
              `\`${escapeCell(finding.entity)}\``,
              escapeCell(finding.message),
            ]),
          ),
          "",
        )
      }
    }
  }

  // --- diagnostics: what could NOT be checked ----------------------------
  lines.push("## Diagnostics", "")
  if (diagnostics.length === 0) {
    lines.push("None.")
  } else {
    lines.push(
      "What the run could not check. These are not drift — they are gaps in the run itself.",
      "",
      ...renderMarkdownTable(
        ["code", "detail"],
        diagnostics.map(diagnostic => [
          `\`${escapeCell(diagnostic.code)}\``,
          escapeCell(diagnostic.message),
        ]),
      ),
    )
  }

  return lines.join("\n")
}

// ---------------------------------------------------------------------------
// SARIF — the artifact GitHub's code-scanning ingestion reads
// (`github/codeql-action/upload-sarif`, wired in the companion Action issue,
// not here). Same source of truth as every other artifact: the findings
// list `report`/`audit` already produce, unchanged.
// ---------------------------------------------------------------------------

// severity -> SARIF `level`, per the issue's mapping. Not derived from
// `SEVERITY_RANK` — that ranks severities against EACH OTHER for sorting,
// this maps each one to an UNRELATED vocabulary SARIF defines.
const SARIF_LEVEL_BY_SEVERITY = {
  error: "error",
  warn: "warning",
  review: "note",
}

/**
 * The `physicalLocation` for one finding.
 *
 * `data.file` is the only field a finding carries that is guaranteed to be a
 * FILE (today: `lint` findings, which pair it with `data.line`). `entity` is
 * whatever identifies the finding on its surface — a token path, a component
 * id, sometimes a file path — so it is the uri fallback but never evidence
 * that a file exists at that uri.
 *
 * A `region` is therefore emitted ONLY alongside `data.file`: a line number
 * under a uri that is not a file is not a location a consumer can resolve,
 * and it reads as more precision than the finding has.
 */
function sarifPhysicalLocation(finding) {
  const file = finding.data?.file
  if (typeof file !== "string" || file === "")
    return { artifactLocation: { uri: finding.entity } }

  return {
    artifactLocation: { uri: file },
    ...(Number.isInteger(finding.data?.line)
      ? { region: { startLine: finding.data.line } }
      : {}),
  }
}

/**
 * Render a findings list as a SARIF 2.1.0 log.
 *
 * A finding carries no dedicated location fields (`core/findings.mjs`'s
 * `entity` is a token path, a component id, or a file path depending on
 * surface — see `docs/report-structure.md`). `data.file`/`data.line`, where a
 * surface carries them, are the one real file position available and become
 * `artifactLocation.uri` + `region.startLine`; otherwise the uri falls back to
 * `entity` with no region. No location field is invented that the finding does
 * not actually carry.
 *
 * @param {object[]} findings
 * @returns {string} a JSON-stringified SARIF log
 */
export function renderFindingsSarif(findings) {
  const rules = [...new Set(findings.map(f => f.ruleId))]
    .sort()
    .map(ruleId => ({ id: ruleId }))

  const results = sortFindings(findings).map(finding => ({
    ruleId: finding.ruleId,
    level: SARIF_LEVEL_BY_SEVERITY[finding.severity] || "warning",
    message: { text: finding.message },
    locations: [{ physicalLocation: sarifPhysicalLocation(finding) }],
  }))

  const sarif = {
    $schema:
      "https://raw.githubusercontent.com/oasis-tcs/sarif-spec/master/Schemata/sarif-schema-2.1.0.json",
    version: "2.1.0",
    runs: [
      {
        tool: { driver: { name: "design-delta", rules } },
        results,
      },
    ],
  }

  return JSON.stringify(sarif, null, 2)
}

// ---------------------------------------------------------------------------
// pr-comment — a second markdown artifact, sized to be PASTED rather than
// linked: `renderFindingsMarkdown` is a standalone document meant to be read
// on its own; this one is a single block meant to sit inside a PR comment, so
// it drops the per-surface breakdown for a flat, worst-first findings list
// and enforces a hard size budget GitHub's comment API rejects above
// (65536 chars) — truncating with a stated count rather than silently
// dropping rows, the same honesty rule the full report's "Not checked"
// section follows.
// ---------------------------------------------------------------------------

// Comfortably under GitHub's 65536-char comment limit, leaving headroom for
// whatever a caller wraps this block in (a workflow's own preamble/footer).
export const PR_COMMENT_MAX_LENGTH = 60000

// Reserved so the truncation note itself never pushes the result over
// `maxLength` — it is appended after the budget check below, not counted
// against it.
const TRUNCATION_FOOTER_RESERVE = 120

function prCommentRow(finding) {
  return `| ${finding.severity} | ${escapeCell(finding.side)} | \`${escapeCell(finding.entity)}\` | \`${escapeCell(finding.ruleId)}\` | ${escapeCell(finding.message)} |`
}

/**
 * Render a compact markdown block sized for a single PR comment: summary
 * counts + a flat, worst-first findings table, truncated under `maxLength`
 * with a "N more" note rather than silently dropping rows. Reuses the same
 * finding data and severity vocabulary `renderFindingsMarkdown` does — no
 * new census logic, just a smaller shape of the same payload.
 *
 * @param {object} result the `audit --json` payload
 * @param {object} [options]
 * @param {string} [options.generatedAt] see `renderFindingsMarkdown`
 * @param {number} [options.maxLength] hard char budget for the whole string;
 *   defaults to `PR_COMMENT_MAX_LENGTH`
 * @param {number} [options.healthScore] 0-100, see `renderHealthScoreLine`
 * @param {object} [options.healthScorePillars] the four pillar sub-scores
 * @returns {string} markdown, no trailing newline
 */
export function renderFindingsPrComment(result, options = {}) {
  const {
    generatedAt,
    maxLength = PR_COMMENT_MAX_LENGTH,
    healthScore,
    healthScorePillars,
  } = options
  const findings = sortFindings(result?.findings || [])
  const lines = ["## Design drift", ""]

  if (generatedAt) lines.push(`_Generated ${generatedAt}_`, "")

  lines.push(
    `**${findings.length} finding(s)** — ${severityLine(findings)}`,
    "",
  )

  const scoreLine = renderHealthScoreLine(healthScore, healthScorePillars)
  if (scoreLine) lines.push(`**${scoreLine}**`, "")

  if (findings.length === 0) return lines.join("\n")

  lines.push(
    "| severity | side | entity | rule | detail |",
    "| --- | --- | --- | --- | --- |",
  )

  const budget = maxLength - TRUNCATION_FOOTER_RESERVE
  let length = lines.join("\n").length
  let shown = 0
  for (const finding of findings) {
    const row = prCommentRow(finding)
    const addition = row.length + 1 // the newline joining it to the block
    if (length + addition > budget) break
    lines.push(row)
    length += addition
    shown++
  }

  const remaining = findings.length - shown
  if (remaining > 0) {
    lines.push(
      "",
      `_…${remaining} more finding(s) not shown — see the full report._`,
    )
  }

  return lines.join("\n")
}
