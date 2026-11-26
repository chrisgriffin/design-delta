# Plan: a packaged skill that builds a component in the design tool from its contract

## Technical context

- The packaged skills are Markdown procedures under `skills/<name>/SKILL.md`. `__tests__/skills.test.js` checks every command, flag, rule id and config key their code names against the engine's own registries.
- `src/cli/commands/dock.mjs` holds `LINKED_SKILLS`; `dock` and `init` write one guarded stub per entry. `scripts/ci/check-package.sh` (two loops and a count floor), `__tests__/cli-dock.test.js` and `__tests__/adr-citations.test.js` pin the list.
- What the design side is compared on, and therefore what a built design component must carry: prop parity through the provider's `componentProps` (`{name, type, values?}`, types `enum`/`boolean`/`string`/`slot`) driven by each prop's `design` marker (`modules/components.mjs` `checkDesignProps`); variant combinations against `invalidVariantCombinations`; the anatomy against the component's layer tree, located by layer name or `designLayer`, compared on `type` (`modules/anatomy.mjs` `runDesignAnatomyCheck`); each declared token binding against the variables the component binds (`modules/styles.mjs` `runDesignBindingsCheck`, `styles/design-binding-missing`). Matching is by the address in `sources.design` only; an address the provider's `sourceSchema` rejects contributes nothing to `gather`, silently.
- `gather`/`ingest` and the refresh skill bring the snapshot up to date; `audit --json --contract <id>` scopes findings to one component.

## Design decisions

- Name: `design-delta-build-design`, the build skill's design-side twin, named the way its siblings are.
- **Skill only, no engine code.** The contract is already the provider-neutral description of what to create: props with their design markers, design-only axes, anatomy with layer names and types, token paths per element and variant, forbidden combinations. What the engine cannot give is the design tool's own vocabulary for writing (how a token path becomes a variable name, the address shape, how a boolean hides a layer), and that is the same gap the code build skill closes with a sibling: here a sibling contract with a design address and no design-side findings, read beside its snapshot entry (`usedVars`, `layers`, props). The proof stays the existing audit rules. A build-plan command would either restate the contract or put a design tool's write vocabulary in a provider, giving the engine a write surface it is designed never to have.
- Variables: a token path is confirmed with `impact <token> --json` (as the authoring skill does), and its variable is the one a sibling binds for that path, or the one spelled the way siblings' variables spell their tokens. More than one candidate is asked, none is reported; never picked by value, never created.
- The one contract write: a newly created component's address in `sources.design`, when the contract had none, in a sibling contract's shape. It records where the component was built, not a decision about what it is, and without it the audit cannot match the component to its contract. Every other contract change stays forbidden. A `sources.design` that resolves to nothing is a contract question: the skill cannot create a node at a given address.
- Which design file a new component goes in is the request's, or the file the sibling's component lives in; otherwise asked, and unattended it stops.
- The refresh is the refresh skill's procedure, run whole, never a shortened copy of it.
- The loop list is the scoped audit's `side: "design"` findings for the component; code-side and spec-side findings are reported, not looped on, mirroring how the build skill sets design-side ones aside.
- Tests: a schema-coverage test (design markers, mechanisms, prop types, anatomy node fields) read from the schema like the docs skill's, and a vendor guard that no packaged skill names a design tool a provider is registered for, read from `listProviders()`.

## Surfaces touched

- `skills/design-delta-build-design/SKILL.md` — new.
- `skills/design-delta/SKILL.md` — names the skill among its siblings.
- `skills/design-delta-build/SKILL.md`, `skills/design-delta-author/SKILL.md`, `skills/design-delta-refresh/SKILL.md` — their "what this does not cover" lines about the design tool point at the new skill.
- `src/cli/commands/dock.mjs` — one more `LINKED_SKILLS` entry.
- `__tests__/skills.test.js`, `__tests__/cli-dock.test.js`, `__tests__/adr-citations.test.js` — the new skill and stub in their expectations, the schema-coverage test and the vendor guard.
- `scripts/ci/check-package.sh` — the stub resolves in the tarball; both loops and the count floor.
- published surface (the package gains a skill; `dock` and `init` write one more file, and `dock --json` reports one more entry) — `README.md` § Agent skills, `docs/cli.md` § `init` and § `dock`. The CHANGELOG is written by the release workflow from the `feat:` commit.
- `docs/architecture.md` — no change: no directory added under `src/`, `skills/` is listed as a whole, and the engine's read-only design side is unchanged.
- `CLAUDE.md` § Architecture — none of its couplings touched (no CI job id, registry URL, `action.yml` input or state schema).
- consumers — additive: an existing consumer's `dock` or `init` re-run writes one more file and skips a path it owns; no migration.
- cost — none: no workflow trigger, cron, per-push job or agent fire added.
- ops after-merge issue — none owed: no Routine, cron, workflow, ruleset or Mac install changes, and no vault note covers these paths.
