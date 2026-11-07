/**
 * index.mjs — the package's public surface.
 *
 * Deliberately narrow (ADR-001 D4): the PURE core, the contract layer, and
 * the PURE domain checkers (`modules/`), and nothing else. v1's barrel
 * re-exported across its whole graph — including its CLIs and its
 * lazily-loaded TypeScript path — so importing the package at all pulled in
 * every engine it shipped. Here, anything that touches the filesystem, the
 * network, or a design tool (`sources/`, `providers/`) and every CLI command
 * stays out of it, so a consumer that only wants to read a contract, resolve
 * a config, or run a checker over data it already has pays for exactly that —
 * never the framework adapter's prop census, and never fs/network access.
 *
 * Stability: what this file exports is the API a consumer may depend on. The
 * `exports` map in `package.json` is the fence: this file (`.`) and
 * `./schema/*` are the only importable paths. Everything else under `src/`
 * ships for the `bin` but is not importable, and may move in any release.
 */

// --- core: the finding model, the rule engine, config, progress -------------

export {
  SEVERITIES,
  CONFIGURABLE_SEVERITIES,
  SEVERITY_RANK,
  SEVERITY_DESCRIPTIONS,
  SURFACES,
  SURFACE_DESCRIPTIONS,
  SIDES,
  makeFinding,
  compareEntities,
  sortFindings,
  groupFindingsByEntity,
  groupFindingsBySurface,
  groupFindingsBySeverityAndRule,
  countBySeverity,
  hasError,
} from "./core/findings.mjs"

export {
  defineRule,
  createRegistry,
  normalizeRuleEntry,
  validateRuleIds,
  resolveRuleConfig,
  resolveAll,
  disabledRuleIds,
  isDisabled,
} from "./core/rules.mjs"

export {
  CONFIG_SCHEMA_FILE,
  DEFAULT_CONFIG_PATH,
  DEFAULT_PATHS,
  DEFAULT_CONVENTIONS,
  DEFAULT_REPORT,
  validateConfig,
  loadConfig,
  resolveConfig,
  resolvePaths,
  resolveConventions,
  resolveReport,
} from "./core/config.mjs"

export {
  RULES as exemptionsRules,
  registry as exemptionsRuleRegistry,
  applyExemptions,
  matchesEntity,
} from "./core/exemptions.mjs"

export {
  createProgress,
  plainRenderer,
  ttyRenderer,
  silentRenderer,
  pickRenderer,
  attachRenderer,
} from "./core/progress.mjs"

// --- spec: the contract layer ----------------------------------------------

export {
  CONTRACT_SCHEMA_FILE,
  CONTRACT_SCHEMA_VERSION,
  loadContract,
  loadContracts,
  contractApiView,
} from "./spec/contracts.mjs"

// --- modules: the domain checkers (ADR-001 D4/D13) --------------------------

export {
  RULES as componentsRules,
  registry as componentsRuleRegistry,
  runComponentsCheck,
} from "./modules/components.mjs"

export {
  RULES as tokensRules,
  registry as tokensRuleRegistry,
  runTokensCheck,
} from "./modules/tokens.mjs"

export {
  RULES as stylesRules,
  registry as stylesRuleRegistry,
  runStylesCheck,
} from "./modules/styles.mjs"

export {
  RULES as anatomyRules,
  registry as anatomyRuleRegistry,
  runAnatomyCheck,
} from "./modules/anatomy.mjs"

export {
  RULES as LINT_RULES,
  registry as lintRegistry,
  runLintCheck,
} from "./modules/lint.mjs"
