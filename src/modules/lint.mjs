/**
 * lint.mjs — the lint surface (ADR-001 D5/D10, Phase 3, issue #120).
 *
 * PURE: `runLintCheck(lintCensus, config) => findings[]`. Never touches
 * fs/network and never imports `@terrazzo/parser` — `sources/code.mjs`'s
 * `censusTokenLint` runs the vendor's rules and hands this module NORMALIZED
 * `{ruleId, level, message, entity}` violations.
 *
 * WHY THE VENDOR STOPS AT `sources/`. Terrazzo's `lintRunner` wants its own
 * token map and source records. Passing those in here would drag a vendor data
 * structure into the pure layer — the mirror of the mistake D12 (design tools
 * are providers) and D16 (frameworks are adapters) exist to prevent. Normalized
 * violations mean this module is driven by plain injected fixtures in tests,
 * the same way every other domain module here is.
 *
 * DELEGATED RULE IDS KEEP THEIR `core/` PREFIX. `core/valid-color` is
 * recognizably Terrazzo's; a rule this engine ports later will not be. That
 * distinction matters to whoever reads a report and wants to know where a rule
 * came from, and it costs nothing to preserve. `docs/spikes/lint-rule-
 * mapping.md` records which rules are delegated and why.
 *
 * SEVERITY IS THIS ENGINE'S CALL, NOT THE VENDOR'S. Terrazzo reports at its own
 * error/warn level; that is mapped to a D5 severity and then run through the
 * same `rules` config every other surface uses, so a consumer silences a
 * delegated rule exactly the way they silence a native one — one mechanism, per
 * D5's explicit rejection of v1's three parallel severity systems.
 *
 * SILENCE IS THE DEFAULT. A project that has configured no lint rules gets
 * ZERO findings, never a faceful of some other design system's opinions. That
 * is enforced upstream in `censusTokenLint` (no rules → no run) and holds
 * trivially here: no violations in, no findings out.
 */

import {
  compareEntities,
  makeFinding,
  sortFindings,
} from "../core/findings.mjs"
import { createRegistry, resolveRuleConfig } from "../core/rules.mjs"
import { resolveConfig } from "../core/config.mjs"

// ---------------------------------------------------------------------------
// The registry.
//
// Deliberately ONE registered rule id rather than seventeen. The delegated set
// is Terrazzo's to change — pinning each `core/*` id here would mean this file
// silently goes stale on their next release, and a consumer disabling
// `core/valid-color` would be configuring a rule this engine only *thinks*
// exists. `lint/token-rule` is the surface's own rule; the specific vendor rule
// travels in `data.rule` and in the message, and is filterable via `--rule`.
// ---------------------------------------------------------------------------

export const RULES = [
  {
    id: "lint/token-rule",
    surface: "lint",
    defaultSeverity: "warn",
    description:
      "A delegated token lint rule (@terrazzo/parser's `core/*` set) reported a violation. The specific rule id is in `data.rule`.",
  },
  {
    id: "lint/tier-alias-inverted",
    surface: "lint",
    defaultSeverity: "warn",
    description:
      "A token aliases one in a HIGHER tier — the layering runs backwards, so a primitive's value now depends on a token built on top of it.",
  },
  {
    id: "lint/tier-alias-missing",
    surface: "lint",
    defaultSeverity: "warn",
    description:
      "A token in a tier above the first one `lint.tiers` lists holds a literal value rather than aliasing a lower tier — the inverse of `lint/tier-alias-inverted`. Opt-in: runs only when `rules` names it.",
  },
  {
    id: "lint/unknown-dollar-field",
    surface: "lint",
    defaultSeverity: "warn",
    description:
      "A token or group carries a `$`-prefixed key the DTCG format does not reserve there (`$tyep`, `$vaule`) — almost always a typo, which the parser otherwise drops silently. Opt-in: runs only when `rules` names it.",
  },
  {
    id: "lint/vocabulary-invalid",
    surface: "lint",
    defaultSeverity: "warn",
    description:
      "A token's leaf name is not in the closed set `lint.vocabularies` declares for its path — a canonical ordered scale (t-shirt sizes) and a closed state set (hover/active) are the same mechanism under different vocabularies.",
  },
  {
    id: "lint/contract-name-case",
    surface: "lint",
    defaultSeverity: "warn",
    description:
      "A contract's prop or anatomy element name does not follow the case `lint.contracts.nameCase` configures — the contract schema only bounds the character set; which case a project uses is its own convention.",
  },
  {
    id: "lint/contract-enum-invalid",
    surface: "lint",
    defaultSeverity: "warn",
    description:
      "An enum prop's values are not all in the closed set `lint.contracts.enumVocabularies` declares for that prop name — the contract-side twin of `lint/vocabulary-invalid`, so `size: sm|md|lg` in one contract and `small|medium|large` in another is a finding, not a silent fork.",
  },
  {
    id: "lint/design-name-invalid",
    surface: "lint",
    defaultSeverity: "warn",
    description:
      "A design-side variable or component name does not match the pattern `lint.designNames` configures for its kind — the naming-convention half of what `tokens/design-token-ambiguous` can only report after the fact.",
  },
  {
    id: "lint/ramp-not-monotonic",
    surface: "lint",
    defaultSeverity: "warn",
    description:
      "A configured color ramp's perceptual lightness does not move monotonically as its numeric step increases — a step reverses the trend the rest of the ramp establishes.",
  },
]

