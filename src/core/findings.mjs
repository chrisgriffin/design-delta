/**
 * findings.mjs — the ONE finding shape (ADR-001 D5) and everything that
 * operates on it: construction (with validation), severity ranking, the
 * natural entity sort, and the two groupings a report renders from. Every
 * check — tokens, components, lint, coverage — emits exactly this
 * shape:
 *
 *   { ruleId, severity, surface, side, entity, message, data }
 *
 * `severity` here is always RESOLVED ("error" | "warn" | "review") — never
 * "off". "off" is a config-time gating value (`core/rules.mjs`'s job): a
 * rule resolved to "off" produces no finding at all, so a finding's severity
 * is never that value. `CONFIGURABLE_SEVERITIES` is what a config's `rules`
 * block may specify; `SEVERITIES` is what a finding may carry.
 *
 * This module is `core/`: it imports nothing (not even other `core/`
 * modules), touches no fs/network, and never relies on object key insertion
 * order for output ordering — determinism is the whole point of the engine (D5's
 * "Fixture ratchet" / "Determinism gate" working method), so every ordered
 * output here is sorted explicitly, never assumed from `Map`/`Object`
 * iteration order by coincidence.
 *
 * The natural, segment-wise entity comparison (`compareEntities`) is ported
 * from v1's `lib/group-findings.mjs` (`comparePathsNatural`/`compareSegment`)
 * — same numeric-aware-segment algorithm, generalized to split on EITHER a
 * dot or a slash in one pass (v1 called it once per finding family with a
 * fixed separator — tokens used ".", components used "/" — because v1 kept
 * two finding shapes; there is one `entity` field that may be a token path
 * *or* a file path, so the splitter accepts both separators together).
 */

// The resolved severities a finding may carry, worst-first. This ordering IS
// the rank: SEVERITY_RANK is derived from it, not maintained separately.
export const SEVERITIES = ["error", "warn", "review"]

// What a config's `rules` block may specify — SEVERITIES plus the gating
// value "off". Never appears on a finding itself (see module docblock).
export const CONFIGURABLE_SEVERITIES = [...SEVERITIES, "off"]

// severity -> numeric rank, worst (error) highest, for sorting. Built from
// SEVERITIES so the two can never drift apart.
export const SEVERITY_RANK = Object.fromEntries(
  SEVERITIES.map((severity, index) => [severity, SEVERITIES.length - index]),
)

// One sentence per severity, for the surfaces that RENDER the vocabulary
// instead of acting on it — `docs/rules.md` is generated from this map, so the
// rule reference states what the engine itself declares rather than a
// hand-written paraphrase that drifts the first time the vocabulary moves.
// Beside SEVERITIES for the same reason SEVERITY_RANK is: the two can only
// disagree if someone edits one and not the other, which `core-findings`'
// exhaustiveness test then fails on.
export const SEVERITY_DESCRIPTIONS = Object.freeze({
  error:
    "A definite contradiction: both sides were read successfully and they disagree. The only severity that fails a gated command's exit code (`lint`, `verify`, `audit --check`).",
  warn: "Real drift the engine is confident about, which is not on its own a defect — an undeclared prop, a hardcoded value, a custom property outside the token system. Reported, never gating.",
  review:
    "The engine could not reach a verdict, or the answer is a human's to give. Reported so an unanswered question is never mistaken for a clean result. Never gating.",
})

// ADR-001 D5 named "tokens | components | lint | coverage" up front, before
// Phase 2b's style-parity checker (issue #103) existed to need its own
// surface — "styles" is that checker's addition, kept alongside rather than
// folded into "components" so a config's `groupFindingsBySurface` view and a
// consumer's per-surface rule overrides can address it independently.
// "anatomy" (Phase 2c, issue #104) follows the exact same reasoning, more
// pointedly: it is the riskiest checker in Phase 2 by the issue's own
// admission, so a consumer needs to be able to turn its findings off without
// also losing "components"' unrelated props/API parity.
export const SURFACES = [
  "tokens",
  "components",
  "styles",
  "anatomy",
  "lint",
  "coverage",
]

