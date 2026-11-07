---
name: design-delta-doctor
description: Diagnose this engine against a real project — install a build (published release or the local working tree), confirm the project's config/scripts/skill still line up with it, run the full audit, and adjudicate EVERY finding as either a bug in design-delta or genuine drift in the project, always verified against real code or the engine's own source rather than accepted on plausibility. Use before or after cutting a release, when asked to test design-delta, validate a version, or check the engine against a project.
---

# design-delta doctor

A maintainer's diagnostic. The engine is deterministic and well tested in
isolation; what a unit suite cannot tell you is whether its rules say true
things about a **real codebase**. This procedure runs it against one and
adjudicates the result — finding bugs on either side.

**Two-sided by design.** Every finding is either a defect in this engine or
real drift in the project under test, and the value is in never guessing
which. A false finding shipped as truth erodes trust in every report the
engine produces; a real finding waved off as a false positive hides genuine
drift. Both failures come from the same shortcut: reasoning about a finding
instead of checking it.

**Maintainer-oriented, but it ships.** Its sibling
[`skills/design-delta/SKILL.md`](../design-delta/SKILL.md) tells anyone how
to run and read an audit; this one tells you how to put the engine on trial.
That is a maintainer's job, but every step of it executes **inside a
consuming project** — the worktree, the install, the audit, the source
reading are all there. So it ships in the package and a project links it
with a thin stub, the same way the canonical skill is linked. Keeping it
out of the tarball would have put it out of reach of the only place it can
actually run.

Nothing below embeds the schema, rule list, or CLI surface: every step
re-reads those from the build under test, so this file cannot go stale
against them.

## Two modes

| Mode             | What it installs                 | When                                                                   |
| ---------------- | -------------------------------- | ---------------------------------------------------------------------- |
| **Pre-release**  | the working tree, via `npm pack` | before cutting a release — does this change hold up against real code? |
| **Post-release** | the newest published version     | after a release lands — did anything regress in the wild?              |

Pre-release is the one that catches a bad rule before consumers see it.
Post-release is the one that catches what only a real upgrade reveals.

## Target project, and where local variables live

**Required argument: a path to the project to run against.** No default —
this file names no project, and nothing below assumes one. Read the target's
own conventions (its `package.json`, its `design-delta.json`, its own
design-delta skill if it has one) rather than assuming any.

Anything machine- or project-specific stays out of this file and out of
`CLAUDE.md`, which is committed and forbids consumer-specific content
anywhere in it. A default target for one maintainer's machine belongs in
`.claude/settings.local.json`'s `env` block — ignored by this repo's own
`.gitignore` (line 13, added for exactly this reason: a global gitignore
would protect only whoever has it, and this file is meant to hold a local
path), and already read by the harness. A project that wants this procedure
on hand keeps a thin stub of its own carrying its path, integration branch,
and handoff workflow; the canonical procedure is this file.

**Where to file is not a variable — both ends are derivable at runtime:**

- **Engine bugs** → the repo this skill lives in. `node -p
"require('./package.json').repository.url"` names it; `gh issue create`
  from this checkout needs no `--repo` at all.
- **Project drift** → the target's own remote, read from the worktree
  (`gh repo view --json nameWithOwner`), and only if that project's own
  workflow wants tickets. Hand it off rather than assuming.

Never hardcode either.

## The one rule that makes this worth running

**Every finding gets verified against ground truth, never accepted or
dismissed by reasoning about plausibility.** "The engine said so" is not
evidence; "that's probably a false positive" without checking is not
evidence either. For each finding, read the actual file, token, or contract
it names — or, for a suspected engine bug, the actual source of the rule
that produced it — and reach one of exactly two verdicts:

1. **ENGINE BUG** — confirmed by reading the rule's own source at the exact
   version under test: the finding is wrong, and the reason is a defect here
   (a parsing gap, a wrong assumption, a mis-scoped comparison), not a
   matter of opinion.
2. **TRUE DRIFT** — confirmed by reading the real code/tokens/contract: the
   project genuinely disagrees with what its contract says it should be.

