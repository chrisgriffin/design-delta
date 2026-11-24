# Plan: a packaged skill that writes a component's documentation page from its contract

## Technical context

- The packaged skills are Markdown procedures under `skills/<name>/SKILL.md`. `__tests__/skills.test.js` checks every command, flag, rule id and config key their code names against the engine's own registries.
- `src/cli/commands/dock.mjs` holds `LINKED_SKILLS`; `dock` and `init` write one guarded stub per entry through `linkedStubTemplates()`. Two other files pin the list: `scripts/ci/check-package.sh` (two loops and a count floor) and `__tests__/cli-dock.test.js`.
- `schema/contract.schema.json` is the list of what a contract can state: its top-level properties, `$defs.prop` and `$defs.anatomyNode`.
- `audit --json --contract <id>` scopes the report to one component; `contracts --json` lists valid contracts and diagnostics.
- A design-only axis (`code: "none"`) is a state or breakpoint, not a prop; a `slot` prop is arbitrary content; `anatomy.$variants` are rendered shapes whose `when` is a note for a reader; `intent` is the one block of usage guidance a contract carries.

## Design decisions

- Name: `design-delta-docs`, named for what it writes, in the pattern of the other packaged skills.
- A procedure, not a renderer. The page's format is the project's, so the mapping from contract to page is a table of what to state, and the syntax comes from a sibling page.
- One table maps every contract construct to its place on the page; a second lists what a contract cannot state, each with the question to leave for a person. The marker for those is one fixed phrase, `Needs a human:`, so they can be searched for.
- Generated regions are delimited by `design-delta-docs:start <section>` and `design-delta-docs:end <section>` comments, and the page opens with a `design-delta-docs: generated from <contract path>` comment. The header is the same kind of ownership guard the generated stubs carry: no header, not ours.
- Hand-written text lives outside the regions, so a re-run has nothing to merge. A region whose markers a person removed is theirs: it is skipped and reported.
- Determinism is by fixed order: sections in the table's order, props, nodes and bindings in the contract's own order. That is what makes an unchanged contract produce no diff.
- No first page without a decision: with no sibling page, format and location are asked. Unattended, plain Markdown beside the contract needs no configuration and nothing has to load it.
- The page states the contract even when the code has drifted; the report carries the scoped audit so the reader knows.
- The schema-coverage test reads the field names from the schema, never a hand list.

## Surfaces touched

- `skills/design-delta-docs/SKILL.md` — new.
- `skills/design-delta/SKILL.md` — names the skill beside the others.
- `skills/design-delta-build/SKILL.md` — its step for a sibling's documentation page says which skill writes it.
- `src/cli/commands/dock.mjs` — one more `LINKED_SKILLS` entry.
- `__tests__/skills.test.js`, `__tests__/cli-dock.test.js`, `__tests__/adr-citations.test.js` — the new skill and stub in their expectations, and the schema-coverage test.
- `scripts/ci/check-package.sh` — the stub resolves in the tarball.
- published surface (the package gains a skill; `dock` and `init` write one more file, and `dock --json` reports one more entry) — `README.md` § Agent skills, `docs/cli.md` § `init` and § `dock`. The CHANGELOG is written by the release workflow from the `feat:` commit.
- `docs/architecture.md` — no change: no directory added under `src/`, and `skills/` is listed as a whole.
- consumers — additive: an existing consumer's `dock` or `init` re-run writes one more file and skips a path it owns; no migration.
- ops after-merge issue — none owed: no Routine, cron, workflow, ruleset or Mac install changes.
