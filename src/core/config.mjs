/**
 * config.mjs — project config: load, validate, and resolve
 * `design-delta.json` against `schema/config.schema.json` (ADR-001 D9's
 * Phase 0 skeleton item).
 *
 * This is `core/`: it imports nothing from `src/lib/` or any sibling `src/`
 * dir, only Node builtins + `ajv`/`ajv-formats` — a hand-edited config is a
 * system boundary a consumer crosses on every run, so its load+validate path
 * has to stand on its own, independent of whatever `sources/`/`modules/`
 * eventually import it.
 *
 * CRITICAL, per ADR-001's explicit call-out: v1's `src/lib/config-schema.mjs`
 * leaked one particular consuming project's layout into engine defaults —
 * that project's own directory names, its `--`-prefix, its token-file path,
 * its brand gradient ramp, its timezone. Every default below is either
 * genuinely empty or a neutral, ecosystem-wide convention (e.g.
 * `.contract.json` as the contract-file suffix) — never one consumer's naming.
 * A project that wants anything else configures it.
 *
 * `loadConfig` is LOUD-FAIL: a missing file throws (the caller decides
 * whether that's fatal — v1's `loadConfig` quietly returned `{}` for a
 * missing file, which is the one v1 behavior this module deliberately does
 * NOT carry over, since "no config" and "config exists but doesn't parse"
 * are different failure classes worth different handling upstream); malformed
 * JSON or a schema violation throws with humanized, aggregated messages.
 */

import { existsSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import Ajv from "ajv/dist/2020.js"
import addFormats from "ajv-formats"

// ---------------------------------------------------------------------------
// Schema location + compilation
// ---------------------------------------------------------------------------

// Resolved from THIS module's own real location (src/core/config.mjs), never
// from the project being audited — for a consumer this file lives only under
// node_modules/design-delta/, exactly as v1's
// validate-component-specs.mjs resolves its own package-anchored schema path.
const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..")

// The FULL resolved path, unlike v1's CONFIG_SCHEMA_FILE (a bare filename
// scripts/ci/check-schemas.mjs joins onto schema/ itself) — this module has
// no equivalent CI script relying on the bare name, so the constant is the
// thing every caller here actually wants: a path `readFileSync` can open
// directly, from any cwd.
export const CONFIG_SCHEMA_FILE = join(
  PACKAGE_ROOT,
  "schema",
  "config.schema.json",
)

const CONFIG_SCHEMA = JSON.parse(readFileSync(CONFIG_SCHEMA_FILE, "utf8"))

// `allErrors` so one bad config reports every problem in a single load;
// `verbose` so each ajv error carries `parentSchema`/`params`, which is what
// lets `humanizeError` name the allowed keys/values straight from the schema
// node that rejected the value, with no hand-authored `x-error` annotations
// to keep in sync (v1's approach) — the schema is meant to read as plain
// JSON Schema on its own.
const ajv = new Ajv({ allErrors: true, verbose: true, strict: false })
addFormats(ajv)
const runConfigSchema = ajv.compile(CONFIG_SCHEMA)

const isPlainObject = value =>
  value != null && typeof value === "object" && !Array.isArray(value)

// ---------------------------------------------------------------------------
// ajv error -> the human-readable line loadConfig/validateConfig returns
// ---------------------------------------------------------------------------

// "/paths/tokensFile" -> "paths.tokensFile"; "" -> "" (caller renders the
// root case, since "config" vs "rules" etc. reads better chosen per message).
export function renderPath(instancePath) {
  if (!instancePath) return ""
  return instancePath
    .slice(1)
    .split("/")
    .map(segment => segment.replace(/~1/g, "/").replace(/~0/g, "~"))
    .reduce(
      (acc, segment) =>
        /^\d+$/.test(segment) ? `${acc}[${segment}]` : `${acc}.${segment}`,
      "",
    )
    .replace(/^\./, "")
}

// Sub-errors from inside a FAILING oneOf/anyOf branch describe the branch,
// not the config value itself (ajv emits "must match exactly one schema in
// oneOf" alongside every branch's own rejection) — the oneOf/anyOf keyword's
// own error is the one whose message is worth surfacing.
function isBranchNoise(error) {
  // An `if`/`then` failure reports twice: the `then` keyword's own error
  // (the useful one) and an `if` summary saying `then` failed.
  if (error.keyword === "if") return true
  return /\/(oneOf|anyOf)\/\d+\//.test(error.schemaPath)
}

function humanizeError(error) {
  const path = renderPath(error.instancePath) || "config"

  if (error.keyword === "additionalProperties") {
    const allowed = Object.keys(error.parentSchema?.properties || {})
      .sort()
      .join(", ")
    return `unknown key '${error.params.additionalProperty}' in ${path} — allowed: ${allowed}`
  }

  if (error.keyword === "enum") {
    const allowed = (error.params.allowedValues || []).join(", ")
    return `${path} must be one of: ${allowed}`
  }

  if (error.keyword === "required") {
    // Name the entry, not just its index, when it carries one (an exemption's
    // `entity`) — "[3]" alone sends the reader counting array items.
    const entity =
      typeof error.data?.entity === "string"
        ? ` (entity "${error.data.entity}")`
        : ""
    return `${path}${entity} is missing required property '${error.params.missingProperty}'`
  }

  if (error.keyword === "oneOf") {
    return `${path} ${error.message}`
  }

  return `${path} ${error.message}`
}

/**
 * Turn ajv's raw error array into the aggregated, human-readable list
 * `validateConfig` returns — one line per PROBLEM, not one per ajv keyword,
 * and never raw ajv wording like "must be equal to one of the allowed
 * values" without saying which values.
 *
 * @param {object[]} errors
 * @returns {string[]}
 */
function humanizeErrors(errors) {
  const relevant = (errors || []).filter(error => !isBranchNoise(error))
  const out = []
  const seen = new Set()
  for (const error of relevant) {
    const message = humanizeError(error)
    if (seen.has(message)) continue
    seen.add(message)
    out.push(message)
  }
  return out
}

/**
 * Structurally validate a parsed config object against
 * `schema/config.schema.json`. Every field is OPTIONAL — a missing one is
 * never flagged, so `{}` is always valid — but a field present with the
 * wrong type or shape, or any key the schema does not define at all, fails.
 * Pure; takes an already-parsed object.
 *
 * @param {*} config
 * @returns {{valid: boolean, errors: string[]}}
 */
export function validateConfig(config) {
  // Ahead of the schema, because "the file's root is a JSON object at all" is
  // a statement about the FILE rather than about a field.
  if (!isPlainObject(config))
    return { valid: false, errors: ["config must be a JSON object"] }

  if (runConfigSchema(config)) return { valid: true, errors: [] }
  return { valid: false, errors: humanizeErrors(runConfigSchema.errors) }
}

/**
 * Read + parse + validate a config from disk. LOUD FAIL: a missing file
 * throws a clear "no config at <path>" error (the caller decides whether
 * that's fatal — e.g. `init` treats it as "nothing to migrate", an audit
 * command may treat it as fatal), malformed JSON throws with the parse
 * error, and a schema violation throws with every humanized message joined.
 * There is no silent `{}` fallback for a missing file here — that decision
 * belongs to the caller, not this loader.
 *
 * @param {string} path
 * @param {{fs?: {existsSync: Function, readFileSync: Function}}} [options]
 *   Injectable fs for tests; defaults to `node:fs`.
 * @returns {object} the parsed, validated config
 */
export function loadConfig(path, { fs } = {}) {
  const reader = fs || { existsSync, readFileSync }
  if (!reader.existsSync(path)) throw new Error(`no config at ${path}`)

  let raw
  try {
    raw = reader.readFileSync(path, "utf8")
  } catch (err) {
    throw new Error(`could not read ${path}: ${err.message}`)
  }

  let config
  try {
    config = JSON.parse(raw)
  } catch (err) {
    throw new Error(`invalid JSON in ${path}: ${err.message}`)
  }

  const { valid, errors } = validateConfig(config)
  if (!valid)
    throw new Error(
      `invalid ${path}:\n${errors.map(e => `  - ${e}`).join("\n")}`,
    )

  return config
}

// ---------------------------------------------------------------------------
// Neutral defaults — see the module docblock: nothing consumer-specific.
// ---------------------------------------------------------------------------

// Where a consuming project's config lives when `--config` is not passed:
// `design-delta.json` at the project root, the same place `tsconfig.json` and
// every other tool's config sits.
//
// Declared ONCE here rather than per-command. It was previously a copy in each
// of the four subcommands, justified as "a CLI convention, not a fact about
// the config format" — but four copies of a path string is simply how two of
// them end up disagreeing, and where a config lives IS a fact about the format
// a consumer has to know.
export const DEFAULT_CONFIG_PATH = "design-delta.json"

/**
 * The one config-resolution step every CLI subcommand shares: an explicit
 * `--config` that is missing or invalid is an error; a missing DEFAULT config
 * is simply "no config". Never throws.
 *
 * @param {string|undefined} configPath the `--config` value, if given
 * @returns {{config: object} | {error: string}}
 */
export function resolveRunConfig(configPath) {
  const explicit = configPath !== undefined
  const path = explicit ? configPath : DEFAULT_CONFIG_PATH

  if (!existsSync(path)) {
    if (explicit) return { error: `no config at ${path}` }
    return { config: {} }
  }

  try {
    return { config: loadConfig(path) }
  } catch (err) {
    return { error: err.message }
  }
}

/** @type {{snapshotDir: string, stateFile: string, tokensFile: string, componentsDir: string, contractsDir: string, reportDir: string}} */
export const DEFAULT_PATHS = {
  snapshotDir: ".agents/design-delta/snapshots",
  stateFile: ".agents/design-delta/state.json",
  tokensFile: "tokens.json",
  // Empty means "the parser reads tokensFile directly" — the common case.
  // See the schema for why only the alias pre-scan consults this.
  resolvedTokensFile: "",
  componentsDir: "components",
  // Extra roots to scan for CSS custom-property declarations. EMPTY by
  // default: the engine assumes nothing about where a project emits its
  // generated token stylesheets (see schema/config.schema.json).
  styleRoots: [],
  contractsDir: "contracts",
  reportDir: ".agents/design-delta/reports",
}

/** Which UI framework the audited code is written in (issue #117). One
 * active framework at a time, mirroring ADR-001 D12's one active design
 * provider; `sources/frameworks.mjs` resolves the name to an adapter. */
export const DEFAULT_CODE = { framework: "react" }

/** @type {{stylesSuffix: undefined, codeConnectSuffix: undefined, contractSuffix: string, cssVarPrefix: string, groupedDirs: string[], nonComponentFileSuffixes: undefined, iconFilePrefix: string, designVarNamespaces: object, opacityExtension: undefined, opacityScale: number}} */
export const DEFAULT_CONVENTIONS = {
  // No default: whether/how a project separates component styles into their
  // own file is genuinely project-specific (CSS modules, SCSS modules,
  // styled-components, none at all) — unlike v1's ".module.scss" default.
  //
  // codeConnectSuffix carries the same "no default" treatment, for the same
  // reason: which design-to-code binding convention (if any) a project uses
  // is project-specific, not an engine assumption (ADR-003 Amendment 1).
  contractSuffix: ".contract.json",
  // No project namespace ships by default (v1's "--system-" is exactly the
  // leak ADR-001 calls out) — an empty CSS custom-property sigil only.
  cssVarPrefix: "--",
  // `groupedDirs` and `iconFilePrefix` (below): accepted and validated, but
  // no rule in this engine currently reads either one (issue #275) — kept
  // rather than dropped, since a real consumer has both configured. See each
  // key's own schema description for the same note.
  groupedDirs: [],
  // No default here since issue #117: which suffixes mark a non-component
  // file (stories, tests) depends on the framework's file conventions, so the
  // framework adapter supplies them (sources/react/adapter.mjs) and a project
  // may still override the list wholesale.
  nonComponentFileSuffixes: undefined,
  iconFilePrefix: "icon-",
  designVarNamespaces: {},
  // No default (issue #517): DTCG cannot alias a color and change its alpha,
  // so a project that needs one expresses it as a `$extensions` key on the
  // color leaf holding a reference to an opacity token. WHICH key that is is
  // the project's own vendor-prefixed name, so an engine default would be a
  // consumer-specific name shipped as an assumption. Absent means the engine
  // reads no such extension at all.
  opacityExtension: undefined,
  // The domain of the tokens `opacityExtension` points at: `1` for a DTCG
  // number in 0–1, `100` for a percentage scale. Defaults to the DTCG-shaped
  // one, never to a design tool's.
  opacityScale: 1,
}

/** @type {{collections: object, codeAuthoritativeGroups: string[], unitlessGroups: string[], aliasFoldingRules: {groups: object}}} */
const DEFAULT_TOKEN_MAPPING = {
  collections: {},
  codeAuthoritativeGroups: [],
  // CSS-spec-level knowledge (which properties are dimensionless numbers),
  // not project data — true for any project using these property names.
  unitlessGroups: ["zIndex", "opacity", "order", "lineHeight"],
  aliasFoldingRules: { groups: {} },
}

/** @type {{timeZone: string, actions: object}} */
export const DEFAULT_REPORT = {
  timeZone: "UTC",
  actions: {},
}

// ---------------------------------------------------------------------------
// Resolution — merge user config over defaults, SHALLOW per block: a config
// that sets a block overrides that block's keys one-for-one (spread), but a
// LIST or MAP value within a key replaces the default wholesale rather than
// splicing entry-by-entry — same convention v1's resolvePaths/
// resolveComponentConventions/resolveTokenMapping used. A project overriding
// `conventions.nonComponentFileSuffixes` supplies its whole list; it is not
// appended to the default list.
// ---------------------------------------------------------------------------

/**
 * @param {object} config
 * @returns {typeof DEFAULT_PATHS}
 */
export function resolvePaths(config) {
  return { ...DEFAULT_PATHS, ...((config && config.paths) || {}) }
}

/**
 * @param {object} config
 * @returns {typeof DEFAULT_CONVENTIONS}
 */
export function resolveConventions(config) {
  return { ...DEFAULT_CONVENTIONS, ...((config && config.conventions) || {}) }
}

/**
 * @param {object} config
 * @returns {typeof DEFAULT_CODE}
 */
export function resolveCode(config) {
  return { ...DEFAULT_CODE, ...((config && config.code) || {}) }
}

/**
 * @param {object} config
 * @returns {typeof DEFAULT_TOKEN_MAPPING}
 */
export function resolveTokenMapping(config) {
  return {
    ...DEFAULT_TOKEN_MAPPING,
    ...((config && config.tokenMapping) || {}),
  }
}

/**
 * @param {object} config
 * @returns {typeof DEFAULT_REPORT}
 */
export function resolveReport(config) {
  return { ...DEFAULT_REPORT, ...((config && config.report) || {}) }
}

// No `resolveDesign` — `design.provider` has no default to merge onto (a
// project without one omits the block entirely), and the only reader,
// `providers/index.mjs`'s `loadProvider`, reads `config?.design?.provider`
// off the raw config directly. Adding a resolve* wrapper here with nothing
// consuming its output would be scaffolding ahead of a need (ADR-003
// Amendment 3 defers `design.options` to Phase 5.3, when a provider's
// `configSchema` gives it something real to validate).

// A `rules`/`exemptions` key starting with "_" is a documentary comment
// (schema-tolerated per the module docblock) — never a rule id. Every
// downstream reader (core/rules.mjs's registry resolution) should see a
// block that already excludes them, rather than re-deriving this filter
// itself in more than one place.
function stripCommentKeys(map) {
  return Object.fromEntries(
    Object.entries(map || {}).filter(([key]) => !key.startsWith("_")),
  )
}

/**
 * One-call resolution of every config block a command needs, each
 * defaulted and merged per its own rule above.
 *
 * @param {object} config
 * @returns {{paths: object, conventions: object, report: object, tokenMapping: object, rules: object, lint: object, exemptions: object}}
 */
// The lint block (ADR-001 Phase 3). Absent means SILENT — every field here is
// a project's own vocabulary, and a missing one must make the rule that reads
// it emit nothing rather than fall back to a default set of names (issue
// #121's central invariant).
function resolveLint(config) {
  const lint = (config && config.lint) || {}
  const resolved = {}
  if (lint.rules) resolved.rules = stripCommentKeys(lint.rules)
  // Only an ordered list of at least two tiers describes a direction; a
  // shorter one has no "downward" to check, so it is treated as unconfigured.
  if (Array.isArray(lint.tiers) && lint.tiers.length >= 2)
    resolved.tiers = [...lint.tiers]
  if (Array.isArray(lint.vocabularies) && lint.vocabularies.length > 0)
    resolved.vocabularies = lint.vocabularies.map(entry => ({
      paths: [...(entry?.paths || [])],
      values: [...(entry?.values || [])],
    }))
  if (Array.isArray(lint.rampPaths) && lint.rampPaths.length > 0)
    resolved.rampPaths = [...lint.rampPaths]
  // Contract lint (issue #406): carried only when at least one of its two
  // fields is set, so an empty `contracts: {}` stays silent like everything
  // else here.
  const contracts = lint.contracts || {}
  const enumVocabularies = Array.isArray(contracts.enumVocabularies)
    ? contracts.enumVocabularies.map(entry => ({
        props: [...(entry?.props || [])],
        values: [...(entry?.values || [])].map(String),
      }))
    : []
  if (contracts.nameCase || enumVocabularies.length > 0)
    resolved.contracts = {
      ...(contracts.nameCase ? { nameCase: contracts.nameCase } : {}),
      ...(enumVocabularies.length > 0 ? { enumVocabularies } : {}),
    }
  // Design naming lint (issue #407): pattern strings carried verbatim; the
  // module compiles and reports invalid ones itself.
  const designNames = lint.designNames || {}
  if (
    typeof designNames.variablePattern === "string" ||
    typeof designNames.componentPattern === "string"
  )
    resolved.designNames = {
      ...(typeof designNames.variablePattern === "string"
        ? { variablePattern: designNames.variablePattern }
        : {}),
      ...(typeof designNames.componentPattern === "string"
        ? { componentPattern: designNames.componentPattern }
        : {}),
    }
  return resolved
}

export function resolveConfig(config) {
  return {
    paths: resolvePaths(config),
    conventions: resolveConventions(config),
    report: resolveReport(config),
    tokenMapping: resolveTokenMapping(config),
    rules: stripCommentKeys(config && config.rules),
    lint: resolveLint(config),
    exemptions: stripCommentKeys(config && config.exemptions),
  }
}
