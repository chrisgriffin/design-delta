---
name: design-delta-adopt
description: Adopt design-delta in an existing codebase that has never used it — install the package and run init (or confirm the config already there), take the first audit, read its coverage findings as the authoring worklist and order it by how widely each component is used, author contracts one component at a time through the authoring skill starting from the code, write the snapshot baseline so later findings carry isNew, wire verify into CI through the package's GitHub Action at the strictest threshold the project already passes, and hand the remaining findings to the resolve skill with a report of what is left and who owns it. Use when asked to set up, adopt, install, onboard or roll out design-delta in a project, or to get a project from no contracts to a working CI gate.
---

# design-delta adopt — from no design-delta to a gate that holds

This file ships inside `design-delta` and describes **exactly the version
installed** in this project. Its sibling
[`skills/design-delta/SKILL.md`](../design-delta/SKILL.md) explains the model
and how to read a finding; every command below is in
[cli.md](../../docs/cli.md) with its flags and exit codes. This file is the
order the other procedures run in when a project starts from nothing, and it
repeats none of them.

**Adoption is a sequence of decisions, and almost none of them are yours.**
The config describes the project's layout, and its owner confirms it. Each
contract is a decision about a component's API, and the authoring skill asks
whoever owns it. Which findings a project accepts is its owners' call too.
What this procedure owns is the order, the evidence at each step, and a CI
gate that is green on the day it lands and still fails the next change that
breaks a contract.

**Two things this file never does.** It names no framework, styling system
or design tool: those are this project's, and every step reads them from the
project. And it never edits a contract, an exemption, a rule's severity or
any other config to make a list shorter or a gate pass: the first gate is set
at the level the project already passes, never by moving the project to
meet a level.

## What it takes

A project root, and, when someone can answer, how many components to
contract in this session. Everything else is read from the project.

## Steps

### 1. Find out how far the project already is

Look before installing anything, and start at the first step below that is
not already done:

- `node_modules/design-delta/package.json`: the package is installed, and its
  `version` is the one this file describes.
- `design-delta.json` at the project root: a config exists. Go to step 2's
  last paragraph.
- Any `*.contract.json` under `paths.contractsDir` (default `contracts`):
  contracts exist. The worklist (step 4) is what they leave uncovered.
- The file at `paths.stateFile`: a baseline exists (step 6).
- A CI step that runs `design-delta verify`, or uses this package's Action:
  the gate is wired (step 7).

Say in the report which steps were already done, and by what evidence.

### 2. Install, and set up a config the owner confirmed

```
npm install --save-dev design-delta
npx design-delta init
```

Use the package manager the project's lockfile says it uses, in its own
install command. `init` is interactive. When the session cannot answer its
prompts, run `npx design-delta init --yes`, which writes every value it
detected without asking. Either way, before the first audit, put each value
in the written `design-delta.json` to the owner, with where it came from:

- `paths.tokensFile`, `paths.componentsDir`, `paths.contractsDir` and
  `paths.styleRoots`: where the tokens, the components, the contracts and
  the emitted token stylesheets live;
- `conventions.cssVarPrefix`: the prefix every token's custom property
  carries. A detected prefix narrower than the project's (one token group's
  prefix, where every group shares a shorter one) makes every token outside
  it read as never emitted;
- `conventions.stylesSuffix`: `init` never writes it. When components keep
  their styles in a file beside them, it is that file's suffix, and without
  it `scaffold` drafts no `styles` and the audit compares no bindings;
- `design.provider`: which design tool, if any. Adoption works without one:
  the code side needs no design tool, and the design side is
  [`skills/design-delta-refresh/SKILL.md`](../design-delta-refresh/SKILL.md)'s,
  later.

Ask them once, together, each with the value you would keep and why. The
owner's answer is what goes in the config. **When nobody can answer**, keep
what was detected and list every value as unconfirmed in the report.

These are the only config edits this procedure makes, and only here, before
the first audit: each one describes where the project keeps things. Once
step 3's audit exists, nothing under this procedure changes the config.

`init` also writes a stub for each packaged skill under `.claude/skills/`.
Every sibling named below can be read at
`node_modules/design-delta/skills/<name>/SKILL.md` whether or not a stub
exists.

**A config already exists.** Do not run `init` again: it rewrites the fields
it detects, and this step only reads them. Read the config, put the same values to the owner,
and carry on from step 3 with whatever they confirm. A config value they
want changed is their edit, made before step 3.

### 3. Take the first audit, and keep it

```
npx design-delta contracts --json
npx design-delta audit --json
npx design-delta lint --json
```

Keep all three documents outside the project's tracked files. They are
"before", and the report compares against them. Then read them:

- **`skipped`** in the audit: a surface that did not run. The usual reason on
  a first run is a missing install the props census needs; the message
  names it. Adding a dependency is the owner's call: ask, and until it is
  installed, carry the surface into the report as unchecked, never as clean.
