# Spec: A packaged skill that authors a component's contract

## Overview

The package can audit a project, test the engine and build a component from its contract, but nothing takes an agent from a request to the contract itself. The build skill stops when a component has no contract, `scaffold` only drafts one from code that already exists, and writing one for a new component means reading the authoring guide by hand. This adds a fourth packaged skill that takes a request to a contract that validates and states every decision, asks instead of inventing where the request leaves the component's API open, and hands off to the build skill.

## User scenarios

- An agent asked for a new component that has no code yet writes its contract from the description, asks the requester every API question the description leaves open, and hands the validated contract to the build skill.
- An agent in a project with a design provider configured and a design snapshot on disk writes the contract from the snapshot's entry for the component, treating what the snapshot says as the design side's facts and the code API as a decision.
- An agent asked to contract a component whose code already exists starts from `scaffold`'s draft and resolves every `_scaffold` marker it can.
- An agent with nobody to ask leaves a `_scaffold` marker at exactly each undecided spot, lists them, and fills none with a guess.
- An agent that needs a value the project has no token for stops and asks; it never binds a token path the project lacks.
- A consumer runs `dock` after an upgrade and gets a discovered stub pointing at the packaged skill.
- An agent whose build stopped for want of a contract is pointed at this skill by name.

## Functional requirements

- FR-001: `skills/design-delta-author/SKILL.md` ships in the package with a frontmatter `name` equal to its directory and a one-line `description`.
- FR-002: The skill's procedure covers, in order: confirm no valid or invalid contract already exists for the component; read the project's config, tokens and one sibling contract as the pattern; choose the starting point (existing code through `scaffold`, a design-tool component through the design snapshot when a provider is configured and the snapshot exists, or the description alone); settle every decision a contract states (id, title, sources, props with type, required, default and enum values, slots, design-only axes, anatomy, token bindings and their variants) and ask the requester each one the request leaves open; resolve every token path against the project's tokens file; write the file where the project keeps contracts; validate with `contracts` and read the audit's findings for the new id; report and hand off to the build skill by name.
- FR-003: The skill leaves a `_scaffold` marker only where a decision is pending, and its report lists every one.
- FR-004: The skill never binds a token path absent from the project's tokens file, and says the engine's contract validation does not check that for it.
- FR-005: The skill links the authoring guide for what each construct means and does not restate it.
- FR-006: The skill names no framework, styling system, design tool vendor, tracker or consuming project.
- FR-007: The skill says what it does not cover.
- FR-008: `dock` writes a linked stub at `skills/design-delta-author/SKILL.md` under its `--dir`, guarded like the other linked stubs.
- FR-009: The build skill's "no contract: stop" step and its "What this does not cover" section name the authoring skill; the audit skill names it too.
- FR-010: `README.md`, `docs/cli.md` and `docs/testing.md` say the authoring skill exists and how a consumer reaches it.

## Success criteria

- [ ] The package ships `skills/design-delta-author/SKILL.md`, a procedure that takes a described component, a design-snapshot component or existing code to a contract `design-delta contracts` validates, asks rather than invents where the request leaves an API decision open, and hands off to the build skill by name.
- [ ] The skill leaves `_scaffold` markers only where a decision is pending and lists them, and never binds a token the project's tokens file lacks.
- [ ] `design-delta dock` writes a stub for that skill that links to the packaged file, and never overwrites a file at that path it did not generate.
- [ ] The build skill's "no contract" stop and its "What this does not cover" section point at the authoring skill, and `README.md` and `docs/cli.md` name the skill and the stub `dock` writes for it.
- [ ] **Runnable:** `test -f skills/design-delta-author/SKILL.md && npm run verify` exits 0 (exits 1 on `develop`, where the skill does not exist).

## Out of scope

- `init` writing this stub: `init` keeps writing the one audit stub until that question is settled on its own issue.
- A subcommand that writes a contract from a description: the open decisions are a person's, so the procedure is prose for an agent.
- A contract check that a bound token exists: the skill resolves tokens by reading the tokens file.
- Refreshing a stale design snapshot: the skill reads the snapshot that exists and says how old it is.
