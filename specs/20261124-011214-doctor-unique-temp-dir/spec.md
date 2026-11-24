# Spec: the doctor skill works in a unique temporary directory per run and always removes it

## Overview

The doctor skill tells an agent to create its worktree at one fixed path under `/tmp`, on one fixed branch name, and to write its two audit documents to two more fixed paths there. A run that is interrupted leaves all of that behind, so the next run's `git worktree add` fails on a path and a branch that already exist, and a second run on the same machine would read or overwrite the first one's audit documents. The skill also hardcodes this repository's name in its post-release command, two paragraphs after saying a destination is never hardcoded.

## User scenarios

- A maintainer runs the doctor after an earlier run was interrupted, and it starts: nothing the earlier run left behind is in its way.
- Two doctor runs on one machine never read each other's baseline or audit documents.
- A run that finishes, fails or is abandoned ends with its worktree and its temporary directory removed, and a branch kept only when it carries a change worth a pull request.
- A maintainer finds what an interrupted run left and removes it with the commands the skill gives.

## Functional requirements

- FR-001: Step 1 creates one new directory with `mktemp -d` and puts the worktree and every working file of the run inside it. No step names a fixed path under a system temporary directory.
- FR-002: The worktree's branch name is unique to the run, so a branch an interrupted run left cannot block the next one.
- FR-003: The steps refer to that directory by the path `mktemp` printed, written as a placeholder, because an agent's shell calls do not share variables.
- FR-004: The final step removes the worktree and the directory on every exit from the procedure, a failed or abandoned run included, and removes the branch unless it carries a change that was pushed for a pull request.
- FR-005: The skill says how to find and remove what an interrupted run left.
- FR-006: The post-release command reads the newest published version from the registry, naming no repository.
- FR-007: A test fails when any packaged skill's code names a fixed path under a system temporary directory, and when the doctor skill stops creating its directory with `mktemp -d` or stops removing it.

## Success criteria

- [ ] The doctor skill creates one directory per run with `mktemp -d`, keeps its worktree and both audit documents inside it, and uses a branch name unique to the run.
- [ ] Its last step removes the worktree and the directory however the run ended, and it says how to clear what an interrupted run left.
- [ ] No packaged skill's code names a fixed path under `/tmp`, and `__tests__/skills.test.js` fails if one returns.
- [ ] The post-release command names no repository.
- [ ] **Runnable:** `! grep -rn "/tmp/" skills/ && grep -q "mktemp -d" skills/design-delta-doctor/SKILL.md && npm run verify` exits 0 (exits 1 on `develop`, where the doctor skill names three fixed `/tmp` paths).

## Out of scope

- A generated stub for the doctor skill: unchanged, it has none.
- Creating the worktree with any one machine's worktree tool: the skill names no machine's conventions, and a project that has its own says so in its instructions.
- Any change to what the doctor checks or how it adjudicates a finding.
