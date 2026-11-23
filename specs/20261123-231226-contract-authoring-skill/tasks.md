# Tasks: A packaged skill that authors a component's contract

## Phase 1 — setup

- [x] T001 Confirm the red: `test -f skills/design-delta-author/SKILL.md` fails on `develop`.

## Phase 2 — the checks, red first

- [x] T002 `__tests__/skills.test.js`: expect the authoring skill among the shipped names; confirm it fails.
- [x] T003 `__tests__/cli-dock.test.js`: expect the authoring stub in `dock`'s files, its guard and its description read from the packaged skill; confirm it fails.

## Phase 3 — the skill

- [x] T004 Write `skills/design-delta-author/SKILL.md` per FR-001 to FR-007.

## Phase 4 — dock

- [x] T005 `src/cli/commands/dock.mjs`: one renderer for packaged-skill stubs, the authoring stub added, the build stub byte-identical.
- [x] T006 `scripts/ci/check-package.sh`: the authoring stub's link resolves in the tarball.
- [x] T007 `__tests__/adr-citations.test.js`: the new skill in the expected list.

## Phase 5 — trial

- [x] T008 In a throwaway worktree of a real consuming project with this build installed, author a contract for a component that does not exist there, then run the build skill on it to a clean audit; fix the skill for every gap the trial exposes.

## Phase 6 — surfaces

- [x] T009 `skills/design-delta-build/SKILL.md`: step 1 and "What this does not cover" name the authoring skill; the visual-correctness limit names a visual before/after check as the complement.
- [x] T010 `skills/design-delta/SKILL.md`: name the authoring skill and its stub.
- [x] T011 `README.md` § Agent skills: the authoring skill and how a consumer reaches it.
- [x] T012 `docs/cli.md` § `dock` and § `init`: five templates, the authoring stub, the `skipped` paths.
- [x] T013 `docs/testing.md` § What is tested: unchanged wording still true; confirm.
- [x] T014 `docs/contract-authoring-guide.md`: point at the skill; correct the stale contract↔code-only passage under `sources`.
- [x] T015 Confirm `docs/architecture.md` needs no change and say so in the PR body.
- [x] T016 Confirm no Routine, cron, workflow, ruleset or Mac install changes, and say so in the PR body.
- [x] T017 Run `npx prettier --write` on changed files and `npm run verify` green.
