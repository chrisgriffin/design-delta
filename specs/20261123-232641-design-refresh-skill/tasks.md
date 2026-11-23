# Tasks: A packaged skill that refreshes the design-side snapshot

## Phase 1 — setup

- [x] T001 Confirm the red: `test -f skills/design-delta-refresh/SKILL.md` fails on `develop`.
- [x] T002 Read every `gather` and `ingest` fact the skill will state off the installed CLI: exit codes, messages, plan shape, envelope shape, `--json` payloads.

## Phase 2 — the checks, red first

- [x] T003 `__tests__/skills.test.js` and `__tests__/cli-dock.test.js`: expect the refresh skill and its stub; confirm they fail.

## Phase 3 — the skill

- [x] T004 Write `skills/design-delta-refresh/SKILL.md` per FR-001 to FR-006.

## Phase 4 — dock

- [x] T005 `src/cli/commands/dock.mjs`: add the refresh skill to `LINKED_SKILLS`.
- [x] T006 `scripts/ci/check-package.sh`: the refresh stub's link resolves in the tarball.
- [x] T007 `__tests__/adr-citations.test.js`: the new skill in the expected list.

## Phase 5 — trial

- [x] T008 Run the procedure in a throwaway worktree of a real consuming project with this build installed; say exactly which steps ran against the installed CLI and which could not; fix the skill for every gap.

## Phase 6 — surfaces

- [x] T009 `skills/design-delta/SKILL.md`: the snapshot section and the linking section name the refresh skill.
- [x] T010 `skills/design-delta-author/SKILL.md`: name the refresh skill where it says refreshing is a separate task.
- [x] T011 `README.md` § Agent skills: the refresh skill.
- [x] T012 `docs/cli.md` § `dock`, § `init`: the refresh stub; § `gather`: the envelope.
- [x] T013 Confirm `docs/architecture.md` needs no change and say so in the PR body.
- [x] T014 Confirm no Routine, cron, workflow, ruleset or Mac install changes, and say so in the PR body.
- [x] T015 Run `npx prettier --write` on changed files and `npm run verify` green.