- **`counts.components` is `0`**: the audit found no component where the
  config looks. That is step 2's `paths.componentsDir`, not an empty
  project. Go back and confirm it.
- **`diagnostics`**: what the run could not read.
- **`contracts`**: `ok` must be `true` before any contract is written here. An
  invalid one that was already there is its owner's, through
  [`skills/design-delta-author/SKILL.md`](../design-delta-author/SKILL.md).

Count the findings by `ruleId`. That table is the report's "before".

### 4. Turn the coverage findings into an ordered worklist

Every `coverage/uncontracted-component` finding is a component with no
contract, and its `entity` is the component's file. The same list, sorted, is
`components.uncontracted` in:

```
npx design-delta map --json
```

Order it by how much of the codebase each component reaches. For each file,
take the component's exported name from the file and run:

```
npx design-delta impact <Component> --json
```

`usedBy` lists every file that references the component. Then:

1. **A component other listed components use comes before them.** When a
   file in the list appears in another component's `usedBy`, that other
   component goes first: a contract that renders another component points at
   that component's contract, so it should exist by then.
2. **Then most used first**: the longest `usedBy`.
3. **Ties keep `map`'s order.**

An `impact` that exits `1` (no file matches the name, or more than one does)
puts that component at the end, with the message as its reason. Never guess
which file a name means.

Write the order down with each component's `usedBy` count; it goes in the
report as is. A contract that already exists and still carries `_scaffold`
notes (`coverage/unfinished-contract`) is not on this list: finishing it is
its owner's, through the authoring skill's change procedure.

**How many.** Ask the owner how many to contract this session. When nobody
can answer, author the first five, and leave the rest on the worklist in the
report: each contract written with nobody to answer its questions is mostly
`_scaffold` notes, and five of them are already a lot for one owner to read.

### 5. Author the contracts, one component at a time

For each component, in order, follow
[`skills/design-delta-author/SKILL.md`](../design-delta-author/SKILL.md) from
its step 1, starting from existing code:

```
npx design-delta scaffold <Component>
```

The authoring skill is what reads the project, treats every drafted field as
a proposal, asks every open decision in one message, marks what nobody
answers with a `_scaffold` note, checks every token, validates, and audits
the new `id`. Do all of it; do not shorten it. Its questions are asked as it
writes them, and **this procedure answers none of them**: not from the code,
not from a sibling, not to keep the session moving.

Never use `scaffold --uncontracted` here. It drafts every contract at once,
each one a record of what the code does today, and skips the asking step
that makes a contract a decision.

After each component, before the next:

- `npx design-delta contracts --json`: the new `id` is in `contracts` with
  `"valid": true`.
- `npx design-delta audit --json`, compared with the one before this
  component by `ruleId` and `entity`: that component's
  `coverage/uncontracted-component` is gone, and every other change is a
  finding for the new `id`. A finding that appeared elsewhere is a contract
  that broke something shared; fix it in the contract you just wrote, through
  the authoring skill, before going on.

A finding for the new `id` says its code and its contract disagree. Which one
is right is settled in the authoring skill's step 7, never by editing the
contract to match the code. What remains goes to step 8.

### 6. Write the baseline

With the session's contracts written and valid:

```
npx design-delta snapshot --json
```

`counts.entities` is the number of contracts whose component it could read;
each one it could not is in `skipped` with the reason. Report both.

**The baseline has to reach CI.** `audit` and `verify` read `state.json` from
the checkout they run in, so a file the project's version control ignores
never gets there, and no finding in CI carries `isNew`. Check the file at
`paths.stateFile`:

```
git check-ignore -v <paths.stateFile>
```

Exit `1` means it is not ignored. Any match is a question for the owner:
track that file, or point `paths.stateFile` somewhere tracked. Either is
their edit.

Then take the audit again. Every finding for a component the snapshot
recorded now carries `isNew: false`. `isNew` is about the component, not the
finding: once that component's code or contract changes, every finding for
it reads `isNew: true` until the next `snapshot`. A finding for a token, a
`lint` rule or an uncontracted component never carries `isNew` at all.

`snapshot` is the baseline, and moving it is a decision about what counts as
already there. Run it here once; after this session, re-running it is the
owner's, never a way to make a finding read old.

### 7. Wire the gate into CI, at the level the project already passes

`verify` gates on a severity (`--fail-on`) and, when asked, on a health
score (`--fail-below`, which the Action does not take). Nothing in it reads
`isNew`. So the first gate is the strictest severity the project passes
today. Try them
strictest first:

```
npx design-delta verify --json --fail-on review
npx design-delta verify --json --fail-on warn
npx design-delta verify --json --fail-on error
npx design-delta verify --json --fail-on none
```

