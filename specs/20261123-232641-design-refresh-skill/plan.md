# Plan: A packaged skill that refreshes the design-side snapshot

## Technical context

- `design-delta gather` prints one JSON plan per pass (no flag: components; `--tokens`; `--bindings`): `provider`, `tool`, `targets[]` each with `args` and `outputPath`, and `planHash`. It exits 1 with `no design.provider configured` when none is set, and 0 with `targets: []` when nothing is addressed.
- `design-delta ingest <raw-file...>` reads one envelope per file: `provider`, `fileKey` and `payload` are required; `gatheredAt`, `planHash` and `providerVersion` feed the snapshot's `provenance`; a token envelope carries the `tool` its target named. It writes `design-components.json` or `design-tokens.json` under `paths.snapshotDir`, skips a file it cannot read with a stated reason, carries the bindings pass's fields forward on a components-only ingest, and fails a bindings-only ingest with no census.
- `audit --json` reports `provenance.designComponents` and `provenance.designTokens` (`null` when absent or invalid, `gatheredAt` when stamped, `normalizationStale` when the engine moved on) and `skipped.design*` reasons.
- This branch is cut from the authoring-skill branch, which adds `LINKED_SKILLS` to `src/cli/commands/dock.mjs`; the refresh stub is one more entry.

## Design decisions

- A skill of its own, `design-delta-refresh`: see the spec's out-of-scope note.
- The skill names tools only as "the tool the plan names": the plan is where the provider's vocabulary lives, so the skill carries none.
- The envelope shape is stated in the skill, because the plan does not print it and a response saved bare is skipped by `ingest`.
- Before and after are two `audit --json` documents compared by `ruleId` and `entity`; no new engine output.
- Snapshot age is read from `provenance`, with the snapshot files' commit history as the fallback for a snapshot that predates it.

## Surfaces touched

- `skills/design-delta-refresh/SKILL.md` — new.
- `skills/design-delta/SKILL.md` — the snapshot section points at the refresh skill; the linking section names its stub.
- `skills/design-delta-author/SKILL.md` — "refreshing a snapshot is a separate task" names the skill.
- `src/cli/commands/dock.mjs` — one more `LINKED_SKILLS` entry.
- `__tests__/cli-dock.test.js`, `__tests__/skills.test.js`, `__tests__/adr-citations.test.js` — the new skill and stub in their expectations.
- `scripts/ci/check-package.sh` — the refresh stub resolves in the tarball.
- published surface (the package gains a skill; `dock` writes one more file and reports one more entry in `--json`) — `README.md` § Agent skills, `docs/cli.md` § `dock`, § `init` and § `gather`. The CHANGELOG is written by the release workflow from the `feat:` commit.
- `docs/cli.md` § `gather` — says the agent wraps each response in the envelope `ingest` reads, which the section left out.
- `docs/architecture.md` — no change: no directory added.
- consumers — additive: an existing consumer's `dock` re-run writes one more file; no migration.
- ops after-merge issue — none owed: no Routine, cron, workflow, ruleset or Mac install changes.
