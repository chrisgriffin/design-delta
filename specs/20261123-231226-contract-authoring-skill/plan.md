# Plan: A packaged skill that authors a component's contract

## Technical context

- Skills ship as `skills/<name>/SKILL.md`; `package.json` `files` includes `skills`, `scripts/ci/check-package.sh` checks every packaged skill's frontmatter `name` and relative links in the installed tarball, and `__tests__/skills.test.js` holds each to the engine's own subcommand, flag, rule and config-key registries.
- `src/cli/commands/dock.mjs` writes one linked stub per consumer-facing skill, guarded by `GENERATED_MARKER`. The build stub reads its description from the packaged skill.
- `design-delta contracts` validates a contract's schema and semantics. It does not look a bound token path up in the tokens file, so the skill does that by reading `paths.tokensFile`.
- `design-delta scaffold <Component>` drafts a contract from existing code and leaves `_scaffold` markers; `coverage/unfinished-contract` reports a contract that still carries one. A contract whose `sources.code.path` has no component reports `coverage/contract-only` until it is built.
- The design snapshot `design-components.json` under `paths.snapshotDir` holds each design component's name, property definitions, variant properties and layers.

## Design decisions

- Name: `design-delta-author`, a verb beside `design-delta-build`.
- Prose for an agent, no new subcommand: which props a component takes is a person's call, so the skill's work is to find the open decisions and ask.
- One batch of questions, each with a recommended answer, before the file is written. Project conventions (naming case, file layout, class naming) are read from a sibling contract and are not questions.
- `_scaffold` is the one marker for a pending decision, placed on the nearest object that still validates, so the engine's existing `coverage/unfinished-contract` reports it and the build skill already knows to build around it.
- The design-snapshot path is gated on a configured provider and a snapshot on disk; the skill reads the file and never calls a design tool.
- `dock`: the build stub's renderer becomes one renderer for any packaged skill (`renderPackagedSkillStubTemplate(name)`), reading the description from the packaged file, and the list of linked skills becomes one array. The build stub's text stays byte-identical so an existing consumer's `dock` re-run reports it `up-to-date`.
- `check-package.sh` requires a stub for each skill in that list by resolving every stub's link, and its minimum stub count follows the list.

## Surfaces touched

- `skills/design-delta-author/SKILL.md` — new.
- `skills/design-delta-build/SKILL.md` — step 1's stop and "What this does not cover" name the authoring skill; the visual-correctness limit says a visual before/after check is the complement.
- `skills/design-delta/SKILL.md` — names the authoring skill and its stub.
- `src/cli/commands/dock.mjs` — a fifth template; one renderer for packaged-skill stubs.
- `__tests__/cli-dock.test.js`, `__tests__/skills.test.js`, `__tests__/adr-citations.test.js` — the new skill and stub in their expectations.
- `scripts/ci/check-package.sh` — the authoring stub resolves in the tarball.
- published surface (the package gains a skill; `dock` writes one more file and reports one more entry in `--json`) — `README.md` § Agent skills, `docs/cli.md` § `dock` and § `init`, `docs/testing.md` § What is tested. The CHANGELOG is written by the release workflow from the `feat:` commit.
- `docs/contract-authoring-guide.md` — points at the skill as the procedure; its stale "this release checks contract↔code only" passage under `sources` is corrected, since the file is edited.
- `docs/architecture.md` — no change: no directory added, and its `skills/` line already covers another skill.
- consumers — additive: an existing consumer's `dock` re-run writes one more file; no migration.
- ops after-merge issue — none owed: no Routine, cron, workflow, ruleset or Mac install changes.