export const registry = createRegistry(RULES)

// Terrazzo reports error/warn; D5's vocabulary is error/warn/review. A
// vendor "error" is a genuine spec violation (a token whose $value does not
// match its $type), so it maps straight across rather than being softened.
function severityFor(level) {
  return level === "error" ? "error" : "warn"
}

/**
 * @param {{ok: boolean, violations: Array<{ruleId: string, level: string, message: string, entity?: string}>}} lintCensus
 *   `sources/code.mjs`'s `censusTokenLint(...)` result. Only `.violations` is
 *   read — `.ok`/`.diagnostics`/`.skipped` are the caller's concern, the same
 *   "a surface skips with a reason" convention every other module follows.
 * @param {object} config resolved project config
 * @returns {Array<object>} D5 findings, sorted
 */
export function runLintCheck(lintCensus, config = {}) {
  const resolved = resolveConfig(config)
  const findings = []

  for (const violation of lintCensus?.violations || []) {
    const ruleId = "lint/token-rule"
    // The registry's default is a floor, not the answer: a consumer's `rules`
    // entry wins, and absent one the VENDOR's own level decides, so a genuine
    // spec violation lands at `error` rather than being flattened to the
    // registry default. `off` gates it, exactly as on every other surface.
    const { severity: configured } = resolveRuleConfig(
      ruleId,
      resolved.rules,
      registry,
    )
    if (configured === "off") continue
    const severity =
      resolved.rules && resolved.rules[ruleId]
        ? configured
        : severityFor(violation.level)

    findings.push(
      makeFinding({
        ruleId,
        severity,
        surface: "lint",
        side: "code",
        // The token id, when `censusTokenLint` could trace the violation to
        // exactly one token's source (#636). When it could not, the rule id
        // is the honest fallback: a guessed token id would put a wrong entity
        // in a report, which is worse than an unspecific one —
        // `data.value`/`data.line` carry what is real.
        entity: violation.entity || violation.ruleId,
        message: `${violation.ruleId}: ${violation.message}`,
        data: {
          rule: violation.ruleId,
          token: violation.entity,
          value: violation.value,
          // `file` + `line` travel together and are the only real FILE
          // POSITION a finding carries — `entity` here is a token id or the
          // rule id, never a path, so a line without its file would point
          // into something that is not a file.
          file: violation.file,
          line: violation.line,
        },
      }),
    )
  }

  return sortFindings(findings)
}

