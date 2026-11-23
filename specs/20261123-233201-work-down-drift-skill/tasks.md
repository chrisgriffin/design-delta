# Tasks: A packaged skill that works down drift across a project

## Phase 1 — setup

- [x] T001 Confirm the red: `test -f skills/design-delta-resolve/SKILL.md` fails on `develop`.

## Phase 2 — the checks, red first

- [x] T002 `__tests__/skills.test.js` and `__tests__/cli-dock.test.js`: expect the skill and its stub; confirm they fail.

## Phase 3 — the skill

- [x] T003 Write `skills/design-delta-resolve/SKILL.md` per FR-001 to FR-006.

## Phase 4 — dock

- [x] T004 `src/cli/commands/dock.mjs`: add the skill to `LINKED_SKILLS`.
- [x] T005 `scripts/ci/check-package.sh`: the stub's link resolves in the tarball.
- [x] T006 `__tests__/adr-citations.test.js`: the new skill in the expected list.

## Phase 5 — trial

- [x] T007 Run the procedure in a throwaway worktree of a real consuming project with this build installed; record the counts by rule before and after; fix the skill for every gap.

## Phase 6 — surfaces

- [x] T008 `skills/design-delta/SKILL.md`: name the skill.
- [x] T009 `skills/design-delta-build/SKILL.md`: point at the skill from the audit step.
- [x] T010 `README.md` § Agent skills: the skill.
- [x] T011 `docs/cli.md` § `dock`, § `init`: the stub.
- [x] T012 Confirm `docs/architecture.md` needs no change and say so in the PR body.
- [x] T013 Confirm no Routine, cron, workflow, ruleset or Mac install changes, and say so in the PR body.
- [x] T014 Run `npx prettier --write` on changed files and `npm run verify` green.
