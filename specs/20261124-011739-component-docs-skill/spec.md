# Spec: a packaged skill that writes a component's documentation page from its contract

## Overview

A contract already states what a component is: its props with their types, defaults and enum values, its slots, the elements it renders, its states and the token each element binds. A project's documentation page for that component repeats all of it by hand, and goes stale the day the contract changes. Nothing in the package turns a contract into that page. This adds a packaged skill that does, in the documentation format the project already uses, stating only what the contract states and marking every place the contract is silent as needing a person.

## User scenarios

- Someone asks for a documentation page for a component that has a contract, and gets one in the project's own documentation format, placed and registered the way its other pages are.
- A reader of that page can tell which parts were generated from the contract and which a person wrote, and finds a marked question wherever the contract says nothing (when to use the component, how it behaves under the keyboard).
- The contract changes, the skill is run again, and only the generated parts change: what a person wrote on the page is untouched, and the report names any of it that now mentions a prop or value the contract dropped.
- The skill is run again against an unchanged contract and the page does not change.
- A project with no component documentation yet is asked where and in what format its pages should go, with a recommendation read from the tooling it has, before anything is written.
- A project set up with `init` or `dock` finds the skill through a stub, as it finds the others.

## Functional requirements

- FR-001: A packaged skill `skills/design-delta-docs/SKILL.md`, in the structure, tone and project-neutral stance of the other packaged skills. It names no framework, documentation tool or file layout: it reads them from the project.
- FR-002: It stops when the component has no valid contract, as the build skill does, and never writes a contract.
- FR-003: It states, from the contract and nothing else: purpose and status, the props with type, whether required, default and enum values, the slots, the states (design-only axes), the anatomy in render order with what each node renders and when, the attributes each node carries, each rendered shape, the token bound to each property per element and variant, combinations the contract forbids, and usage guidance where the contract's `intent` gives it.
- FR-004: Wherever the contract is silent (usage guidance with no `intent`, behavior, keyboard and focus, content guidance), the page carries a marked question for a person, never an answer. A `_scaffold` note in the contract is carried to the page as undecided.
- FR-005: The format, location, naming and registration of the page are read from a sibling component's page. With no sibling page, the choice is asked, with a recommendation from the documentation tooling the project has; unattended, the page is plain Markdown beside the contract and the report says so.
- FR-006: Generated parts sit between markers written as comments in the page's own format, and a header line says which contract the page was generated from. A re-run rewrites only what is between markers. A page without the header is the project's own and is not edited.
- FR-007: A re-run against an unchanged contract leaves the page byte-identical; after a contract change, the report lists what changed and any hand-written text naming something the contract no longer has.
- FR-008: The report says whether the code agrees with the contract (the audit scoped to the component), since the page describes the contract.
- FR-009: `dock` and `init` each write a stub for the skill, guarded like the others.
- FR-010: A test fails when a top-level contract field, a prop type or a prop field the schema defines is not named in the skill, so a contract construct added later cannot be silently left off every page.

## Success criteria

- [ ] `skills/design-delta-docs/SKILL.md` ships in the package and takes one contract to a documentation page covering anatomy, props with types, defaults and enum values, slots, token bindings, states, and usage guidance.
- [ ] The skill states only what the contract states, and marks each place the contract is silent as needing a person.
- [ ] The page is written in the project's existing documentation format, read from the project, and a re-run changes only the generated parts: nothing when the contract is unchanged.
- [ ] `design-delta dock` and `design-delta init` each write a guarded stub at `.claude/skills/design-delta-docs/SKILL.md`.
- [ ] The skill was run against a real consuming project, for a first page and for a re-run after a contract change.
- [ ] **Runnable:** `test -f skills/design-delta-docs/SKILL.md && npm run verify` exits 0 (exits 1 on `develop`, where the skill does not exist).

## Out of scope

- A `design-delta` subcommand that renders the page: the format is the project's, and the engine names no documentation tool.
- New examples, stories or tests for the component: those are the build skill's.
- Writing or changing a contract, including adding `intent` to one.
- A machine-readable block on the page: the contract file is that.
- A stub for the doctor skill: unchanged.
