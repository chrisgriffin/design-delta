# Spec: The gate lints again, and it is one command

## Overview

Nothing lints this package. The engine's source was copied here at `0.26.0` and renamed, and in the transcription of the CI chain the lint step was dropped and never noticed. The result, measured on `develop` at `2128be6`:

- No `eslint.config.mjs`, and no `eslint` in `dependencies`, `devDependencies` or `peerDependencies`. [`@chrisgriffin/config`](https://github.com/chrisgriffin/config), which carries the shared Prettier, ESLint and TypeScript bases, is not a dependency either; this package's Prettier config is a local `.prettierrc`.
- `.github/workflows/ci.yml`'s `checks` job runs six commands — `prettier --check`, `check-action.sh`, `check-package.sh`, `check-schemas.mjs`, and the two reference generators with `--check`. There is no lint step.
- `CLAUDE.md` § Coding standards says only that Prettier owns formatting; the source it came from said Prettier owns formatting **and ESLint lints**, both from the shared config.

This was not a decision. The pull request that brought the source over claimed in its own `Done means` that "`npm test` and the `checks` chain pass on the renamed tree with the same counts as the source", and the verification block it quoted runs six commands where the source's chain ran seven. The omission is visible in that block and nobody saw it. No ADR, no `CLAUDE.md` passage and no CHANGELOG entry says lint was removed on purpose.

So a published package — `0.27.0` on the public registry, `0.28.0` queued — has shipped twice with no static analysis over `src/`, and a fork contributor gets no lint feedback at all.

The second half of this is why the omission could happen silently. The list of commands the gate runs is written out three times: in `ci.yml`'s `run:` block, in `CLAUDE.md` § CI, and in `docs/testing.md` § Running tests. They agree today, by hand. Adding a step means editing three places and no check notices if one is missed — which is precisely what happened. `package.json` becomes the one home for the chain, the workflow calls it, and a test pins the two together.

## User scenarios

- A contributor runs one command before pushing and gets the same verdict CI will give, without reading `ci.yml` to assemble the chain.
- A contributor on a fork opens a pull request and the lint runs for them, with no token and no registry auth.
- Someone adds a step to the gate, edits one place, and a test fails if the workflow no longer calls the chain it lives in.
- Someone reads `CLAUDE.md` § Coding standards and finds that what it claims about ESLint is true.

## Functional requirements

- FR-001: ESLint runs over this repo's source, configured from the shared `@chrisgriffin/config` ESLint base, and `eslint` plus whatever that base needs are declared dependencies.
- FR-002: The lint passes on `develop`'s tree as it stands. Any finding it raises is fixed in the code; a rule is relaxed only in `eslint.config.mjs` with a comment saying what in this codebase makes it inapplicable, and never to clear a finding that is a real defect.
- FR-003: Directories that are not this repo's source are excluded: Spec Kit's `specs/`, the runtime-laid `.agents/` and `.specify/` trees, and scratch output. `__tests__/` and fixture sources get whatever globals and relaxations they need, as their own config entries rather than a blanket exclusion.
- FR-004: `package.json` holds the gate's command list once. A `verify` script runs the whole local gate — the checks chain and the test suite — so one command gives the verdict.
- FR-005: `ci.yml`'s `checks` job calls that script rather than repeating its commands, and the test suite fails if it stops doing so.
- FR-006: The suite still runs as its own CI job on its own Node version. `verify` must not cause CI to run the test suite twice in one pull request.
- FR-007: Every dependency this adds installs with no registry token and no credential, so a fork's pull request still works.
- FR-008: `CLAUDE.md` § Coding standards says ESLint lints and from where; `CLAUDE.md` § CI and `docs/testing.md` point at the one place the chain lives instead of listing it again.

## Success criteria

- [ ] **Runnable:** `node -e 'const p=require("./package.json");const d={...p.dependencies,...p.devDependencies};if(!d.eslint){console.error("eslint is not a dependency");process.exit(1)}' && npx eslint .` exits 0. Red on `develop` today, where it exits 1 printing `eslint is not a dependency`.
- [ ] `npm run verify` exists, runs the checks chain and then the suite, and exits 0 on a clean tree.
- [ ] A step added to the chain in `package.json` alone is a step CI runs, and the test suite fails if `ci.yml` stops calling that script. Record the deliberate-break output in the pull request.
- [ ] One pull request runs the test suite in exactly one CI job. Name the jobs and what each runs in the pull request.
- [ ] Every lint finding on today's tree is fixed in the code, or the rule is relaxed in `eslint.config.mjs` with a stated reason. The pull request lists each one and which it was.
- [ ] `npm ci` succeeds with no registry token and no credential configured.
- [ ] `CLAUDE.md` § Coding standards says ESLint lints and from where; `CLAUDE.md` § CI and `docs/testing.md` stop listing the chain's commands and point at `package.json`.
- [ ] `CLAUDE.md` stays inside the 9500-byte budget its `checks` job enforces.

## Out of scope

- A `coverage` script. What a coverage gate should assert here is not settled, so adding one now would be inventing a standard rather than applying one. It gets its own ticket once that is decided.
- Any new lint rule beyond what the shared base and the source's own config carried. This restores what was lost; raising the bar is a separate decision.
- The `test_24` and `test_26` jobs, which run on a push to `main` and are untouched.
- The three required check names, which do not change: no job is added, removed or renamed, so no branch ruleset edit is owed.
