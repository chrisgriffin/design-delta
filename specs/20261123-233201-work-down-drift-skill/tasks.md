# Tasks: A packaged skill that works down drift across a project

## Phase 1 — setup

- [ ] T001 Confirm the red: `test -f skills/design-delta-resolve/SKILL.md` fails on `develop`.

## Phase 2 — the checks, red first

- [ ] T002 `__tests__/skills.test.js` and `__tests__/cli-dock.test.js`: expect the skill and its stub; confirm they fail.

## Phase 3 — the skill

- [ ] T003 Write `skills/design-delta-resolve/SKILL.md` per FR-001 to FR-006.

## Phase 4 — dock

- [ ] T004 `src/cli/commands/dock.mjs`: add the skill to `LINKED_SKILLS`.
- [ ] T005 `scripts/ci/check-package.sh`: the stub's link resolves in the tarball.
- [ ] T006 `__tests__/adr-citations.test.js`: the new skill in the expected list.

## Phase 5 — trial

- [ ] T007 Run the procedure in a throwaway worktree of a real consuming project with this build installed; record the counts by rule before and after; fix the skill for every gap.

## Phase 6 — surfaces

- [ ] T008 `skills/design-delta/SKILL.md`: name the skill.
- [ ] T009 `skills/design-delta-build/SKILL.md`: point at the skill from the audit step.
- [ ] T010 `README.md` § Agent skills: the skill.
- [ ] T011 `docs/cli.md` § `dock`, § `init`: the stub.
- [ ] T012 Confirm `docs/architecture.md` needs no change and say so in the PR body.
- [ ] T013 Confirm no Routine, cron, workflow, ruleset or Mac install changes, and say so in the PR body.
- [ ] T014 Run `npx prettier --write` on changed files and `npm run verify` green.
