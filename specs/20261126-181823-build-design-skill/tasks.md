# Tasks: a packaged skill that builds a component in the design tool from its contract

## Phase 1 — the checks, red first

- [x] T001 `__tests__/skills.test.js`: the package ships `design-delta-build-design`; every design marker, mechanism, prop type and anatomy node field in the schema is named in it; no packaged skill names a design tool a provider is registered for. Confirm it fails.
- [x] T002 `__tests__/cli-dock.test.js`: `LINKED_SKILLS` and the written paths include the build-design stub. Confirm it fails.

## Phase 2 — the skill and its stub

- [x] T003 `skills/design-delta-build-design/SKILL.md`.
- [x] T004 `src/cli/commands/dock.mjs`: the `LINKED_SKILLS` entry.

## Phase 3 — surfaces

- [x] T005 `skills/design-delta-build-design/SKILL.md` — new (T003).
- [x] T006 `skills/design-delta/SKILL.md` — names the skill among its siblings.
- [x] T007 `skills/design-delta-build/SKILL.md`, `skills/design-delta-author/SKILL.md`, `skills/design-delta-refresh/SKILL.md` — their design-tool "what this does not cover" lines point at the new skill.
- [x] T008 `src/cli/commands/dock.mjs` — the `LINKED_SKILLS` entry (T004).
- [x] T009 `__tests__/skills.test.js`, `__tests__/cli-dock.test.js`, `__tests__/adr-citations.test.js` — the new skill in their expectations (T001, T002, and the shipped skill list).
- [x] T010 `scripts/ci/check-package.sh` — both loops and the count floor.
- [x] T011 published surface — `README.md` § Agent skills, `docs/cli.md` § `init` and § `dock`.
- [x] T012 `docs/architecture.md` — confirm no change and say so in the PR body.
- [x] T013 `CLAUDE.md` § Architecture — confirm none of its couplings is touched.
- [x] T014 consumers — confirm the change is additive and say so in the PR body.
- [x] T015 cost — confirm no workflow, cron or agent fire is added.
- [x] T016 ops after-merge issue — confirm none is owed and say so in the PR body.
- [x] T017 Run `npx prettier --write` on changed files and `npm run verify` green.
