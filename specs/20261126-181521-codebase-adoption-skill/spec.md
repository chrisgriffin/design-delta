# Spec: a packaged skill that adopts design-delta in an existing codebase

## Overview

`design-delta init` writes a config and the authoring skill writes one contract at a time, but nothing in the package takes a codebase that has never used design-delta to a working setup: a config the owner confirmed, contracts for the components that matter most, a baseline so later findings can be told apart from the drift that was already there, and a CI gate that holds the line without failing the first pull request on that older drift. This adds a packaged skill, `design-delta-adopt`, that runs that sequence by calling the commands and the sibling skills that already exist, never deciding a component's API itself, and ends with a report of what is left and who owns it.

## User scenarios

- Someone asks to set up design-delta in a project that has never used it. The skill installs the package, runs `init`, has the owner confirm each detected value, and runs the first audit.
- The first audit lists many components with no contract. The skill reads that list as the authoring worklist, puts the components most used across the codebase first, and authors their contracts one at a time through the authoring skill, starting each from the code.
- Every question about a component's API that the code does not settle is asked through the authoring skill's own asking step, or marked as undecided when nobody can answer; the adoption skill never answers one.
- With the first contracts written, the skill writes the baseline that lets a later audit mark each finding as new or as already there.
- The skill wires the gate into the project's CI through the package's GitHub Action, at the strictest threshold the project already passes, so the first pull request that carries it is green and a new error still fails.
- The findings that remain go to the resolve skill, and the report names each group, its count and its owner.
- A project that already has a `design-delta.json` is not re-initialized blind: the skill confirms what is there and picks up from the first step that has not been done.
- A project set up with `init` or `dock` finds the skill through a stub, as it finds the others.

## Functional requirements

- FR-001: A packaged skill `skills/design-delta-adopt/SKILL.md`, in the structure, tone and project-neutral stance of the other packaged skills. It names no framework, styling system or design tool, and reads the project's layout, tooling and CI from the project.
- FR-002: It installs the package and runs `init`, or, when a config exists, confirms it and runs `init` only to lay missing stubs. Every value `init` detected is put to the owner to confirm; unattended, each is reported as unconfirmed.
- FR-003: It runs `contracts`, `audit` and `lint` and keeps the first audit as the "before" document; a skipped surface is fixed or reported as unchecked, never read as clean.
- FR-004: It reads `coverage/uncontracted-component` findings (and `map`'s `components.uncontracted`) as the worklist, orders it by how widely each component is used (`impact`), with a component another renders before the ones that render it, and states the order and why in the report.
- FR-005: It authors each contract through `design-delta-author`, starting from code (`scaffold <Component>`), one component at a time, validating each before the next. Every API decision is the author skill's asking step; the adoption skill decides none and never uses `scaffold --uncontracted` to skip that step.
- FR-006: It writes the `snapshot` baseline after the contracts it authored validate, checks the state file is not ignored by the project's version control (and asks if it is), and confirms a following audit tags those components' findings `isNew: false`.
- FR-007: It wires `verify` into CI through the package's composite Action (`action.yml`), pinned to the installed version's tag, with `fail-on` set to the strictest level at which `verify --fail-on <level>` passes on the project today, read from `verify --json`'s `ok`. A project that does not run GitHub Actions gets the same command in the CI it has, or the question asked.
- FR-008: It never edits a contract, an exemption, a rule's severity or any other config to shorten a list or to make the gate pass, and never hand-writes a contract field nobody decided.
- FR-009: It hands the remaining findings to `design-delta-resolve` and reports, per group, the rule, count, owner and the decision each waits on, plus the threshold chosen and what tightening it would take.
- FR-010: `dock` and `init` each write a stub for the skill, guarded like the others, and every surface that lists the packaged skills names it.

## Success criteria

- [ ] `skills/design-delta-adopt/SKILL.md` ships in the package and takes a project with no design-delta through install and `init`, the first audit, an ordered authoring worklist, contracts through the authoring skill, the `snapshot` baseline, CI wiring through the package's Action, and a hand-off to the resolve skill.
- [ ] The skill decides no API question itself, never edits a contract, exemption or rule severity to shorten a list or pass the gate, names no framework, styling system or design tool, and ends with a report of what is left and who owns it.
- [ ] The CI threshold the skill sets is the strictest `fail-on` level the project's current state passes, so the first pull request carrying the gate does not fail on drift that predates it.
- [ ] `design-delta dock` and `design-delta init` each write a guarded stub at `.claude/skills/design-delta-adopt/SKILL.md`.
- [ ] **Runnable:** `test -f skills/design-delta-adopt/SKILL.md && npm run verify` exits 0 (exits 1 on `develop`, where the skill this work adds does not exist yet).

## Out of scope

- A `design-delta adopt` subcommand: every step either needs a person's decision or already has a command.
- Gating `verify` on `isNew`: the engine has no such option today, and adding one is engine work, not a skill.
- A `fail-below` input on the Action, or any change to `action.yml`.
- Refreshing the design side: that is `design-delta-refresh`, and adoption is code-side first.
- A stub for the doctor skill: unchanged.
