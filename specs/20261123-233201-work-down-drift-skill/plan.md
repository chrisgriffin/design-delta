# Plan: A packaged skill that works down drift across a project

## Technical context

- A finding is `{ ruleId, severity, surface, side, entity, message }`. `side` is where the engine attributes the drift, which is not who can clear it: a token no component uses is `side: "code"` and no code change is the right fix for it.
- `audit --json` also carries `decided` (findings an exemption hid), `skipped` (surfaces and rules that did not run) and `diagnostics`.
- The build skill's "Updating a component whose contract changed" is the per-component loop: audit, fix the code, re-audit, stop on a contract question.
- This branch is cut from the refresh-skill branch, which carries `LINKED_SKILLS` in `src/cli/commands/dock.mjs`; this stub is one more entry.

## Design decisions

- A skill of its own, `design-delta-resolve`: the audit skill interprets one finding, the build skill fixes one component, and this is the procedure over the whole list. It calls the build skill by name and restates none of its loop.
- Five piles, each with an owner, decided by rule family first and by `side` and `severity` for anything the table does not name: code, contract, design side, tokens and config, and review. A finding is in exactly one.
- The proof that nothing was cleared the wrong way is mechanical: the project's config and every contract file show no diff, and `decided` has the same length before and after.
- The report groups the remainder (one line per rule and owner with a count), since the reader cannot act on dozens of rows.

## Surfaces touched

- `skills/design-delta-resolve/SKILL.md` — new.
- `skills/design-delta/SKILL.md` — names the skill beside the others.
- `skills/design-delta-build/SKILL.md` — its audit step says where a project-wide list is handled.
- `src/cli/commands/dock.mjs` — one more `LINKED_SKILLS` entry.
- `__tests__/cli-dock.test.js`, `__tests__/skills.test.js`, `__tests__/adr-citations.test.js` — the new skill and stub in their expectations.
- `scripts/ci/check-package.sh` — the stub resolves in the tarball.
- published surface (the package gains a skill; `dock` writes one more file and reports one more entry in `--json`) — `README.md` § Agent skills, `docs/cli.md` § `dock` and § `init`. The CHANGELOG is written by the release workflow from the `feat:` commit.
- `docs/architecture.md` — no change: no directory added.
- consumers — additive: an existing consumer's `dock` re-run writes one more file; no migration.
- ops after-merge issue — none owed: no Routine, cron, workflow, ruleset or Mac install changes.
