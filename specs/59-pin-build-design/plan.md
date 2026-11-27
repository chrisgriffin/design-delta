# Plan: design-delta-build-design's description is pinned

- `__tests__/skill-descriptions.test.js`: a `PINNED` entry for `design-delta-build-design`, its description copied from the skill's frontmatter.
- `skills/design-delta/SKILL.md`: a Route the task first row for it, after design-delta-adopt's.

## Surfaces touched

- `__tests__/skill-descriptions.test.js`, `skills/design-delta/SKILL.md` (the packaged router; a consumer's stub picks it up on its next `dock`).
- No workflow, CLI or Action change; no added cost.