// What each surface is ABOUT, one entry per SURFACES member. Same rationale as
// SEVERITY_DESCRIPTIONS above: a rule's own `description` says what that rule
// reports, but nothing said what the group it belongs to is for, so the
// generated rule reference would have had to invent that prose itself. Engine
// data, therefore declared in the engine.
export const SURFACE_DESCRIPTIONS = Object.freeze({
  tokens:
    "The token layer itself — which tokens a contract declares, which custom properties the code declares, and which of them the code actually references. Answers whether the token system and the stylesheets know about the same set of values.",
  components:
    "A component's public API: each prop's presence, type, enum values, default value, and required/optional status, compared between the contract and the code.",
  styles:
    "Where a component's styles get their values — whether each element/property pair binds the token the contract declares, binds a different one, or hardcodes a literal instead.",
  anatomy:
    "The structure a component renders — which nodes exist, at which positions, as which elements, with which content bound — compared against the anatomy the contract declares.",
  lint: "Static best-practice checks that need no contract at all: token naming vocabularies, tier layering, ramp monotonicity, and a delegated token-lint rule set. Silent until a project configures it — the engine ships no starter opinions.",
  coverage:
    "What the run could NOT compare, and what it was told to skip: a component with no contract, a contract with no component, an exemption that no longer matches anything. A worklist rather than drift.",
})

export const SIDES = ["design", "code", "spec", "both"]

const REQUIRED_STRING_FIELDS = [
  "ruleId",
  "severity",
  "surface",
  "side",
  "entity",
  "message",
]

const isNonEmptyString = value => typeof value === "string" && value.length > 0

/**
 * Construct a finding, validating shape. Throws a clear Error when a
 * required field (`ruleId`, `severity`, `surface`, `side`, `entity`,
 * `message`) is missing, or when `severity`/`surface`/`side` isn't one of
 * the declared enums. `data` is optional and, when absent, is omitted from
 * the returned object entirely (never set to `undefined` as an own key) so
 * findings stay JSON-stable — `JSON.stringify` drops `undefined` values but
 * `Object.keys`/deep-equal callers would otherwise see a phantom key.
 *
 * @param {object} fields
 * @returns {{ruleId: string, severity: string, surface: string, side: string, entity: string, message: string, data?: *}}
 */
export function makeFinding(fields) {
  const source = fields || {}

  for (const key of REQUIRED_STRING_FIELDS) {
    if (!isNonEmptyString(source[key]))
      throw new Error(
        `makeFinding: missing or invalid required field "${key}" (got ${JSON.stringify(source[key])})`,
      )
  }

  const { ruleId, severity, surface, side, entity, message, data } = source

  if (!SEVERITIES.includes(severity))
    throw new Error(
      `makeFinding: invalid severity "${severity}" — must be one of ${SEVERITIES.join(", ")}`,
    )
  if (!SURFACES.includes(surface))
    throw new Error(
      `makeFinding: invalid surface "${surface}" — must be one of ${SURFACES.join(", ")}`,
    )
  if (!SIDES.includes(side))
    throw new Error(
      `makeFinding: invalid side "${side}" — must be one of ${SIDES.join(", ")}`,
    )

  const finding = { ruleId, severity, surface, side, entity, message }
  if (data !== undefined) finding.data = data
  return finding
}

// Natural ordering for one path SEGMENT — ported verbatim from v1's
// group-findings.mjs `compareSegment`: two purely-numeric strings compare as
// numbers ("2" < "10"); a purely-numeric segment always sorts before a
// non-numeric one; two non-numeric segments compare as plain strings.
function compareSegment(a, b) {
  const na = Number(a)
  const nb = Number(b)
  const aNumeric = a !== "" && !Number.isNaN(na)
  const bNumeric = b !== "" && !Number.isNaN(nb)
  if (aNumeric && bNumeric) return na - nb
  if (aNumeric !== bNumeric) return aNumeric ? -1 : 1
  return a < b ? -1 : a > b ? 1 : 0
}