// ---------------------------------------------------------------------------
// PORTED rule: tier alias direction (issue #121).
//
// The idea is general to any layered token system: lower tiers hold raw
// values, higher tiers alias DOWNWARD toward them. An alias pointing UPWARD
// inverts the layering — a primitive whose value depends on a token built on
// top of it — and makes the dependency graph circular in intent if not in
// fact.
//
// THE NAMES ARE NOT. `base`/`system`/`component` is one project's vocabulary;
// another's is `global`/`alias`/`component`, or `core`/`semantic`. So the
// ordered tier list comes from `lint.tiers` in config and NOTHING here ever
// names a tier. `__tests__/modules-lint.test.js` proves that with a fixture
// whose tiers share no substring with any real project's.
//
// SILENT WITHOUT CONFIG, which is issue #121's central invariant: with no
// `lint.tiers` the rule cannot know what a tier is, so it emits nothing rather
// than guessing. A token whose first segment is not a configured tier is
// likewise skipped — it is outside the model, not wrong.
//
// WHAT THIS DELIBERATELY DOES NOT CHECK, each measured against a real design
// system rather than reasoned about (see the PR for the numbers):
//
//   - "a primitive must not alias at all" — 16 hits, every one a same-tier
//     `lineHeight.N -> spacing.N` reuse of a shared numeric scale. Whether
//     that is a smell is the consumer's call, and several of those tokens are
//     ALREADY reported by `tokens/token-unreferenced`, so the rule would
//     double-report what another rule covers.
//   - "a non-primitive tier must alias rather than hold a raw value" — 82
//     hits, including easings, elevations and gradients that have no primitive
//     to alias. Too noisy to run for every project that lists tiers, so it is
//     its own rule, `lint/tier-alias-missing` (#639), which runs only when
//     `rules` names it — see `runTierAliasMissingCheck` below.
//
// Both are recorded so a later slice does not re-litigate them from scratch.
// ---------------------------------------------------------------------------

// The tier a token id belongs to, as an INDEX into the configured list, or
// null when it belongs to none. A mode-scoped id (`system/dark.color.x`)
// carries its mode on the first segment; the tier is the part before the `/`,
// since a mode is an alternate VALUE of a tier's token, not a tier of its own.
// The token this one aliases DIRECTLY — the single edge whose direction this
// rule is about.
//
// NOT `aliasOf`, which is the trap: the census carries Terrazzo's FULLY
// RESOLVED ultimate target there, so a chain
// `base.x -> {system.y} -> {base.z}` reports `aliasOf: "base.z"`. Reading it
// makes an inverted alias look like a same-tier one, and in a well-formed
// system the ultimate target is always a primitive — so the rule would have
// been incapable of EVER firing while looking perfectly correct.
//
// `aliasChain[0]` is the direct target; `aliasOf` is the fallback for a
// single-hop alias where no chain is recorded. Caught by injecting an inverted
// alias into a real token file and watching nothing happen — a fixture built
// on `aliasOf` alone reproduces a shape the real census never emits, and
// passed.
function directAliasTarget(token) {
  const chain = token?.aliasChain
  if (Array.isArray(chain) && chain.length > 0) return chain[0]
  return token?.aliasOf || null
}

function tierIndexOf(tokenId, tiers) {
  const head = String(tokenId).split(".")[0].split("/")[0]
  const index = tiers.indexOf(head)
  return index === -1 ? null : index
}

/**
 * Check that every alias points DOWNWARD through the configured tiers.
 * Pure — reads only the already-loaded token census.
 *
 * @param {{tokens: Array<{id: string, aliasOf?: string}>}} tokenCensus
 *   `sources/code.mjs`'s `censusTokens(...)` result
 * @param {object} [config] the project's (unresolved) config
 * @returns {object[]} findings, in `core/findings.mjs`'s deterministic order
 */
