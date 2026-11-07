/**
 * rules.mjs
 *
 * The ONE rule registry + severity resolution engine for every surface
 * (tokens, components, lint, coverage) — ADR-001 D5. Where v1 split this
 * concern across three mechanisms (`lib/rules.mjs`'s unified `rules` block,
 * the legacy `lint.severityOverrides`, and `tokenHygiene.flagRawFills`) and
 * defined `SEVERITY_RANK` twice, there is exactly one registry and imports its
 * severity vocabulary from `./findings.mjs` rather than redeclaring it — a
 * rule descriptor's `defaultSeverity` and a config entry's severity are both
 * checked against the SAME constants a finding's own `severity` field uses.
 *
 * This module ports `lib/rules.mjs`'s proven semantics onto a cleaner
 * registry shape:
 *
 *   - `defineRule` / `createRegistry` replace v1's ad-hoc descriptor arrays
 *     (`AUDIT_RULES`, `CONFORM_RULES`, drift-lint's own list) with one
 *     validated, immutable registry every domain module contributes to.
 *   - `normalizeRuleEntry` is unchanged in spirit from v1: a config value is
 *     either a bare severity string or a `[severity, options]` tuple, and
 *     anything else throws — a value this function can't read is a config
 *     the consumer meant to have an effect and which would otherwise have
 *     none.
 *   - `validateRuleIds` keeps v1's loud-fail posture for a typo'd rule id.
 *     v1 had to tell a FOREIGN rule id (another engine's namespace) from a
 *     typo via a hand-maintained `RULE_NAMESPACES` map, because several
 *     engines shared one `rules` block with only some descriptors in hand at
 *     a time. there is one registry with every rule from every surface always
 *     present, so that distinction is gone: an id absent from the registry
 *     is unconditionally unknown.
 *   - `resolveRuleConfig` keeps v1's precedence — registry default wins by
 *     default, the config's `rules[id]` entry wins outright when present,
 *     including `"off"` — minus the legacy `lint.severityOverrides` rung:
 *     ADR-001 D5 retires it, so there are two levels here, not three.
 *
 * Config shape (`design-delta.json` → `rules`, validated
 * structurally by `schema/config.schema.json`):
 *
 *   {
 *     "rules": {
 *       "tokens/value-mismatch": "warn",
 *       "components/prop-missing": ["error", { "ignoreOptional": true }],
 *       "lint/camel-case": "off"
 *     }
 *   }
 *
 * Pure module: no fs, no network, no process exit, no console output. Every
 * function here is a plain data transform over an already-parsed config
 * object and an in-memory registry.
 */

import { SEVERITIES, CONFIGURABLE_SEVERITIES, SURFACES } from "./findings.mjs"

const isPlainObject = v =>
  v != null && typeof v === "object" && !Array.isArray(v)

const isSeverity = v => typeof v === "string" && SEVERITIES.includes(v)

const isConfigurableSeverity = v =>
  typeof v === "string" && CONFIGURABLE_SEVERITIES.includes(v)

const CONFIGURABLE_SEVERITY_LIST = CONFIGURABLE_SEVERITIES.join(", ")

// `<surface-noun>/<check-name>` — both segments lowercase, hyphen-separated,
// starting with a letter. e.g. "tokens/value-mismatch", "lint/camel-case".
const RULE_ID_PATTERN = /^[a-z][a-z0-9-]*\/[a-z][a-z0-9-]*$/

/**
 * Validate one rule definition and return a frozen, normalized copy.
 *
 * @param {{id: string, surface: string, defaultSeverity: string, description: string, options?: object}} def
 * @returns {Readonly<{id: string, surface: string, defaultSeverity: string, description: string, options: Readonly<object>}>}
 *
 * Throws a clear Error on any malformed field:
 *   - `id` must match `^[a-z][a-z0-9-]*\/[a-z][a-z0-9-]*$`.
 *   - `surface` must be one of `SURFACES` (from `./findings.mjs`).
 *   - `defaultSeverity` must be one of `SEVERITIES` — never `"off"`: a rule's
 *     OWN default is a real severity, only a consumer's config can turn it
 *     off.
 *   - `description` must be a non-empty string.
 *   - `options`, if provided, must be a plain object (it becomes the default
 *     options every resolution merges a config override on top of).
 */
