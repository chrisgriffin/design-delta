# Plan: the doctor skill works in a unique temporary directory per run and always removes it

## Technical context

- `skills/design-delta-doctor/SKILL.md` step 1 runs `git worktree add /tmp/design-delta-doctor <integration-branch> -b chore/design-delta-doctor`; steps 2 and 5 write `/tmp/drift-baseline.json` and `/tmp/drift-audit.json`; step 3 changes into the fixed path again. Step 8 removes the worktree only "if nothing is worth keeping".
- A git branch lives in the repository, not in the worktree, so a worktree can always be removed without losing a commit on its branch.
- An agent runs each command in a new shell: a variable set in step 1 is gone by step 2, and an `EXIT` trap would fire at the end of step 1's own call. So the cleanup is a step the procedure always reaches, not a trap.
- `__tests__/skills.test.js` already extracts every piece of code from each packaged skill (`codeOf`), and `scripts/ci/check-package.sh` already uses `mktemp -d` for its own work.
- The skill says the package is on the public npm registry and `npm view design-delta version` answers with no auth; the post-release block uses `gh release view --repo <this repository>` instead.

## Design decisions

- One directory per run from `mktemp -d "${TMPDIR:-/tmp}/design-delta-doctor.XXXXXX"`, the worktree at `<work>/project`, the audit documents beside it. `git worktree add` accepts a path that does not exist yet.
- Branch `chore/design-delta-doctor-<suffix>`, the suffix being the directory's own random one: unique with nothing more to generate.
- `<work>` is a placeholder the agent fills with the printed path, the way the skill already writes `<target-project>`.
- Cleanup is unconditional. A change worth keeping is committed and pushed first, then the worktree goes like any other; only the branch outlives the run.
- Leftovers: `git worktree list` in the target names them; the skill gives the remove, prune and branch-delete commands, for a worktree a doctor run created and nothing else.
- Post-release: `LATEST=$(npm view design-delta version)`. One command fewer, and no repository named.
- The test covers every packaged skill, not the doctor alone: a fixed temporary path is the same bug in any of them.

## Surfaces touched

- `skills/design-delta-doctor/SKILL.md` — steps 1, 2, 3, 5 and 8, and the hard limits.
- `__tests__/skills.test.js` — the fixed-temporary-path check, its failure path, and the doctor's `mktemp -d` and removal.
- published surface (a packaged skill's procedure) — `README.md` and `docs/` name no doctor path or branch (`git grep` for `/tmp/` and `design-delta-doctor` outside `skills/` finds only the skill's name), so no doc changes. The CHANGELOG is written by the release workflow from the `fix:` commit.
- `docs/architecture.md` — no change: no directory added.
- consumers — none to migrate: the skill has no generated stub, and a project's own stub links the packaged file.
- ops after-merge issue — none owed: no Routine, cron, workflow, ruleset or Mac install changes.
