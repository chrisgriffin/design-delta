# Plan: a packaged skill that adds, renames, deprecates and removes a token

## Technical context

- The packaged skills are Markdown procedures under `skills/<name>/SKILL.md`. `__tests__/skills.test.js` checks every command, flag, rule id and config key their code names against the engine's own registries, so the new skill is held to the engine the same way.
- `src/cli/commands/dock.mjs` holds `LINKED_SKILLS`; `dock` and `init` write one guarded stub per entry through `linkedStubTemplates()`. Three other files pin the list: `scripts/ci/check-package.sh` (two loops and a count floor), `__tests__/cli-dock.test.js`, and `__tests__/adr-citations.test.js`'s shipped-skill list. `__tests__/cli-init.test.js` iterates `LINKED_SKILLS`, so it covers the new stub with no edit.
- `impact <token.id> --json` reports code references only: `var()` usages under `componentsDir`/`styleRoots` of the token's candidate custom-property names. An id the token census lacks exits `1`, so after a rename the old id can no longer be asked about: the blast radius is taken before the edit.
- Checked against the synthetic project before writing the skill: after a rename, `contracts --json` still reports every contract binding the old path as valid, and the audit names no contract for it; a stylesheet still on the old variable surfaces as `tokens/var-unresolved` (once the emitted stylesheet no longer declares it); a token aliasing the old path is dropped from the census and reported in the audit's `diagnostics` as `unresolvable-alias`. So contracts and aliases are found by searching the contracts directory and the tokens file for the path, and the skill says so.
- DTCG 2025.10 reserves `$deprecated` on a token or group; the engine's `$`-key scan accepts it and nothing in the engine reports a deprecated token still in use.
- Config can name a token id: `exemptions` entries, `rules` options such as `tokens/token-unreferenced`'s `ignorePrefixes`, `lint.tiers`/`lint.vocabularies`, and `design.options.tokenMap`.

## Design decisions

- Name: `design-delta-token`, for what it changes, in the pattern of the other packaged skills.
- One procedure, three changes. Shared steps (read the project, take the before state, validate and report) wrap one section per change: add, rename, deprecate or remove.
- Blast radius first, for every change but an add: `impact` for code, a search of `paths.styleRoots` for the custom property's declaration, a search of `paths.contractsDir` for the path as a token binding, a search of the tokens file for the path as an alias, a search of `design-delta.json` for the id, its custom-property names and its ancestor prefixes. Each search says which spelling of the id it uses where mode sets are separate. Each is listed before the tokens file is touched. An add checks the path is neither an existing group nor under an existing token.
- The tokens file is the only file it edits. A rename or removal lists every contract and stylesheet it leaves pointing at the old path and hands them on: contract edits to `design-delta-author`'s "Changing a contract that exists", code edits to `design-delta-build`'s update procedure. Aliases inside the tokens file are part of the token change and are updated with it. Config entries naming the id are the config owner's: listed, never edited.
- Removal of a referenced token is not done by default: the recommendation is deprecate first, and the owner decides, including each aliasing token's new target.
- Decisions follow the authoring skill's discipline: name, tier (where the project separates tiers), type and value, and for a deprecation its replacement, are each settled from the request or the project's conventions, or asked once together with a recommendation. Unattended, the tokens file is left without the undecided token, since DTCG has no place for a marked placeholder that still parses, and the report carries each open decision as the question to answer.
- Validation compares `contracts`, `lint` and `audit` before and after, by `ruleId` and `entity`, and the `diagnostics` (where a broken alias shows). The project's token build is run before both the before- and the after-audit when the emitted stylesheet is build output, as the build skill already does.
- The author and build skills' "token task" lines name the new skill; nothing else in them changes.

## Surfaces touched

- `skills/design-delta-token/SKILL.md` — new.
- `skills/design-delta/SKILL.md` — names the skill beside its siblings.
- `skills/design-delta-author/SKILL.md` — step 5's "a token task, outside this procedure" and "What this does not cover" point to `design-delta-token`.
- `skills/design-delta-build/SKILL.md` — "What this does not cover" § New tokens points to `design-delta-token`.
- `src/cli/commands/dock.mjs` — one more `LINKED_SKILLS` entry.
- `__tests__/skills.test.js`, `__tests__/cli-dock.test.js`, `__tests__/adr-citations.test.js` — the new skill and stub in their expectations.
- `scripts/ci/check-package.sh` — both procedure-skill loops and the stub-count floor.
- published surface (the package gains a skill; `dock` and `init` write one more file, and `dock --json` reports one more entry) — `README.md` § Agent skills, `docs/cli.md` § `init` and § `dock`. The CHANGELOG is written by the release workflow from the `feat:` commit.
- `docs/architecture.md` — no change: no directory added under `src/`, and `skills/` is listed as a whole.
- consumers — additive: an existing consumer's `dock` or `init` re-run writes one more file and skips a path it owns; no migration.
- ops after-merge issue — none owed: no Routine, cron, workflow, ruleset, required check or Mac install changes.
- cost — none: no workflow trigger, job or agent fire added.
