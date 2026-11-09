/**
 * audit.mjs — `design-delta audit` (ADR-001 Phase 1/2/D13, issues
 * #98/#102/#103/#104): runs every implemented contract↔code check end to
 * end.
 *
 *   design-delta audit [--components] [--tokens] [--styles] [--anatomy] [--code-only] [--staged] [--json] [--check] [--config <path>]
 *
 * Four independent surfaces exist so far:
 *   - **components** (Phase 1, #98): load contracts, extract the code-side
 *     prop census via the TypeScript compiler API (`sources/react/extract.mjs`),
 *     and run props/API parity (`modules/components.mjs`).
 *   - **tokens** (Phase 2a, #102): census the project's DTCG `tokens.json`
 *     and the emitted CSS custom properties (`sources/code.mjs`), and run
 *     token parity (`modules/tokens.mjs`).
 *   - **styles** (Phase 2b, #103): census every loaded contract's own
 *     `sources.code.styles` file (`sources/styles.mjs`) and run style parity
 *     (`modules/styles.mjs`) — contract `styles` token bindings vs what the
 *     stylesheet actually declares. Contracts are therefore loaded whenever
 *     ANY of `components`/`styles`/`anatomy` is in scope, since all three
 *     consume them; the TypeScript prop extraction census stays
 *     components-only.
 *   - **anatomy** (Phase 2c, #104): walk every loaded contract's own
 *     `sources.code.path` component's returned JSX (`sources/react/jsx.mjs`, over
 *     the SAME file list `--components` discovers) and run anatomy parity
 *     (`modules/anatomy.mjs`) — the contract's declared element tree vs the
 *     structure the component actually renders. The riskiest checker here by
 *     the issue's own admission, which is why it is its own surface (see
 *     `modules/anatomy.mjs`'s docblock) rather than folded into `components`.
 *
 * `--components`/`--tokens`/`--styles`/`--anatomy` SELECT a surface. Passing
 * none runs ALL FOUR — "everything implemented" — matching the `[--tokens|
 * --components] (default: everything implemented)` convention the ADR
 * describes for `lint` (Phase 4). Passing one or more selects only those
 * surfaces (Phase 1's `--components` was a documented no-op accepted for
 * forward compatibility; now that other surfaces exist, every flag gates
 * real work).
 *
 * `--staged` (issue #220) narrows the run to what is about to be committed, so
 * a pre-commit hook audits the CHANGE rather than the whole codebase. Only the
 * CODE-SIDE censuses are scoped — the component files, their stylesheets, and
 * the CSS-var scan. Everything a changed file is COMPARED AGAINST stays full:
 * the token census, the component-usage
 * census, and the contracts themselves. Narrowing a comparison target would
 * change the answer rather than the scope, and a staged component checked
 * against a staged-only token census would silently pass on tokens that do
 * not exist.
 *
 * Seven rules are skipped outright on a `--staged` run, with a stated reason on
 * the `skipped` channel (`STAGED_SKIPPED_RULES`). Every one of them answers
 * "does anything ELSE in the codebase account for this?" — a question a
 * partial scope cannot answer, only guess at, and every guess it makes is a
 * report of absence it has no evidence for. D8's standard is a surface that
 * skips with a reason, never one that runs degraded.
 *
 *   - `coverage/uncontracted-component` — an unstaged contract reads as a
 *     component nobody has written a contract for.
 *   - `coverage/contract-only` — an unstaged component reads as a contract
 *     pointing at code that does not exist.
 *   - `coverage/stale-exemption` — a waiver whose finding lives outside the
 *     scope reads as a waiver matching nothing.
 *   - `tokens/token-unreferenced` — "no component references this token" is
 *     a codebase-wide claim by construction, and under a staged scope it is
 *     one per token in the project: staging a single component reported all
 *     three of the test fixture's tokens unreferenced, and an empty staged
 *     diff reported EVERY token in the project. `tokens/token-unemitted`,
 *     its other half (issue #562), is skipped for the same reason: a staged
 *     scope scans only the staged files, so every unstaged declaration
 *     would read as never emitted. `tokens/token-untracked` and
 *     `tokens/var-unresolved` are NOT skipped: both are facts about an
 *     occurrence in a scanned file, so scoping the scan scopes them honestly.
 *   - `coverage/design-only` / `coverage/design-missing` (ADR-003 Phase
 *     5.1) — the exact same shape as `uncontracted-component`/`contract-
 *     only`: `designCensus` is never staged-scoped (a git diff never touches
 *     Figma) and neither is the contract list these compare it against, so
 *     staging one component would report every OTHER unmatched design
 *     component as `coverage/design-only` regardless of what changed.
 *   - `tokens/design-value-untracked` (ADR-003 Phase 5.3) — same reasoning
 *     again: `designTokenCensus` is a project-wide value census, never
 *     staged-scoped, so staging one component would still report every
 *     other untracked design value regardless of what changed.
 *
 * `--code-only` skips the design side entirely (ADR-003 Phase 5.1/5.3) — no
 * provider load, no snapshot read, `coverage/design-only`/`coverage/design-
 * missing`/`tokens/design-value-untracked` stay silent even where they
 * would otherwise fire. Accepted as a documented no-op since Phase 1 (D13
 * inverted the phase order so the code-side checkers would not have to wait
 * for a provider); this is its first release with anything real to skip.
 *
 * DESIGN SIDE (ADR-003 Phase 5.1 coverage + Phase 5.2 prop parity, `components`
 * surface; Phase 5.3 value coverage, `tokens` surface; issue #402 layer-tree
 * anatomy, `anatomy` surface): when `design.provider`
 * is configured AND `design-components.json` exists and validates, every
 * loaded contract's `sources.design` is resolved against it via the
 * provider's own `designAddress`/`componentAddress` — this is the ONE place
 * those get called, since `audit.mjs` is allowed to import both `spec/` and
 * `providers/` and `modules/components.mjs` itself never learns a design
 * tool's addressing vocabulary (D12). Every matched design census entry also
 * gets its `props` attached, via the provider's own `componentProps`
 * (Phase 5.2) — the SAME reduction reasoning: `modules/components.mjs` runs
 * its one prop-parity algorithm against whichever side handed it data in the
 * shared `{name, type, values?}` shape, never learning how a design provider
 * derived it. Independently, when `design-tokens.json` exists and validates,
 * its `{name, value}` entries are handed to `modules/tokens.mjs` as
 * `designTokenCensus` — no address resolution needed there (Phase 5.3 matches
 * by VALUE, never by name or address; see that module's docblock). Each
 * snapshot is read only when its OWN surface is in scope (`design-
 * components.json` under `--components` OR `--anatomy`, since #402 gave the
 * anatomy surface a design half reading the same file; `design-tokens.json`
 * only under `--tokens`) — the provider load itself is shared between both.
 * The anatomy half is skipped under `--staged` with a stated reason, for the
 * same reason `coverage/design-only` is: neither the design census nor the
 * contract list is staged-scoped, so it would report every contract's design
 * drift regardless of what changed. It is a SURFACE skip rather than a rule
 * skip because its three rule ids are the code side's too.
 * Absent EITHER a configured provider or a gathered/ingested snapshot is
 * silent, not a diagnostic — the same "surface skips, it doesn't fail the
 * run" convention a missing `tokens.json` follows; a snapshot that exists
 * but fails its own schema degrades the same way, with a stated reason on
 * `diagnostics` (D7).
 *
 * Exit codes (ADR-001 D5, carried over verbatim): `audit` exits 0 UNLESS
 * `--check` is given and an error-severity FINDING exists, across whichever
 * surfaces ran. This is deliberately narrower than "any diagnostic" — a
 * contract that failed to load, or a tokens.json that failed to parse, is
 * surfaced in the output either way, but never itself flips the exit code;
 * `audit` is a read-only report, and `--check` is the one opt-in gate.
 *
 * Two stream invariants (D8), matching `contracts.mjs`:
 *   - progress goes to stderr, via the injected bus, never to stdout.
 *   - `--json` writes ONE JSON document to stdout and nothing else.
 *
 * This handler is `async`: the tokens surface's `censusTokens` parses the
 * project's tokens.json via `@terrazzo/parser`, which is asynchronous
 * (`sources/code.mjs`) — `cli/main.mjs`'s `run` already accepts a
 * Promise-returning handler (Phase 5's provider gather was always going to
 * need this), so this is not a new capability, only the first user of it.
 */

