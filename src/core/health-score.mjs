/**
 * health-score.mjs — a single 0-100 health score over a run's findings
 * (roadmap #219). `verify`/`report`
 * compute this from the SAME findings + counts their underlying `audit` (and,
 * for the Consistency pillar, `lint`) runs already produce — this module adds
 * no census of its own, it only scores what already ran.
 *
 * FOUR PILLARS, weights pinned by the issue's plan (decided 2026-08-12, itself
 * pinned to a published four-pillar split):
 *
 *   - Value Discipline  (0-60) — `styles/raw-value` findings relative to
 *     every style declaration censused in contracted style files — "of
 *     everywhere a contract binds a value, how much of it is hardcoded."
 *   - Token Health       (0-20) — `tokens/token-unreferenced` +
 *     `tokens/token-unemitted` + `tokens/token-untracked` relative to every
 *     token censused.
 *   - Consistency        (0-10) — the three PORTED lint rules
 *     (`lint/tier-alias-inverted`, `lint/vocabulary-invalid`,
 *     `lint/ramp-not-monotonic`) relative to every token censused.
 *   - Critical Issues    (0-10) — every error-severity finding, across every
 *     surface, relative to the total census size (components + tokens +
 *     style files + anatomy components) — the one pillar with no single
 *     natural denominator of its own, so it uses the run's overall size.
 *
 * DENSITY-NORMALIZED, deliberately: every pillar is a RATE (findings ÷ census
 * size), never a raw count, so a codebase twice the size with proportionally
 * the same drift scores the same — the whole point of a health score meant to
 * be compared release over release as a project grows.
 *
 * A denominator of zero (the surface never ran, or censused nothing) reads as
 * "nothing to grade" and awards full marks for that pillar, not zero — an
 * empty/unconfigured surface is not evidence of drift, and penalizing it would
 * make a project score WORSE for not having wired up a surface yet than for
 * having wired it up cleanly.
 *
 * Pure: findings + counts in, numbers out. No fs, no network, no knowledge of
 * `audit`/`lint`/`verify` as commands — `core/`: imports nothing outside
 * `core/` (ADR-001 D4).
 */

// Pillar point splits — the total is always 100 by construction (60+20+10+10).
export const PILLAR_MAX = Object.freeze({
  valueDiscipline: 60,
  tokenHealth: 20,
  consistency: 10,
  criticalIssues: 10,
})

export const HEALTH_SCORE_MAX = Object.values(PILLAR_MAX).reduce(
  (a, b) => a + b,
  0,
)

// Human-readable labels for the four pillar keys above, in the same fixed
// order — shared by every renderer (`core/report.mjs`, `verify`'s human
// output) so "value discipline" never drifts from "valueDiscipline" spelled
// differently in two places.
export const PILLAR_LABELS = Object.freeze({
  valueDiscipline: "value discipline",
  tokenHealth: "token health",
  consistency: "consistency",
  criticalIssues: "critical issues",
})

const VALUE_DISCIPLINE_RULE_IDS = new Set(["styles/raw-value"])
const TOKEN_HEALTH_RULE_IDS = new Set([
  "tokens/token-unreferenced",
  "tokens/token-unemitted",
  "tokens/token-untracked",
])
const CONSISTENCY_RULE_IDS = new Set([
  "lint/tier-alias-inverted",
  "lint/vocabulary-invalid",
  "lint/ramp-not-monotonic",
])

// One pillar's sub-score: `maxPoints` scaled down by how much of the censused
// surface is drifting, floored at 0. A zero/undefined denominator is "nothing
// censused" — see the module docblock — and awards full marks rather than
// dividing by zero.
function pillarScore(maxPoints, numerator, denominator) {
  if (!denominator || denominator <= 0) return maxPoints
  const density = Math.min(1, Math.max(0, numerator / denominator))
  return Math.round(maxPoints * (1 - density))
}

function countMatching(findings, ruleIds) {
  return findings.filter(f => ruleIds.has(f.ruleId)).length
}

/**
 * @param {object} input
 * @param {object[]} input.findings every finding to score — `audit`'s own
 *   findings PLUS `lint`'s (Consistency is the only pillar lint feeds; the
 *   other three rule ids never come from the lint surface, and every finding
 *   here is matched by exact `ruleId`, so mixing the two lists is safe).
 * @param {object} input.counts `audit`'s own `counts` object: `tokens`,
 *   `components`, `styleFiles`, `styleDeclarations`, `anatomyComponents` are
 *   the census sizes this function reads; anything else is ignored.
 * @returns {{total: number, pillars: {valueDiscipline: number, tokenHealth: number, consistency: number, criticalIssues: number}}}
 *   `total` always equals the sum of `pillars`' four (already-rounded)
 *   values, so the two can never print as disagreeing.
 */
export function computeHealthScore({ findings = [], counts = {} } = {}) {
  const valueDiscipline = pillarScore(
    PILLAR_MAX.valueDiscipline,
    countMatching(findings, VALUE_DISCIPLINE_RULE_IDS),
    counts.styleDeclarations,
  )
  const tokenHealth = pillarScore(
    PILLAR_MAX.tokenHealth,
    countMatching(findings, TOKEN_HEALTH_RULE_IDS),
    counts.tokens,
  )
  const consistency = pillarScore(
    PILLAR_MAX.consistency,
    countMatching(findings, CONSISTENCY_RULE_IDS),
    counts.tokens,
  )
  // No single census axis is "the" critical-issues surface — an error can
  // come from any of the four `audit` surfaces — so this pillar normalizes
  // against the run's overall size instead of one surface's own count.
  const totalSurfaceArea =
    (counts.components || 0) +
    (counts.tokens || 0) +
    (counts.styleFiles || 0) +
    (counts.anatomyComponents || 0)
  const criticalIssues = pillarScore(
    PILLAR_MAX.criticalIssues,
    findings.filter(f => f.severity === "error").length,
    totalSurfaceArea,
  )

  const pillars = { valueDiscipline, tokenHealth, consistency, criticalIssues }
  const total = Object.values(pillars).reduce((a, b) => a + b, 0)
  return { total, pillars }
}
