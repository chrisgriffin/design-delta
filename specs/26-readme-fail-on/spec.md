# Spec: The README says --fail-on can make verify gate on warn and review findings

**Issue**: [#26](https://github.com/chrisgriffin/design-delta/issues/26)

## Overview

The README's `verify` paragraph says `review`/`warn` findings are "reported, never gating". That stopped being true when `--fail-on` shipped: `verify --fail-on warn` (or `review`) fails on them, and `docs/cli.md` and `docs/github-action.md` already say so. A consumer reading only the README would not know the threshold can be lowered.

## User scenarios

- A reader of the README learns that `verify` gates on `error` by default and that `--fail-on` can make it gate on `warn` or `review` too.

## Functional requirements

- FR-001: The README's `verify` paragraph says `review`/`warn` findings do not fail `verify` by default.
- FR-002: The same paragraph names `--fail-on` as the way to lower the threshold, agreeing with `docs/cli.md`, and links there.

## Success criteria

- [x] The README's `verify` paragraph says `review`/`warn` findings do not fail `verify` by default and that `--fail-on` lowers the threshold, agreeing with `docs/cli.md`.
- [x] **Runnable:** `grep -c -- '--fail-on' README.md` prints `1` or more (prints `0` on `develop`).

## Out of scope

- Other docs that state the old absolute (`skills/design-delta/SKILL.md`, the `warn` severity description in `src/core/findings.mjs` and the generated `docs/rules.md`, `docs/report-structure.md`'s severity table): outside this issue's `Done means`, named in the PR body for their own issue.
