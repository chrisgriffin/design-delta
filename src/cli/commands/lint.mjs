/**
 * lint.mjs — the `design-delta lint` subcommand (ADR-001 Phase 3, issue #120).
 *
 *   design-delta lint [--json] [--rule <id>]
 *
 * One surface: tokens. `--rule` takes ONE id and filters by the DELEGATED
 * rule id (`core/valid-color`), which is the id a consumer actually sees in
 * a report — filtering by the engine's own `lint/token-rule` would match
 * everything and be useless.
 *
 * SILENCE IS THE DEFAULT, AND IT IS THE POINT. A project that has configured
 * no `lint.rules` gets zero findings. Not a starter set, not a "recommended"
 * default — nothing. `docs/spikes/lint-rule-mapping.md` measured why: Terrazzo's
 * `core/consistent-naming` alone produces 798 findings on a 657-leaf token
 * file, none of them defects, purely because its default format is kebab-case
 * and the project is camelCase. A lint surface that ships opinions on by
 * default is a lint surface people turn off.
 *
 * NO COMPONENT-STRUCTURE SURFACE, DELIBERATELY (2026-08-06, closing #142 and
 * removing `lint/component-dir-case`). Directory casing, required sibling
 * files, and line budgets are general code hygiene — no relationship to
 * tokens, contracts, or the design tool — and mature tooling already owns
 * them (ESLint's own `max-lines`; a scaffolding generator for file-bundle
 * completeness). design-delta's job is design↔dev parity and design-system
 * governance, not general code quality; this surface stays token-only for
 * that reason, not because component checks are merely unimplemented.
 */

import { join } from "node:path"

import { countBySeverity, sortFindings } from "../../core/findings.mjs"
import { resolveConfig, resolveRunConfig } from "../../core/config.mjs"
import { renderDecisionsHuman } from "../../core/report.mjs"
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
  registry as lintRegistry,
  runLintCheck,
  runTierCheck,
  runVocabularyCheck,
  runRampCheck,
  runTierAliasMissingCheck,
  runUnknownDollarFieldCheck,
  runContractLintCheck,
  compileDesignNamePatterns,
  runDesignNamingCheck,
} from "../../modules/lint.mjs"
import { loadContracts } from "../../spec/contracts.mjs"
import { loadProvider } from "../../providers/index.mjs"
import { readDesignSnapshot } from "./audit.mjs"
import { censusTokenLint, censusTokens } from "../../sources/code.mjs"
import { buildFullRuleRegistry } from "../rule-registry.mjs"
import { parseFlags } from "../flags.mjs"

// `--rule` is SINGLE-VALUED: the shared `parseFlags` has no repeatable-flag
// support, so a second `--rule` would silently overwrite the first. v1's linter
// documented it as repeatable; teaching the shared parser that is a change to
// every command's argument handling and does not belong in this slice, so the
// honest move is to take one value and say so in `--help`.
const FLAG_SPEC = {
  boolean: ["--json"],
  value: ["--rule"],
}

