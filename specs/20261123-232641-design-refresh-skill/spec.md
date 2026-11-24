# Spec: A packaged skill that refreshes the design-side snapshot

## Overview

The engine never calls a design tool: `gather` prints a plan, an agent runs it and saves the raw responses, and `ingest` turns them into the snapshot every audit reads. The audit skill says this in one paragraph and warns that a stale snapshot reads as current, but nothing walks an agent through the refresh, and an agent that gets one step wrong (a trimmed response, a substituted tool, a pass skipped in silence) writes a snapshot that looks fine and is not. This adds a packaged skill for the whole procedure, from "is there a design side at all" to "here is what changed".

## User scenarios

- An agent asked to refresh the design side in a project with no provider configured stops and reports the engine's own reason.
- An agent in a project whose contracts address no design file reports that the plan is empty and there is nothing to gather.
- An agent reads how old each committed snapshot is before deciding anything, and states those dates.
- An agent runs each pass's plan with the tools the plan names, saves each response whole where the plan says, ingests, and reports what `ingest` skipped.
- An agent whose session lacks a tool a plan needs runs the passes it can, names the ones it could not, and substitutes nothing.
- An agent compares the audit before and after and reports which design-side findings appeared and disappeared.
- A consumer runs `dock` after an upgrade and gets a discovered stub pointing at the packaged skill.

## Functional requirements

- FR-001: `skills/design-delta-refresh/SKILL.md` ships in the package with a frontmatter `name` equal to its directory and a one-line `description`.
- FR-002: The skill's procedure covers, in order: confirm a provider is configured and stop with the stated reason if not; read each snapshot's age from the audit's `provenance` and compare it to the design source where the session can read one; run `gather` for each pass; confirm the session has the tools each plan names; execute the plan and save each raw response, whole, in the envelope `ingest` reads, at the plan's output path; run `ingest` for each pass and read what it skipped; audit, compare with the audit taken before, and report what changed on the design side.
- FR-003: The skill says what to do when the session lacks a tool a plan names: run the passes whose tools are present, report the ones not run, and never substitute another tool.
- FR-004: Every subcommand, flag, payload field and path the skill names exists in the installed CLI.
- FR-005: The skill names no design tool vendor, framework, tracker or consuming project.
- FR-006: The skill says what it does not cover.
- FR-007: `dock` writes a linked stub at `skills/design-delta-refresh/SKILL.md` under its `--dir`, guarded like the other linked stubs.
- FR-008: The audit skill's snapshot section and the authoring skill's design-snapshot step point at the refresh skill; `README.md` and `docs/cli.md` name it.

## Success criteria

- [ ] The package ships `skills/design-delta-refresh/SKILL.md`, a procedure that stops with the engine's stated reason when no design provider is configured, reads each design snapshot's age, runs `gather`, executes the printed plan and saves each raw response where the plan says, runs `ingest`, and reports what changed on the design side between the audit before and the audit after.
- [ ] The skill says what to do when the session lacks a tool a plan names, and never substitutes one.
- [ ] `design-delta dock` writes a stub for that skill that links to the packaged file, and never overwrites a file at that path it did not generate.
- [ ] The audit skill's snapshot section points at the refresh skill, and `README.md` and `docs/cli.md` name the skill and the stub `dock` writes for it.
- [ ] **Runnable:** `test -f skills/design-delta-refresh/SKILL.md && npm run verify` exits 0 (exits 1 on `develop`, where the skill does not exist).

## Out of scope

- A section of the audit skill instead of a skill of its own: the procedure has its own trigger, its own stop conditions and more steps than the audit skill's whole snapshot section, and the audit skill stays a map.
- Any change to `gather` or `ingest`.
- Fixing a design-side finding: that is an edit in the design tool or a contract decision, and neither is this procedure's.
- A staleness rule in the engine: the engine cannot know the design tool changed, only how old its last look was.
