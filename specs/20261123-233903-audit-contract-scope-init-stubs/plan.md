# Plan: `audit --contract <id>` scopes the output to one component, and `init` writes every linked skill stub

## Technical context

- `src/cli/commands/audit.mjs` assembles one `result` after exemptions, sorting and `isNew` marking, then renders it as JSON or text and returns `opts.check && hasError(findings) ? 1 : 0`. `verify`, `report`, `map` and the MCP server call `runAudit` with their own argv, so a flag they do not pass does not reach them.
- A finding for a contracted component carries the contract `id` or `<id>.<element>` as its `entity` (`__tests__/skills.test.js` pins this against a real run); `coverage/contract-only` carries the id.
- `lint --rule <id>` is the existing single-valued filter flag; `parseFlags` has no repeatable flags.
- `src/cli/commands/init.mjs` writes one stub through `dock`'s `writeTemplateFile`. `dock` holds the list of linked skills in `LINKED_SKILLS`. This branch is cut from the resolve-skill branch, which carries that list at four entries.

## Design decisions

- Name: `--contract <id>`. The value is a contract id, so the flag is named for what it takes, like `lint --rule <id>`. `--component` is one letter from the existing `--components` surface flag, and `--entity` would promise an exact match on any entity, which this is not.
- The filter runs last, over the finished `findings` and `decided`, so nothing upstream changes and the scoped answer cannot differ from the full run's.
- `counts.findings` and `counts.exempted` follow the scoped lists because `docs/report-structure.md` states `counts.exempted` equals `decided.length`; the project-wide numbers move to a new `scope` object so a reader can still see there is more.
- `--check` gates on the scoped list: an exit code that fails on findings the output does not show cannot be acted on. `verify` is unchanged and stays the whole-project gate.
- An unknown id is an error, like an unknown rule id in config: a typo must not look like a clean component.
- `init`: it was written when the audit stub was the only linked stub, and nothing records a reason to stop at one, so this is an omission. `dock` exports `linkedStubTemplates()`, the audit stub plus every `LINKED_SKILLS` stub with its guard, and both commands write from it. `init` still writes no hook and no verify skill: those change how an agent behaves and need wiring, which is `dock`'s decision to make with the user.
- The doctor skill keeps no generated stub; `dock.mjs` and `docs/cli.md` say so in one sentence each.

## Surfaces touched

- `src/cli/commands/audit.mjs` — the flag, the filter, `scope`, the scoped `--check`.
- `src/cli/commands/dock.mjs` — `linkedStubTemplates()`; `src/cli/commands/init.mjs` — writes each.
- `__tests__/cli-audit-contract-scope.test.js` — new; `__tests__/cli-init.test.js`, `__tests__/skills.test.js` — updated.
- `scripts/ci/check-package.sh` — every stub `init` writes resolves in the tarball.
- `skills/design-delta-build/SKILL.md`, `skills/design-delta-resolve/SKILL.md`, `skills/design-delta-author/SKILL.md`, `skills/design-delta/SKILL.md` — use the flag; say `init` writes the stubs too.
- published surface (a new `audit` flag, two new payload fields under it, `init` writing more files) — `docs/cli.md` § `audit`, § `init`, § `dock`; `docs/report-structure.md` § `counts`; `README.md`. The CHANGELOG is written by the release workflow from the `feat:` commit.
- `docs/architecture.md` — no change: no directory added.
- consumers — additive: no existing invocation changes meaning; a consumer's next `init` writes four more stubs and skips any path it owns.
- ops after-merge issue — none owed: no Routine, cron, workflow, ruleset or Mac install changes.
