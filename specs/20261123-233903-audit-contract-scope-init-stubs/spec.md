# Spec: `audit --contract <id>` scopes the output to one component, and `init` writes every linked skill stub

## Overview

Two gaps the build skill's own pull request named. First, `audit` reports on the whole project and has no way to show one component's findings, so the build skill tells an agent to filter `findings` by `entity` by hand, and every skill that works on one component repeats that rule. Second, `init` writes a stub for the audit skill only, so a project set up with `init` cannot find the skills for writing a contract, building from one, refreshing the design side or working findings down until someone also runs `dock`.

## User scenarios

- An agent building one component runs `audit --json --contract <id>` and reads only that component's findings, with no filter of its own.
- A person runs `audit --contract <id>` and reads the same scoped list in the terminal, with a line saying how many findings the whole project has.
- Someone passes an id that is not a loaded contract and gets an error naming the ids that are, never an empty list that reads as clean.
- A new consumer runs `init` and gets a stub for every skill `dock` links, each guarded like the audit stub.
- A consumer who already owns a file at one of those paths keeps it, and `init` says which it skipped.

## Functional requirements

- FR-001: `audit` accepts `--contract <id>`. With it, `findings` and `decided` hold only entries whose `entity` is the id, starts with the id followed by `.`, or is a path that contract's `sources.code` names.
- FR-002: The flag applies to the human output and to `--json` alike.
- FR-003: The flag changes nothing the audit computes: every surface runs over the whole project, and `diagnostics`, `skipped`, `provenance` and the census counts are what an unscoped run reports.
- FR-004: Under the flag, `counts.findings` and `counts.exempted` count the scoped lists, so they stay equal to the lengths of `findings` and `decided`; the payload carries `scope: { contract, findings, exempted }` with the project-wide totals, and the human output states both numbers.
- FR-005: `--check` with `--contract` exits 1 only when an error-severity finding is in the scoped list. Without `--contract`, exit codes are unchanged.
- FR-006: An id that is not a loaded contract, or a run whose surfaces load no contracts, exits 1 with a message naming the loaded ids; nothing is written to stdout.
- FR-007: `init` writes the audit stub and one stub per skill `dock` links, through `dock`'s own templates and writer, each guarded by the generated-by marker, and reports each file's action.
- FR-008: The one packaged skill with no generated stub, the doctor skill, stays that way, and the docs say why.
- FR-009: The build, resolve and authoring skills use `audit --json --contract <id>` in place of the hand filter.
- FR-010: `docs/cli.md` documents the flag, its payload fields and exit code, and `init`'s stubs; `README.md` agrees.

## Success criteria

- [ ] `design-delta audit --contract <id>` limits `findings` and `decided` to that contract's component (its id, its elements, and the files its `sources.code` names) in both the human output and `--json`, while every surface still runs over the whole project.
- [ ] An id that is not a loaded contract exits 1 naming the loaded ids, and `--check --contract <id>` exits 1 only on an error-severity finding in the scoped list.
- [ ] `design-delta init` writes a stub for every skill `dock` links, never overwriting a file at one of those paths it did not generate.
- [ ] The build and resolve skills use the flag instead of filtering by hand, and `docs/cli.md` documents the flag and `init`'s stubs.
- [ ] **Runnable:** `test -f __tests__/cli-audit-contract-scope.test.js && npm run verify` exits 0 (exits 1 on `develop`, where the flag and its test do not exist).

## Out of scope

- Scoping what the audit computes: the flag filters the report, so the answer for one component is the same one the full run gives.
- The same flag on `verify`, `report` or `lint`: `verify` is the project's gate and stays whole.
- A generated stub for the doctor skill: it is the maintainer's procedure and needs a target project path a generated file cannot know.
- More than one id per run: the shared flag parser has no repeatable flags.
