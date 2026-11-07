# Tasks

## Phase 1: Red

- [x] T001 Run the runnable line on an empty checkout: it fails, since there is no package.json.

## Phase 2: Build

- [x] T002 Lay the source's `v0.26.0` tree, minus `specs/` and `CHANGELOG.md`; record the baseline counts (71 suites, 2096 passed, 1 skipped).
- [x] T003 Mechanical rename and public-name pass over the tree; rename the two skill directories; `package-lock.json` name and license.
- [x] T004 Rewrite the seven workflow stubs, `CODEOWNERS`, `.prettierignore`, `.claude/` and `LICENSE`; reset `CHANGELOG.md`.
- [x] T005 Rewrite `docs/ci.md` and `docs/adr/README.md`; edit `README.md`, `CLAUDE.md`, `docs/releasing.md`, `docs/architecture.md`, `docs/testing.md`, `docs/github-action.md`, the doctor skill and the remaining comments; regenerate the two generated docs.
- [x] T006 Update `__tests__/workflow-stubs.test.js`, `__tests__/ci-workflow.test.js`, `__tests__/workflow-timeouts.test.js` and `scripts/ci/required-checks.mjs` for the public stubs and this repo's ruleset id.

## Phase 3: Green

- [x] T007 `npm test`, `npx prettier --check .`, `check-schemas.mjs`, both `generate-*.mjs --check`, `check-package.sh` and `check-action.sh` pass; the runnable line prints `design-delta MIT`.
