/**
 * is-new.mjs — read-only `isNew` consumption for `audit`/`verify` (issue
 * #243, the read-only half of roadmap #216's plan). `cli/commands/
 * snapshot.mjs` is the only WRITER of `state.json`; this module only ever
 * reads a prior run's state to answer, per finding, "has this entity's
 * code/spec changed since the last snapshot?" — never touches the file
 * itself, preserving the audit path's read-only guarantee (CLAUDE.md).
 *
 * `state.json` only ever holds `component:<id>` entities — this slice's own
 * scope (`docs/state-shape.md`). A finding whose entity does not resolve to
 * a known contract id (a token dot-path, a raw uncontracted stylesheet
 * selector, an uncontracted component with no contract to hash) has nothing
 * in `state.json` it could ever match, so it is left without an `isNew`
 * field entirely — "cannot be determined" is not the same claim as "not
 * new," and guessing either would be dishonest output.
 */

import { buildEntityStates } from "./commands/snapshot.mjs"

// `state.json` only ever holds `component:<id>` entities, so only surfaces
// whose `entity` is itself a contract id (or a contract id prefix, per
// `resolveContractId` below) can ever legitimately resolve to one. `tokens`
// and `lint` findings carry a token dot-path in `entity` instead — one that
// can coincidentally SHARE a prefix with a real contract id (a token
// `button.bg.default` next to a `Button` contract), which would otherwise
// silently mismatch it to that component's state.
const CONTRACT_SCOPED_SURFACES = new Set([
  "components",
  "anatomy",
  "styles",
  "coverage",
])

// `coverage`'s own rule ids don't share one entity shape: `contract-only`'s
// entity is always a contract id, but `stale-exemption`'s is whatever a
// config author wrote in `exemptions` — a token path, a raw selector,
// anything the corresponding rule's entity space allows (`core/
// exemptions.mjs`'s `entry.entity`, unvalidated against contract ids). It
// carries the exact same collision risk `tokens`/`lint` do, despite sharing
// `coverage`'s surface with the one rule that IS contract-scoped.
const NON_CONTRACT_SCOPED_RULES = new Set(["coverage/stale-exemption"])

// A finding's `entity` is a bare contract id (components), a contract id
// followed by `.<element>` (anatomy/styles), or a contract id followed by
// `:<selector>` (never seen today, kept for the same convention) — matched
// against the KNOWN contract ids rather than blindly split on the first
// separator, so a token path ("acme.color.danger") or a raw file path
// ("src/theme/tag.css:.tag") never accidentally resolves to an unrelated
// contract id.
function resolveContractId(entity, knownIds) {
  if (knownIds.has(entity)) return entity
  for (const separator of [".", ":"]) {
    const index = entity.indexOf(separator)
    if (index > 0) {
      const candidate = entity.slice(0, index)
      if (knownIds.has(candidate)) return candidate
    }
  }
  return null
}

/**
 * Attach `isNew` to every finding whose entity resolves to a `component:<id>`
 * this run can independently recompute a CURRENT code/spec state for.
 * Findings that resolve to no known contract id, or whose current state
 * can't be read (an unreadable component, a contract with no code source),
 * are returned unchanged — no `isNew` field at all.
 *
 * @param {object[]} findings
 * @param {object|null} priorState a validated `state.json` document (or
 *   `null` — no prior run, every finding stays unmarked)
 * @param {Array<{id: string, contract: object}>} contracts this run's
 *   already-loaded contracts
 * @param {{root: string}} options
 * @returns {object[]} a NEW array; never mutates its argument
 */
export function markIsNew(findings, priorState, contracts, { root, config }) {
  if (!priorState) return findings

  const knownIds = new Set(contracts.map(({ id }) => id))
  const { entities: currentEntities } = buildEntityStates(contracts, {
    root,
    config,
  })

  return findings.map(finding => {
    if (!CONTRACT_SCOPED_SURFACES.has(finding.surface)) return finding
    if (NON_CONTRACT_SCOPED_RULES.has(finding.ruleId)) return finding

    const contractId = resolveContractId(finding.entity, knownIds)
    if (!contractId) return finding

    const key = `component:${contractId}`
    const current = currentEntities[key]
    if (!current) return finding

    const prior = priorState.entities?.[key]
    const isNew =
      !prior ||
      prior.codeHash !== current.codeHash ||
      prior.specHash !== current.specHash

    return { ...finding, isNew }
  })
}
