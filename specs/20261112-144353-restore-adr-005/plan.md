# Plan: Restore the accepted decision record this engine still implements but no longer carries

## Technical context

- Node ESM; no code behaviour changes and no dependency changes. The alias walk already
  exists in `src/modules/styles.mjs` (`boundAliasTarget`, the message it builds, and the
  ordering ahead of the two `#492` skips).
- `docs/adr/` follows the shape `docs/adr/README.md` states: frontmatter with `status` and
  `date`, then `# ADR-NNN: <title>`, then `## Context`, `## Decision`, `## Consequences`.
- `docs/rules.md` is generated from the registries; the `checks` job fails on a stale copy,
  so editing a `description` is incomplete until it is regenerated.
- The record's text already exists, complete, in the repo this engine was copied from at
  `0.26.0`. It is transcribed, not rewritten: the decision is Chris's and its wording is the
  record.

## Design decisions

1. **Transcribe, do not re-derive.** The record is copied from the source at `0.26.0` and
   only its references are adjusted. Rewriting a decision record in one's own words loses
   the thing a record is for.
2. **Historical links keep pointing where the history is.** Issues #684, #686, #697 and pull
   requests #685, #687, and the two comments the record cites, happened in the repo this
   engine was copied from. They stay as links to that repo. Only references to *this
   package* — the rule's owner, the ADR's own path — are renamed. A link rewritten to this
   repo would 404 and would also claim the decision happened here.
3. **The reason gets one home again.** `docs/report-structure.md` currently restates why the
   finding stays. The restatement is removed and replaced by a link, which is what the record's
   own Consequences section requires and what this repo's single-source rule requires.
4. **No test changes.** FR-7 is the guard: the record names four behaviours already pinned by
   `__tests__/modules-styles.test.js`. If a test needs changing, the transcription has changed
   behaviour and is wrong.

## File structure

- `docs/adr/ADR-005-primitive-binding-is-drift.md` — new; the transcribed record.
- `docs/adr/README.md` — add the ADR-005 row; correct the count of records that predate this
  repo.
- `src/modules/styles.mjs` — restore the rule `description`'s final clause with a
  `design-delta's ADR-005` citation, and the four docblock citations.
- `docs/report-structure.md` — replace the restated reason with a link to the record.
- `docs/rules.md` — regenerated.

## Surfaces touched

- a decision worth remembering — `docs/adr/` in this repo gains ADR-005; this is the surface
  the change exists to repair, and the decision is Chris's of 2026-10-26, not a new one
- a published surface: a report shape — the `styles/design-binding-missing` `description` is
  read in consumers' reports and in `docs/rules.md`; regenerate with
  `node scripts/generate-rules-reference.mjs` and confirm `--check` exits 0
- a published surface: the CHANGELOG — a `docs:` entry, since no behaviour changes
- `docs/report-structure.md` — the restated reason becomes a link to the record
- `docs/adr/README.md` — the records table and the pre-existing count
- a rule stated in more than one doc — the reason the finding stays is currently in both the
  rule description and `docs/report-structure.md`; this collapses it to the record and makes
  both pointers, which is the row this change is on the right side of
- `docs/architecture.md` — no directory is added, removed or renamed; `docs/adr/` already
  exists, so nothing changes there
- none — no Routine, cron, workflow trigger or scheduled function changes, so no `cost` line
- none — nothing installed on Chris's Mac, no plugin tree, no `_reusable-*.yml` body, no
  required check name, so no ruleset edit
- the vault — no vault note covers this path and the decision is one repo's, not fleet-wide,
  so it stays in `docs/adr/` and no vault `ADR/` note is added; recorded in the PR body
