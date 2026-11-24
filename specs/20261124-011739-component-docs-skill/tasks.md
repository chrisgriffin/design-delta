# Tasks: a packaged skill that writes a component's documentation page from its contract

## Phase 1 — the checks, red first

- [x] T001 `__tests__/skills.test.js`: the package ships `design-delta-docs`; every top-level contract field, prop type and prop field in the schema is named in it. Confirm it fails.
- [x] T002 `__tests__/cli-dock.test.js`: `LINKED_SKILLS` and the written paths include the docs stub. Confirm it fails.

## Phase 2 — the skill and its stub

- [x] T003 `skills/design-delta-docs/SKILL.md`.
- [x] T004 `src/cli/commands/dock.mjs`: the `LINKED_SKILLS` entry.
- [x] T005 `scripts/ci/check-package.sh`: both loops and the count floor.
- [x] T006 `__tests__/adr-citations.test.js`: the shipped skill list.

## Phase 3 — trial

- [x] T007 In a throwaway worktree of a real consuming project with this build installed: write a first page for one component, build the project's documentation, re-run unchanged, change the contract and re-run. Fold what the trial shows back into the skill.

## Phase 4 — surfaces

- [x] T008 `skills/design-delta/SKILL.md` and `skills/design-delta-build/SKILL.md` name the skill.
- [x] T009 `README.md` § Agent skills; `docs/cli.md` § `init` and § `dock`.
- [x] T010 Confirm `docs/architecture.md` needs no change and say so in the PR body.
- [x] T011 Confirm no Routine, cron, workflow, ruleset or Mac install changes, and say so in the PR body.
- [x] T012 Run `npx prettier --write` on changed files and `npm run verify` green.