export function defineRule(def) {
  if (!isPlainObject(def))
    throw new Error(
      `rule definition must be an object — got ${JSON.stringify(def) ?? String(def)}`,
    )

  const { id, surface, defaultSeverity, description, options } = def

  if (typeof id !== "string" || !RULE_ID_PATTERN.test(id))
    throw new Error(
      `rule id must match ${RULE_ID_PATTERN} (e.g. "tokens/value-mismatch") — got ${JSON.stringify(id)}`,
    )

  if (typeof surface !== "string" || !SURFACES.includes(surface))
    throw new Error(
      `rule '${id}' surface must be one of ${SURFACES.join(", ")} — got ${JSON.stringify(surface)}`,
    )

  if (!isSeverity(defaultSeverity))
    throw new Error(
      `rule '${id}' defaultSeverity must be one of ${SEVERITIES.join(", ")} — got ${JSON.stringify(defaultSeverity)}`,
    )

  if (typeof description !== "string" || description.trim() === "")
    throw new Error(`rule '${id}' description must be a non-empty string`)

  if (options !== undefined && !isPlainObject(options))
    throw new Error(
      `rule '${id}' options must be a plain object when provided — got ${JSON.stringify(options)}`,
    )

  return Object.freeze({
    id,
    surface,
    defaultSeverity,
    description,
    options: Object.freeze({ ...(options || {}) }),
  })
}

/**
 * Build an immutable registry from an array of rule definitions (each run
 * through `defineRule`, so a malformed definition fails at registry
 * construction, not at first resolution). Throws on a duplicate id — two
 * domain modules colliding on the same rule id is a build-time bug, not a
 * runtime condition to tolerate.
 *
 * @param {Array<object>} ruleDefs
 * @returns {{get(id: string): object|undefined, ids(): string[], bySurface(surface: string): object[]}}
 */
export function createRegistry(ruleDefs) {
  if (!Array.isArray(ruleDefs))
    throw new Error("createRegistry expects an array of rule definitions")

  const byId = new Map()
  for (const raw of ruleDefs) {
    const rule = defineRule(raw)
    if (byId.has(rule.id))
      throw new Error(`duplicate rule id '${rule.id}' in registry`)
    byId.set(rule.id, rule)
  }

  const sortedIds = Object.freeze([...byId.keys()].sort())

  return Object.freeze({
    get(id) {
      return byId.get(id)
    },
    ids() {
      return [...sortedIds]
    },
    bySurface(surface) {
      return sortedIds
        .filter(id => byId.get(id).surface === surface)
        .map(id => byId.get(id))
    },
  })
}

/**
 * One `rules` entry → `{severity, options}`.
 *
 * Accepts a bare severity string (`"off"`, `"error"`, `"warn"`, or
 * `"review"`) or a 2-tuple of severity + a plain-object options override.
 * Anything else THROWS — a bare object, an unknown severity string, or an
 * array of the wrong length are all config the consumer meant to have an
 * effect and which would otherwise silently do nothing.
 *
 * @param {string|[string, object]} entry
 * @returns {{severity: string, options: object}}
 */
export function normalizeRuleEntry(entry) {
  if (isConfigurableSeverity(entry)) return { severity: entry, options: {} }

  if (
    Array.isArray(entry) &&
    entry.length === 2 &&
    isConfigurableSeverity(entry[0]) &&
    isPlainObject(entry[1])
  )
    return { severity: entry[0], options: { ...entry[1] } }

  throw new Error(
    `must be one of ${CONFIGURABLE_SEVERITY_LIST}, or a [severity, options] pair — got ${JSON.stringify(entry) ?? String(entry)}`,
  )
}

// Plain Levenshtein edit distance — used only for "did you mean" hints (an
// unknown rule id here, an unknown subcommand in `cli/main.mjs`), never for
// anything that affects resolution.
export function levenshtein(a, b) {
  const m = a.length
  const n = b.length
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0))
  for (let i = 0; i <= m; i++) dp[i][0] = i
  for (let j = 0; j <= n; j++) dp[0][j] = j
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j - 1], dp[i - 1][j], dp[i][j - 1])
    }
  }
  return dp[m][n]
}

// The closest known id to an unknown one, only when the match is close
// enough to plausibly be a typo (not a wholesale-wrong id).
function closestId(id, ids) {
  let best = null
  let bestDistance = Infinity
  for (const candidate of ids) {
    const distance = levenshtein(id, candidate)
    if (distance < bestDistance) {
      bestDistance = distance
      best = candidate
    }
  }
  return bestDistance <= 3 ? best : null
}

// `block` names which config block the id came from, purely for the
// message a human reads — `rules` and `exemptions` are BOTH keyed by rule id
// but a typo in either is otherwise indistinguishable at a glance, and the
// two live in different parts of a config file.
function unknownRuleIdMessage(id, registry, block) {
  const surface = String(id).split("/")[0]
  const idsInSurface = SURFACES.includes(surface)
    ? registry.bySurface(surface).map(rule => rule.id)
    : []
  const allIds = registry.ids()
  const candidates = idsInSurface.length ? idsInSurface : allIds
  const suggestion = closestId(id, allIds)
  const hint = suggestion ? ` — did you mean '${suggestion}'?` : ""
  return `unknown rule id '${id}' in ${block}${hint} — known ids: ${candidates.join(", ")}`
}

