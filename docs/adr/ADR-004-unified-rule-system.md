---
status: proposed
date: 2026-07-28
---

# ADR-004: design-delta gets a unified configurable rule system, correctness fixes first

**Decision (proposed, 2026-07-28):** Give
[design-delta](https://github.com/chrisgriffin/design-delta) **one flat rule id space and
one `rules` config block** — ESLint-style enable/disable/severity per rule — spanning all
three of its check families (lint, audit, conformance), built on a new pure-metadata
registry (`src/lib/rules.mjs`) and an ajv-backed `schema/config.schema.json`. Land the
**correctness bugs first** (three HIGH bugs that make the engine's output untrustworthy
for its one real consumer), then the foundation, then the rule system family by family.
Seven PRs to `develop`, each landing green.

## Context — forces

A full audit (2026-07-28, two exhaustive exploration passes + design pass over the
worktree) found the package is three tools wearing one trench coat:

1. **Lint** (`src/drift-lint.mjs`) — a real `RULES` registry, 18 rules, with
   `lint.severityOverrides` + `lint.ruleExemptions` config. The good pattern.
2. **Audit** (`src/drift-audit.mjs`) — no rule abstraction; a hardcoded sequence of 8
   `diff*()` calls emitting deltas classified by `kind`. Only one ad-hoc toggle
   (`tokenHygiene.flagRawFills`).
3. **Conformance** (`src/lib/component-conformance.mjs`) — a hardcoded `check*()`
   sequence with **no severity field at all**; every finding is implicitly fatal.

Three incompatible finding shapes, three suppression mechanisms, no way to say "turn
this check off" except for the lint family. The direction: the package will be
highly configurable, lint-style — enable/disable rules from the consumer's config.

**Verified bugs forcing the correctness-first ordering** (all confirmed against source,
not from a stale report):

- **B1** `drift-report.mjs:69` anchors on the _package_ dir, not `process.cwd()` — for
  installed consumers the config silently never loads, both sub-engines run with an
  empty config, and the report writes into `node_modules`.
- **B2** `schema/fingerprints-snapshot.schema.json` requires `props` to be an object,
  but `ingest.mjs:219` writes `props: null` for every non-mover on the documented fast
  path — the whole snapshot fails validation and the visual-baseline diff goes dark
  silently.
- **B3** `verify.mjs` drops the `schemaPath`/`tokenNamespace` args the standalone spec
  CLI passes — `npm run spec` and `npm run verify` disagree for any consumer with a
  custom `cssVarPrefix`.
- **B4–B7** 9 of 12 bins silently ignore typo'd flags (a typo'd `--fail-on-new-drift`
  leaves CI green); `drift-audit --report --json` skips writing the report file;
  malformed config gives a raw stack trace from the flagship CLI; the hand-rolled config
  validator silently ignores unknown keys — and **no `schema/config.schema.json` exists
  despite CLAUDE.md claiming one**.

Useful pre-existing assets: `config.surfaces` is validated but read by nothing (dead
key); `drift-report.mjs` already projects audit deltas to lint-shaped findings under
synthetic `drift/<kind>` ids — the id scheme is already shipped; `verify.mjs` already
has a per-check `enabled` field for exactly one check.

Tension resolved: the repo ROADMAP parks "generality beyond the first consumer" as a
non-goal, while repo CLAUDE.md demands config-driven purity. The unified
rule system was chosen explicitly, so configurability is now in-scope; consumer-specific string
cleanup (`/designer` remediation text, PT timezone) stays parked.

## Options considered

**Scope of the rule system**

1. **Unified rule system** _(chosen 2026-07-28)_ — one registry + one `rules`
   block across lint, audit, and conformance. Bigger lift; delivers the lint-like
   experience everywhere.
2. Incremental per-engine — wire `config.surfaces` for audit, add `"off"` to lint
   overrides, a conformance toggle. Cheaper, config stays fragmented. Rejected.
3. Lint-only first. Rejected — audit/conformance are where configurability is missing.

**Bug fixes in or out**

1. **Bugs + rules, phased** _(chosen)_ — correctness first; the config-schema work is
   shared foundation anyway.
2. Rules only, bugs as issues. Rejected — B1/B2/B3 undermine trust in every report the
   rules system would emit.

**Audit rule granularity:** rule-per-**kind** (chosen; kinds are what users tune, and
`drift/<kind>` ids are already public) over rule-per-surface. Each diff surface declares
the kinds it emits, which is what makes run-gating possible.

## Decision

**1. One flat id space, no renames.** Lint keeps its 18 bare ids
(`naming/camel-case`, …). Audit gets rule-per-kind under `drift/` (`drift/changed`,
`drift/code-only`, `drift/code-connect-gap`, `drift/waiver-stale`, `drift/var-figma-only`,
`drift/var-code-only`, `drift/figma-only`, `drift/added`, `drift/mockup-only-instance`,
`drift/missing-mockup`, `drift/mockup-config-stale`, `drift/icon-figma-only`; `in-sync`
is never a rule). Conformance gets rule-per-check-function under `conform/`
(`conform/code-api`, `conform/anatomy-consistency`, `conform/code-connect`,
`conform/code-styles`, `conform/code-anatomy`, `conform/subcomponent-refs`,
`conform/figma-api`, `conform/figma-styles`, `conform/figma-anatomy`). Prefixes can't
collide, so one flat `rules` map is unambiguous.

