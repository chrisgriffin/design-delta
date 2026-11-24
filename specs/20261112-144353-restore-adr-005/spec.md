# Spec: Restore the accepted decision record this engine still implements but no longer carries

## Overview

A rule in this engine deliberately diagnoses rather than suppresses: when a design
component binds a primitive where the contract declares the semantic token aliasing it,
and none of the rule's three skips applies, `styles/design-binding-missing` reports it and
names the token to bind. That is the maintainer's decision of 2026-10-26, and the source
this engine was copied from records it as `ADR-005: A component that binds a primitive where
its contract declares a semantic token is drift, not agreement`, `status: accepted`.

The code is here; the record is not. It was written in the source two days after the
0.26.0 cut this engine was copied from, so the copy never carried it: the rule's
`description` does not cite it, no docblock in `src/modules/styles.mjs` points at it, and
`docs/report-structure.md` restates the reason in one line where that record says a pointer
belongs. `docs/adr/README.md`'s count of four pre-existing records is correct until this
change adds the fifth.

So the engine ships an alias walk that deliberately removes no finding, with nothing saying
why — the exact state ADR-005's own Context describes as the defect it was written to fix.
This brings the record over as first written, which matches this engine's code, and points
at it from the rule and its docblocks. It changes no behaviour.

## Corrections (2026-11-23)

Corrected after the build, so the requirements below say what was decided on the issue
rather than leaving a note to override them:

- **Overview.** It said the rename dropped the record and that the source has five records
  where the README claims four. Neither held: the record postdates the 0.26.0 cut, so nothing
  was dropped and the README's "four" was true until this change. Rewritten above.
- **FR-2.** It asked for the source's issues and pull requests to stay as links there. This
  repo is public and the source is private, so those links 404 here; the decision on the
  issue keeps them as plain references to that history, and the record names no person.
- **FR-4.** It asked the description to say the finding is reported "ahead of the
  unbindable-property and zero-value skips". That is the later amendment's behaviour, which
  this engine does not ship: here the alias diagnosis runs only after all three skips. The
  decision on the issue restores the record as first written, and porting that behaviour is
  a separate ticket, so FR-4 now states what the code does.
- The citations go in the description and the four alias-walk comments (`buildAliasIndex`,
  `expandThroughAliases`, `runDesignBindingsCheck` and the walk's call site), which is what
  the success criteria count.

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
  references to issues and pull requests in the repo this engine was copied from stay as
  plain references to that history, never links, and the record names no person.
- **FR-3** `docs/adr/README.md` lists ADR-005 in its records table and its count of records
  that predate this repo matches the folder.
- **FR-4** The `styles/design-binding-missing` rule `description` states that, when none
  of the unbindable-property, zero-value and `tokenMap` skips applies, a component binding a
  primitive where the contract declares the semantic token aliasing it is reported, naming
  the token to bind — and cites the record as `design-delta's ADR-005`.
- **FR-5** The four docblocks in `src/modules/styles.mjs` that explain the alias walk cite
  the record again, including the path to it.
- **FR-6** `docs/report-structure.md` links the record where it currently restates the
  reason, so the reason has one home.
- **FR-7** No behaviour changes: the alias walk, the message, `data.boundAliasTarget` and
  every skip stay exactly as they are, and the existing `__tests__/modules-styles.test.js`
  tests the record names still pass unchanged.

## Success criteria

- [ ] **Runnable:** `grep -q "design-delta's ADR-005" src/modules/styles.mjs` exits 0 — the rule
      description cites the record again. It exits 1 on `develop` today: `grep -c "ADR-005" src/modules/styles.mjs` prints 0.
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
