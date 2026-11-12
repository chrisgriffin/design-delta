# Tasks: Restore the accepted decision record this engine still implements but no longer carries

## Phase 1 — setup

- [ ] T001 Confirm the red: `test -f docs/adr/ADR-005-primitive-binding-is-drift.md` fails and
      `grep -c "ADR-005" src/modules/styles.mjs` prints 0.
- [ ] T002 Read the record in the source this engine was copied from at `0.26.0`, and the
      four behaviours it names in `__tests__/modules-styles.test.js`, so the transcription can
      be checked against the code as it stands.

## Phase 2 — the record

- [ ] T003 Add `docs/adr/ADR-005-primitive-binding-is-drift.md`, transcribed, with
      `status: accepted` and `date: 2026-10-26`, and its Context, Decision and Consequences.
- [ ] T004 Rename references to this package inside the record; leave every issue, pull
      request and comment link pointing at the repo the history happened in.
- [ ] T005 Verify each of the four "what the decision leaves unchanged" items still matches
      the code and the named tests in `__tests__/modules-styles.test.js`; if one does not, stop
      and say so rather than editing the record to fit.

## Phase 3 — the pointers

- [ ] T006 Restore the final clause of the `styles/design-binding-missing` `description` in
      `src/modules/styles.mjs`, citing `design-delta's ADR-005`.
- [ ] T007 Restore the four docblock citations in `src/modules/styles.mjs`, including the path
      to the record.
- [ ] T008 Replace the restated reason in `docs/report-structure.md` with a link to the record.

## Phase 4 — polish

- [ ] T009 Run `npm run verify` and confirm it passes with no test file changed
      (`git diff --name-only origin/develop -- __tests__/` is empty).

## Phase 5 — surfaces

- [ ] T010 Add the ADR-005 row to `docs/adr/README.md` and correct its stated count of records
      that predate this repo so it matches the folder.
- [ ] T011 Regenerate `docs/rules.md` and confirm
      `node scripts/generate-rules-reference.mjs --check` exits 0.
- [ ] T012 Add a `docs:` CHANGELOG entry recording that the decision behind the rule is
      documented again; note in it that no behaviour changed.
- [ ] T013 Confirm `docs/architecture.md` needs no change and say so in the PR body.
- [ ] T014 Confirm no vault note covers these paths and that the decision is this repo's
      alone, so no vault `ADR/` note is added; say so in the PR body.