**2. Registry: new `src/lib/rules.mjs`, pure metadata.** Descriptors
`{ id, family, defaultSeverity, surface? }`; engines import it, never the reverse. Lint
run functions stay in `drift-lint.mjs`. Exports `AUDIT_RULES`, `CONFORM_RULES`,
`normalizeRuleEntry` (accepts `"off"|"error"|"warn"|"review"` or ESLint-style
`[severity, options]`), and `resolveRuleConfig`. Precedence per id: descriptor default →
legacy `lint.severityOverrides` (lint only, can't say off) → `config.rules[id]` wins
outright, including `"off"`. Unknown rule id in `rules` → loud config validation error.

**3. Config surface.**

```json
{
  "rules": {
    "naming/camel-case": "warn",
    "component/line-budget": ["warn", { "maxLines": 300 }],
    "drift/icon-figma-only": "off",
    "conform/figma-api": "error"
  }
}
```

Per-rule options: plumb the mechanism, wire exactly one real option in v1 —
`component/line-budget` gets `maxLines`, replacing the hardcoded 200. Legacy keys:
`lint.severityOverrides` deprecated (remove ~0.6); `lint.ruleExemptions` kept
(path-scoped, orthogonal); `config.surfaces` stays dead — deprecation notice, remove
~0.6, do **not** invent semantics for it; `tokenHygiene.flagRawFills: false` becomes a
shim for the raw-fill kind rule.

**4. Enable/disable is hybrid.** Lint: run-gate off rules in the run loop; post-filter
the collection-scope rules that fire during tree-walk and physically can't be gated.
Audit: annotate every delta with resolved severity in one normalization step, post-filter
off kinds, run-gate a whole diff surface only when _every_ kind it declares is off.
Conformance: pure run-gate, one check function = one rule. The public `rulesChecked`
JSON contract counts only evaluated rules and gains a sibling `rulesDisabled` array.

**5. Severity + exit codes stay honest.** Audit kinds default `warn` (icons/mockup-only
`review`) — matches the shipped all-warn projection, nothing visibly downgrades.
Conformance code checks default `error`, `conform/figma-*` default `warn`.
**`drift-audit` keeps exiting 0 by default** — config alone must never silently flip a
CI gate; a new `--check` flag exits 1 on error-severity deltas. `verify` counts
error-severity conformance findings only.

**6. Config gets a real JSON Schema.** `schema/config.schema.json` (draft 2020-12),
`validateConfig` becomes ajv-backed with the exported `{valid, errors}` API unchanged, a
formatter keeps errors human-readable, `additionalProperties: false` fixes the
silent-typo class, and the two real-but-unvalidated keys (`paths.componentSpecSchema`,
`componentConventions.figmaVarNamespaces`) join the schema. This also makes repo
CLAUDE.md's schema claim true.

## Consequences

- **The prize:** consumers tune the engine like a linter — one block, one id space —
  and the three worst trust-eroding bugs die first.
- **Commits us to:** a registry that must stay in sync with what the engines actually
  emit (guarded by a registry-integrity test), a docs rule table that must track it
  (guarded by a doc-sync test), and a golden-run invariant that default config output
  stays byte-identical through the whole rollout.
- **One deliberate behavior change:** opt-in conformance figma checks drop from
  implicitly-fatal to warn-by-default — called out in the PR body with a migration note.
- **Pre-1.0 breaking room is used, not abused:** every legacy config key keeps working
  through 0.5; deprecations carry removal targets.
- Parked debt is parked, not forgotten: consumer-hardcoded remediation strings, PT
  timezone, lint scan-dir literals, figma-gather test coverage, and the untested 774-line
  `figma-token-map.mjs` get filed as issues when the PRs open.

## Plan of action

Full per-PR detail (files, tests, acceptance criteria) lives in the execution plan
handed to the build session; summary:

| PR  | Type             | What                                                                                                                                                          | Guards                                                                              |
| --- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| 1   | `fix:`           | B1 consumer-root, B2 fingerprints schema `props: null`, B3 verify/spec divergence (shared `specValidationOptions` helper)                                     | synthetic-project integration tests crossing the exact boundaries that hid the bugs |
| 2   | `fix:`           | shared `parseFlags` in `lib/cli.mjs`, adopted by all 12 bins; audit `--report --json` writes both; try/catch on config load                                   | typo'd-flag → exit 1 tests per CLI                                                  |
| 3   | `feat:`          | `schema/config.schema.json` + ajv-backed `validateConfig`, unknown keys loud-fail                                                                             | invalid-fixture matrix + error-message snapshot                                     |
| 4   | `feat:`          | `src/lib/rules.mjs` + configurable lint rules + `maxLines` option                                                                                             | golden run: empty `rules` ⇒ byte-identical output                                   |
| 5   | `feat:`          | audit severity annotation, off-kind filtering, surface gating, `--check` flag                                                                                 | exit-code matrix; `flagRawFills` shim equivalence                                   |
| 6   | `feat:`          | conformance rules gated, findings gain `ruleId`/`severity`, severity-aware exits                                                                              | verify still fails on code-nonconforming                                            |
| 7   | `docs:`/`chore:` | rewrite stale engine docs (incl. the now-false "the audit is not rule-based" section), doc-sync test, dead-code removal, `engines` field, deep-path `exports` | doc-sync test fails on undocumented rule                                            |

Every PR: `npm test` + Prettier + both CI guard scripts locally, `npm pack` smoke into a
scratch consumer dir (the B1 regression harness), PR to `develop`.
Conventional Commit types drive the automated release — no hand version bumps.

## Open questions

- Should `--check` eventually become `verify`'s default path for audit deltas, or stay a
  separate opt-in gate? (Deferred until the rules system has real usage.)
- When a second consumer exists, does the parked consumer-string cleanup
  (`actionFor` remediation text, timezone) get its own ADR or ride the generalization
  effort the ROADMAP already names?

## Status

**Proposed 2026-07-28.** Design locked (unified rule system; bugs +
rules, phased). Execution plan written for a Sonnet/Opus build session; not yet started —
awaiting a go on the plan itself.

— design-delta audit session 2026-07-28