import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

import { compareVersions } from "../../core/version.mjs"

import {
  applyExemptions,
  registry as exemptionsRegistry,
} from "../../core/exemptions.mjs"
import {
  isDisabled,
  resolveRuleConfig,
  validateExemptionRuleIds,
  validateRuleIds,
} from "../../core/rules.mjs"
import {
  dedupeDiagnostics,
  hasError,
  sortFindings,
} from "../../core/findings.mjs"
import {
  DEFAULT_CONFIG_PATH,
  resolveConfig,
  resolvePaths,
  resolveRunConfig,
} from "../../core/config.mjs"
import {
  renderFindingsHuman,
  renderSeveritySummary,
  renderDecisionsHuman,
} from "../../core/report.mjs"
import { readState } from "../../core/state.mjs"
import { markIsNew } from "../is-new.mjs"
import { contractApiView, loadContracts } from "../../spec/contracts.mjs"
import { loadProvider } from "../../providers/index.mjs"
import { readDesignSnapshot } from "../design-snapshot.mjs"
import { resolveFramework } from "../../sources/frameworks.mjs"
import {
  censusComponentUsage,
  censusCssVars,
  censusTokens,
} from "../../sources/code.mjs"
import { censusStyles } from "../../sources/styles.mjs"
import { buildFullRuleRegistry } from "../rule-registry.mjs"
import {
  RULES as componentRules,
  registry as componentRegistry,
  runComponentsCheck,
  runBindingFilesCheck,
} from "../../modules/components.mjs"
import {
  RULES as tokenRules,
  registry as tokenRegistry,
  runTokensCheck,
} from "../../modules/tokens.mjs"
import {
  RULES as styleRules,
  registry as styleRegistry,
  runStylesCheck,
  runDesignBindingsCheck,
} from "../../modules/styles.mjs"
import {
  RULES as anatomyRules,
  registry as anatomyRegistry,
  runAnatomyCheck,
  runDesignAnatomyCheck,
} from "../../modules/anatomy.mjs"
import { parseFlags } from "../flags.mjs"
import { stagedFileScope } from "../staged.mjs"

const FLAG_SPEC = {
  boolean: [
    "--components",
    "--tokens",
    "--styles",
    "--anatomy",
    "--code-only",
    "--staged",
    "--json",
    "--check",
  ],
  value: [],
}

// The rules a `--staged` run does not evaluate at all, and the reason it
// reports for each. See the module docblock — every one of them answers a
// question about the WHOLE codebase, which a staged scope cannot see.
const STAGED_SKIPPED_RULES = [
  "coverage/uncontracted-component",
  "coverage/contract-only",
  "coverage/stale-exemption",
  "tokens/token-unreferenced",
  "tokens/token-unemitted",
  "coverage/design-only",
  "coverage/design-missing",
  "tokens/design-value-untracked",
]
const STAGED_SKIP_REASON =
  "requires full-codebase visibility, incompatible with --staged"