export function runTierCheck(tokenCensus, config = {}) {
  const resolved = resolveConfig(config)
  const tiers = resolved.lint?.tiers
  // No configured vocabulary -> no opinion. See the block comment above.
  if (!Array.isArray(tiers) || tiers.length < 2) return []

  const ruleId = "lint/tier-alias-inverted"
  const { severity } = resolveRuleConfig(ruleId, resolved.rules, registry)
  if (severity === "off") return []

  const findings = []
  for (const token of tokenCensus?.tokens || []) {
    const target = directAliasTarget(token)
    if (!target) continue
    const from = tierIndexOf(token.id, tiers)
    const to = tierIndexOf(target, tiers)
    if (from === null || to === null) continue // outside the model, not wrong
    // STRICTLY upward only. Same-tier aliasing is a separate question this
    // rule deliberately does not answer — see the block comment.
    if (to <= from) continue

    findings.push(
      makeFinding({
        ruleId,
        severity,
        surface: "lint",
        side: "code",
        entity: token.id,
        message: `token "${token.id}" is in tier "${tiers[from]}" but aliases "${target}" in the higher tier "${tiers[to]}" — aliases must point downward`,
        data: {
          token: token.id,
          aliasOf: target,
          tier: tiers[from],
          aliasTier: tiers[to],
        },
      }),
    )
  }

  return sortFindings(findings)
}

// ---------------------------------------------------------------------------
// Opt-in token rules (#639): `lint/tier-alias-missing` and
// `lint/unknown-dollar-field`.
//
// OPT-IN, NOT SILENT-UNTIL-SHAPED. Every other ported rule is silenced by an
// absent `lint.*` block, but neither of these has a block of its own: the
// first reuses `lint.tiers`, which projects already set for
// `lint/tier-alias-inverted`, and the second needs no config at all. A
// registry default can never be `off`, so the opt-in is the `rules` entry
// itself: a rule `rules` does not name says nothing, and a project upgrading
// hears nothing new.
// ---------------------------------------------------------------------------

// The configured severity, or null when `rules` does not name the rule or
// turns it `off`.
function optedInSeverity(ruleId, resolved) {
  if (!resolved.rules || resolved.rules[ruleId] === undefined) return null
  const { severity } = resolveRuleConfig(ruleId, resolved.rules, registry)
  return severity === "off" ? null : severity
}

/**
 * Report every token in a tier above the first that aliases nothing: no
 * direct alias and no aliased composite member. Pure — reads only the
 * already-loaded token census.
 *
 * @param {{tokens: Array<{id: string, aliasOf?: string, aliasChain?: string[], partialAliasOf?: object}>}} tokenCensus
 *   `sources/code.mjs`'s `censusTokens(...)` result
 * @param {object} [config] the project's (unresolved) config
 * @returns {object[]} findings, in `core/findings.mjs`'s deterministic order
 */
export function runTierAliasMissingCheck(tokenCensus, config = {}) {
  const resolved = resolveConfig(config)
  const tiers = resolved.lint?.tiers
  if (!Array.isArray(tiers) || tiers.length < 2) return []
  const ruleId = "lint/tier-alias-missing"
  const severity = optedInSeverity(ruleId, resolved)
  if (!severity) return []

  const findings = []
  for (const token of tokenCensus?.tokens || []) {
    const tier = tierIndexOf(token.id, tiers)
    // The first tier holds raw values by definition; a token in no tier is
    // outside the model, not wrong.
    if (tier === null || tier === 0) continue
    if (directAliasTarget(token) || token.partialAliasOf) continue
    findings.push(
      makeFinding({
        ruleId,
        severity,
        surface: "lint",
        side: "code",
        entity: token.id,
        message: `token "${token.id}" is in tier "${tiers[tier]}" but holds a literal value — it should alias a token in a lower tier`,
        data: { token: token.id, tier: tiers[tier] },
      }),
    )
  }
  return sortFindings(findings)
}

/**
 * Report every `$` key the census found that DTCG does not reserve. Pure —
 * the census walked the raw document; this only turns its list into findings.
 *
 * @param {{dollarFields?: Array<{path: string, key: string, file?: string}>}} tokenCensus
 *   `sources/code.mjs`'s `censusTokens(...)` result
 * @param {object} [config] the project's (unresolved) config
 * @returns {object[]} findings, in `core/findings.mjs`'s deterministic order
 */
export function runUnknownDollarFieldCheck(tokenCensus, config = {}) {
  const resolved = resolveConfig(config)
  const ruleId = "lint/unknown-dollar-field"
  const severity = optedInSeverity(ruleId, resolved)
  if (!severity) return []

  const findings = (tokenCensus?.dollarFields || []).map(
    ({ path, key, file }) =>
      makeFinding({
        ruleId,
        severity,
        surface: "lint",
        side: "code",
        entity: path ? `${path}.${key}` : key,
        message: `${path ? `"${path}"` : "the document root"} carries "${key}", which is not a DTCG reserved property — a typo is silently ignored`,
        data: { path, key, file },
      }),
  )
  return sortFindings(findings)
}