// Splits an entity on either separator an entity may use: "." for a token
// dot-path, "/" for a file or component path. Both separators are accepted
// in one pass rather than picked per caller, because there is one `entity`
// field shared by every surface (D5) instead of v1's per-family split.
const ENTITY_SEGMENT_SPLIT = /[./]/

/**
 * Natural, numeric-aware, segment-wise comparison of two entities — the
 * deterministic, total order `sortFindings`/`groupFindingsByEntity` sort by.
 * Ported from v1's `comparePathsNatural`.
 *
 * @param {string} a
 * @param {string} b
 * @returns {number} negative if a < b, positive if a > b, 0 if equal
 */
export function compareEntities(a, b) {
  const segsA = String(a).split(ENTITY_SEGMENT_SPLIT)
  const segsB = String(b).split(ENTITY_SEGMENT_SPLIT)
  const length = Math.max(segsA.length, segsB.length)
  for (let i = 0; i < length; i++) {
    if (segsA[i] === undefined) return -1
    if (segsB[i] === undefined) return 1
    const c = compareSegment(segsA[i], segsB[i])
    if (c !== 0) return c
  }
  return 0
}

const compareRuleId = (a, b) =>
  a.ruleId < b.ruleId ? -1 : a.ruleId > b.ruleId ? 1 : 0

/**
 * Sort findings worst-severity-first, then by `compareEntities` on `entity`,
 * then by `ruleId` alphabetically — a stable, total order so report output
 * is byte-deterministic run over run. Returns a NEW array; never mutates
 * its argument.
 *
 * @param {object[]} findings
 * @returns {object[]}
 */
export function sortFindings(findings) {
  return [...findings].sort((a, b) => {
    const rank = SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]
    if (rank !== 0) return rank
    const entityRank = compareEntities(a.entity, b.entity)
    if (entityRank !== 0) return entityRank
    return compareRuleId(a, b)
  })
}

/**
 * Roll a flat findings list up by `entity` — "everything wrong with this
 * entity" in one place, the shape a report's entity-centric tables render
 * from. An array (not a plain object) so iteration order is guaranteed by
 * the array itself, never by object key insertion order.
 *
 * @param {object[]} findings
 * @returns {Array<{entity: string, findings: object[]}>} entities in
 *   `compareEntities` order, each entity's findings in `sortFindings` order
 */
export function groupFindingsByEntity(findings) {
  const byEntity = new Map()
  for (const finding of findings) {
    if (!byEntity.has(finding.entity)) byEntity.set(finding.entity, [])
    byEntity.get(finding.entity).push(finding)
  }
  return [...byEntity.keys()]
    .sort(compareEntities)
    .map(entity => ({ entity, findings: sortFindings(byEntity.get(entity)) }))
}

/**
 * Roll a flat findings list up by `surface`, in `SURFACES`' declared order
 * (tokens, components, lint, coverage) rather than discovery order. A
 * surface with zero findings is omitted entirely, the same convention v1's
 * `groupBySide` used for an empty side — an empty section never prints.
 *
 * @param {object[]} findings
 * @returns {Array<{surface: string, findings: object[]}>}
 */
export function groupFindingsBySurface(findings) {
  const bySurface = new Map()
  for (const finding of findings) {
    if (!bySurface.has(finding.surface)) bySurface.set(finding.surface, [])
    bySurface.get(finding.surface).push(finding)
  }
  return SURFACES.filter(surface => bySurface.has(surface)).map(surface => ({
    surface,
    findings: sortFindings(bySurface.get(surface)),
  }))
}