No third bucket. An ambiguous finding is not left ambiguous — dig further
(git blame, the compiled CSS output, the rule's source) until it lands on
one side. If something is genuinely a human policy call rather than a
factual question ("should this token exist at all"), that is out of scope:
flag it to the project's owner rather than forcing a verdict.

## Steps

### 1. Isolate — never dirty the target's real checkout

```
cd <target-project>
git status --short   # must be clean before touching anything
git worktree add /tmp/design-delta-doctor <integration-branch> -b chore/design-delta-doctor
cd /tmp/design-delta-doctor
npm ci
```

Everything below happens in that worktree. If nothing worth committing comes
out of it, remove the worktree and its branch at the end — leave zero trace.
If a version bump or config fix IS warranted, that branch is what becomes a
PR in the final step.

### 2. Baseline — capture the CURRENT version's findings first

Before installing anything, run the audit on whatever version the target
already has, and keep the output:

```
npx design-delta audit --json > /tmp/drift-baseline.json
node -p "require('./node_modules/design-delta/package.json').version"
```

Skipping this throws away the single highest-signal diagnostic available: a
finding that **disappeared** across the upgrade is exactly as suspicious as
one that appeared, and neither is visible from the new version's output
alone. Step 6 diffs against this.

If the target has no working install yet (first adoption), say so and treat
this run as having no baseline — a stated absence, not a silently skipped
step.

### 3. Install the build under test

**Pre-release** — the working tree, exactly as a release would package it
(the same thing `scripts/ci/check-package.sh` proves installable):

```
cd <design-delta-repo> && npm pack
cd /tmp/design-delta-doctor
npm install <design-delta-repo>/design-delta-<version>.tgz
```

**Post-release** — the newest published version:

```
LATEST=$(gh release view --repo chrisgriffin/design-delta --json tagName -q .tagName)
CURRENT=$(node -p "require('./package.json').dependencies['design-delta']")
npm install "design-delta@${LATEST#v}"
```

The package is on the public npm registry, so `npm view design-delta version`
answers with no auth.

Either way, confirm what actually landed before trusting a single finding:
`node -p "require('./node_modules/design-delta/package.json').version"`.
In post-release mode, `CURRENT` already equalling `LATEST` is a legitimate
reportable outcome, not a failure to find work.

### 4. Confirm the project still lines up with this build

Read the installed package's own generated docs under
`node_modules/design-delta/docs/` — ground truth for what
changed, never a changelog summary:

- **Config** (`docs/config-reference.md`) — diff its field list against the
  project's `design-delta.json`. Flag any key the project sets that the
  schema no longer documents, and any new key or rule option the project
  could now use but doesn't. Propose; never auto-edit — config is a real
  decision.
- **Scripts** (`docs/cli.md`) — cross-reference the subcommand list against
  the project's own scripts. A subcommand documented with no script wired
  for it is worth flagging.
- **State** — if the state schema changed shape, confirm the project's
  committed state file still validates. The next `snapshot` rewrites it
  naturally, but check rather than assume.
- **Skill link** — if the project keeps a skill describing this engine,
  confirm it is a thin stub linking the packaged
  `skills/design-delta/SKILL.md` rather than hand-written prose about engine
  behavior. Hand-written prose is what goes stale on exactly this upgrade;
  that is why the canonical skill ships in the package.

### 5. Exercise the engine — findings are only half of it

Read the target's `package.json` for how it invokes the engine (projects
commonly wrap it in scripts) and use those. With nothing wired:

```
npx design-delta audit --json > /tmp/drift-audit.json
npx design-delta verify
npx design-delta report
```

A real codebase can falsify claims a unit suite structurally cannot, because
the suite writes its own inputs. Check each one:

