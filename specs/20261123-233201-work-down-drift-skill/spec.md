# Spec: A packaged skill that works down drift across a project

## Overview

The build skill brings one component in line with its contract, and the audit skill explains how to read a finding. Nothing covers a project that reports many findings at once: a first audit, an engine upgrade, or a template that reports dozens before any of the user's own code exists. An agent facing that list either fixes whatever it can reach, or makes the count go down the wrong way, by editing a contract, adding an exemption or turning a rule off. This adds a packaged skill that sorts every finding by who can clear it, fixes what code can clear one component at a time, and ends with a report of what is left and who owns it.

## User scenarios

- An agent asked to clean up a project with many findings groups them by rule, side and entity before changing anything, and can say how many there are of each.
- The agent sorts every finding into one pile: code can clear it, the contract's owner must decide, the design side must change, the token system or config owner must decide, or a person must read it.
- The agent fixes the code pile one component at a time through the build skill's update procedure, re-auditing after each, and stops on a contract question instead of changing the contract.
- The agent finds that every finding in a project belongs to somebody else (a fresh template whose only findings are unused tokens), clears none, and reports each group with its owner and the decision it is waiting for.
- The agent's final report gives the count by rule before and after, and no finding has left the list by any route other than a code fix.
- A consumer runs `dock` after an upgrade and gets a discovered stub pointing at the packaged skill.

## Functional requirements

- FR-001: `skills/design-delta-resolve/SKILL.md` ships in the package with a frontmatter `name` equal to its directory and a one-line `description`.
- FR-002: The skill's procedure covers, in order: confirm the contracts validate and no surface was skipped; keep the audit taken before; group findings by rule, side and entity; sort each finding into exactly one pile by who can clear it; order the code pile; fix it component by component through the build skill's update procedure, re-auditing after each; take the audit after; report counts by rule before and after, what was cleared, and each remaining group with its owner.
- FR-003: The skill forbids clearing a finding by editing a contract, an exemption, a rule's severity or any other config, and has the agent prove it by showing those files unchanged.
- FR-004: The skill sends design-side findings through a snapshot-age check before reporting them as the design side's to fix.
- FR-005: The skill names no framework, styling system, design tool vendor, tracker or consuming project.
- FR-006: The skill says what it does not cover.
- FR-007: `dock` writes a linked stub at `skills/design-delta-resolve/SKILL.md` under its `--dir`, guarded like the other linked stubs.
- FR-008: The audit skill names the skill; `README.md` and `docs/cli.md` name it and its stub.

## Success criteria

- [x] The package ships `skills/design-delta-resolve/SKILL.md`, a procedure that groups a project's findings by rule, side and entity, separates what code can clear from contract questions, design-side findings and findings that need a person, fixes code-side drift component by component through the build skill's update procedure, and ends with a report of what was cleared, what is left and who owns each remainder.
- [x] The skill never clears a finding by editing a contract, an exemption or a rule severity, and its report shows the count by rule before and after.
- [x] `design-delta dock` writes a stub for that skill that links to the packaged file, and never overwrites a file at that path it did not generate.
- [x] The audit skill, `README.md` and `docs/cli.md` name the skill and the stub `dock` writes for it.
- [x] **Runnable:** `test -f skills/design-delta-resolve/SKILL.md && npm run verify` exits 0 (exits 1 on `develop`, where the skill does not exist).

## Out of scope

- A flag that scopes `audit` to one component: the skill filters by `entity` the way the build skill does until the engine has one.
- Deciding any finding that belongs to an owner: which tokens a project keeps, what a contract says, what the design tool shows.
- Filing the remainder anywhere: where a project tracks work is its own.
- Any change to the audit, its rules or their severities.
