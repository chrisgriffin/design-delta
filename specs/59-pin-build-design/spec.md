# Spec: design-delta-build-design's description is pinned

Issue: [#59](https://github.com/chrisgriffin/design-delta/issues/59)

## Problem

[#52](https://github.com/chrisgriffin/design-delta/pull/52) linked `design-delta-build-design`, and [#56](https://github.com/chrisgriffin/design-delta/pull/56) pinned every linked skill's description. Merged together, `__tests__/skill-descriptions.test.js` fails on develop and on release PR #45.

## Success criteria

1. **Runnable:** `npx jest __tests__/skill-descriptions.test.js` exits 0
2. `design-delta-build-design`'s description is pinned and the router's Route the task first table links it, as 36c269f did for design-delta-adopt

## Out of scope

- The skill's own text.