// ---------------------------------------------------------------------------
// PORTED rule: closed-vocabulary token leaves (issue #121).
//
// ONE MECHANISM, not three rule ids. The triaged v1 rules were
// `scale/tshirt-canonical` (a token step is one of a canonical ordered
// scale), `scale/no-legacy-ordinal` (and specifically not a raw number, the
// shape scales looked like before migrating to t-shirt names), and
// `state/vocabulary` (a token's mode is one of a closed state set). Measured
// against how they would actually be configured, all three ask the identical
// question — "is this leaf a member of the set configured for this path" —
// with different sets. A numbered legacy step is automatically caught by NOT
// being in the canonical set; it needs no rule of its own. Splitting one
// mechanism into three ids would be the same anti-pattern #120 rejected for
// Terrazzo's `core/*` family, in the opposite direction.
//
// PATH MATCHING is deliberately minimal: `*` stands for exactly one dot
// segment, matched against a token's PARENT path (its id with the leaf
// removed) — `system.typography.ui.xlSemiboldFlat`'s parent is
// `system.typography.ui`; `*.color.bg.secondary` matches both
// `system/light.color.bg.secondary` and `system/dark.color.bg.secondary`,
// since a mode sits in a fixed position other paths do not need to repeat.
// No multi-segment wildcard, no regex — a project's real path shapes
// (measured against 87 real token groups) never needed more than this.
//
// FIRST MATCHING ENTRY WINS when a token's parent matches more than one
// configured entry, so two entries governing overlapping paths do not double-
// report the same token — config order is the tie-break, same determinism
// posture as everywhere else in this engine.
// ---------------------------------------------------------------------------

// A `*` segment matches exactly one segment of `path`; every other segment
// must match literally. Segment counts must be equal — no partial-path
// matching, which would silently govern more than a project meant to name.
function pathMatches(pattern, path) {
  const patternSegments = pattern.split(".")
  const pathSegments = path.split(".")
  if (patternSegments.length !== pathSegments.length) return false
  return patternSegments.every(
    (segment, i) => segment === "*" || segment === pathSegments[i],
  )
}

// The first configured vocabulary entry whose `paths` matches this token's
// PARENT path (its id with the leaf segment removed), or null when none does
// — an ungoverned path, not a violation.
function vocabularyFor(tokenId, vocabularies) {
  const segments = String(tokenId).split(".")
  const parent = segments.slice(0, -1).join(".")
  for (const entry of vocabularies) {
    if (entry.paths.some(pattern => pathMatches(pattern, parent))) return entry
  }
  return null
}

/**
 * Check that every governed token's leaf name is in its configured closed
 * vocabulary. Pure — reads only the already-loaded token census.
 *
 * @param {{tokens: Array<{id: string}>}} tokenCensus
 *   `sources/code.mjs`'s `censusTokens(...)` result
 * @param {object} [config] the project's (unresolved) config
 * @returns {object[]} findings, in `core/findings.mjs`'s deterministic order
 */
export function runVocabularyCheck(tokenCensus, config = {}) {
  const resolved = resolveConfig(config)
  const vocabularies = resolved.lint?.vocabularies
  // No configured vocabulary -> no opinion. See the block comment above.
  if (!Array.isArray(vocabularies) || vocabularies.length === 0) return []

  const ruleId = "lint/vocabulary-invalid"
  const { severity } = resolveRuleConfig(ruleId, resolved.rules, registry)
  if (severity === "off") return []

  const findings = []
  for (const token of tokenCensus?.tokens || []) {
    const entry = vocabularyFor(token.id, vocabularies)
    if (!entry) continue // ungoverned path, not a violation

    const leaf = String(token.id).split(".").pop()
    if (entry.values.includes(leaf)) continue

    findings.push(
      makeFinding({
        ruleId,
        severity,
        surface: "lint",
        side: "code",
        entity: token.id,
        message: `token "${token.id}" has leaf "${leaf}", which is not in the configured vocabulary (${entry.values.join(", ")})`,
        data: { token: token.id, leaf, allowed: [...entry.values] },
      }),
    )
  }

  return sortFindings(findings)
}

