# Spec: architecture.md and CLAUDE.md name only the CI checks this repo runs, by their real job ids

**Issue**: [#5](https://github.com/chrisgriffin/design-delta/issues/5)

## Overview

Two docs describe CI checks this repo does not run under those names. `docs/architecture.md` says CI's `Check docs/` step fails a PR that changes the directory structure without touching the file, but `ci.yml` passes `docs_owed: ""`, so that step checks nothing here. `CLAUDE.md` § CI names the test job `test`, but its real id is `test_22`.

## User scenarios

- A contributor who restructures a directory reads `docs/architecture.md`, learns to update it in the same PR, and is not told a CI gate will catch them if they forget.
- A maintainer looking for the test job in a run or the ruleset finds it under the name `CLAUDE.md` gives, `test_22`.

## Functional requirements

- FR-001: `docs/architecture.md` keeps asking that a change adding, removing or renaming a directory, or changing what a part does, update it in the same PR, and no longer claims CI enforces that.
- FR-002: `CLAUDE.md` § CI names the test job `test_22`, and notes that `test_24` and `test_26` run on a push to `main` only.

## Success criteria

- [x] `docs/architecture.md` no longer claims CI fails a PR for not updating it, and still asks that a structural change update it.
- [x] `CLAUDE.md` names the test job by its real id, `test_22` (the push-only Node 24/26 jobs may be noted too).
- [x] **Runnable:** `grep -c "Check docs/" docs/architecture.md` prints `0` (1 on `develop`).

## Out of scope

- Turning the docs check on (a non-empty `docs_owed`): this repo carries no shared doc template, so there is nothing for it to check.
