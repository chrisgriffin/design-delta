# Spec: design-delta is the engine's source at 0.26.0, renamed and released to npm from a public repo

**Issue**: [#1](https://github.com/chrisgriffin/design-delta/issues/1)

## Overview

The engine was developed privately through 0.26.0 and published to a registry that needs auth to install from. design-delta is the same source in this public repo, MIT, named `design-delta` everywhere the old name appeared, and wired to publish to the public npm registry. The copy carries no history: the first commit here is the copy itself. Every name a public repo never carries (private sibling repos, operator internals, attributed decisions, competitor comparisons) is rewritten or removed in the same pass.

## User scenarios

- A consumer runs `npm install --save-dev design-delta` with no `.npmrc` and gets the engine, its schemas, docs and two skills.
- A maintainer runs `npm test` and the `checks` chain here and gets the same counts the source gave at 0.26.0.
- A release PR merges into `main` and the shared release workflow publishes to npmjs with the repo's `NPM_TOKEN` secret.

## Functional requirements

- FR-001: `src`, `schema`, `docs`, `skills`, `__tests__`, `scripts`, `action.yml` and the config files are the source's at 0.26.0, with `design-drift` renamed `design-delta` in every identifier, path, package name, bin, default config file name and doc, and the two skills' directories renamed.
- FR-002: `package.json` is `design-delta`, MIT, unscoped, with `publishConfig.registry` at `https://registry.npmjs.org`; `publish.yml` and `create-github-release.yml` name the same registry (held by `__tests__/registry-url.test.js`).
- FR-003: Each of the seven workflows is a thin stub calling `chrisgriffin/workflows@v1` and passes its secrets by name; `create-github-release.yml` passes `npm_registry_url`, `npm_scope: ""` and `NPM_TOKEN` (held by `__tests__/workflow-stubs.test.js`).
- FR-004: No file names a private sibling repo, the operator, the vault, a quoted or attributed owner decision, or a competitor.
- FR-005: `.claude/` carries the public-repo hook pair (`bash-guard.sh`, `post-edit-check.sh`) and `settings.json` wiring them.
- FR-006: `docs/ci.md`, `docs/releasing.md`, `docs/architecture.md`, `docs/github-action.md`, `README.md` and `CLAUDE.md` describe the public registry and the public workflow repo, with CLAUDE.md under 9500 bytes.

## Success criteria

- [x] This repo holds the engine's `src`, `schema`, `docs`, `skills`, tests and `action.yml` from 0.26.0, with every old name renamed (package `design-delta`, bin `design-delta`, default config `design-delta.json`, the two packaged skills) and no commit older than the copy.
- [x] An MIT `LICENSE`, the seven workflow stubs at `chrisgriffin/workflows@v1` with `create-github-release.yml` passing `npm_registry_url: https://registry.npmjs.org`, `npm_scope: ""` and `NPM_TOKEN`, every stub passing its secrets by name, and a CLAUDE.md under the 9500-byte budget.
- [x] `npm test` and the `checks` chain pass on the renamed tree with the same counts as the source at 0.26.0 (71 suites, 2096 passed, 1 skipped).
- [x] **Runnable:** `node -p "require('./package.json').name + ' ' + require('./package.json').license"` prints `design-delta MIT` (the repo holds no package.json today).

## Out of scope

- The first npm publish: [#2](https://github.com/chrisgriffin/design-delta/issues/2), which waits on the `NPM_TOKEN` secret and the shared workflow's `v1` tag.
- The source's own spec folders and changelog history: they stay with the source. `CHANGELOG.md` starts empty here and `release-pr.yml` writes the first entry.
