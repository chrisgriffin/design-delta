# Spec: Every ADR this engine names in a consumer-read string says which package owns it

## Overview

This package writes ADR citations into strings a consumer reads inside their own
repo: a rule's `description`, which lands in `docs/rules.md` and in every report,
and the `_scaffold` notes the scaffolder drafts into their contract files. A bare
`ADR-002` there reads as *that repo's* ADR-002, pointing a consumer at a decision
record they do not have. Seven registered rules and one scaffold note carry a bare
citation today, and the test that used to catch them is gone.

The source this engine was copied from attributed every one of them and held it with
a test. The rename stripped the owner's name from the citations and dropped the test
in the same change, so nothing failed. This re-attributes the eight strings and
restores the guard, retargeted to the package that owns them now.

## User scenarios

- A consumer reads `docs/rules.md` or a report finding for `coverage/design-only` and
  sees which package's ADR-003 is meant, so they can find the record.
- A consumer runs the scaffolder and the `_scaffold` note in the drafted contract names
  the owning package's ADR-002 D4, not their own.
- A contributor adds a rule whose `description` cites a bare `ADR-NNN`: `npm test`
  fails, naming the rule id and the citation.
- A contributor adds a scaffold note citing a bare ADR anywhere in a contract
  document: `npm test` fails, naming the note's file and JSON pointer.

## Functional requirements

- **FR-1** Every registered rule whose `description` cites an ADR writes it as
  `design-delta's ADR-NNN`. Seven do not today: `components/prop-missing`,
  `components/enum-values-mismatch`, `coverage/uncontracted-component`,
  `coverage/design-only`, `coverage/design-missing`, `coverage/stale-exemption`,
  `tokens/design-token-mismatch`.
- **FR-2** Every `_scaffold` note the scaffolder writes that cites an ADR attributes it
  the same way. One does not today: the `when` note in `src/spec/scaffold.mjs`.
- **FR-3** One scan owns the definition of an unattributed citation, imported by every
  test that guards one of these surfaces, so widening it reaches all of them. It treats
  `ADR-002`, `ADR 002` and `ADR-2` alike, accepts either apostrophe in the attribution,
  and does not match a citation that is part of a longer word.
- **FR-4** A test scans every rule array the package exports, found by shape rather than
  by name, so a registry exported under a new name is scanned too.
- **FR-5** A test scans every `_scaffold` note anywhere in a drafted contract, at any
  depth, and fails naming the file and the JSON pointer.
- **FR-6** The test asserts that at least one rule description and more than one scaffold
  note cite an ADR at all, so the scan cannot pass vacuously if the citations are removed
  instead of attributed.
- **FR-7** `docs/rules.md` is regenerated from the registries, so the published copy
  carries the attributed descriptions.

## Success criteria

- [ ] **Runnable:** `npm test` exits 0 and its output names an ADR-citation test that
      passed. On `develop` today there is no such test: `ls __tests__/adr-citations.test.js`
      exits 2.
- [ ] A scan of every registered rule's `description` for a citation not written
      `design-delta's ADR-NNN` returns zero. It returns 7 on `develop` today.
- [ ] A scan of every `_scaffold` note a scaffold run drafts returns zero unattributed
      citations. It returns 1 on `develop` today.
- [ ] Adding a rule whose `description` says `per ADR-004` makes `npm test` fail, and the
      failure names that rule's id and `ADR-004`.
- [ ] `node scripts/generate-rules-reference.mjs --check` exits 0, so `docs/rules.md`
      matches the attributed descriptions.
- [ ] `npm run verify` passes.

## Out of scope

- The missing `docs/adr/ADR-005-primitive-binding-is-drift.md` and the citations to it
  that the same rename removed. That is its own ticket: this one holds the citations that
  exist, and the guard it restores then holds ADR-005's citation when it returns.
- Bare ADR citations in source comments and docblocks. They are read in this repo, where
  an unqualified ADR-NNN is correct, and the source this engine came from did not
  attribute them either.
