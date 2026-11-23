# Plan: The README says --fail-on can make verify gate on warn and review findings

## Technical context

- `src/cli/commands/verify.mjs` accepts `--fail-on <error|warn|review|none>`, default `error`; `docs/cli.md` § `verify` documents it.
- The README's `verify` paragraph replaces "`review`/`warn` findings are reported, never gating" with: reported only by default, `--fail-on` moves the threshold, with a link to `docs/cli.md` § `verify`.
- No test pins this sentence (the CLI-docs parity test checks command names only), so this is a README-only edit.

## Surfaces touched

- `README.md` § Usage, the `verify` paragraph.
- Not changed, named in the PR body: `skills/design-delta/SKILL.md`, `src/core/findings.mjs`'s `warn` description (and the generated `docs/rules.md`), `docs/report-structure.md`'s severity table, which state the same old absolute.
- No workflow, ruleset, vault note, Routine or cron.
