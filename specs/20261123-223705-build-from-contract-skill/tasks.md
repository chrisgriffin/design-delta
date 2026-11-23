# Tasks: A packaged skill that builds a component from its contract

## Phase 1 — setup

- [ ] T001 Confirm the red: `test -f skills/design-delta-build/SKILL.md` fails on `develop`.

## Phase 2 — the checks, red first

- [ ] T002 Export `FLAG_SPEC` from each `src/cli/commands/*.mjs` and `GLOBAL_FLAGS_HELP` from `src/cli/main.mjs`.
- [ ] T003 Add `__tests__/skills.test.js`: frontmatter, the three shipped names, subcommands, flags and rule ids against the engine's registries, each with a negative control; confirm it fails for the missing skill.
- [ ] T004 Add the entity-form test to `__tests__/skills.test.js` against a real audit run.

## Phase 3 — the skill

- [ ] T005 Write `skills/design-delta-build/SKILL.md` per FR-001 to FR-004.

## Phase 4 — dock

- [ ] T006 Generalize `renderSkillStubTemplate` in `src/cli/commands/dock.mjs` and add the build stub as a fourth, marker-guarded template; extend `__tests__/cli-dock.test.js` first.
- [ ] T007 Extend `scripts/ci/check-package.sh` to run `dock` in the installed consumer and resolve every stub's link.
- [ ] T008 Add the new skill to the expected list in `__tests__/adr-citations.test.js`.

## Phase 5 — trial

- [ ] T009 Run the skill against a real consuming project in a throwaway worktree with this build installed, on a contract for a component that does not exist there; fix the skill for every gap the trial exposes.

## Phase 6 — surfaces

- [ ] T010 `skills/design-delta/SKILL.md`: name the build skill and its stub; correct the "never gating" sentence to match `--fail-on`.
- [ ] T011 `README.md` § Agent skill: the build skill and how a consumer reaches it.
- [ ] T012 `docs/cli.md` § `dock` and § `init`: four templates, the build stub, the `skipped` paths.
- [ ] T013 `docs/testing.md` § What is tested: the skills suite.
- [ ] T014 Confirm `docs/architecture.md` needs no change and say so in the PR body.
- [ ] T015 Confirm no Routine, cron, workflow, ruleset or Mac install changes, and say so in the PR body.
- [ ] T016 Run `npx prettier --write` on changed files and `npm run verify` green.