/**
 * Every problem in a `rules` config block as a list of human-readable lines.
 * Pure — returns `[]` for a valid or absent block. An unknown rule id is a
 * HARD ERROR upstream (v1 behavior): a typo'd id must never silently do
 * nothing, so callers should treat a non-empty result as fatal before ever
 * calling `resolveRuleConfig`/`resolveAll`.
 *
 * @param {Record<string, string|[string, object]>} rulesConfig  the config's `rules` block (id → entry)
 * @param {{get: Function, ids: Function, bySurface: Function}} registry  from `createRegistry`
 * @returns {string[]}
 */
export function validateRuleIds(rulesConfig, registry) {
  const rules = rulesConfig || {}
  if (!isPlainObject(rules)) return ["rules must be an object"]

  const errors = []
  for (const [id, entry] of Object.entries(rules)) {
    if (!registry.get(id)) {
      errors.push(unknownRuleIdMessage(id, registry, "rules"))
      continue
    }
    try {
      normalizeRuleEntry(entry)
    } catch (err) {
      errors.push(`rules.${id} ${err.message}`)
    }
  }
  return errors
}

/**
 * Every unknown rule id in an `exemptions` config block (issue #188) — the
 * same HARD ERROR posture as `validateRuleIds`, id-existence only.
 * `exemptions` is keyed by rule id exactly like `rules`, but its VALUES are
 * waiver lists, not severity entries — `normalizeRuleEntry` does not apply,
 * so this is deliberately a separate function rather than `validateRuleIds`
 * with a flag: the two blocks share a key vocabulary, not a value shape.
 * `applyExemptions`'s own `normalizeEntry` already tolerates a malformed
 * ENTRY within a known rule's list by treating it as no-op; a typo'd rule ID
 * is the one thing that function cannot detect on its own, because a key
 * that matches nothing simply never gets consulted.
 *
 * @param {Record<string, Array<string|{entity: string, reason?: string}>>} exemptionsConfig
 * @param {{get: Function, ids: Function, bySurface: Function}} registry
 * @returns {string[]}
 */
export function validateExemptionRuleIds(exemptionsConfig, registry) {
  const exemptions = exemptionsConfig || {}
  if (!isPlainObject(exemptions)) return ["exemptions must be an object"]

  const errors = []
  for (const id of Object.keys(exemptions)) {
    if (!registry.get(id))
      errors.push(unknownRuleIdMessage(id, registry, "exemptions"))
  }
  return errors
}

/**
 * Resolve one rule's effective `{severity, options}`, merging the registry's
 * default severity + default options with the config's override. The config
 * wins outright, including `"off"`; its `options` merge ON TOP of the
 * registry default's `options` (a partial override, not a replacement).
 * Resolution is pure and does no IO.
 *
 * @param {string} id
 * @param {Record<string, string|[string, object]>} rulesConfig
 * @param {object} registry
 * @returns {{severity: string, options: object}}
 *
 * Throws if `id` is not in `registry`, or if `rulesConfig[id]` is present but
 * malformed (see `normalizeRuleEntry`).
 */
export function resolveRuleConfig(id, rulesConfig, registry) {
  const rule = registry.get(id)
  if (!rule) throw new Error(`cannot resolve unknown rule id '${id}'`)

  const rules = rulesConfig || {}
  if (!Object.prototype.hasOwnProperty.call(rules, id))
    return { severity: rule.defaultSeverity, options: { ...rule.options } }

  const entry = normalizeRuleEntry(rules[id])
  return {
    severity: entry.severity,
    options: { ...rule.options, ...entry.options },
  }
}

/**
 * The set of registry ids whose resolved severity is `"off"` — what a caller
 * run-gates before ever computing that rule's findings.
 *
 * @param {Record<string, string|[string, object]>} rulesConfig
 * @param {object} registry
 * @returns {Set<string>}
 */
export function disabledRuleIds(rulesConfig, registry) {
  const disabled = new Set()
  for (const id of registry.ids()) {
    if (resolveRuleConfig(id, rulesConfig, registry).severity === "off")
      disabled.add(id)
  }
  return disabled
}

/**
 * Whether a single rule resolves to `"off"`.
 *
 * @param {string} id
 * @param {Record<string, string|[string, object]>} rulesConfig
 * @param {object} registry
 * @returns {boolean}
 */
export function isDisabled(id, rulesConfig, registry) {
  return resolveRuleConfig(id, rulesConfig, registry).severity === "off"
}

/**
 * Resolve every rule in `registry` at once.
 *
 * @param {Record<string, string|[string, object]>} rulesConfig
 * @param {object} registry
 * @returns {Map<string, {severity: string, options: object}>}
 */
export function resolveAll(rulesConfig, registry) {
  const resolved = new Map()
  for (const id of registry.ids())
    resolved.set(id, resolveRuleConfig(id, rulesConfig, registry))
  return resolved
}