// ---------------------------------------------------------------------------
// PORTED rule: monotonic color ramps (issue #121).
//
// "A numeric ramp's lightness moves monotonically as the key increases" is a
// genuinely general invariant about a layered color system — but WHICH paths
// are ramps is a project's own token architecture, so `lint.rampPaths` names
// them the same way `lint.vocabularies` names governed paths, reusing
// `pathMatches` rather than a second matcher.
//
// LIGHTNESS, NOT THE RAW CHANNELS. Comparing R/G/B directly would flag a
// perfectly fine ramp the moment its hue is not pure gray — a ramp typically
// keeps SOME chroma while lightness moves. HSL lightness
// `(max(r,g,b) + min(r,g,b)) / 2` is used because it needs only the DTCG
// `color` shape already in the census (`components: [r, g, b, ...]`,
// normalized 0..1) — no color-space conversion, no new dependency, and it is
// the same measure a human visually reading "does this get darker" would use.
//
// A TOKEN THIS RULE CANNOT READ IS SKIPPED, NOT FLAGGED: a leaf that is not a
// parseable number (the ramp has no ordering to check), a value with fewer
// than 3 numeric `components` (not a shape this rule can compute lightness
// from). Both are "outside what this rule can assert", the same posture as an
// unmappable candidate in `modules/tokens.mjs`.
//
// NON-STRICT MONOTONICITY (`<=`/`>=`, not `<`/`>`) — measured on a real
// system, several ramps hold a CONSTANT lightness across every step (pure
// black/white varying only alpha). Requiring strict movement would flag every
// one of those as broken; a ramp that never reverses is not the invariant
// this rule protects.
// ---------------------------------------------------------------------------

// value.components, coerced to a finite RGB triple, or null when the shape
// cannot be read.
function rgbOf(value) {
  const components = value?.components
  if (!Array.isArray(components) || components.length < 3) return null
  const [r, g, b] = components
  if (![r, g, b].every(Number.isFinite)) return null
  return [r, g, b]
}

// HSL lightness — see the block comment for why this measure and not a raw
// channel or a full color-space conversion.
function hslLightness(value) {
  const rgb = rgbOf(value)
  if (!rgb) return null
  return (Math.max(...rgb) + Math.min(...rgb)) / 2
}

// The trailing dot-segment of a token id, coerced to a finite number, or null
// when it is not one — the token's position in a numeric ramp.
function rampStep(tokenId) {
  const leaf = String(tokenId).split(".").pop()
  const n = Number(leaf)
  return Number.isFinite(n) ? n : null
}

/**
 * Check that every configured color ramp's lightness moves monotonically as
 * its numeric step increases. Pure — reads only the already-loaded token
 * census.
 *
 * @param {{tokens: Array<{id: string, $type?: string, value?: unknown}>}} tokenCensus
 *   `sources/code.mjs`'s `censusTokens(...)` result
 * @param {object} [config] the project's (unresolved) config
 * @returns {object[]} findings, in `core/findings.mjs`'s deterministic order
 */
