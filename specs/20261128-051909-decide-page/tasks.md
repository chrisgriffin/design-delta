# Tasks: `design-delta decide`

Spec: [spec.md](./spec.md). Plan: [plan.md](./plan.md).

## Phase 1: foundational (pure `core/`)

- [ ] [T001] `src/core/piles.mjs`: `PILE_RULES` and `pileOf(finding)` from the resolve skill's step 3 table, with a cautious default that is never `code`; `__tests__/core-piles.test.js` covers every named rule, the precedence of a named rule over its `side`, and the default
- [ ] [T002] `src/core/recommendations.mjs`: per-pile defaults plus per-rule overrides, `recommendationFor(ruleId, pile)`; `__tests__/core-recommendations.test.js` fails for a registered rule with no entry or a recommendation outside its options
- [ ] [T003] `src/core/decisions.mjs`: `buildDecisions` (grouping, stable ids, code count, answered/done from the decisions file) and `applyAnswers` (validation first, exemption entries appended preserving order and `_` keys, action entries keyed by id); `__tests__/core-decisions.test.js`
- [ ] [T004] `src/core/decisions-page.mjs`: `renderDecisionsPage` for `serve` and `static` modes, with embedded data escaped, no external request, recommended option preselected, and reason/issue requirements enforced in the inline script; `__tests__/core-decisions-page.test.js` (deterministic output, no `http(s)://` resource, `</script>` escaping, labels on every control)

## Phase 2: the command

- [ ] [T005] `DEFAULT_PATHS.decisionsFile` in `src/core/config.mjs` and `paths.decisionsFile` in `schema/config.schema.json`
- [ ] [T006] `schema/decisions.schema.json` and `schema/decide-answers.schema.json`, validated in `src/cli/commands/decide.mjs` with the existing ajv setup
- [ ] [T007] `src/cli/commands/decide.mjs`: `--json`, `--apply`, `--no-serve`/`--out`, and the default served mode on `127.0.0.1` with a per-run token, injectable `ctx.serve`, prune of done entries; register in `src/cli/main.mjs` `SUBCOMMANDS`
- [ ] [T008] `__tests__/cli-decide.test.js` over a fixture project: `--json` determinism and shape; `--apply` writes exemptions and the decisions file, and the next audit lists them under `decided`; an unknown id writes nothing and exits 1; an invalid resulting config writes nothing; a served post without the token is rejected; a valid post writes and resolves 0; the real server binds `127.0.0.1`; `--no-serve` writes one HTML file

## Phase 3: the resolve skill

- [ ] [T009] `skills/design-delta-resolve/SKILL.md`: step 3's table becomes a pointer to `decide --json`'s `pile` and `src/core/piles.mjs`; read the decisions file in step 1; work `fix-code` entries in step 5; a step for `change-contract` entries as the one recorded exception to step 6 and the hard limits; the report step ends with `decide`

## Phase 4: surfaces

- [ ] [T010] `src/core/piles.mjs`, `src/core/recommendations.mjs`, `src/core/decisions.mjs`, `src/core/decisions-page.mjs`: new pure modules (T001–T004)
- [ ] [T011] `src/cli/commands/decide.mjs`, `src/cli/main.mjs`: subcommand and `SUBCOMMANDS` row (T007)
- [ ] [T012] `src/core/config.mjs`: `DEFAULT_PATHS.decisionsFile` (T005)
- [ ] [T013] `schema/config.schema.json`, `schema/decisions.schema.json`, `schema/decide-answers.schema.json` (T005, T006); `node scripts/ci/check-schemas.mjs` passes
- [ ] [T014] `docs/config-reference.md`: regenerate with `node scripts/generate-config-reference.mjs`
- [ ] [T015] `docs/cli.md`: a `## decide` section
- [ ] [T016] `README.md`: the `## Usage` listing line and the agent-skills sentence
- [ ] [T017] `docs/architecture.md`: the new `core/` modules
- [ ] [T018] `skills/design-delta-resolve/SKILL.md` (T009)
- [ ] [T019] `skills/design-delta/SKILL.md` (router): mention `decide` where commands are listed
- [ ] [T020] `__tests__/`: the five new test files (T001–T004, T008)
- [ ] [T021] `package.json` `files`: `bash scripts/ci/check-package.sh` confirms the new schemas ship
- [ ] [T022] CHANGELOG: left to the release PR (a `feat:` commit)
- [ ] [T023] Published surface: README, docs and schema covered by T013–T016
- [ ] [T024] Migration: none, additive; an existing config validates unchanged
- [ ] [T025] Cost: none, no workflow, trigger or cron
- [ ] [T026] ops after-merge issue: none owed (no living note covers these paths)
- [ ] [T027] `npm run verify` exits 0
