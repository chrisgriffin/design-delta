# Spec: The README says design-delta is on npm

**Issue**: [#23](https://github.com/chrisgriffin/design-delta/issues/23)

## Overview

The README's status note says 0.27.0 "is released but not yet on npm", and its Install section opens with "Once the package is on npm". Both are now false: 0.27.0 has been on the public npm registry since 2026-11-10 and is its `latest` version. The README is also the package's npm page, so every reader is told they cannot install it yet.

## User scenarios

- A reader of the README or the npm page learns the package is on npm and can install it now.

## Functional requirements

- FR-001: The status blockquote drops the not-yet-on-npm sentence and keeps the ADR-001 pointer and the note about the 0.26.0 cut.
- FR-002: § Install is plain install instructions, with no condition on a future publish.

## Success criteria

- [x] The README no longer says the package is not on npm or will be published later.
- [x] § Install reads as plain install instructions for a package that is on npm.
- [x] **Runnable:** `! grep -qE "not yet on npm|Once the package is on npm" README.md` exits 0 (it exits 1 on `develop`).

## Out of scope

- Any other README section, and the release state of later versions: a point-in-time version claim is what went stale here, so the note states none.
