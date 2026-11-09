/**
 * exemptions.mjs — apply the config's `exemptions` block to a finding list
 * (ADR-001 D5, issue #181).
 *
 * A project migrating off v1 carries deliberate, reviewed decisions about what
 * NOT to report: layout primitives with no design surface, behaviour wrappers
 * that render nothing, symbol sub-parts a parent contract already covers. v1
 * held them in `ignore.waived` / `ignore.trackedGaps` / `ignore.separateEfforts`.
 * This block is where they land.
 *
 * The field was schema-validated, documented in `docs/config-reference.md`, and
 * named in the ADR, while nothing read it. That is worse than an unimplemented
 * feature: a consumer reasonably sets it, sees no change, and cannot tell
 * whether their glob is wrong or the feature is absent. The only alternative
 * they had was disabling the whole rule via `rules`, which loses real-gap
 * detection — exactly what exemptions exist to avoid.
 *
 * ---------------------------------------------------------------------------
 * AN EXEMPTION IS A CLAIM, NOT SILENCE
 * ---------------------------------------------------------------------------
 *
 * The schema states the intent: "exemptions are claims to re-verify, not
 * permanent silence." The condition implemented here is that the rule REPORTED
 * NOTHING matching the exemption — which covers the entity disappearing, and
 * also the case where it still exists and has been fixed. Both mean the waiver
 * is no longer carrying weight, and the second is the more common one in
 * practice: a waiver outliving the problem it excused is exactly the rot this
 * check exists to surface.
 *
 * That is the whole design. A waiver list nobody revisits becomes a place
 * where real drift hides: an entity is renamed or deleted, its exemption stops
 * matching anything, and nothing says so. Reporting the stale entry turns the
 * list into something that decays loudly rather than quietly.
 *
 * A GLOB is deliberately NOT reported stale on its own — `header/*` matching
 * nothing today may be correct tomorrow, and a pattern is a statement about a
 * shape rather than a specific entity. Only literal entities are checked.
 *
 * `core/`: imports nothing outside `core/` (ADR-001 D4). Pure — takes findings
 * and config, returns findings. No fs, no clock.
 */

import { makeFinding } from "./findings.mjs"
import { createRegistry } from "./rules.mjs"

/**
 * Registered in `core/`, beside the code that emits it — not in a module that
 * has nothing to do with exemptions. A rule owned by the layer that raises it
 * is the norm everywhere else in this engine.
 */
export const RULES = [
  {
    id: "coverage/stale-exemption",
    surface: "coverage",
    defaultSeverity: "review",
    description:
      "An entity is exempted from a rule, but that rule reported nothing matching it — the exemption is stale, or the entity no longer exists. Exemptions are claims to re-verify, not permanent silence (ADR-001 D5).",
  },
]

export const registry = createRegistry(RULES)

/**
 * Turn one exemption entry into `{entity, reason}`. The schema allows a bare
 * string or an `{entity, reason}` object; both normalize here so no caller
 * has to know which form an author used.
 */
function normalizeEntry(entry) {
  if (typeof entry === "string")
    return { entity: entry, reason: null, kind: "waived", issue: null }
  if (entry && typeof entry === "object" && typeof entry.entity === "string")
    return {
      entity: entry.entity,
      reason: entry.reason || null,
      kind: entry.decision || "waived",
      issue: entry.issue || null,
    }
  return null
}

/**
 * Whether `pattern` matches `entity`. `*` is the one metacharacter the
 * schema's "entity string/glob" promises, and it matches ANY run of
 * characters INCLUDING separators — `header/*` covers `header/a/b` as well as
 * `header/nav`. Everything else is escaped, so a token id full of dots cannot
 * accidentally act as a regex and waive more than its author wrote.
 */
