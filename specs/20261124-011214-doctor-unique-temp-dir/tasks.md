# Tasks: the doctor skill works in a unique temporary directory per run and always removes it

## Phase 1 — the check, red first

- [ ] T001 `__tests__/skills.test.js`: no packaged skill's code names a fixed path under a system temporary directory; the doctor skill creates its directory with `mktemp -d` and removes it; the failure path. Confirm it fails.

## Phase 2 — the skill

- [ ] T002 `skills/design-delta-doctor/SKILL.md` step 1: `mktemp -d`, the worktree inside it, a branch unique to the run, the `<work>` placeholder.
- [ ] T003 Steps 2, 3 and 5: the audit documents and the `cd` use `<work>`.
- [ ] T004 Step 8 and the hard limits: unconditional cleanup, and what an interrupted run leaves.
- [ ] T005 Step 3: the post-release command names no repository.

## Phase 3 — trial

- [ ] T006 Run steps 1, 2 and 8 as written against a real consuming project, twice, the first run interrupted after step 1; confirm the second starts and both leave nothing.

## Phase 4 — surfaces

- [ ] T007 Confirm `README.md` and `docs/` name no doctor path, and `docs/architecture.md` needs no change; say so in the PR body.
- [ ] T008 Confirm no Routine, cron, workflow, ruleset or Mac install changes, and say so in the PR body.
- [ ] T009 Run `npx prettier --write` on changed files and `npm run verify` green.
