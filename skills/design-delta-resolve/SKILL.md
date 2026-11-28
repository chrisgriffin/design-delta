---
name: design-delta-resolve
description: Work down a project's design-delta findings — group every finding by rule, side and entity, separate what code can clear from contract questions, design-side findings, token and config decisions and findings that need a person, fix the code-side drift one component at a time through the build skill's update procedure, and end with a report of what was cleared, what is left and who owns each remainder. Use when an audit reports many findings, when asked to clean up, reduce or burn down drift, or to turn a long design-delta report into something each owner can act on.
---

# design-delta resolve — working a project's findings down

This file ships inside `design-delta` and describes **exactly the version
installed** in this project. Its sibling
[`skills/design-delta/SKILL.md`](../design-delta/SKILL.md) explains the model
and how to read one finding;
[`skills/design-delta-build/SKILL.md`](../design-delta-build/SKILL.md) brings
one component in line with its contract. This file is the procedure over the
whole list, and it calls the build skill rather than repeating it.

**The number is not the goal.** A project's finding count can always be made
smaller: change the contract to say what the code does, add an exemption,
turn the rule down. Each of those removes a finding and leaves the
disagreement it reported exactly where it was, now unreported. The goal is
that every finding is either gone because the code now matches, or in front
of the person who can decide it, with what they need to decide.

**Most findings are not yours to clear.** A finding says two things disagree.
Which one is wrong is a fact about the project, and for most rules the answer
is not in the code. This procedure fixes the ones where it is, and sorts the
rest by owner.

## Steps

### 1. Start from a list you can trust

```
npx design-delta contracts --json
npx design-delta audit --json
npx design-delta lint --json
npx design-delta decide --json
```

Keep all four documents, outside the project's tracked files. They are
"before", and step 7 compares against them.

Before reading a single finding:

- **`contracts`**: `ok` must be `true`. Every finding about a component is a
  comparison against its contract, so findings downstream of an invalid one
  mean nothing. Report the diagnostics; set those components aside as the
  contract owner's (step 3) and work the rest.
- **`skipped`** in the audit: a surface listed there did not run. Its
  findings are not zero, they are unknown. Fix what the reason names if it is
  a missing install or an unbuilt input (a stylesheet the tokens are emitted
  into, for one), and take the audit again. Otherwise carry the skipped
  surface into the report as unchecked.
- **`diagnostics`**: read them. They say what the run could not check.
- **`decided`**: findings an exemption in the project's config already hid.
  Note how many, and keep the list. They are decisions somebody made; they
  are not on your list, and at the end the only ones allowed to be gone are
  those step 7 accounts for.
- **The owner's answers.** `decide --json` marks each decision the owner
  already answered with a change (`answered`: `fix-code`, `change-contract`
  or `change-design`, with their note). Those answers live in the project's
  decisions file (`paths.decisionsFile`). They are the owner's decisions,
  made: step 5 works them. Entries listed under `done` were carried out
  already.
- The project's own instructions, and its `design-delta.json`, `_`-prefixed
  keys included: a project records known findings and local decisions there,
  and a finding it already explains goes to the report as explained, not
  into the work.

### 2. Group before you fix

From `findings` (the audit's and lint's together), make three counts:

- **by `ruleId`**: how many of each rule, with its `severity`;
- **by `side`**: `code`, `design`, `spec`, `both`;
- **by `entity`**: which thing each finding is about. A component's findings
  carry its contract `id` as the `entity`, or the `id` followed by a `.` and
  an element (`<id>.root`); fold those together per component. A token
  finding's `entity` is the token's path. A coverage finding's may be a file
  path.

Write the three tables down. Two things are visible only here: one rule that
accounts for most of the list is usually one decision, not that many tasks;
and one component that carries most of the code-side findings is usually one
change that was half made.

### 3. Sort every finding into one pile

`side` says where the engine attributes the drift. It does **not** say who
can clear it: a token no component uses is `side: "code"`, and no code change
is the right fix for it. The engine sorts for you, and the table it sorts by
lives in one place, `src/core/piles.mjs` in the installed package. Never
restate it.

- **Code**: `decide --json`'s `code` list. Yours, through the build skill
  (step 5).
- **Everything else**: `decide --json`'s `decisions`, one per rule and pile,
  each with its `pile` (`contract`, `design`, `tokens-config` or `review`),
  the entities it covers, the answers that can clear it, and a recommended
  answer. Each pile belongs to an owner: the contract's, the design file's,
  the token system's or config's, or a person's.

A rule the table does not name falls through to its side: a `side: "code"`
finding at `error` or `warn` on the `components`, `styles` or `anatomy`
surface is code, and anything the sides do not settle goes to review, where
a wrong guess costs a question rather than a change nobody asked for. A
component whose contract failed validation (step 1) has its code-side
findings in the contract pile, not the code list. `coverage/contract-only` is in the contract pile because
the engine cannot tell a wrong path from a component never built. When you
read the project and the contract's path is right and the component was
simply never built, work it as code (step 5).

