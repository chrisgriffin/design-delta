# Spec: The npm description and README status describe design-delta as it is released

**Issue**: [#6](https://github.com/chrisgriffin/design-delta/issues/6)

## Overview

Two public self-descriptions still predate the rename and the first release. `package.json`'s description, which npmjs.com shows under the package name, calls the package a "design-drift engine", and the README's status note says the package publishes to npm "on its first release" although 0.27.0 has been released. Both should describe the package as it is.

## User scenarios

- A reader on npmjs.com sees the package described as the design-delta engine.
- A reader of the README learns the package's real release state: 0.27.0 is released, and it is not on npm yet (the registry answers 404 for `design-delta` on 2026-11-09).

## Functional requirements

- FR-001: `package.json`'s `description` names the package the design-delta engine, matching the README and `CLAUDE.md` (the rename spec's FR-001).
- FR-002: The README's status blockquote states the release state as checked: 0.27.0 released, not yet on npm, publishing from the next release. The history note about the 0.26.0 cut stays.

## Success criteria

- [x] `package.json`'s description calls the package the design-delta engine.
- [x] The README's status note describes the package's release state as it is, not as a future first release.
- [x] **Runnable:** `node -p "require('./package.json').description.includes('design-drift')"` prints `false` (`true` on `develop`).

## Out of scope

- Why 0.27.0 never reached npm: its `create-github-release.yml` run ended in `startup_failure`, so no tag, Release or publish followed. Fixing the release is its own change.