// None of `--components`/`--tokens`/`--styles`/`--anatomy` given -> run all
// four ("everything implemented"); one or more given -> run only those.
function resolveScopes(opts) {
  const explicitComponents = opts.components === true
  const explicitTokens = opts.tokens === true
  const explicitStyles = opts.styles === true
  const explicitAnatomy = opts.anatomy === true
  const noneExplicit =
    !explicitComponents &&
    !explicitTokens &&
    !explicitStyles &&
    !explicitAnatomy
  return {
    components: noneExplicit || explicitComponents,
    tokens: noneExplicit || explicitTokens,
    styles: noneExplicit || explicitStyles,
    anatomy: noneExplicit || explicitAnatomy,
  }
}

// `readDesignSnapshot` lives in `../design-snapshot.mjs` since issue #481 —
// `snapshot` reads the design census too, and importing it from here would
// cycle (audit → is-new → snapshot → audit). Re-exported for `lint.mjs`.
export { readDesignSnapshot } from "../design-snapshot.mjs"

// Total declaration count across a `censusStyles(...)` result — every
// property set on every selector in every censused file. The unit
// `counts.styleDeclarations` reports (see the styles surface below).
function countDeclarations(census) {
  return (census?.files || []).reduce(
    (sum, file) =>
      sum +
      file.selectors.reduce(
        (fileSum, selector) => fileSum + selector.declarations.length,
        0,
      ),
    0,
  )
}

function renderDiagnostic(diagnostic) {
  const where = diagnostic.file ? `${diagnostic.file}: ` : ""
  return `  ${where}[${diagnostic.code}] ${diagnostic.message}`
}

function renderHuman(result, { componentsDirLabel, tokensFileLabel }) {
  const lines = []
  const headerParts = []
  if (result.counts.components !== undefined) {
    headerParts.push(
      `${result.counts.contracts} contract(s), ${result.counts.components} component(s) under ${componentsDirLabel}`,
    )
  } else if (result.counts.contracts !== undefined) {
    // `--styles` alone loads contracts (it needs them) without running the
    // components surface's own TypeScript extraction — no `components`
    // count to report alongside, unlike the branch above.
    headerParts.push(`${result.counts.contracts} contract(s)`)
  }
  if (result.counts.tokens !== undefined) {
    headerParts.push(
      `${result.counts.tokens} token(s), ${result.counts.cssVars} css var(s) from ${tokensFileLabel}`,
    )
  }
  if (result.counts.styleFiles !== undefined) {
    headerParts.push(`${result.counts.styleFiles} style file(s) censused`)
  }
  if (result.counts.anatomyComponents !== undefined) {
    headerParts.push(
      `${result.counts.anatomyComponents} component(s) censused for anatomy`,
    )
  }
  lines.push(`design-delta audit: ${headerParts.join("; ")}`)
  const parity = result.counts.tokenParity
  if (parity) {
    lines.push(
      `  token parity: ${parity.matched} matched, ${parity.mismatched} mismatched, ${parity.ambiguous} ambiguous, ${parity.designOnly} design-only, ${parity.codeOnly} code-only`,
    )
  }
  // Rendered generically rather than one `if` per known key: `--staged`
  // (issue #220) skips by RULE ID, not only by surface, and a hardcoded list
  // would have silently dropped those from human output while the `--json`
  // payload reported them.
  for (const [what, reason] of Object.entries(result.skipped || {})) {
    lines.push(`  ${what} check skipped: ${reason}`)
  }
  lines.push("")
  lines.push(renderFindingsHuman(result.findings))
  lines.push("")
  lines.push(renderSeveritySummary(result.findings))
  const decisions = renderDecisionsHuman(result.decided)
  if (decisions) {
    lines.push("")
    lines.push(decisions)
  }

  if (result.diagnostics.length > 0) {
    lines.push("")
    lines.push(`${result.diagnostics.length} diagnostic(s):`)
    for (const diagnostic of result.diagnostics)
      lines.push(renderDiagnostic(diagnostic))
  }

  return lines.join("\n") + "\n"
}

function renderJson(result) {
  return JSON.stringify(result, null, 2) + "\n"
}

/**
 * Run the subcommand. Returns the exit code (or a Promise of one — see the
 * module docblock); never calls `process.exit`, so tests drive it in-process
 * exactly as they drive `main.mjs`'s `run`.
 *
 * @param {string[]} cmdArgv this subcommand's own argv (globals already removed)
 * @param {{globalOpts: object, io: {stdout: object, stderr: object}, bus: object}} ctx
 * @returns {Promise<number>}
 */
