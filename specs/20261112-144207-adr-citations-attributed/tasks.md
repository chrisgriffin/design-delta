# Tasks: Every ADR this engine names in a consumer-read string says which package owns it

## Phase 1 — setup

- [ ] T001 Confirm the red: run the scan over every registered rule's `description` and
      record that it returns 7, and that `ls __tests__/adr-citations.test.js` exits 2.

## Phase 2 — foundational: the one scan

- [ ] T002 Add `__tests__/helpers/adr-citations.mjs` exporting `unattributedAdrs(text)`,
      `citesAdr(text)` and `scaffoldNotes(contract)`. The citation pattern is a word
      boundary, `ADR`, an optional hyphen or space, then digits, with a negative
      lookbehind for `design-delta's ` accepting `'` and `’`.
- [ ] T003 Add `__tests__/helpers/rule-arrays.mjs` exporting `ruleArraysOf(index)`, which
      returns every exported value that is a non-empty array of objects with a string
      `id`.

## Phase 3 — the guard

- [ ] T004 Add `__tests__/adr-citations.test.js` asserting every registered rule's
      `description` carries no unattributed citation, failing with `<rule id>: bare <citation>`.
- [ ] T005 In the same file, assert at least one rule description cites an ADR at all, so
      the scan cannot pass by the citations having been deleted.
- [ ] T006 In the same file, drive a scaffold run against a synthetic project reaching
      every note site, and assert no `_scaffold` note carries an unattributed citation,
      failing with `<file><pointer>: bare <citation>`.
- [ ] T007 In the same file, assert the note fixtures reached every kind of note site and
      that every note read is a recognised kind, and that more than one note cites an ADR.
- [ ] T008 In the same file, assert the scan reads `ADR-002`, `ADR 002`, `ADR-2` and
      `ADR4` alike, treats either apostrophe as attribution, and does not match `GADR-1`.

## Phase 4 — attribute the strings

- [ ] T009 Attribute the citations in `src/modules/components.mjs` for
      `components/prop-missing` and `components/enum-values-mismatch`.
- [ ] T010 Attribute the citations in `src/modules/coverage.mjs` for
      `coverage/uncontracted-component`, `coverage/design-only`, `coverage/design-missing`
      and `coverage/stale-exemption`.
- [ ] T011 Attribute the citation in `src/modules/tokens.mjs` for
      `tokens/design-token-mismatch`.
- [ ] T012 Attribute the `when` note's citation in `src/spec/scaffold.mjs`.

## Phase 5 — polish

- [ ] T013 Run `npm run verify` and confirm it passes, the new test included.

## Phase 6 — surfaces

- [ ] T014 Regenerate `docs/rules.md` with `node scripts/generate-rules-reference.mjs`
      and confirm `--check` exits 0, so the published rule reference carries the
      attributed descriptions.
- [ ] T015 Add a `fix:` CHANGELOG entry: the ADR citations a consumer reads now name the
      package that owns them.
- [ ] T016 Read `docs/report-structure.md` and update any passage quoting an
      unattributed citation; if none does, say so in the PR body.
- [ ] T017 Update `docs/testing.md` to list the new test file and the two new helpers.
- [ ] T018 Confirm `docs/architecture.md` needs no change (no directory added, removed or
      renamed) and say so in the PR body.
