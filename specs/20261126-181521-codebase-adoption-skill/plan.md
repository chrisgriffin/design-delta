# Plan: a packaged skill that adopts design-delta in an existing codebase

## Technical context

- The packaged skills are Markdown procedures under `skills/<name>/SKILL.md`. `__tests__/skills.test.js` checks every command, flag, rule id and config key their code names against the engine's own registries, so a flag the skill invents fails the suite.
- `src/cli/commands/dock.mjs` holds `LINKED_SKILLS`; `dock` and `init` write one guarded stub per entry through `linkedStubTemplates()`. Three other files pin the list: `scripts/ci/check-package.sh` (two loops and a count floor), `__tests__/cli-dock.test.js` and `__tests__/adr-citations.test.js` (the shipped skill list). `__tests__/cli-init.test.js` iterates `LINKED_SKILLS` and needs no edit.
- The commands the procedure drives, each with its real flags from `docs/cli.md`: `init [--yes]`, `contracts --json`, `audit --json [--contract <id>]`, `lint --json`, `map --json` (`components.uncontracted`), `impact <Component> --json` (`usedBy`), `scaffold <Component>`, `snapshot --json`, `verify --json --fail-on <error|warn|review|none>`.
- `isNew` is set on a finding only when `state.json` exists and the entity is a contracted component; `verify` reports counts and `ok`, and has no option that gates on `isNew`. So "do not fail the first PR on old drift" can only be met through `fail-on`.
- `action.yml` takes `config-path`, `fail-on`, `sarif`, `sarif-path`; `docs/github-action.md` holds the example workflow and the tag-pinning rule.

## Design decisions

- Name: `design-delta-adopt`, named for what it does, in the pattern of the other packaged skills.
- An orchestration procedure, not a new engine command. Each step calls a command that exists or a sibling skill; the adopt skill repeats none of their procedures and points at each.
- Authoring is per component through `design-delta-author`, starting from `scaffold <Component>`. `scaffold --uncontracted` is named only to say it is not used here: it drafts every contract at once and skips the asking step where API decisions are made.
- Order: a component another component renders first (so its contract exists when the one rendering it is written), then by `impact`'s `usedBy` count, most used first. Ties keep `map`'s order, which is sorted. Each component is named for `impact` and `scaffold` from its file's basename (both match the kebab-cased name to the basename, not the export); `usedBy` counts only relative imports from inside `paths.componentsDir`, so when every count is 0 the order is `map`'s and the report says so.
- Scope of one session: the owner says how many components to author; unattended, the skill stops after the first few and leaves the rest on the worklist in the report, rather than writing many contracts full of `_scaffold` notes.
- Baseline after authoring: `snapshot` once the authored contracts validate, so the components just contracted read `isNew: false` until they change. Its file must be tracked for CI to see it; if the project ignores it, that is a question, not a config edit.
- Threshold: try `verify --json --fail-on` at `review`, `warn`, `error`, `none` in that order and take the first whose `ok` is `true`. An invalid contract fails every level; that is fixed in the contract (the author skill) before CI is wired. Tightening later is the owner's call, reported with what it would take.
- Pin the Action to `v<installed version>`, so the Action's steps and the CLI `npx` resolves agree. `sarif` stays at its default: turning it on needs a permission and code scanning, which is the owner's call.
- No GitHub Actions in the project: the same `verify --fail-on <level>` goes into the CI the project has, or the question is asked.
- The doctor skill is out: adoption is a consumer task, doctor is the maintainer's.

## Surfaces touched

- `skills/design-delta-adopt/SKILL.md` — new.
- `skills/design-delta/SKILL.md` — names the skill beside the others.
- `skills/design-delta-author/SKILL.md`, `skills/design-delta-resolve/SKILL.md` — no change needed: neither lists its siblings exhaustively; checked by grep.
- `src/cli/commands/dock.mjs` — one more `LINKED_SKILLS` entry.
- `__tests__/skills.test.js` — the package ships the new skill, plus a test that the adopt skill tries every `verify --fail-on` level the engine accepts (read from `SEVERITIES`), strictest first, and that every Action input it names is one `action.yml` declares; `__tests__/cli-dock.test.js` and `__tests__/adr-citations.test.js` — the new stub and skill in their expectations.
- `scripts/ci/check-package.sh` — the stub resolves in the tarball: both loops and the count floor.
- published surface (the package gains a skill; `dock` and `init` write one more file, and `dock --json` reports one more entry) — `README.md` § Agent skills, `docs/cli.md` § `init` and § `dock` (including the template count). The CHANGELOG is written by the release workflow from the `feat:` commit.
- `docs/github-action.md` — one line pointing a first-time adopter at the skill for choosing `fail-on`; the example and inputs are unchanged.
- `docs/architecture.md` — no change: no directory added under `src/`, and `skills/` is listed as a whole.
- `action.yml` — no change.
- consumers — additive: an existing consumer's `dock` or `init` re-run writes one more file and skips a path it owns; no migration.
- ops after-merge issue — none owed: no Routine, cron, workflow, ruleset or Mac install changes, and no vault note covers these paths.
- cost — none: no workflow trigger, job or agent fire is added.
