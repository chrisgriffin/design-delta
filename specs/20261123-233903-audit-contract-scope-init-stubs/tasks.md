# Tasks: `audit --contract <id>` scopes the output to one component, and `init` writes every linked skill stub

## Phase 1 — the checks, red first

- [x] T001 Add `__tests__/cli-audit-contract-scope.test.js`: the scoped `findings` and `decided`, `counts`, `scope`, the human output, an unknown id, a run that loads no contracts, `--check`, and that an unscoped run is unchanged; confirm it fails.
- [x] T002 `__tests__/cli-init.test.js`: `init` writes every linked stub, guards each, reports each; confirm it fails.

## Phase 2 — audit

- [x] T003 `src/cli/commands/audit.mjs`: `--contract <id>`, the filter over `findings` and `decided`, `scope`, the scoped `--check`, the two error paths.

## Phase 3 — init

- [x] T004 `src/cli/commands/dock.mjs`: export `linkedStubTemplates()` and write from it; note the doctor skill's missing stub.
- [x] T005 `src/cli/commands/init.mjs`: write every linked stub and report each.
- [x] T006 `scripts/ci/check-package.sh`: every stub `init` writes resolves in the tarball.

## Phase 4 — trial

- [x] T007 In a throwaway worktree of a real consuming project with this build installed, compare `audit --json --contract <id>` against the hand filter for a component with seeded drift, and run `init` in a copy with no stubs.

## Phase 5 — surfaces

- [x] T008 `skills/design-delta-build/SKILL.md`: step 5 and the update procedure use the flag; the "no flag" sentence goes.
- [x] T009 `skills/design-delta-resolve/SKILL.md`: the per-component audit uses the flag.
- [x] T010 `skills/design-delta-author/SKILL.md`: the validation step uses the flag.
- [x] T011 `skills/design-delta/SKILL.md`: the command map and the linking section.
- [x] T012 The scoped list is pinned against the hand filter of an unscoped run, in `__tests__/cli-audit-contract-scope.test.js`.
- [x] T013 `docs/cli.md` § `audit`, § `init`, § `dock`; `docs/report-structure.md` § `counts`; `README.md`.
- [x] T014 Confirm `docs/architecture.md` needs no change and say so in the PR body.
- [x] T015 Confirm no Routine, cron, workflow, ruleset or Mac install changes, and say so in the PR body.
- [x] T016 Run `npx prettier --write` on changed files and `npm run verify` green.
