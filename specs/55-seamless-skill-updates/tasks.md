# Tasks

## Phase 1: Red

- [x] T001 Add `__tests__/skill-descriptions.test.js` pinning each linked skill's description, with the router's new broad one: fails on `develop`.
- [x] T002 Add `dock --check` and router-stub tests to `__tests__/cli-dock.test.js`: fail on `develop`.

## Phase 2: Build

- [x] T003 Widen the packaged router's description; the router stub reads it from the packaged file.
- [x] T004 Implement `dock --check`: no writes, per-file state, exit 1 on `stale`/`missing`.
- [x] T005 Add the Action's `check-skills` input and its step; add its row to `docs/github-action.md`.
- [x] T006 Update `README.md` § Agent skills and `docs/cli.md` § `dock`.

## Phase 3: Green

- [x] T007 `npm run verify` exits 0.