- **Determinism** (ADR-001's central claim). Run the audit twice against an
  unchanged tree and byte-compare the two JSON documents; do the same for
  `report --no-timestamp`, which exists for exactly this. Any difference is
  a bug — filesystem or Map iteration order leaking into output is the
  classic cause.
- **Rules that never fire.** Cross-reference every rule id in the installed
  `docs/rules.md` against the ids actually present in the findings. A rule
  that fires zero times on a large real codebase is the documented failure
  mode in `docs/deferred-rules.md` — four rules shipped or nearly shipped
  broken because a fixture matched an assumption the real code didn't use
  (`&[data-size="lg"]` vs `&.lg`, 0 occurrences vs 86). A zero-fire rule is
  not proof of a bug, but it is the best lead this procedure can generate,
  and it is invisible from any test suite. Check each one's assumption
  against the real tree before clearing it.
- **Exit codes.** The gate is the product: a wrong exit code silently
  un-gates every consumer's CI while every report still looks right. Verify
  the real codes against the installed `docs/cli.md` — notably that `verify`
  and `audit --check` return `1` on an error-severity finding and `0` when
  clean, and that `lint` reports without gating.
- **The read-only claim.** The audit path is documented as never editing.
  After a full run, `git status --short` in the worktree must show nothing
  beyond the report/state files the commands were actually asked to write.
- **Cross-command agreement.** `audit`, `verify`, and `report` each
  re-derive the same census. Confirm they agree about the same tree — a
  disagreement between the JSON findings, the rendered report, and the
  gate's verdict is a real bug class no single command's output reveals.

### 6. Diff against the baseline

Compare step 2's findings to step 5's. For **every** appearance and **every**
disappearance, name the reason:

- An appeared finding is either a new rule, a fixed blind spot now seeing
  real drift, or a regression.
- A disappeared finding is either a genuine fix, or a rule that quietly
  stopped working. This direction is the one people skip, and it is where a
  silent regression hides — the count going down looks like progress.

Any delta you cannot tie to a specific change in the version under test is
itself a finding. Do not close the diff with "probably the upgrade."

### 7. Adjudicate — every finding, per the one rule above

Work the full findings list, not a sample. For each:

- **Suspected engine bug**: read the rule's actual logic in
  `node_modules/design-delta/src/` at the exact version under
  test. A failure is just as likely the project calling a removed API as an
  engine defect — never guess from a changelog or a plausible theory. In
  pre-release mode this is the highest-value outcome available: a bad rule
  caught before it ships.
- **Suspected true drift**: open the actual file the finding names. Confirm
  the disagreement by reading it, not by trusting the message.
- **A known-finding note citing an issue number**: do not assume it is still
  needed. Re-test it against this build — an upgrade is the single most
  likely moment for such a note to have become false, and a project carrying
  a workaround for something already fixed is itself a finding.

For every confirmed **engine bug**: file it here (or fix it, if this session
is doing the release) with the root cause, a reproduction, and the exact
version tested. For every confirmed **true drift**: hand it to whatever
workflow the target project uses for tracked work — this procedure
classifies; it does not fix project code or file the project's own tickets.

### 8. Report, and clean up

Summarize: mode and version tested (old → new), alignment gaps, the
invariant results from step 5 (determinism, zero-fire rules, exit codes,
read-only, cross-command agreement — each stated, including the ones that
passed), the baseline delta with a reason per change, and the full
adjudicated list with the evidence behind each verdict, not just a count.
Name every engine issue filed or fixed.

State what was NOT checked as plainly as what was. Remove the worktree and
branch if nothing is worth keeping. If a version bump or config fix is
warranted, open it as a real PR against the target's integration branch —
propose, never auto-merge.

## Hard limits

- Never accept a finding's own message as proof, in either direction.
- Never leave a finding as "probably fine" or "probably a bug" — verify, or
  explicitly flag it as a human policy call. Nothing in between.
- Never dirty the target's real checkout — worktree only.
- Never push a version bump or config change without a real PR.
- Never let a pre-release pass silently become the reason to skip the
  post-release one: a local tarball and a published package are not the same
  artifact until `check-package.sh` and a real install both say so.
- Never report a clean run without saying which invariants were actually
  exercised. "No findings" and "I ran the audit and nothing else" are
  different results, and only one of them is evidence.
