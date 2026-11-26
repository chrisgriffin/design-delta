# Tasks: a packaged skill that adopts design-delta in an existing codebase

## Phase 1 — the checks, red first

- [x] T001 `__tests__/skills.test.js`: the package ships `design-delta-adopt`; the adopt skill tries every `verify --fail-on` level the engine accepts, strictest first, and names only Action inputs `action.yml` declares. Confirm it fails.
- [x] T002 `__tests__/cli-dock.test.js`: `LINKED_SKILLS` and the written paths include the adopt stub. Confirm it fails.

## Phase 2 — the skill and its stub

- [x] T003 `skills/design-delta-adopt/SKILL.md`.
- [x] T004 `src/cli/commands/dock.mjs`: the `LINKED_SKILLS` entry.
- [x] T005 `scripts/ci/check-package.sh`: both loops and the count floor.
- [x] T006 `__tests__/adr-citations.test.js`: the shipped skill list.

## Phase 3 — trial

- [x] T007 In a scratch project with no design-delta, with this build installed from `npm pack`: run the skill's commands in order (`init --yes`, `contracts`, `audit`, `map`, `impact`, `scaffold`, `snapshot`, the `verify --fail-on` ladder) and check each output field the skill reads is where it says. Fold what the trial shows back into the skill.

## Phase 4 — surfaces

- [x] T008 `skills/design-delta-adopt/SKILL.md` — written (T003).
- [x] T009 `skills/design-delta/SKILL.md` names the skill beside the others.
- [x] T010 `skills/design-delta-author/SKILL.md`, `skills/design-delta-resolve/SKILL.md`: confirm by grep that neither lists its siblings exhaustively, so neither needs a change.
- [x] T011 `src/cli/commands/dock.mjs` — the entry (T004).
- [x] T012 `__tests__/skills.test.js`, `__tests__/cli-dock.test.js`, `__tests__/adr-citations.test.js` — expectations (T001, T002, T006).
- [x] T013 `scripts/ci/check-package.sh` — loops and floor (T005).
- [x] T014 Published surface: `README.md` § Agent skills; `docs/cli.md` § `init` and § `dock`, the template count included.
- [x] T015 `docs/github-action.md`: one line pointing a first-time adopter at the skill for choosing `fail-on`.
- [x] T016 Confirm `docs/architecture.md` needs no change and say so in the PR body.
- [x] T017 Confirm `action.yml` is unchanged.
- [x] T018 Consumers: additive, no migration; say so in the PR body.
- [x] T019 Confirm no Routine, cron, workflow, ruleset, Mac install or vault note changes (no ops after-merge issue owed), and say so in the PR body.
- [x] T020 Cost: none; say so in the PR body.
- [x] T021 Run `npx prettier --write` on changed files and `npm run verify` green.