export function runRampCheck(tokenCensus, config = {}) {
  const resolved = resolveConfig(config)
  const rampPaths = resolved.lint?.rampPaths
  // No configured ramp -> no opinion. See the block comment above.
  if (!Array.isArray(rampPaths) || rampPaths.length === 0) return []

  const ruleId = "lint/ramp-not-monotonic"
  const { severity } = resolveRuleConfig(ruleId, resolved.rules, registry)
  if (severity === "off") return []

  // Group every readable color token under its parent path, in ramp-step
  // order — the shape the direction check below needs.
  const groups = new Map()
  for (const token of tokenCensus?.tokens || []) {
    if (token?.$type !== "color") continue
    const step = rampStep(token.id)
    if (step === null) continue
    const lightness = hslLightness(token.value)
    if (lightness === null) continue

    const parent = String(token.id).split(".").slice(0, -1).join(".")
    if (!rampPaths.some(pattern => pathMatches(pattern, parent))) continue

    if (!groups.has(parent)) groups.set(parent, [])
    groups.get(parent).push({ id: token.id, step, lightness })
  }

  const findings = []
  for (const [, members] of [...groups.entries()].sort((a, b) =>
    compareEntities(a[0], b[0]),
  )) {
    const sorted = [...members].sort((a, b) => a.step - b.step)
    // The direction the ramp establishes: the sign of the first non-zero
    // lightness change. A ramp with fewer than 2 comparable steps, or one
    // whose lightness never changes at all, asserts no direction and is left
    // alone — flat is not a reversal.
    const firstChange = sorted
      .slice(1)
      .map((m, i) => Math.sign(m.lightness - sorted[i].lightness))
      .find(sign => sign !== 0)
    if (!firstChange) continue

    for (let i = 1; i < sorted.length; i++) {
      const delta = sorted[i].lightness - sorted[i - 1].lightness
      // Non-strict: a delta of 0 (a plateau step) never reverses a trend.
      if (Math.sign(delta) !== 0 && Math.sign(delta) !== firstChange) {
        findings.push(
          makeFinding({
            ruleId,
            severity,
            surface: "lint",
            side: "code",
            entity: sorted[i].id,
            message: `token "${sorted[i].id}" breaks the ramp's lightness trend — it follows "${sorted[i - 1].id}" but moves the opposite direction`,
            data: {
              token: sorted[i].id,
              previous: sorted[i - 1].id,
              lightness: sorted[i].lightness,
              previousLightness: sorted[i - 1].lightness,
            },
          }),
        )
      }
    }
  }

  return sortFindings(findings)
}

// ---------------------------------------------------------------------------
// Contract lint (issue #406). The token rules above lint the TOKEN census;
// these lint the CONTRACTS — the same "is this name a member of the set the
// project configured" question, asked of prop names, anatomy element names,
// and enum values. ABSENT MEANS SILENT, same as every field in `lint`: the
// contract schema bounds the character set (`^[A-Za-z][A-Za-z0-9]*$`), and
// which case or vocabulary a project uses within it is config, never engine
// opinion. `side: "spec"` — the finding is about the contract file itself.
// ---------------------------------------------------------------------------

const NAME_CASES = {
  camelCase: /^[a-z][A-Za-z0-9]*$/,
  PascalCase: /^[A-Z][A-Za-z0-9]*$/,
}

// The two sigils a contract map reserves are never names (the same rule the
// schema's `patternProperties` states): `_`-prefixed keys are documentary
// comments, and `$`-prefixed keys are structure — `anatomy.$variants`
// (ADR-002 D2) is the only one, and unlike a comment it survives loading, so
// this filter is what keeps it out of a name-case finding.
const namedKeys = object =>
  Object.keys(object || {}).filter(
    key => !key.startsWith("_") && !key.startsWith("$"),
  )

/**
 * Lint every loaded contract's prop names, anatomy element names, and enum
 * values against `lint.contracts`. Pure — reads only the already-loaded
 * contracts.
 *
 * @param {Array<{id: string, file?: string, contract: object}>} contracts
 *   `spec/contracts.mjs`'s `loadContracts(...).contracts`
 * @param {object} [config] the project's (unresolved) config
 * @returns {object[]} findings, in `core/findings.mjs`'s deterministic order
 */
