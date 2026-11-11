# Tasks: The gate lints again, and it is one command

Spec: `specs/20261111-145510-gate-lints-again/spec.md` · Plan: `plan.md` in the same folder.

The runnable line is red today: `eslint` is not a dependency, so it exits 1 before ESLint is ever invoked.

## Phase 1 — setup

- [x] T001 Record the red baseline: the spec's runnable line, exiting 1 with `eslint is not a dependency`, and the current `checks` chain from `ci.yml` (six commands, no lint). Both go in the pull request.
- [x] T002 Add `eslint`, `globals` and `@chrisgriffin/config` (`github:chrisgriffin/config#v1`) to `devDependencies` and install.
- [x] T003 Confirm FR-007 deliberately: `package-lock.json` resolves all three over https, and `npm ci` succeeds in a shell with no registry token or credential configured. Quote the result in the pull request — this is a standing constraint in `CLAUDE.md`, not an incidental.

## Phase 2 — make the lint pass honestly

- [x] T004 Add `eslint.config.mjs` from the engine's own at `0.26.0`: the shared base, the `ignores` list for `specs/`, `.agents/`, `.specify/` and scratch output, and the three overrides — `no-unused-vars` with `ignoreRestSiblings: true`, Node and Jest globals for `__tests__/**`, and the fixture-source relaxation. Keep each comment that says why.
- [x] T005 Run `npx eslint .` and record every finding. **This is the real baseline** — the suite is green, so anything here is uncovered by any test.
- [x] T006 Fix each finding in the code. Relax a rule only in `eslint.config.mjs`, with a comment naming what in this codebase makes it inapplicable, and never for a finding that is a real defect. List every finding and which it was in the pull request.
- [x] T007 `npx eslint .` exits 0, and `npm test` still passes at 71 suites / 2096 tests / 1 skipped. A changed count means a fix changed behaviour: say so rather than accepting it.

## Phase 3 — one home for the chain

- [x] T008 Add `lint` (`eslint .`), `checks` (the chain, with `lint` after `prettier --check`) and `verify` (`npm run checks && npm test`) to `package.json`'s `scripts`.
- [x] T009 `npm run verify` exits 0 on the clean tree, and its output shows the chain then the suite.
- [x] T010 `.github/workflows/ci.yml` — the `checks` job's `run:` becomes `npm run checks`. Do not touch `test_22`, `test_24` or `test_26`, and do not add, remove or rename a job.
- [x] T011 `__tests__/ci-workflow.test.js` — assert the `checks` job's `run:` is exactly `npm run checks` and that `package.json` defines a `checks` script.
- [x] T012 Prove the pin bites: change `ci.yml`'s `run:` to something else, confirm T011's assertion fails, revert. Quote the failure in the pull request.
- [x] T013 Confirm FR-006: name every CI job a pull request runs and what each runs, and show the test suite runs in exactly one of them. In the pull request.

## Phase 4 — surfaces

One task per `## Surfaces touched` line in the plan, in its order.

- [x] T014 `eslint.config.mjs` — the file exists with the `ignores` list and the three commented overrides (T004).
- [x] T015 `package.json` and `package-lock.json` — the three devDependencies and the three scripts, lockfile resolving over https (T002, T003, T008).
- [x] T016 `src/**`, `__tests__/**`, `scripts/**` — the pull request lists every lint finding and its fix, or says none was found.
- [x] T017 `.github/workflows/ci.yml` — the `checks` job calls the script; no job added, removed or renamed, so the three required check names are unchanged and no ruleset edit is owed. Say so in the pull request.
- [x] T018 `__tests__/ci-workflow.test.js` — carries the new assertion (T011).
- [x] T019 `CLAUDE.md` — § Coding standards says ESLint lints and from where; § CI points at the `checks` script instead of listing its commands. Then `wc -c CLAUDE.md` is under 9500 and the `checks` job passes on it.
- [x] T020 `docs/testing.md` — § The gate and § Running tests name `npm run verify` as the one local command and point at `package.json` for the chain, keeping the per-command explanations.
- [x] T021 `.prettierignore` — confirm no entry is needed; if one is, add the matching `docs/testing.md` line, because `CLAUDE.md` says it carves out only what that doc lists.
- [x] T022 `docs/ci.md` — records why the `checks` job calls a script and why `test_22` does not call `verify`, which is the billed-minute reasoning this doc holds.
- [x] T023 cost — confirm in the pull request that no job, trigger or cron is added, the lint runs inside the existing `checks` job, and the suite still runs once per pull request.
- [x] T024 `docs/adr/` — confirm no ADR is owed, or say in the pull request why one is and write it.
- [x] T025 `CHANGELOG.md` — confirm nothing is hand-written and `version` is not touched.
- [x] T026 none else — confirm in the pull request: no reusable workflow body in chrisgriffin/workflows touched, no required check renamed, and `files`, `bin` and `exports` unchanged, which `check-package.sh` confirms inside the chain.

## Phase 5 — polish

- [x] T027 `npm run verify` green end to end one more time, on a clean tree.
- [x] T028 Confirm `git status` is clean: no scratch directory, no `coverage/`, nothing the install left behind that is not the lockfile.

## Convergence

- [x] T029 `README.md` § Development and `docs/architecture.md` § Running it also listed the chain's commands (a fourth and fifth copy the plan missed). Both now name `npm run verify` and point at `package.json`.