export async function runAudit(cmdArgv, ctx) {
  const { io, globalOpts = {}, bus } = ctx
  const { opts, errors } = parseFlags(cmdArgv, FLAG_SPEC)

  if (errors.length > 0) {
    for (const error of errors)
      io.stderr.write(`design-delta audit: ${error}\n`)
    return 1
  }

  const { config, error } = resolveRunConfig(globalOpts.config)
  if (error) {
    io.stderr.write(`design-delta audit: ${error}\n`)
    return 1
  }

  // A typo'd rule id in `rules` or `exemptions` must never silently do
  // nothing (issue #188) — checked against every rule in the engine, not
  // only the surfaces THIS run selects, since one config drives every
  // command. Fatal, before any surface runs: partial output from a run that
  // already knows its config can't mean what it says is worse than none.
  //
  // Validated against the RESOLVED config, never the raw one — `resolveConfig`
  // strips `^_`-prefixed documentary comment keys from both blocks, and
  // validating the raw form would report a project's own `_doc` key as an
  // unknown rule id. Computed once, here, and reused below (see
  // `resolvedConfig`) rather than a second time closer to where exemptions
  // are applied.
  const resolvedConfig = resolveConfig(config)
  const fullRuleRegistry = buildFullRuleRegistry()
  const ruleIdErrors = [
    ...validateRuleIds(resolvedConfig.rules, fullRuleRegistry),
    ...validateExemptionRuleIds(resolvedConfig.exemptions, fullRuleRegistry),
  ]
  if (ruleIdErrors.length > 0) {
    for (const message of ruleIdErrors)
      io.stderr.write(`design-delta audit: ${message}\n`)
    return 1
  }

  const root = process.cwd()
  const scopes = resolveScopes(opts)

  // `--staged` — see the module docblock. A `null` scope means "everything",
  // so every call site below reads the same `inScope` predicate whether the
  // flag was given or not.
  let stagedScope = null
  if (opts.staged) {
    const resolved = stagedFileScope(root)
    if (resolved.error) {
      io.stderr.write(`design-delta audit: ${resolved.error}\n`)
      return 1
    }
    stagedScope = resolved
  }
  const inScope = path => !stagedScope || stagedScope.includes(path)
  const stagedSkipped = new Set(stagedScope ? STAGED_SKIPPED_RULES : [])

  const {
    componentsDir: componentsDirLabel,
    tokensFile: tokensFileLabel,
    stateFile,
    snapshotDir,
  } = resolvePaths(config)
  // Which framework the code is in — the only place audit names one, and it
  // names it by reading config, never by import (issue #117).
  const framework = resolveFramework(config)

  // -------------------------------------------------------------------
  // Contracts — the shared input for the components, styles, and anatomy
  // surfaces (styles needs the same loaded set components does, #103; so
  // does anatomy, #104).
  // -------------------------------------------------------------------
  const needsContracts = scopes.components || scopes.styles || scopes.anatomy
  let contractsResult = { contracts: [], diagnostics: [] }
  if (needsContracts) {
    contractsResult = loadContracts(config, { root, onProgress: bus })
  }

  // Both the components and anatomy surfaces walk the SAME `.tsx` files
  // under `paths.componentsDir` — discovered once here rather than twice.
  const needsComponentFiles = scopes.components || scopes.anatomy
  const componentFiles = needsComponentFiles
    ? framework.findComponentFiles(config, { root }).files.filter(inScope)
    : []

  // -------------------------------------------------------------------
  // Design side (ADR-003 Phase 5.1 components + Phase 5.3 tokens) — feeds
  // the components and tokens surfaces below. Silent (never a diagnostic)
  // ONLY when NOTHING was configured to look at: `--code-only`, or no
  // `design.provider` set at all — the same "never looked" case a project
  // with no `tokens.json` reports as silent. Everything past that point is
  // "looked and it was broken," which gets a diagnostic, not silence:
  // `design.provider` naming an unknown provider (a real config error,
  // previously swallowed — an unrecognized key made `gather`/`ingest` fail
  // loudly but let `audit` report a clean components surface), or a
  // snapshot that EXISTS but fails its own schema (D7: invalid degrades
  // like missing, but is not the same silence as never having looked). The
  // provider load itself is shared between the two surfaces (one config,
  // one provider); each surface's own snapshot is read and reasoned about
  // independently, since `design-components.json` and `design-tokens.json`
  // are two separate D7 files that can independently be missing/invalid.
  // -------------------------------------------------------------------
  let designProvider = null
  let designReason
  const configuredProviderName =
    typeof config?.design?.provider === "string" &&
    config.design.provider.length > 0
      ? config.design.provider
      : null
  // `design-components.json` feeds the components surface AND, since issue
  // #402, the anatomy one — an `audit --anatomy` alone must still reach it.
  const needsDesignComponents = scopes.components || scopes.anatomy
  if ((needsDesignComponents || scopes.tokens) && !opts.codeOnly) {
    if (configuredProviderName) {
      const loaded = await loadProvider(config)
      if (loaded.ok) designProvider = loaded.provider
      else designReason = loaded.reason
    }
  }

  // ADR-003 Amendment 3: the provider validates its own `design.options`.
  // Invalid options are a diagnostic, never a crash and never silently
  // applied — the design-side token rules run as if the block were absent,
  // so a typo'd key cannot quietly turn a mapping off.
  let designOptionsReason = null
  let tokensConfig = config
  if (
    designProvider?.validateDesignOptions &&
    config?.design?.options !== undefined
  ) {
    const checked = designProvider.validateDesignOptions(config.design.options)
    if (!checked.valid) {
      designOptionsReason = `design.options rejected by the "${designProvider.name}" provider: ${checked.errors.join("; ")}`
      tokensConfig = {
        ...config,
        design: { ...config.design, options: undefined },
      }
    }
  }

  let designSnapshotResult = { present: false, snapshot: null }
  if (needsDesignComponents && designProvider) {
    designSnapshotResult = readDesignSnapshot(
      join(root, snapshotDir, "design-components.json"),
      designProvider.validateDesignComponents,
    )
    designReason = designReason || designSnapshotResult.reason
  }
  // The provider's private components (issue #460) are censused — a
  // contract may still address one, and prop parity still runs — but flagged
  // so `coverage/design-only` skips them: the tool itself keeps them out of
  // the published library, so no contract is missing. One diagnostic states
  // the count, and `design.options.includePrivateComponents` counts them.
  const countPrivate =
    typeof designProvider?.isPrivateComponent === "function" &&
    config?.design?.options?.includePrivateComponents !== true
  let designPrivateCount = 0
  const designCensus =
    designProvider && designSnapshotResult.snapshot
      ? {
          entries: designSnapshotResult.snapshot.components.map(component => ({
            matchKey: designProvider.componentAddress(component),
            name: component.name,
            ...(countPrivate && designProvider.isPrivateComponent(component)
              ? (designPrivateCount++, { private: true })
              : {}),
            // What kind of census unit it is (issue #658) — the design side
            // of the anatomy surface reads it to compare a variant set's
            // `root` children inside a variant rather than among the
            // variants. The provider's call, so no vendor type reaches here.
            ...(typeof designProvider.censusUnit === "function" &&
            designProvider.censusUnit(component)
              ? { unit: designProvider.censusUnit(component) }
              : {}),
            // The bindings gather's merge (issue #401) — carried so the
            // design-bindings check reads it; absent on a snapshot from
            // before the gather, which that check treats as "not gathered".
            ...(Array.isArray(component.usedVars)
              ? { usedVars: component.usedVars }
              : {}),
            // The same gather's other census (issue #402) — the component's
            // layer tree, for the design side of the anatomy surface. Absent
            // on a snapshot from before it, which that check reads as "not
            // gathered" and never as "carries no layers".
            ...(component.layers ? { layers: component.layers } : {}),
            // The same gather's other field (issue #403) — which variant
            // combinations the set actually publishes, carried on the same
            // absent-means-not-gathered terms.
            ...(Array.isArray(component.variantCombinations)
              ? { variantCombinations: component.variantCombinations }
              : {}),
            // ADR-003 Phase 5.2: reduced HERE, not inside `modules/
            // components.mjs` (which never learns a provider's raw prop
            // vocabulary, D12), into the same `{name, type, values?}` shape
            // a code component's `props` already carries.
            props: designProvider.componentProps(component),
          })),
        }
      : undefined

  // `designMatchKey` is attached HERE, once, not inside any module (none of
  // which learns `sources.design`'s shape, D12) — `designAddress` is the
  // provider's own interpretation of the contract's opaque address, and all
  // three surfaces that compare against the design side read the same
  // resolved list.
  const contractsWithDesignKeys = designProvider
    ? contractsResult.contracts.map(entry => ({
        ...entry,
        designMatchKey: designProvider.designAddress(
          entry.contract?.sources?.design,
        ),
      }))
    : contractsResult.contracts

  let designTokenSnapshotResult = { present: false, snapshot: null }
  let designTokensReason
  if (scopes.tokens && designProvider) {
    designTokenSnapshotResult = readDesignSnapshot(
      join(root, snapshotDir, "design-tokens.json"),
      designProvider.validateDesignTokens,
    )
    designTokensReason = designTokenSnapshotResult.reason
  }
  // A snapshot normalized by an engine older than the provider's
  // `normalizationSince` for that snapshot (issue #458): its stored values
  // may not be the form today's rules read, and nothing but a re-ingest can
  // change that — so it is a diagnostic, stated on the basis line too, never
  // a silent wrong comparison. With no `engineVersion` recorded (nothing
  // before 0.19.0 stamped one) the provider's `staleShape` reads the stored
  // values instead; a provider that cannot tell stays silent rather than
  // guess — a false "stale" on a fresh census is the worse error.
  const staleNormalization = (snapshot, kind, flag) => {
    const since = designProvider?.normalizationSince?.[kind]
    if (!snapshot || typeof since?.version !== "string") return null
    const ingested = snapshot.provenance?.engineVersion
    const stale =
      typeof ingested === "string"
        ? compareVersions(ingested, since.version) < 0
        : typeof since.staleShape === "function" && since.staleShape(snapshot)
    if (!stale) return null
    return `design-${kind}.json was normalized by design-delta ${
      typeof ingested === "string"
        ? ingested
        : "older than 0.19.0 (no engineVersion recorded, and its stored values are in the earlier form)"
    }, and this provider's ${kind} normalization changed in ${since.version} — its stored values may not compare the way today's rules expect; re-run \`gather${flag}\` then \`ingest${flag}\` to refresh it`
  }
  const designComponentsStale = staleNormalization(
    designSnapshotResult.snapshot,
    "components",
    "",
  )
  const designTokensStale = staleNormalization(
    designTokenSnapshotResult.snapshot,
    "tokens",
    " --tokens",
  )
  const designTokenCensus =
    designProvider && designTokenSnapshotResult.snapshot
      ? {
          // The whole record, not `{name, value}`: a structured gather
          // (issue #380) carries `kind`, typed `values`, and a text style's
          // `style`, and the field-level compare reads them.
          entries: designTokenSnapshotResult.snapshot.tokens.map(token => ({
            ...token,
          })),
        }
      : undefined

  // -------------------------------------------------------------------
  // Components surface (Phase 1, #98).
  // -------------------------------------------------------------------
  let census = { ok: true, components: [], diagnostics: [], skipped: false }
  let componentFindings = []

  if (scopes.components) {
    census = framework.extractComponents(componentFiles, {
      root,
      onProgress: bus,
    })
    const usageCensus = censusComponentUsage(config, { root, onProgress: bus })

    // A missing `typescript` install means NOTHING in the census could
    // extract — skip the whole check with one stated reason rather than
    // running it against an empty census and reporting every contract as
    // `coverage/contract-only`, which would be true in form but misleading in
    // substance (the components are not actually missing from code).
    componentFindings = census.skipped
      ? []
      : runComponentsCheck(
          contractsWithDesignKeys,
          census,
          config,
          usageCensus,
          designCensus,
        )

    if (census.skipped) {
      bus?.skip?.("components-check", census.diagnostics[0]?.message)
    }
  }

  // Binding files (issue #400) — the read-only successor to the deleted
  // `codegen` command: a missing or stale design-to-code binding file is
  // drift and is reported as a finding, through the provider that owns the
  // binding vocabulary. Applicability is the provider's call (no
  // sources.code.path or no configured suffix → silently not applicable,
  // the same opt-in posture as every convention-gated surface).
  if (scopes.components && designProvider?.bindingPath) {
    // The census knows how a component is exported; the render's import
    // has to match it (issue #453). Keyed the way `runComponentsCheck` keys
    // it: by the contract's `sources.code.path`.
    const componentsByFile = new Map(
      (census.components || []).map(component => [component.file, component]),
    )
    const bindingEntries = []
    for (const { id, contract } of contractsResult.contracts) {
      const bindingFile = designProvider.bindingPath(contract, config)
      if (!bindingFile) continue
      const committedPath = join(root, bindingFile)
      const committed = existsSync(committedPath)
        ? readFileSync(committedPath, "utf8")
        : null
      const component = componentsByFile.get(contract?.sources?.code?.path)
      const status = designProvider.bindingStatus(
        contract,
        config,
        contractApiView(contract),
        committed,
        { namedExport: component?.namedExport === true },
      )
      if (status.applicable && status.status !== "match")
        bindingEntries.push({
          id,
          // The provider's own render, carried through rather than re-derived
          // here (issue #579): what the finding shows a consumer has to be the
          // text the comparison was made against, and only the provider knows
          // how to produce it.
          expected: status.expected,
          outputPath: status.outputPath,
          status: status.status,
          // Why the provider could not trust its own comparison (issue #588),
          // in its words — this layer has none for it.
          ceiling: status.ceiling,
        })
    }
    componentFindings = componentFindings.concat(
      runBindingFilesCheck(bindingEntries, config),
    )
  }

  // -------------------------------------------------------------------
  // Tokens surface (Phase 2a, #102).
  // -------------------------------------------------------------------
  let tokenCensus = { ok: true, tokens: [], diagnostics: [] }
  let cssVarCensus = { ok: true, vars: [], diagnostics: [] }
  let tokenFindings = []
  // `tokenParity` lands here when the design token census ran.
  const tokensReport = {}

  if (scopes.tokens) {
    tokenCensus = await censusTokens(config, { root, onProgress: bus })
    cssVarCensus = censusCssVars(config, {
      root,
      onProgress: bus,
      include: inScope,
    })

    // A tokens.json that failed to load/parse leaves no contract to compare
    // against — skip the check with one stated reason rather than running it
    // against an empty token list, which would misreport every emitted var
    // as untracked (the same "surface skips, it doesn't fail the run"
    // principle as the components surface above).
    tokenFindings = tokenCensus.ok
      ? runTokensCheck(
          tokenCensus,
          cssVarCensus,
          tokensConfig,
          designTokenCensus,
          tokensReport,
        )
      : []

    if (!tokenCensus.ok) {
      bus?.skip?.("tokens-check", tokenCensus.diagnostics[0]?.message)
    }
  }

  // -------------------------------------------------------------------
  // Styles surface (Phase 2b, #103).
  // -------------------------------------------------------------------
  let styleCensus = { ok: true, files: [], diagnostics: [] }
  let styleFindings = []
  let designBindingsSkipped = null
  // Total CSS declarations censused across the contracted style files. This
  // is the "style bindings" denominator issue #219's health score normalizes
  // `styles/raw-value` findings against: how many declarations this run
  // actually looked at, not how many FILES.
  let styleDeclarationsCount = 0

  if (scopes.styles) {
    // Every loaded contract's own declared style file, deduplicated — a
    // contract with no `sources.code.styles` at all contributes nothing
    // (`modules/styles.mjs` skips it silently too, same reasoning as a
    // contract with no `sources.code.path` in the components surface).
    const stylePaths = [
      ...new Set(
        contractsResult.contracts
          .map(({ contract }) => contract?.sources?.code?.styles)
          .filter(Boolean),
      ),
    ]
    styleCensus = censusStyles(stylePaths.filter(inScope), {
      root,
      onProgress: bus,
    })
    styleFindings = runStylesCheck(
      contractsResult.contracts,
      styleCensus,
      config,
    )

    // Design-side bindings (issue #401): needs the design component census
    // (for `usedVars`), the token census (as the candidate match set), and
    // a provider to resolve addresses — so it needs the tokens surface and
    // the design side both in scope.
    if (
      scopes.tokens &&
      tokenCensus.ok &&
      designProvider &&
      designSnapshotResult.snapshot
    ) {
      const designBindings = runDesignBindingsCheck(
        contractsWithDesignKeys,
        designCensus,
        tokenCensus,
        tokensConfig,
        designProvider,
      )
      styleFindings = styleFindings.concat(designBindings.findings)
      // What the comparison could not reach (issue #492) — reported, never
      // silent, so a clean bindings result is readable: the count, and the
      // first reason, on the same `skipped` channel every other surface's
      // "we could not look" lands on.
      if (designBindings.skipped.length > 0) {
        designBindingsSkipped = `${designBindings.skipped.length} declared binding(s) not compared — e.g. ${designBindings.skipped[0].reason}`
        bus?.skip?.("design-bindings", designBindingsSkipped)
      }
    }
    styleDeclarationsCount = countDeclarations(styleCensus)
  }

  // -------------------------------------------------------------------
  // Anatomy surface (Phase 2c, #104).
  // -------------------------------------------------------------------
  let jsxCensus = { ok: true, skipped: false, components: [], diagnostics: [] }
  let anatomyFindings = []
  // The design half of the surface (issue #402) — independent of the code
  // half, including of its skip: a missing `typescript` install says nothing
  // about whether the contract matches the design component. When it does not
  // compare anything, it says so on the `skipped` channel rather than passing
  // silently — an empty design half and a clean one are not the same result.
  let designAnatomyReason

  if (scopes.anatomy) {
    jsxCensus = framework.extractJsxComponents(componentFiles, {
      root,
      onProgress: bus,
    })

    // Same "surface skips, it doesn't fail the run" principle as the
    // components surface: a missing `typescript` install means nothing in
    // the jsx census could resolve, so nothing here is comparable.
    anatomyFindings = jsxCensus.skipped
      ? []
      : runAnatomyCheck(contractsResult.contracts, jsxCensus, config)

    if (jsxCensus.skipped) {
      bus?.skip?.("anatomy-check", jsxCensus.diagnostics[0]?.message)
    }

    // Contract ↔ design component (issue #402): the same three structural
    // rules, `side: "design"`, against the layer tree `ingest --bindings`
    // merged onto the design census. NOT under `--staged`: neither the
    // design census nor the contract list is staged-scoped (a git diff never
    // touches a design file), so a staged run would report every contract's
    // design drift regardless of what changed — the same reasoning that
    // skips `coverage/design-only` there. It is a SURFACE skip with a stated
    // reason rather than a rule skip, because these three rule ids are the
    // code side's too and skipping them by id would silence it as well.
    if (designProvider && designSnapshotResult.snapshot) {
      if (stagedScope) {
        designAnatomyReason = STAGED_SKIP_REASON
      } else {
        anatomyFindings = anatomyFindings.concat(
          runDesignAnatomyCheck(contractsWithDesignKeys, designCensus, config),
        )
        // The layer tree rides on the bindings gather, which a project may
        // simply never have run — the check itself stays silent on absent
        // data (that is its contract), so the fact that there WAS no data is
        // reported here instead of leaving a silent pass looking like a
        // clean one.
        if (!designCensus.entries.some(entry => entry.layers))
          designAnatomyReason =
            "no component in `design-components.json` carries a layer tree — run `design-delta gather --bindings` then `design-delta ingest --bindings <raw-file...>` to compare the design side of `anatomy/*`"
      }
    }
  }

  // Exemptions are applied HERE, after every surface has reported and before
  // anything is rendered or counted — one place, so a waiver cannot silence a
  // finding on one surface and miss it on another (issue #181). The stale
  // report it can append is a finding about the project's own config, so it
  // joins the same list rather than hiding in diagnostics.
  // Which rules this run actually EVALUATED. A surface that was scoped out
  // (`audit --tokens`) or skipped (no `typescript` installed) reports nothing,
  // so an exemption on one of its rules has no evidence either way — calling
  // it stale would be true in form and misleading in substance, the same trap
  // the skip paths above already guard against twice.
  //
  // A rule turned `"off"` is the same case: every module returns early on a
  // resolved severity of `"off"`, so a disabled rule reports nothing no matter
  // what the code looks like. It sits directly on the migration path — a
  // consumer moving `rules: {"x": "off"}` onto `exemptions` has both set at
  // once — and without this filter every one of those entries reads as stale.
  // `resolvedConfig` is the same value validated above — every module reads
  // it when it decides a severity.
  const evaluatedRuleIds = new Set()
  const collectRules = (ran, moduleRules, moduleRegistry) => {
    if (!ran) return
    for (const rule of moduleRules) {
      // A rule `--staged` skipped never ran, so an exemption on it has no
      // evidence either way — the same reasoning as the scoped-out and
      // `"off"` cases above.
      if (stagedSkipped.has(rule.id)) continue
      if (isDisabled(rule.id, resolvedConfig.rules, moduleRegistry)) continue
      evaluatedRuleIds.add(rule.id)
    }
  }
  collectRules(
    scopes.components && !census.skipped,
    componentRules,
    componentRegistry,
  )
  collectRules(scopes.tokens && tokenCensus.ok, tokenRules, tokenRegistry)
  collectRules(scopes.styles, styleRules, styleRegistry)
  collectRules(
    scopes.anatomy && !jsxCensus.skipped,
    anatomyRules,
    anatomyRegistry,
  )

  const {
    findings: afterExemptions,
    exempted,
    decided,
  } = applyExemptions(
    [
      ...componentFindings,
      ...tokenFindings,
      ...styleFindings,
      ...anatomyFindings,
    ].filter(finding => !stagedSkipped.has(finding.ruleId)),
    resolvedConfig.exemptions,
    {
      // `"off"` for a `--staged`-skipped rule is how
      // `coverage/stale-exemption` is suppressed — `applyExemptions` still
      // applies every waiver, it just does not report what matched nothing
      // (its own documented contract for this return value).
      severityOf: ruleId =>
        stagedSkipped.has(ruleId)
          ? "off"
          : resolveRuleConfig(ruleId, resolvedConfig.rules, exemptionsRegistry)
              .severity,
      wasEvaluated: ruleId => evaluatedRuleIds.has(ruleId),
    },
  )
  const sortedFindings = sortFindings(afterExemptions)

  // `isNew` (issue #243) — read-only against `state.json` if present. An
  // absent or unreadable state file changes nothing about the run: every
  // finding stays exactly as `sortedFindings` built it, unmarked.
  const stateResult = readState(join(root, stateFile), stateFile)
  const findings = markIsNew(
    sortedFindings,
    stateResult.state,
    contractsResult.contracts,
    { root, config },
  )

  const skipped = {
    ...(scopes.components && census.skipped
      ? { components: census.diagnostics[0]?.message }
      : {}),
    ...(scopes.tokens && !tokenCensus.ok
      ? { tokens: tokenCensus.diagnostics[0]?.message }
      : {}),
    ...(scopes.anatomy && jsxCensus.skipped
      ? { anatomy: jsxCensus.diagnostics[0]?.message }
      : {}),
    ...(designReason ? { design: designReason } : {}),
    ...(designBindingsSkipped ? { designBindings: designBindingsSkipped } : {}),
    ...(designTokensReason ? { designTokens: designTokensReason } : {}),
    ...(designAnatomyReason ? { designAnatomy: designAnatomyReason } : {}),
    ...Object.fromEntries(
      [...stagedSkipped].map(ruleId => [ruleId, STAGED_SKIP_REASON]),
    ),
  }

  const result = {
    command: "audit",
    componentsDir: componentsDirLabel,
    tokensFile: tokensFileLabel,
    // The design side's BASIS (issue #389): present whenever a design
    // provider is configured; each snapshot's own `provenance` (or `null`
    // when that snapshot is absent/invalid, `{}` when it predates
    // provenance). `report` renders it unconditionally, so a stale
    // committed snapshot can never read as fresh by omission.
    // A configured provider the run did NOT read is a stated fact of its
    // own — never "no design provider configured". Two ways that happens:
    // the run's scope never reached the design side (`--code-only`, or a
    // scope with neither components nor tokens), or the provider failed to
    // load (the `design-provider-invalid` diagnostic says the same thing;
    // the basis line must agree with it, not contradict it).
    ...(!designProvider && configuredProviderName
      ? {
          provenance: designReason
            ? { unavailable: designReason }
            : {
                notConsulted: opts.codeOnly
                  ? "--code-only"
                  : "the run's scope includes neither components nor tokens",
              },
        }
      : {}),
    ...(designProvider
      ? {
          provenance: {
            ...(scopes.components
              ? {
                  designComponents: designSnapshotResult.snapshot
                    ? {
                        ...(designSnapshotResult.snapshot.provenance || {}),
                        ...(designComponentsStale
                          ? { normalizationStale: designComponentsStale }
                          : {}),
                      }
                    : null,
                }
              : {}),
            ...(scopes.tokens
              ? {
                  designTokens: designTokenSnapshotResult.snapshot
                    ? {
                        ...(designTokenSnapshotResult.snapshot.provenance ||
                          {}),
                        ...(designTokensStale
                          ? { normalizationStale: designTokensStale }
                          : {}),
                      }
                    : null,
                }
              : {}),
          },
        }
      : {}),
    counts: {
      ...(needsContracts
        ? { contracts: contractsResult.contracts.length }
        : {}),
      ...(scopes.components ? { components: census.components.length } : {}),
      ...(scopes.tokens
        ? {
            tokens: tokenCensus.tokens.length,
            cssVars: cssVarCensus.vars.length,
          }
        : {}),
      ...(scopes.styles
        ? {
            styleFiles: styleCensus.files.length,
            styleDeclarations: styleDeclarationsCount,
          }
        : {}),
      ...(scopes.anatomy
        ? { anatomyComponents: jsxCensus.components.length }
        : {}),
      // Present only when the design token census ran — see runTokensCheck.
      ...(tokensReport.tokenParity
        ? { tokenParity: tokensReport.tokenParity }
        : {}),
      findings: findings.length,
      // Reported ALWAYS, not only when nonzero: a run can go from N findings
      // to zero and the number that matters is the one explaining why. An
      // engine whose product is honest output cannot let a waiver silently
      // account for the difference.
      exempted,
    },
    findings,
    // Every exempted finding, still visible, tagged with the decision that
    // covers it. Never gates and never counts toward severity totals.
    decided: sortFindings(decided),
    // Deduplicated because the props and anatomy censuses parse the SAME
    // files independently, so a file that is missing, unloadable, or not a
    // component at all is discovered — correctly — by both, and was reported
    // twice (issue #155). Only byte-identical diagnostics collapse; anything
    // either phase knows that the other does not still survives.
    diagnostics: dedupeDiagnostics([
      ...(needsContracts ? contractsResult.diagnostics : []),
      ...(scopes.components ? census.diagnostics : []),
      ...(scopes.tokens
        ? [...tokenCensus.diagnostics, ...cssVarCensus.diagnostics]
        : []),
      ...(scopes.styles ? styleCensus.diagnostics : []),
      ...(scopes.anatomy ? jsxCensus.diagnostics : []),
      // Two distinct causes share `designReason`, so the diagnostic names
      // which one applies: a config naming an unknown provider (no
      // `designProvider` resolved at all) vs a snapshot that exists but
      // fails its own schema (`designProvider` resolved fine).
      ...(designReason
        ? [
            designProvider
              ? {
                  code: "design-snapshot-invalid",
                  file: join(snapshotDir, "design-components.json"),
                  message: designReason,
                }
              : {
                  code: "design-provider-invalid",
                  file: globalOpts.config || DEFAULT_CONFIG_PATH,
                  message: designReason,
                },
          ]
        : []),
      ...(designOptionsReason
        ? [
            {
              code: "design-options-invalid",
              file: globalOpts.config || DEFAULT_CONFIG_PATH,
              message: designOptionsReason,
            },
          ]
        : []),
      // Always the snapshot-invalid case (never the provider-load case,
      // already covered by `designReason` above) — `designTokensReason` is
      // only ever set once `designProvider` resolved successfully.
      ...(designTokensReason
        ? [
            {
              code: "design-token-snapshot-invalid",
              file: join(snapshotDir, "design-tokens.json"),
              message: designTokensReason,
            },
          ]
        : []),
      ...(scopes.components && designPrivateCount > 0
        ? [
            {
              code: "design-private-components-excluded",
              file: join(snapshotDir, "design-components.json"),
              message: `${designPrivateCount} private design component(s) — a name or path segment starting with "." or "_" — were not reported as coverage/design-only: the design tool keeps them out of the published library, so no contract is missing; set design.options.includePrivateComponents to true to count them`,
            },
          ]
        : []),
      ...(scopes.components && designComponentsStale
        ? [
            {
              code: "design-snapshot-normalization-stale",
              file: join(snapshotDir, "design-components.json"),
              message: designComponentsStale,
            },
          ]
        : []),
      ...(scopes.tokens && designTokensStale
        ? [
            {
              code: "design-token-snapshot-normalization-stale",
              file: join(snapshotDir, "design-tokens.json"),
              message: designTokensStale,
            },
          ]
        : []),
      ...(stateResult.present && !stateResult.state
        ? stateResult.errors.map(message => ({
            code: "state-unreadable",
            file: stateFile,
            message,
          }))
        : []),
    ]),
    ...(Object.keys(skipped).length > 0 ? { skipped } : {}),
  }

  io.stdout.write(
    opts.json
      ? renderJson(result)
      : renderHuman(result, { componentsDirLabel, tokensFileLabel }),
  )

  return opts.check && hasError(findings) ? 1 : 0
}