export function runContractLintCheck(contracts, config = {}) {
  const resolved = resolveConfig(config)
  const options = resolved.lint?.contracts
  if (!options) return []

  const findings = []
  const emit = (ruleId, fields) => {
    const { severity } = resolveRuleConfig(ruleId, resolved.rules, registry)
    if (severity === "off") return
    findings.push(
      makeFinding({
        ruleId,
        severity,
        surface: "lint",
        side: "spec",
        ...fields,
      }),
    )
  }

  const casePattern = NAME_CASES[options.nameCase]
  const vocabularies = options.enumVocabularies || []

  for (const { id, contract } of contracts || []) {
    if (casePattern) {
      for (const [kind, names] of [
        ["prop", namedKeys(contract.props)],
        ["anatomy element", namedKeys(contract.anatomy)],
      ]) {
        for (const name of names) {
          if (casePattern.test(name)) continue
          emit("lint/contract-name-case", {
            entity: id,
            message: `contract "${id}" names ${kind} "${name}", which is not ${options.nameCase}`,
            data: { kind, name, nameCase: options.nameCase },
          })
        }
      }
    }

    for (const name of namedKeys(contract.props)) {
      const prop = contract.props[name]
      if (prop?.type !== "enum") continue
      const entry = vocabularies.find(v => v.props.includes(name))
      if (!entry) continue // ungoverned prop, not a violation
      const invalid = (prop.values || [])
        .map(String)
        .filter(value => !entry.values.includes(value))
      if (invalid.length === 0) continue
      emit("lint/contract-enum-invalid", {
        entity: id,
        message: `contract "${id}" prop "${name}" has enum value(s) ${invalid.map(v => `"${v}"`).join(", ")} not in the configured vocabulary (${entry.values.join(", ")})`,
        data: { prop: name, invalid, allowed: [...entry.values] },
      })
    }
  }

  return sortFindings(findings)
}

// ---------------------------------------------------------------------------
// Design naming lint (issue #407). The engine cannot LINT a design tool's
// names into a convention — but it can check them against the one the
// project declares, which is what turns a pile of
// `tokens/design-token-ambiguous` findings into a nameable cause. Patterns
// are consumer config (JavaScript regex source, anchored by the author);
// the engine ships none. An invalid pattern is reported by
// `compileDesignNamePatterns` — the same "invalid config is a diagnostic,
// never a crash" posture `validateDesignOptions` takes — so the check only
// ever sees compiled patterns. `side: "design"`.
// ---------------------------------------------------------------------------

/**
 * Compile `lint.designNames`'s patterns, reporting the invalid ones rather
 * than throwing.
 *
 * @param {object} [config] the project's (unresolved) config
 * @returns {{patterns: {variable?: RegExp, component?: RegExp}, errors: string[]}}
 */
export function compileDesignNamePatterns(config = {}) {
  const resolved = resolveConfig(config)
  const configured = resolved.lint?.designNames || {}
  const patterns = {}
  const errors = []
  for (const [key, kind] of [
    ["variablePattern", "variable"],
    ["componentPattern", "component"],
  ]) {
    if (typeof configured[key] !== "string") continue
    try {
      patterns[kind] = new RegExp(configured[key])
    } catch (err) {
      errors.push(
        `lint.designNames.${key} is not a valid pattern: ${err.message}`,
      )
    }
  }
  return { patterns, errors }
}

/**
 * Check design-side names against the configured patterns. Pure — the
 * caller reads the snapshots and reduces them to name lists.
 *
 * @param {{variables?: string[], components?: string[]}} names
 * @param {object} [config] the project's (unresolved) config
 * @returns {object[]} findings, in `core/findings.mjs`'s deterministic order
 */
export function runDesignNamingCheck(names, config = {}) {
  const resolved = resolveConfig(config)
  const configured = resolved.lint?.designNames || {}
  const { patterns } = compileDesignNamePatterns(config)
  const ruleId = "lint/design-name-invalid"
  const { severity } = resolveRuleConfig(ruleId, resolved.rules, registry)
  if (severity === "off") return []

  const findings = []
  for (const [kind, list, source] of [
    ["variable", names?.variables, configured.variablePattern],
    ["component", names?.components, configured.componentPattern],
  ]) {
    const pattern = patterns[kind]
    if (!pattern) continue
    for (const name of list || []) {
      if (pattern.test(name)) continue
      findings.push(
        makeFinding({
          ruleId,
          severity,
          surface: "lint",
          side: "design",
          entity: name,
          message: `design ${kind} "${name}" does not match the configured ${kind} name pattern ${source}`,
          data: { kind, name, pattern: source },
        }),
      )
    }
  }
  return sortFindings(findings)
}
