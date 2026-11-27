# Spec: a packaged skill that builds a component in the design tool from its contract

## Overview

design-delta compares a contract with the code and, separately, with the design tool. A packaged skill already takes a contract to code and audits until clean (`design-delta-build`), but nothing goes the other way on the design side: the refresh skill only reads the design tool, and the authoring and build skills both say they never create or edit a design-tool component. This adds a sibling skill, `design-delta-build-design`, that takes a contract to a design-tool component using the session's own design-tool tools, then runs the refresh procedure and audits the contract↔design side until that component has no design-side findings. It is a procedure an agent session carries out; the engine itself gains nothing and stays read-only, with no agent inside it.

## User scenarios

- Someone with a session connected to their design tool asks for a contract's component to be built there, and gets a component whose properties, variants, layers and variable bindings are the ones the contract states, followed by a refreshed snapshot and a scoped audit that shows no design-side findings for it.
- A contract changes, the skill is run again, and the existing design component is brought back in line: the audit's design-side findings for it are the list of what to change.
- A session without design-tool write tools asks for the same thing and is told so, with nothing written anywhere.
- A contract leaves something open (a `_scaffold` note), binds a token the design tool has no variable for, or declares something the design tool cannot express. The skill builds the rest, leaves that part alone, and reports it instead of guessing.
- A project set up with `init` or `dock` finds the skill through a stub, as it finds the others.

## Functional requirements

- FR-001: A packaged skill `skills/design-delta-build-design/SKILL.md`, in the structure, tone and project-neutral stance of the other packaged skills. It names no design tool, framework or styling system: it reads them from the project and the session.
- FR-002: It stops when the component has no valid contract, as the build skill does, and never writes or changes the contract's API.
- FR-003: It stops, writing nothing, when no design provider is configured or the session lacks the design tool's write tools, and reports which.
- FR-004: It maps every contract construct the design side is compared on to what the design component carries: each prop by its `design` marker (none, unverified, a rename, a mechanism), each design-only axis (`code: "none"`), each enum value, the anatomy as named layers of the declared types, each token binding as a bound variable, and `invalidVariantCombinations` as combinations not created. The provider's own vocabulary (address shape, naming, how a token becomes a variable) is read from a sibling design component, never assumed.
- FR-005: It binds only variables that map to tokens the project has, never creates a variable or a token, and never picks a variable by its value.
- FR-006: It never invents a decision the contract leaves open: a `_scaffold` note stays open, and which design file a new component goes in is the request's or a sibling's, never a guess.
- FR-007: After creating a component that had no design address, it records that address in the contract's `sources.design`, in a sibling contract's shape and nothing else, and confirms the gather plans now name it.
- FR-008: It runs the refresh skill's procedure, then `audit --json --contract <id>`, and repeats fix → refresh → audit on the design-side findings until none remain or what is left is reported as a contract question or something the engine could not check.
- FR-009: Its report lists what was created or changed in the design tool, the address recorded, the passes refreshed, the design-side findings left and why, and everything ambiguous.
- FR-010: `dock` and `init` each write a stub for the skill, guarded like the others.
- FR-011: The build, authoring and refresh skills' "what this does not cover" lines, the audit skill's list of siblings, the README and `docs/cli.md` point at the new skill.
- FR-012: A test fails when a design marker, a mechanism, a prop type or an anatomy node field the schema defines is not named in the skill, and when any packaged skill names a design tool a provider is registered for.

## Success criteria

- [ ] `skills/design-delta-build-design/SKILL.md` ships in the package and takes one contract to a design-tool component through the session's own design-tool tools, then refreshes and audits until the component has no design-side findings.
- [ ] The skill stops and reports, writing nothing, when the session lacks design-tool write tools or no design provider is configured.
- [ ] The skill never invents a decision the contract leaves open, binds only variables that map to tokens the project has, and reports what was created and what still disagrees.
- [ ] The engine gains no code that calls or writes to a design tool: the change touches nothing under `src/` but the one `LINKED_SKILLS` entry.
- [ ] `design-delta dock` and `design-delta init` each write a guarded stub at `.claude/skills/design-delta-build-design/SKILL.md`.
- [ ] The build, authoring and refresh skills, the audit skill's sibling list, the README § Agent skills and `docs/cli.md` § `init`/§ `dock` name the new skill.
- [ ] **Runnable:** `test -f skills/design-delta-build-design/SKILL.md && npm run verify` exits 0 (exits 1 on `develop`, where the skill does not exist).

## Out of scope

- An engine command that prints a build plan, or a provider member that writes to a design tool: the contract already is the provider-neutral description of what to build, and the engine's audit path stays read-only.
- Creating design variables, text styles or tokens: a value with no variable is a token task.
- Building the code side: that is `design-delta-build`.
- A live trial against a real project's design file: it writes to someone's design file, which needs the owner's go-ahead (see the PR).
