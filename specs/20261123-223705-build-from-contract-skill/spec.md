# Spec: A packaged skill that builds a component from its contract

## Overview

The package ships two skills: one runs and reads an audit, one puts the engine on trial. Nothing takes an agent from a contract to code; `scaffold` only goes the other way, from code to a draft contract. A contract already holds what a build needs (props, defaults, enum values, slots, anatomy, token bindings, source paths), and the engine can then prove the code matches it, so a contract-driven build skill belongs in this package. It also gives a consumer's own "add a component" command something to sit behind.

## User scenarios

- An agent in a consuming project is given a contract path or a component id and produces the files the contract's `sources` name, plus whatever the sibling components carry beside theirs, then runs the audit until that component reports nothing.
- An agent asked to build a component that has no contract is told so and pointed at the authoring guide and `scaffold`; it never invents a contract.
- An agent whose audit cannot go clean without changing the contract stops and reports a contract question; it never edits the contract to pass.
- A consumer runs `dock` after an upgrade and gets a discovered stub that points at the packaged skill, as it already does for the audit skill.
- A maintainer renames a subcommand, a flag or a rule id that a packaged skill names, and the gate fails naming the skill and the stale name.

## Functional requirements

- FR-001: `skills/design-delta-build/SKILL.md` ships in the package with a frontmatter `name` equal to its directory and a one-line `description`.
- FR-002: The skill's procedure covers, in order: take a contract by path or id and stop when none exists; validate it and stop on an invalid one; read the project's config and one sibling component with its contract as the pattern; generate what `sources` names so every prop, default, enum value, slot and anatomy element is realized, a `code: "none"` axis is never a prop, and values come from the project's tokens; add what siblings have alongside and nothing they lack; audit that component until it has no findings and run the project's own gate; report what was created, the audit result and what was ambiguous.
- FR-003: The skill names no framework, styling system, design tool or consuming project, and assumes none beyond what the contract's `sources` and the sibling show.
- FR-004: The skill says what it does not cover.
- FR-005: `dock` writes a linked stub at `skills/design-delta-build/SKILL.md` under its `--dir`, pointing at the packaged skill, and leaves a file there it did not generate untouched, reported as `skipped`.
- FR-006: The gate checks every packaged skill: frontmatter, and that each subcommand, flag and rule id it names in code is one the engine has. The check reads the engine's own registries, never a hand-written list.
- FR-007: The package check proves that every stub `dock` writes links to a file present in the installed tarball.
- FR-008: `README.md`, `docs/cli.md` and the audit skill's own text say the build skill exists and how a consumer reaches it.

## Success criteria

- [ ] The package ships `skills/design-delta-build/SKILL.md`, a procedure that takes a contract to code and audits the result until that component reports no findings, and that stops with a contract question, never a contract edit, when it cannot.
- [ ] `design-delta dock` writes a stub for that skill that links to the packaged file, and never overwrites a file at that path it did not generate.
- [ ] The gate fails when a packaged skill is missing from the installed package, has frontmatter without a `name` matching its directory or without a `description`, or names in code a subcommand, flag or rule id the engine does not have.
- [ ] `README.md` and `docs/cli.md` name the build skill and the stub `dock` writes for it.
- [ ] **Runnable:** `test -f skills/design-delta-build/SKILL.md && npm run verify` exits 0 (exits 1 on `develop`, where the skill does not exist).

## Out of scope

- A consumer CLI command that calls the skill.
- Adopting the skill in any consuming project; that is the consumer's own change after a release carries it.
- A per-component filter flag on `audit`: the skill filters `audit --json` by `entity`.
- `init` writing the build stub: `init` keeps writing the one audit stub; `dock` is the command that lays the full set.
