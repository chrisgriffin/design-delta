# Decision records

This folder records the decisions this repo's own PRs implement, so each one
travels with the code it shaped.

Each record is `ADR-NNN-<slug>.md`, numbered in order within this repo. It
opens with YAML frontmatter carrying `status` (`proposed`, `accepted`,
`superseded` or `deprecated`), `date`, and `superseded-by: ADR-NNN` when it
has a successor; then `# ADR-NNN: <title>`; then `## Context`,
`## Decision` and `## Consequences`, in that order.

The four records below predate this repo: they were written while the engine
was developed privately and came across with the source at 0.26.0.

## Records

| ADR                                           | Date       | Status   | Decision                                                       |
| --------------------------------------------- | ---------- | -------- | -------------------------------------------------------------- |
| [ADR-001](./ADR-001-modular-rewrite.md)       | 2026-07-30 | accepted | The engine — spec-basis modular rewrite                        |
| [ADR-002](./ADR-002-variant-keyed-anatomy.md) | 2026-08-03 | accepted | Variant-keyed anatomy for components with divergent roots      |
| [ADR-003](./ADR-003-figma-provider.md)        | 2026-08-16 | accepted | The Figma provider — phased, spec-basis contract↔design parity |
| [ADR-004](./ADR-004-unified-rule-system.md)   | 2026-07-28 | proposed | A unified configurable rule system                             |
