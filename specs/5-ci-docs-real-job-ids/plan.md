# Plan: architecture.md and CLAUDE.md name only the CI checks this repo runs, by their real job ids

## Technical context

- `docs/architecture.md` lines 5–7: drop the sentence about CI's `Check docs/` step; the sentence before it already states the convention.
- `CLAUDE.md` § CI line 84: `test` becomes `test_22`, with a note that `test_24`/`test_26` run on a push to `main` only. The job ids come from `.github/workflows/ci.yml` and match `scripts/ci/required-checks.mjs`, `docs/ci.md` and `docs/testing.md`.
- Docs only: no code, schema, workflow or test changes. The gate is `npm test` plus the `checks` chain.

## Surfaces touched

- `docs/architecture.md`: one sentence removed. No directory added, removed or renamed.
- `CLAUDE.md`: one line in § CI; stays under the 9500-byte budget `ci.yml` sets.
- No workflow job renamed, so no ruleset change. No published surface, vault note, Routine or cron.
- cost — none: no trigger, job or agent run added.
