#!/usr/bin/env node
/**
 * generate-rules-reference.mjs — renders every registered rule into
 * `docs/rules.md`, the catalog of what this engine can report.
 *
 * GENERATED, NOT HAND-WRITTEN, for the same reason
 * `generate-config-reference.mjs` is: each rule descriptor already carries a
 * `description` written where the rule is raised, and that is the source of
 * truth. A hand-maintained catalog drifts the first time a rule is added,
 * renamed, or has its default severity changed — and a drift engine whose own
 * rule reference silently disagrees with its registry is the exact failure
 * this repo does not tolerate anywhere else (`docs-parity.test.js`,
 * `check-schemas.mjs`).
 *
 * INVENTS NO PROSE: every sentence about a rule comes from the rule's own
 * `description`, every sentence about a surface from
 * `core/findings.mjs`'s SURFACE_DESCRIPTIONS, every sentence about a severity
 * from its SEVERITY_DESCRIPTIONS. Only the page's structural chrome (headings,
 * the "do not hand-edit" banner, the pointer at the config reference) lives
 * here.
 *
 * SOURCE OF THE RULE LIST: `src/index.mjs`'s exported `*Rules` arrays — the
 * package's own public surface, not a directory scrape. `rules-reference.test.js`
 * asserts that every `export const RULES` array under `src/` is reachable from
 * there, so a new module's rules cannot ship undocumented by being forgotten
 * here.
 *
 * DETERMINISTIC: reads one module graph, sorts every list explicitly (surfaces
 * in SURFACES order, rules by id within a surface — never registry insertion
 * order, which for `coverage` depends on which file happens to be imported
 * first), writes one file. No wall clock, no environment, so `--check` can
 * assert the committed doc is EXACTLY what running this script now produces.
 *
 * Usage:
 *   node scripts/generate-rules-reference.mjs           # writes docs/rules.md
 *   node scripts/generate-rules-reference.mjs --check    # exits 1 if the committed file is stale
 */

import { readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import {
  SEVERITIES,
  SEVERITY_DESCRIPTIONS,
  SURFACES,
  SURFACE_DESCRIPTIONS,
  componentsRules,
  tokensRules,
  stylesRules,
  anatomyRules,
  LINT_RULES,
  exemptionsRules,
} from "../src/index.mjs"

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")
const OUT_PATH = join(REPO_ROOT, "docs", "rules.md")

// Not exported: this file writes a doc and calls `process.exit` at import
// time, so nothing may import it. `rules-reference.test.js` rebuilds the same
// list from `src/index.mjs` by SHAPE — every exported array of rule
// descriptors — which also catches a registry this script forgot to list.
const ALL_RULES = [
  ...componentsRules,
  ...tokensRules,
  ...stylesRules,
  ...anatomyRules,
  ...LINT_RULES,
  ...exemptionsRules,
]

// ---------------------------------------------------------------------------
// Rendering.
// ---------------------------------------------------------------------------

// A literal `|` would end the cell early (GFM reads it as a column delimiter),
// and a literal newline would end the ROW — every value that lands in a cell
// goes through this first.
function escapeCell(text) {
  return String(text).replace(/\|/g, "\\|").replace(/\n/g, " ")
}

const compareId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

function rulesFor(surface) {
  return ALL_RULES.filter(rule => rule.surface === surface).sort(compareId)
}

function renderRuleTable(rules) {
  return [
    "| Rule | Default severity | What it reports |",
    "| --- | --- | --- |",
    ...rules.map(
      rule =>
        `| \`${rule.id}\` | ${rule.defaultSeverity} | ${escapeCell(rule.description)} |`,
    ),
  ].join("\n")
}

function renderSeverityTable() {
  return [
    "| Severity | Meaning |",
    "| --- | --- |",
    ...SEVERITIES.map(
      severity =>
        `| \`${severity}\` | ${escapeCell(SEVERITY_DESCRIPTIONS[severity])} |`,
    ),
  ].join("\n")
}

function renderSurfaceSection(surface) {
  const rules = rulesFor(surface)
  return [
    `### \`${surface}\``,
    "",
    SURFACE_DESCRIPTIONS[surface],
    "",
    renderRuleTable(rules),
    "",
  ].join("\n")
}

function render() {
  // A surface with no registered rule renders nothing at all rather than an
  // empty table — same convention `groupFindingsBySurface` uses for a surface
  // with no findings.
  const surfaces = SURFACES.filter(surface => rulesFor(surface).length > 0)

  const lines = [
    "# Rule reference",
    "",
    "Generated from the rule registries in [`src/index.mjs`](../src/index.mjs) — " +
      "**do not hand-edit this file**, it is overwritten by " +
      "`node scripts/generate-rules-reference.mjs` (checked in CI via the same " +
      "script's `--check` flag).",
    "",
    `Every finding this engine emits carries the id of the rule that raised it. There are ${ALL_RULES.length} rules across ${surfaces.length} surfaces.`,
    "",
    'A rule\'s severity is a default, not a verdict: `rules["<id>"]` in the project\'s config overrides it, and `"off"` disables the rule outright. Per-entity waivers go in `exemptions` — see the [config reference](./config-reference.md).',
    "",
    "## Severities",
    "",
    renderSeverityTable(),
    "",
    "## Rules by surface",
    "",
    ...surfaces.map(surface => `- [\`${surface}\`](#${surface})`),
    "",
    ...surfaces.map(renderSurfaceSection),
  ]

  return (
    lines
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trimEnd() + "\n"
  )
}

const rendered = render()

if (process.argv.includes("--check")) {
  const committed = (() => {
    try {
      return readFileSync(OUT_PATH, "utf8")
    } catch {
      return null
    }
  })()
  if (committed !== rendered) {
    console.error(
      `FAIL  docs/rules.md is stale relative to the rule registries.\n` +
        `      Run: node scripts/generate-rules-reference.mjs`,
    )
    process.exit(1)
  }
  console.log("OK    docs/rules.md is current")
  process.exit(0)
}

writeFileSync(OUT_PATH, rendered)
console.log(`Wrote ${OUT_PATH}`)