/**
 * Roll a flat findings list up by severity, then by rule — "what is wrong,
 * worst first, and which entities it is wrong for", the shape an actionable
 * report reads from. Severities in `SEVERITIES` order (empty ones omitted);
 * rules within a severity by descending count, then rule id, so the biggest
 * pile is always on top; findings within a rule in `sortFindings` order.
 *
 * @param {object[]} findings
 * @returns {Array<{severity: string, findings: object[], rules: Array<{ruleId: string, findings: object[]}>}>}
 */
export function groupFindingsBySeverityAndRule(findings) {
  const bySeverity = new Map()
  for (const finding of findings) {
    if (!bySeverity.has(finding.severity))
      bySeverity.set(finding.severity, new Map())
    const byRule = bySeverity.get(finding.severity)
    if (!byRule.has(finding.ruleId)) byRule.set(finding.ruleId, [])
    byRule.get(finding.ruleId).push(finding)
  }
  return SEVERITIES.filter(severity => bySeverity.has(severity)).map(
    severity => {
      const byRule = bySeverity.get(severity)
      const rules = [...byRule.keys()]
        .sort(
          (a, b) =>
            byRule.get(b).length - byRule.get(a).length ||
            compareRuleId({ ruleId: a }, { ruleId: b }),
        )
        .map(ruleId => ({ ruleId, findings: sortFindings(byRule.get(ruleId)) }))
      return { severity, findings: rules.flatMap(r => r.findings), rules }
    },
  )
}

/**
 * Count findings by severity. Always returns all three `SEVERITIES` keys,
 * even at zero, so a report can render a fixed-column summary without a
 * presence check per severity.
 *
 * @param {object[]} findings
 * @returns {{error: number, warn: number, review: number}}
 */
export function countBySeverity(findings) {
  const counts = Object.fromEntries(SEVERITIES.map(severity => [severity, 0]))
  for (const finding of findings) {
    if (Object.prototype.hasOwnProperty.call(counts, finding.severity))
      counts[finding.severity] += 1
  }
  return counts
}

/**
 * Whether any finding is error-severity — the exit-code question every CLI
 * command that gates on findings (`lint`, `verify`, `audit --check`) asks.
 *
 * @param {object[]} findings
 * @returns {boolean}
 */
export function hasError(findings) {
  return findings.some(finding => finding.severity === "error")
}

/**
 * Collapse diagnostics that state the SAME fact — identical `code`, `file` and
 * `message` — to one entry, preserving first-seen order (issue #155).
 *
 * Independent phases legitimately reach the same conclusion about one file: a
 * props census and an anatomy census each parse it, and each discovers on its
 * own that the file is missing, that TypeScript could not load it, or that it
 * declares no component. Both are right, and neither can be silenced without
 * making that phase dishonest when it runs alone — so the redundancy has to be
 * resolved where the phases MEET, not inside either one.
 *
 * Identity is the whole triple, deliberately. Keying on `code` + `file` alone
 * would silently discard a second diagnostic that says something genuinely
 * different about the same file, which is the failure mode this engine cares
 * about more than the duplicate it is fixing. Two entries that differ by even
 * one character both survive — so collapsing a shared fact requires the phases
 * to agree on its wording, which is an obligation on the phases themselves and
 * is pinned by their own tests, not by anything this function can enforce.
 *
 * Pure and order-preserving: the first occurrence keeps its position, which
 * keeps the deterministic phase ordering the callers already establish.
 *
 * @param {object[]} diagnostics
 * @returns {object[]}
 */
export function dedupeDiagnostics(diagnostics) {
  const seen = new Set()
  const out = []
  for (const diagnostic of diagnostics) {
    const key = JSON.stringify([
      diagnostic.code,
      diagnostic.file,
      diagnostic.message,
    ])
    if (seen.has(key)) continue
    seen.add(key)
    out.push(diagnostic)
  }
  return out
}