Two piles deserve a second look before they leave your hands:

- **Review** findings can often be half-answered. Where the engine could not
  compare something, read the code against the contract at the place the
  finding names and say what you saw. That turns "the engine could not tell"
  into "the engine could not tell; read by hand, the code does what the
  contract says", which is something a person can accept in a minute. Adding
  an exemption so it stops appearing is their call, never yours.
- **Tokens and config** findings usually come in one large group with one
  cause: a set of tokens the project ships and nothing uses yet, or a tier of
  tokens that is never meant to be emitted. Say what the group has in common
  (the directory the tokens are authored in, the prefix they share) and name
  the options the engine gives for it, which are in the rule's description
  and in [config-reference.md](../../docs/config-reference.md).
  Do not pick one. Never reference a token from a component just to make it
  count as used.

### 4. Check the design snapshot's age before blaming the design side

Design-side findings are read from a snapshot on disk, and a stale snapshot
reports drift that was fixed, or hides drift that was added. In the audit's
`provenance`, read `gatheredAt` for each snapshot.

If the snapshot predates work you know happened on the design side, or
nobody can say, the design pile is unverified: say so on every line of it in
the report, with the date. Refreshing it is the sibling skill
[`skills/design-delta-refresh/SKILL.md`](../design-delta-refresh/SKILL.md);
do that first when the session has the design tool's tools, and re-sort.

### 5. Work the code pile, one component at a time

The code pile is `decide --json`'s `code` list, plus every decision the owner
answered `fix-code`, plus the components of every `change-contract` answer
once step 5a has changed their contract.

Order the components:

1. a component other contracts name in an `instanceOf` before the components
   that render it;
2. then by severity: any component with an `error` finding first, since those
   are what fail the project's gate;
3. then by count, most findings first.

For each component, follow the build skill's **Updating a component whose
contract changed** with that component's contract. A component in the pile
for `coverage/contract-only` was never built, and that procedure skips the
generation step, so it would create none of the component's files: follow
the build skill's full **Steps** for it instead, from step 1. Do not
improvise a shorter loop: that procedure is what says which findings code can clear,
when to stop, and that the contract is never edited. It ends for each finding
in one of three ways, and you record which:

- **cleared**: the code now matches;
- **contract question**: the contract asks for something the code cannot
  truthfully do. The finding moves to the contract pile with the question;
- **not checkable**: a `review` finding the code cannot clear. It moves to
  the review pile with what you read by hand.

While working one component, `npx design-delta audit --json --contract <id>`
shows that component's findings alone, which is what the build skill's
procedure reads. It scopes the report, not the project: its count is never
the number you report. Nor does it show every code-pile finding:
`tokens/var-unresolved`, and any other code-pile finding whose `entity` is
not the component's `id`, one of its elements or a file its contract names,
is never in the scoped list. Track those in the unscoped audit, and clear
them in the component whose code references the custom property.

After each component, before starting the next:

- take the whole audit again, without `--contract`, and compare it with the
  one before this component, by
  `ruleId` and `entity`. This component's cleared findings are gone, and
  **nothing new appeared anywhere else**. A new finding on another component
  is your change breaking something shared (a style both use, a component
  one renders); fix it now or undo the change;
- run the project's own gate, the command its instructions name. Fix what it
  reports in the files you touched.

A `tokens/var-unresolved` finding names the custom property, not the file
that uses it. Search the project's components for the property to find
where it is, and treat that file's component as the one being worked.

Keep each component's change separate (its own commit, where the project's
workflow has commits), so one that has to be undone takes nothing with it.

### 5a. Make the contract changes the owner asked for

For each decision answered `change-contract`, change the contract as the
owner's note says, through
[`skills/design-delta-author/SKILL.md`](../design-delta-author/SKILL.md),
and only for the entities the answer covers. Where the note leaves the
change open, ask the owner rather than choosing. Then work that component in
step 5. A `change-design` answer is the design file's owner's to make: list
it in the report for them, and never edit the design file to clear it.

### 6. What never clears a finding

Whatever the pile, and however small the remainder:

- never edit a contract so it agrees with the code, except the change a
  `change-contract` answer in the decisions file records (step 5a);
- never add, widen or reword an `exemptions` entry;
- never change a rule's severity or turn it off under `rules`, and never add
  an ignore option to one;
- never change `paths`, `conventions` or any other config so that a file,
  token or component stops being scanned;
- never delete a token, a component or a contract because it has findings;
- never run with a flag that leaves a surface out and report the smaller
  number.

Each of these is sometimes the right outcome. None of them is yours to
choose: each is the owner's decision, and `decide` (step 8) is how they get
to make it. Never answer a decision on the owner's behalf, on the page or
with `decide --apply`.