export async function runLint(cmdArgv, ctx) {
  const { io, globalOpts = {}, bus } = ctx
  const { opts, errors } = parseFlags(cmdArgv, FLAG_SPEC)

  if (errors.length > 0) {
    for (const error of errors) io.stderr.write(`design-delta lint: ${error}\n`)
    return 1
  }

  const { config, error } = resolveRunConfig(globalOpts.config)
  if (error) {
    io.stderr.write(`design-delta lint: ${error}\n`)
    return 1
  }

  // ONE accessor for the config, resolved — `resolveConfig` strips the `^_`
  // documentary-comment keys that `rules`/`exemptions` allow, and every module
  // reads the resolved form when it decides a severity. Reading the raw block
  // in one place and the resolved block in another, in the same function, is
  // how the two quietly disagree.
  const resolved = resolveConfig(config)

  // A typo'd rule id in `rules` or `exemptions` must never silently do
  // nothing (issue #188) — checked against every rule in the engine, not
  // only `lint`'s own rules, since one config drives every command. Fatal,
  // before the surface runs.
  const fullRuleRegistry = buildFullRuleRegistry()
  const ruleIdErrors = [
    ...validateRuleIds(resolved.rules, fullRuleRegistry),
    ...validateExemptionRuleIds(resolved.exemptions, fullRuleRegistry),
  ]
  if (ruleIdErrors.length > 0) {
    for (const message of ruleIdErrors)
      io.stderr.write(`design-delta lint: ${message}\n`)
    return 1
  }

  const root = process.cwd()
  const findings = []
  const diagnostics = []

  // This command is the ONE place two censuses read the same tokens file:
  // the delegating lint census and, when a ported rule is configured, the
  // token census. Both parse that document and both judge its aliases, so
  // every DOCUMENT-level diagnostic arrived twice in one report (#352).
  //
  // Identity is the whole diagnostic, field for field: two entries agreeing
  // on every field describe the same fact about the same file, and nothing
  // narrower could be right here (`alias-resolved-after-preprocessing` is
  // keyed by `tokenId`, others carry no id at all). Two genuinely different
  // problems differ somewhere, so they cannot collide.
  const seenDiagnostics = new Set()
  const collectDiagnostics = list => {
    for (const diagnostic of list || []) {
      const key = JSON.stringify(
        Object.entries(diagnostic).sort(([a], [b]) => (a < b ? -1 : 1)),
      )
      if (seenDiagnostics.has(key)) continue
      seenDiagnostics.add(key)
      diagnostics.push(diagnostic)
    }
  }

  // Which lint rules this run actually EVALUATED, recorded AT each gate rather
  // than derived from the findings afterwards — see the exemptions block below
  // for why that distinction is the whole point.
  const evaluatedLintRules = new Set()

  const census = await censusTokenLint(config, {
    root,
    onProgress: bus,
    rules: config?.lint?.rules,
  })
  collectDiagnostics(census.diagnostics)
  findings.push(...runLintCheck(census, config))
  // `delegated`, NOT `ok`: the census returns `ok: true` on its
  // "no configured rules means nothing to delegate" path, where the rule
  // never ran and could not have reported. Gating on `ok` there would make
  // this the one rule whose exemptions go stale for a project that simply
  // has no `lint.rules` block — the same "no evidence" case as a
  // scoped-out surface, and asymmetric with the three gates below, which
  // each require their own config to be present.
  if (census.delegated) evaluatedLintRules.add("lint/token-rule")

  // PORTED rules read the TOKEN census, not the vendor's violations — they
  // are this engine's own checks over the same tokens (issue #121). Loaded
  // only when something is configured for them, so a project that has
  // configured no vocabulary pays nothing and hears nothing. The two opt-in
  // rules (#639) are configured by a `rules` entry naming them, since
  // neither has a `lint.*` block of its own.
  const optedIn = id =>
    resolved.rules?.[id] !== undefined &&
    !isDisabled(id, resolved.rules, lintRegistry)
  const tierAliasMissing =
    config?.lint?.tiers && optedIn("lint/tier-alias-missing")
  const unknownDollarField = optedIn("lint/unknown-dollar-field")
  if (
    config?.lint?.tiers ||
    config?.lint?.vocabularies ||
    config?.lint?.rampPaths ||
    unknownDollarField
  ) {
    const tokenCensus = await censusTokens(config, { root, onProgress: bus })
    collectDiagnostics(tokenCensus.diagnostics)
    if (tokenCensus.ok) {
      if (config?.lint?.tiers) {
        findings.push(...runTierCheck(tokenCensus, config))
        evaluatedLintRules.add("lint/tier-alias-inverted")
      }
      if (config?.lint?.vocabularies) {
        findings.push(...runVocabularyCheck(tokenCensus, config))
        evaluatedLintRules.add("lint/vocabulary-invalid")
      }
      if (config?.lint?.rampPaths) {
        findings.push(...runRampCheck(tokenCensus, config))
        evaluatedLintRules.add("lint/ramp-not-monotonic")
      }
      if (tierAliasMissing) {
        findings.push(...runTierAliasMissingCheck(tokenCensus, config))
        evaluatedLintRules.add("lint/tier-alias-missing")
      }
      if (unknownDollarField) {
        findings.push(...runUnknownDollarFieldCheck(tokenCensus, config))
        evaluatedLintRules.add("lint/unknown-dollar-field")
      }
    }
  }

  // Contract lint (issue #406) reads the CONTRACTS, not the tokens — gated
  // the same way: nothing configured, nothing loaded, nothing said.
  if (config?.lint?.contracts) {
    const loaded = loadContracts(config, { root, onProgress: bus })
    collectDiagnostics(loaded.diagnostics)
    findings.push(...runContractLintCheck(loaded.contracts, config))
    if (config.lint.contracts.nameCase)
      evaluatedLintRules.add("lint/contract-name-case")
    if (config.lint.contracts.enumVocabularies?.length)
      evaluatedLintRules.add("lint/contract-enum-invalid")
  }

  // Design naming lint (issue #407) reads the ingested design snapshots —
  // gated on its config like every ported rule, and honest about what it
  // could not check: a missing/invalid snapshot or pattern is a diagnostic,
  // and the rule only counts as evaluated for the kinds it actually saw.
  if (config?.lint?.designNames) {
    const { patterns, errors: patternErrors } =
      compileDesignNamePatterns(config)
    for (const message of patternErrors)
      collectDiagnostics([{ code: "invalid-config", message }])
    const loadedProvider = await loadProvider(config)
    if (!loadedProvider.ok) {
      collectDiagnostics([
        {
          code: "design-side-unavailable",
          message: `design naming lint skipped: ${loadedProvider.reason}`,
        },
      ])
    } else {
      const provider = loadedProvider.provider
      const { snapshotDir } = resolveConfig(config).paths
      const names = {}
      let evaluatedAnyKind = false
      const readNames = (file, validate, pick, kind) => {
        const result = readDesignSnapshot(
          join(root, snapshotDir, file),
          validate,
        )
        if (result.snapshot) {
          names[kind] = pick(result.snapshot)
          evaluatedAnyKind = true
        } else {
          collectDiagnostics([
            {
              code: "design-side-unavailable",
              message: `design naming lint: ${file} ${result.present ? `is unreadable (${result.reason})` : "is not present"} — design ${kind} names not checked`,
            },
          ])
        }
      }
      if (patterns.variable)
        readNames(
          "design-tokens.json",
          snapshot => provider.validateDesignTokens(snapshot),
          snapshot => snapshot.tokens.map(token => token.name),
          "variables",
        )
      if (patterns.component)
        readNames(
          "design-components.json",
          snapshot => provider.validateDesignComponents(snapshot),
          snapshot => snapshot.components.map(component => component.name),
          "components",
        )
      findings.push(...runDesignNamingCheck(names, config))
      if (evaluatedAnyKind) evaluatedLintRules.add("lint/design-name-invalid")
    }
  }

  const wanted = new Set(
    (Array.isArray(opts.rule)
      ? opts.rule
      : opts.rule
        ? [opts.rule]
        : []
    ).filter(Boolean),
  )
  const filtered =
    wanted.size > 0
      ? findings.filter(f => wanted.has(f.data?.rule) || wanted.has(f.ruleId))
      : findings

  // Exemptions apply here too (issue #181). The schema keys `exemptions` by
  // rule id and the sibling `rules` description cites a `lint/*` id as its
  // example, so a lint waiver that silently did nothing would be the same
  // broken promise this fix exists to close — just one command over.
  //
  // `wasEvaluated` is scoped to the lint rules this run actually ran, for the
  // same reason `audit` scopes its own: a rule that did not run has reported
  // nothing, and calling its exemption stale is a claim without evidence.
  //
  // The set is built AT THE GATES above, never from the findings. Deriving it
  // from output inverts the check exactly where it matters: a rule that ran and
  // came back completely CLEAN emits nothing, so it would be absent from the
  // set and its exemptions would never be stale-checked at all — the
  // fully-rotted waiver list is the case this feature exists for.
  //
  // Two more ways a rule reports nothing without being clean, both filtered
  // here rather than at the gates, because both are properties of the config
  // rather than of the run:
  for (const id of [...evaluatedLintRules]) {
    // Turned `"off"` — every check in `modules/lint.mjs` returns early on a
    // resolved severity of `"off"`, so the rule produced nothing regardless of
    // the code. Same "no evidence" case as a surface that was scoped out.
    if (isDisabled(id, resolved.rules, lintRegistry))
      evaluatedLintRules.delete(id)
  }
  if (wanted.size > 0) {
    // `--rule` narrows the OUTPUT, so any rule whose findings could have been
    // filtered away has no evidence behind it either. Only a rule the user
    // named explicitly still counts — narrowing to one rule must not report
    // every OTHER rule's exemptions as stale.
    for (const id of [...evaluatedLintRules])
      if (!wanted.has(id)) evaluatedLintRules.delete(id)
  }

  const {
    findings: afterExemptions,
    exempted,
    decided,
  } = applyExemptions(filtered, resolved.exemptions, {
    severityOf: ruleId =>
      resolveRuleConfig(ruleId, resolved.rules, exemptionsRegistry).severity,
    wasEvaluated: ruleId => evaluatedLintRules.has(ruleId),
  })

  const sorted = sortFindings(afterExemptions)
  const counts = countBySeverity(sorted)

  if (opts.json) {
    io.stdout.write(
      `${JSON.stringify({ findings: sorted, decided: sortFindings(decided), counts: { ...counts, exempted }, diagnostics }, null, 2)}\n`,
    )
    return 0
  }

  const lines = []
  for (const finding of sorted) {
    lines.push(
      `${finding.severity.padEnd(6)} ${finding.entity}  ${finding.message}`,
    )
  }
  if (sorted.length === 0) lines.push("no lint findings")
  lines.push("")
  lines.push(
    `${counts.error} error(s), ${counts.warn} warn(s), ${counts.review} review(s)`,
  )
  // Same reasoning as `audit`: a silenced finding that nothing accounts for
  // reads as "no drift", so every exempted one is listed with its decision.
  const decisions = renderDecisionsHuman(sortFindings(decided))
  if (decisions) {
    lines.push("")
    lines.push(decisions)
  }
  for (const diagnostic of diagnostics) {
    lines.push(`  [${diagnostic.code}] ${diagnostic.message}`)
  }
  io.stdout.write(`${lines.join("\n")}\n`)

  // Reports, never gates. `verify` is the gate — editing a lint config must
  // not silently turn an informational run into a red pipeline, the rule
  // `audit` already documents and this surface inherits.
  return 0
}