When the config is not `design-delta.json` at the root, add `--config <path>`
to each. The first whose `ok` is `true` is the level. At that level, everything the
project has now passes, and any new finding at or above it fails the next
change that adds it. `none` still fails an invalid contract. If even `none`
fails, `contracts.ok` is `false`: fix that contract through the authoring
skill before wiring anything, since a gate that is red on the day it lands
is a gate someone turns off.

Never pick a stricter level than the one that passed, and never change a
rule, an exemption or the config to make a stricter one pass.

**Where CI lives.** Read the project's CI configuration.

- **The project runs GitHub Actions.** Add a workflow in the shape
  [github-action.md](../../docs/github-action.md) gives, as shown below.
- **The project runs another CI.** Add
  `npx design-delta verify --fail-on <level>` as a step the way its other
  checks run, after the install.
- **No CI.** Ask where the gate should run. Until someone answers, the gate
  is unwired, and the report says so first.

For GitHub Actions: the checkout, runtime setup and install are written the
way the project's other workflows write them, and the package's Action is
the gate:

```yaml
- uses: chrisgriffin/design-delta@v<version>
  with:
    fail-on: <level>
```

`<version>` is the installed package's `version` (step 1), so the Action's
steps and the CLI it runs are the same release; check the tag exists on the
releases page that doc links before writing it. Set `config-path` only when
the config is not `design-delta.json` at the root. Leave `sarif` at its
default: turning it on needs a permission and code scanning, which is the
owner's call; name it in the report.

Run the same `verify --fail-on <level>` locally once more after the CI
change and confirm it exits `0`. The pull request that carries the CI change
is where it runs for real; say so in the report rather than calling it
verified.

### 8. Hand off what is left

Everything still on the list now is drift that predates the gate, plus the
components the worklist did not reach. None of it is cleared here.

- **The findings** go to
  [`skills/design-delta-resolve/SKILL.md`](../design-delta-resolve/SKILL.md).
  Its piles say who owns each one. When the session goes on to work them,
  that procedure takes over from its step 1; otherwise sort them by its
  step 3 table for the report, and stop.
- **The rest of the worklist** stays in order, for the authoring skill.
- **The threshold.** Name the level set in step 7, and the findings that
  stand between it and the next stricter one, by `ruleId` and count. Once
  those are cleared, tightening the gate is the owner's call.

### 9. What never moves adoption forward

- never write a contract field nobody decided, or answer an authoring
  question yourself;
- never edit a contract, an exemption, a rule's severity or the config to
  shorten a list or pass a stricter level;
- never draft every contract at once to make the worklist look done;
- never re-run `snapshot` to make a finding read old;
- never call a surface clean when the audit skipped it, or the gate verified
  before CI has run it.

### 10. Report

- **Setup**: the version installed, each config value with whether its owner
  confirmed it, and which steps were already done before this session.
- **Before**: the step 3 counts by `ruleId`, and every skipped surface.
- **Worklist**: the order, each component's `usedBy` count, which were
  contracted this session and which remain.
- **Contracts**: each contract written, from the authoring skill's report:
  its pending `_scaffold` notes, and the findings left for its `id`.
- **Baseline**: the state file, `counts.entities`, every skipped entity, and
  whether the file is tracked.
- **Gate**: the CI file and step, the level, every rung of step 7 with its
  `ok`, and what tightening it would take. If it is unwired, this is the
  first line.
- **Left, by owner**: one line per group (pile, rule, count, the decision it
  waits on, who owns it), from the resolve skill's piles. "None" is a valid
  entry; leaving the section out is not.
- **Untouched**: that the config shows no change since step 2's confirmed
  values, and no exemption or rule entry was added. Check with the project's
  version control.

## What this does not cover

- **Each contract's decisions.** The authoring skill asks them; the owner
  answers them.
- **Building or fixing components.** That is
  [`skills/design-delta-build/SKILL.md`](../design-delta-build/SKILL.md),
  reached through the resolve skill for drift that predates adoption.
- **The design side.** A design provider, if the project has one, is set up
  in step 2 and refreshed by the refresh skill, after the code side has a
  gate.
- **Tightening the gate later.** A stricter level is the owner's, once the
  findings below it are gone.
- **Judging the engine.** A finding you believe is wrong about the project is
  reported as that, with what you checked. Putting the engine on trial is
  [`skills/design-delta-doctor/SKILL.md`](../design-delta-doctor/SKILL.md).

## Hard limits

- Never answer a question that decides a component's API.
- Never edit a contract, an exemption, a rule's severity or the config to
  make a list shorter or a gate pass.
- Never change the config yourself after the first audit.
- Never set a CI threshold stricter than the one `verify` passed at.
- Never move the baseline after this session.
- Never leave a remaining finding, or an unwired gate, out of the report.

## How a consumer links this file

Claude Code does not discover skills inside `node_modules`. `design-delta
init` and `design-delta dock` each write a stub at
`.claude/skills/design-delta-adopt/SKILL.md` that points here, the same way
they link the other packaged skills; the stub carries no procedure of its
own, so it cannot disagree with the installed version.
