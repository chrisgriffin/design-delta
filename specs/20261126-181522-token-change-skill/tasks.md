# Tasks: a packaged skill that adds, renames, deprecates and removes a token

## Phase 1 — the checks, red first

- [x] T001 `__tests__/skills.test.js`: the package ships `design-delta-token`. Confirm it fails.
- [x] T002 `__tests__/cli-dock.test.js`: `LINKED_SKILLS` and the written paths include the token stub. Confirm it fails.

## Phase 2 — the skill and its stub

- [x] T003 `skills/design-delta-token/SKILL.md`: add, rename, deprecate or remove; blast radius before the edit; decisions asked or reported; only the tokens file edited; validation before and after.
- [x] T004 `src/cli/commands/dock.mjs`: the `LINKED_SKILLS` entry.

## Phase 3 — trial

- [x] T005 In a throwaway synthetic project with this checkout's CLI: add a token, rename a token that a contract binds, a stylesheet references and another token aliases, then remove one. Check every claim the skill makes about what `impact`, `contracts`, `lint` and `audit` report, and fold what the trial shows back into the skill.

## Phase 4 — surfaces

- [x] T006 `skills/design-delta-token/SKILL.md` — new (T003).
- [x] T007 `skills/design-delta/SKILL.md` — names the skill beside its siblings.
- [x] T008 `skills/design-delta-author/SKILL.md` — step 5's token task and "What this does not cover" point to `design-delta-token`.
- [x] T009 `skills/design-delta-build/SKILL.md` — "What this does not cover" § New tokens points to `design-delta-token`.
- [x] T010 `src/cli/commands/dock.mjs` — the `LINKED_SKILLS` entry (T004).
- [x] T011 `__tests__/skills.test.js`, `__tests__/cli-dock.test.js`, `__tests__/adr-citations.test.js` — the new skill and stub in their expectations.
- [x] T012 `scripts/ci/check-package.sh` — both procedure-skill loops and the stub-count floor.
- [x] T013 published surface — `README.md` § Agent skills, `docs/cli.md` § `init` and § `dock`; the CHANGELOG comes from the `feat:` commit.
- [x] T014 `docs/architecture.md` — confirm no change is needed and say so in the PR body.
- [x] T015 consumers — confirm the change is additive and say so in the PR body.
- [x] T016 ops after-merge issue — confirm none is owed (no Routine, cron, workflow, ruleset, required check or Mac install changes) and say so in the PR body.
- [x] T017 cost — confirm none (no workflow trigger, job or agent fire) and say so in the PR body.
- [x] T018 Run `npx prettier --write` on changed files and `npm run verify` green.