export function matchesEntity(pattern, entity) {
  if (pattern === entity) return true
  if (!pattern.includes("*")) return false
  const escaped = pattern
    .split("*")
    .map(part => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*")
  return new RegExp(`^${escaped}$`).test(entity)
}

function isGlob(pattern) {
  return pattern.includes("*")
}

// A finding's own identity, `entity`, plus every ALTERNATE identity it
// declares via `data.tokens` / `data.expectedVar` — a module-agnostic
// convention (`core/` still names no domain, per ADR-001 D4/D12/D16), not a
// hardcoded read of one module's shape: any finding may list further strings
// it is also legitimately known by. `modules/tokens.mjs`'s
// `token-unreferenced` and `token-unemitted` findings are the only callers
// today (issue #191; #562 split the second off the first): when several tokens fold to one shared CSS var, `entity` becomes
// that var so the finding reads honestly at a glance, but an exemption
// authored against any ONE of the declaring token ids — what a consumer
// actually wrote before the var ever existed as a reportable identity — must
// keep matching. `expectedVar` closes the other direction, symmetrically: a
// waiver written against the VAR NAME must keep matching even after the
// group it was grouped under later shrinks back to one token and `entity`
// reverts to that token's own id. Both are present on EVERY finding of this
// rule, single or grouped (`tokens.mjs`'s `data: {token, tokens,
// expectedVar}`), so neither direction depends on the finding's current
// group size. Without either, an exemption invalidates itself the moment the
// codebase's mode-grouping shape moves, silently: the finding reappears AND
// a false `coverage/stale-exemption` fires claiming the still-valid waiver
// matches nothing.
function entityCandidates(finding) {
  const { entity, data } = finding || {}
  const tokens = Array.isArray(data?.tokens) ? data.tokens : []
  const expectedVar =
    typeof data?.expectedVar === "string" ? [data.expectedVar] : []
  return [entity, ...tokens, ...expectedVar]
}

/**
 * Apply `exemptions` to a finding list.
 *
 * Returns the findings that survive, plus one `coverage/stale-exemption` per
 * literal entity that matched nothing — appended to the SAME list, because a
 * stale exemption is a finding about the project's own configuration and
 * hiding it in diagnostics would make it easy to ignore.
 *
 * @param {object[]} findings
 * @param {Record<string, Array<string|{entity: string, reason?: string}>>} exemptions
 * @param {object} [options]
 * @param {(ruleId: string) => string|null} [options.severityOf] resolves the
 *   configured severity for `coverage/stale-exemption`; returning `"off"` or
 *   `null` suppresses the stale report while still applying the exemptions
 * @param {(ruleId: string) => boolean} [options.wasEvaluated] whether the run
 *   actually evaluated this rule. REQUIRED for an honest stale report: a rule
 *   whose surface was scoped out (`audit --tokens`) or skipped (no
 *   `typescript` installed) reports nothing, and calling every exemption on it
 *   stale would be true in form and misleading in substance. Absent, every
 *   rule is assumed evaluated — correct only for a caller that ran everything.
 * @returns {{findings: object[], exempted: number, decided: object[]}}
 *   `decided` is every exempted finding, kept visible with the decision that
 *   covers it — `decision: {kind, reason, issue, exemption}`, where
 *   `exemption` is the entity or glob that matched.
 */
export function applyExemptions(findings, exemptions, options = {}) {
  const list = findings || []
  const byRule = exemptions || {}
  const ruleIds = Object.keys(byRule)
  if (ruleIds.length === 0) return { findings: list, exempted: 0, decided: [] }

  // Which literal entities actually silenced something. A glob is never
  // tracked here — see the module docblock for why it is not reported stale.
  const matchedLiterals = new Set()
  const kept = []
  const decided = []

  for (const finding of list) {
    const entries = (byRule[finding.ruleId] || [])
      .map(normalizeEntry)
      .filter(Boolean)

    const candidates = entityCandidates(finding)
    let exemptedBy = null
    for (const entry of entries) {
      if (!candidates.some(candidate => matchesEntity(entry.entity, candidate)))
        continue
      exemptedBy = entry
      if (!isGlob(entry.entity))
        matchedLiterals.add(`${finding.ruleId}\u0000${entry.entity}`)
      break
    }
    if (!exemptedBy) kept.push(finding)
    else
      decided.push({
        ...finding,
        decision: {
          kind: exemptedBy.kind,
          reason: exemptedBy.reason,
          issue: exemptedBy.issue,
          exemption: exemptedBy.entity,
        },
      })
  }

  const exempted = list.length - kept.length

  const severityOf = options.severityOf
  const staleSeverity = severityOf
    ? severityOf("coverage/stale-exemption")
    : "review"
  if (!staleSeverity || staleSeverity === "off")
    return { findings: kept, exempted, decided }

  // An exemption is a claim to re-verify. One that matched nothing is either
  // already fixed — in which case delete it — or pointed at something that no
  // longer exists, in which case the list is drifting from the codebase it
  // describes.
  const wasEvaluated = options.wasEvaluated || (() => true)

  const stale = []
  for (const ruleId of [...ruleIds].sort()) {
    // The surface that owns this rule did not run — scoped out, or skipped.
    // It reported nothing, so nothing matching the exemption is EXPECTED, and
    // "stale" would be a claim the run has no evidence for.
    if (!wasEvaluated(ruleId)) continue
    const entries = (byRule[ruleId] || []).map(normalizeEntry).filter(Boolean)
    for (const entry of entries) {
      if (isGlob(entry.entity)) continue
      if (matchedLiterals.has(`${ruleId}\u0000${entry.entity}`)) continue
      stale.push(
        makeFinding({
          ruleId: "coverage/stale-exemption",
          severity: staleSeverity,
          surface: "coverage",
          side: "spec",
          entity: entry.entity,
          message: `"${entry.entity}" is exempted from "${ruleId}", but nothing that rule reports matches it — the exemption is stale, or the entity no longer exists${entry.reason ? ` (recorded reason: ${entry.reason})` : ""}`,
          data: { ruleId, entity: entry.entity },
        }),
      )
    }
  }

  return { findings: [...kept, ...stale], exempted, decided }
}
