# Spec: Restore the accepted decision record this engine still implements but no longer carries

## Overview

A rule in this engine deliberately diagnoses rather than suppresses: when a design
component binds a primitive where the contract declares the semantic token aliasing it,
`styles/design-binding-missing` reports it and names the token to bind. That is Chris's
decision of 2026-10-26, and the source this engine was copied from records it as
`ADR-005: A component that binds a primitive where its contract declares a semantic token
is drift, not agreement`, `status: accepted`.

The code is still here. The record is not. The rename dropped
`docs/adr/ADR-005-primitive-binding-is-drift.md`, cut the sentence that cited it from the
rule's `description`, removed four docblock citations in `src/modules/styles.mjs`, and
replaced the link in `docs/report-structure.md` with a one-line restatement of the reason —
which that record explicitly says must be a pointer, not a copy. `docs/adr/README.md` still
claims four records came across with the source; the source has five.

So the engine ships an alias walk that deliberately removes no finding, with nothing saying
why — the exact state ADR-005's own Context describes as the defect it was written to fix.
This restores the record and every pointer to it. It changes no behaviour.

## User scenarios

- A contributor reads the alias walk in `src/modules/styles.mjs` and the docblock points at
  the record saying why a walk never removes a finding.
- A consumer reads the `styles/design-binding-missing` description in `docs/rules.md` and
  learns that a component binding a primitive is reported on purpose, and where the
  decision is recorded.
- Someone proposes resolving a declared binding through the alias chain so a bound primitive
  satisfies a declared semantic token; `docs/adr/` shows that reverses an accepted decision
  and needs Chris, not a rule change.
- A reader of `docs/adr/README.md` counts the records that came across with the source and
  the number matches what is in the folder.

## Functional requirements

- **FR-1** `docs/adr/ADR-005-primitive-binding-is-drift.md` exists, carrying the record's
  Context, Decision and Consequences with `status: accepted` and `date: 2026-10-26`.
- **FR-2** References to this package inside the record name it as it is named now;
  references to issues and pull requests that happened in the repo this engine was copied
  from keep pointing there, because that is where they happened.
- **FR-3** `docs/adr/README.md` lists ADR-005 in its records table and its count of records
  that predate this repo matches the folder.
- **FR-4** The `styles/design-binding-missing` rule `description` again states that a
  component binding a primitive where the contract declares the semantic token aliasing it is
  always reported, naming the token to bind, ahead of the unbindable-property and zero-value
  skips, once a bound variable maps exactly to that primitive — and cites the record as
  `design-delta's ADR-005`.
- **FR-5** The four docblocks in `src/modules/styles.mjs` that explain the alias walk cite
  the record again, including the path to it.
- **FR-6** `docs/report-structure.md` links the record where it currently restates the
  reason, so the reason has one home.
- **FR-7** No behaviour changes: the alias walk, the message, `data.boundAliasTarget` and
  every skip stay exactly as they are, and the existing `__tests__/modules-styles.test.js`
  tests the record names still pass unchanged.

## Success criteria

- [ ] **Runnable:** `grep -q "design-delta's ADR-005" src/modules/styles.mjs` exits 0 — the rule
      description cites the record again. It exits 1 on `develop` today: `grep -c "ADR-005"
      src/modules/styles.mjs` prints 0.
- [ ] `docs/adr/ADR-005-primitive-binding-is-drift.md` exists and carries the record's Context,
      Decision and Consequences with `status: accepted` and `date: 2026-10-26`.
- [ ] `grep -c "ADR-005" src/modules/styles.mjs` prints 4 or more, covering the description and the four docblocks.
- [ ] `docs/adr/README.md` links ADR-005 and its stated count of pre-existing records equals
      the number of `ADR-*.md` files in `docs/adr/`.
- [ ] `docs/report-structure.md` links `./adr/ADR-005-primitive-binding-is-drift.md` and no
      longer restates the reason the finding stays.
- [ ] `node scripts/generate-rules-reference.mjs --check` exits 0, so `docs/rules.md` carries
      the restored description.
- [ ] `npm run verify` passes, with no test changed.

## Out of scope

- Any change to how the rule behaves. The decision is already implemented; this records it.
- Re-deciding the question. Reversing it is Chris's call, as the record itself says.
- The seven rule descriptions and one scaffold note whose citations the same rename left
  unattributed. That is its own ticket, which lands first and whose guard then holds the
  citation this one restores.