### 7. Take the list again, and account for every change

```
npx design-delta audit --json
npx design-delta lint --json
```

Compare with step 1's, by `ruleId` and `entity`:

- **every finding that disappeared is one you cleared in code, or follows
  from one.** Match each to a component from step 5. The usual follow-on is
  a token finding: a token a component binds again is no longer unreferenced,
  so it leaves the list with the fix. Any other finding that is gone and
  that you did not fix is not good news: find out why before reporting it (a
  surface that is now skipped, a file that stopped being scanned);
- **every finding that appeared** is explained, or it is a regression;
- `decided` has the same length as in step 1, with one exception. A code fix
  in step 5 can clear a finding an exemption was covering. That finding then
  leaves `decided`, and when the exemption names it literally (not a glob),
  `coverage/stale-exemption` appears for that exemption. That is the right
  outcome: accept it only when the finding that left `decided` belongs to a
  component you fixed in step 5, and list each one in the report with its
  exemption, for the config's owner to remove. Removing it is theirs, never
  yours. Any other change to `decided` is a regression;
- `skipped` lists nothing it did not list before;
- the project's `design-delta.json` and every contract file show no change,
  except the contracts a `change-contract` answer named (step 5a). Check
  with the project's version control, and put the result in the report: it
  is the proof that nothing was cleared the wrong way.

### 8. Report

- **Before and after, by rule**: one row per `ruleId` with its severity, the
  count before, the count after, and how many were cleared in code. Totals at
  the bottom.
- **Cleared**: per component, the findings cleared and the files changed.
- **Left, by owner**: one line per group, not per finding. Each line has the
  pile, the rule, the count, what the group has in common, the decision or
  action it is waiting for, and who owns that (a role: the contract's owner,
  the design file's owner, the token system's owner, a reviewer; the
  project's own instructions say who that is, and where it tracks work).
  Contract questions carry the finding as printed, what the contract says,
  what the code would need, and the smallest contract change that would
  settle it. A group already explained in the project's config is listed as
  explained, with where.
- **Not checked**: every skipped surface, every component set aside for an
  invalid contract, and whether the design pile was verified against a
  current snapshot.
- **Untouched**: that the config and the contracts show no change, and that
  `decided` is the same length, or each finding that left it, the component
  fixed in step 5 that cleared it, and the exemption now stale.
- **Gate**: the project's gate command and its result. If it still fails,
  name the findings it fails on and their pile: an `error` that belongs to an
  owner keeps the gate red until they decide, and that is the report's first
  line, not a reason to reach for step 6's list.

**Hand the rest to the owner.** End by running `npx design-delta decide`
and giving the owner the address it prints: one question per group, each
with the recommended answer and its reason, and their answers are written
back for the next pass. Where no browser can reach the session, run
`npx design-delta decide --no-serve` and give them the page's path; they
apply what it saves with `decide --apply`. Say how many decisions are on the
page, and that nothing was answered for them.

A project where the code pile was empty ends here with nothing cleared and
every group in front of its owner. That is a complete result. Say plainly
that no finding was code's to clear, so nobody reads the unchanged count as
work not done.

## What this does not cover

- **Deciding for an owner.** Which tokens a project keeps, what a contract
  says, what the design tool shows, and which findings a project accepts.
- **Writing contracts** for uncontracted components. That is the authoring
  skill,
  [`skills/design-delta-author/SKILL.md`](../design-delta-author/SKILL.md);
  each one is a decision about a component's API, so it is asked for, not
  swept up here.
- **Filing the remainder.** Where a project tracks work is its own. Follow
  its instructions; file nothing they do not ask for.
- **Judging the engine.** A finding you believe is wrong about the project
  is reported as that, with what you checked. Putting the engine itself on
  trial is
  [`skills/design-delta-doctor/SKILL.md`](../design-delta-doctor/SKILL.md).
- **Visual correctness.** As in the build skill: a cleared finding says the
  code binds what the contract declares, not that the result looks right.

## Hard limits

- Never clear a finding by editing a contract, an exemption, a rule's
  severity or any other config. The one exception is a `change-contract`
  answer the owner recorded in the decisions file.
- Never answer a decision for the owner.
- Never report a count without the count before it.
- Never report a finding as cleared that you did not fix in code.
- Never start a second component with the first one's audit unread.
- Never call the design pile real without the snapshot's date beside it.
- Never leave a remaining finding without an owner.

## How a consumer links this file

Claude Code does not discover skills inside `node_modules`. `design-delta
init` and `design-delta dock` each write a stub at `.claude/skills/design-delta-resolve/SKILL.md` that
points here, the same way they link the other packaged skills; the stub
carries no procedure of its own, so it cannot disagree with the installed
version.
