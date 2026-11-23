# Plan: A packaged skill that builds a component from its contract

## Technical context

- Skills ship as `skills/<name>/SKILL.md`; `package.json` `files` already includes `skills`, and `scripts/ci/check-package.sh` checks every `skills/*/SKILL.md` in the installed tarball for a `name:` and for relative links that resolve.
- Claude Code does not discover a skill inside `node_modules`, so a consumer reaches a packaged skill through a generated stub. `src/cli/commands/dock.mjs` writes one for the audit skill, guarded by `GENERATED_MARKER`.
- `audit` has no per-component flag. A finding's `entity` for a contracted component is the contract `id` or `<id>.<element>` (`src/modules/components.mjs`, `styles.mjs`, `anatomy.mjs`), so the skill filters `audit --json` on that.
- The subcommand inventory is `SUBCOMMANDS` in `src/cli/main.mjs`; each command's accepted flags are its module's `FLAG_SPEC`; the rule ids are `buildFullRuleRegistry()` in `src/cli/rule-registry.mjs`.

## Design decisions

- Name: `design-delta-build`, beside `design-delta` and `design-delta-doctor`.
- The skill is prose for an agent, not a generator: file layout, styling approach and test shape differ per project, so the skill reads a sibling and matches it, and the engine's audit is the check. No new subcommand.
- The update case (contract changed, code must follow) is included: it is the same audit loop without the generation step.
- `dock` gets a fourth template. `renderSkillStubTemplate` is generalized to take the skill it links, so both stubs come from one function and one marker; the audit stub's output stays byte-identical.
- `FLAG_SPEC` becomes an export in each `src/cli/commands/*.mjs`, and `GLOBAL_FLAGS_HELP` in `main.mjs`, so the new test reads accepted flags from the parser's own input.
- New suite `__tests__/skills.test.js`: every `skills/*/SKILL.md` has frontmatter with `name` equal to its directory and a `description`; the three shipped names are present; every `design-delta <word>` in a code span or fence is a subcommand; every `--flag` on such an invocation is in that command's `FLAG_SPEC` or a global flag; every code span shaped like a rule id is in the registry; each check has a negative control. One more test pins the entity form the build skill filters on, against a real audit run of a fixture.
- `check-package.sh` runs `dock` in the throwaway consumer and resolves every `node_modules/design-delta/skills/...` path each generated stub names.

## Surfaces touched

- `skills/design-delta-build/SKILL.md` — new.
- `skills/design-delta/SKILL.md` — names the build skill and its stub; its "never gating" sentence is corrected to match `--fail-on`, since the file is edited.
- `src/cli/commands/dock.mjs` — fourth template, generalized stub renderer.
- `src/cli/commands/*.mjs`, `src/cli/main.mjs` — `FLAG_SPEC` and `GLOBAL_FLAGS_HELP` exported; no behavior change.
- `__tests__/skills.test.js` — new; `__tests__/cli-dock.test.js`, `__tests__/adr-citations.test.js` — the new file in their expectations.
- `scripts/ci/check-package.sh` — every `dock` stub's link resolves in the tarball.
- published surface (`dock`'s files and `--json` payload gain one entry; the package gains a skill) — `README.md` § Agent skill, `docs/cli.md` § `dock` and § `init`, `docs/testing.md` § What is tested. The CHANGELOG is written by the release workflow from the `feat:` commit.
- `docs/architecture.md` — no change: no directory added, and its `skills/` line already covers a third skill.
- consumers — additive: an existing consumer's `dock` re-run writes one more file; no migration.
- ops after-merge issue — none owed: no Routine, cron, workflow, ruleset or Mac install changes.
