# Tasks

## Phase 1: Red

- [x] T001 Run the runnable line on `develop`: `grep -c "Check docs/" docs/architecture.md` prints `1`.

## Phase 2: Build

- [x] T002 Remove the `Check docs/` sentence from `docs/architecture.md`, keeping the update-this-file convention.
- [x] T003 Rename `test` to `test_22` in `CLAUDE.md` § CI and note the push-only `test_24`/`test_26` jobs.

## Phase 3: Green

- [x] T004 The runnable line prints `0`; `npm test`, `npx prettier --check .` and the rest of the `checks` chain pass.
