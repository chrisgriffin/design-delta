---
name: design-delta-build
description: Build a component from its *.contract.json contract — generate the files the contract's sources name so every prop, default, enum value, slot, anatomy element and token binding is realized the way this project's other components do it, then run the design-delta audit until that component reports no findings. Use when asked to build, add, implement or generate a component from a contract, or to bring a component's code back in line after its contract changed.
---

# design-delta build — from a contract to code the audit accepts

This file ships inside `design-delta` and describes **exactly the version
installed** in this project. Its sibling
[`skills/design-delta/SKILL.md`](../design-delta/SKILL.md) explains the model
and how to read a finding; read it first if a finding below is unclear.

**The contract is the spec, and the audit is the proof.** A contract already
says what a component is: its props, their types, defaults and enum values,
its slots, the elements it renders and the tokens each one binds. This
procedure turns that into code, then has the engine compare the code against
the same contract. You are done when the engine has nothing to say about the
component, never when the code looks right.

**Two things this file never does.** It names no framework, styling system or
file layout: those are this project's, and step 2 reads them from the
project. And it never changes a contract: when the code cannot be made to
match, that is a question for whoever owns the contract (step 6).

## What it takes

One contract, given as a path to a `*.contract.json` file or as a component
`id`. Everything else is read from the project.

## Steps

### 1. Find the contract, or stop

```
npx design-delta contracts --json
```

The `contracts` array lists, as `{ id, file, valid }`, every contract that
validated. A contract that fails its schema or semantic check is **not** in
that array: it appears only in `diagnostics`, under its `file`. So check
`diagnostics` before deciding there is no contract:

- **Any entry in `diagnostics` naming this contract's file: stop.** Given a
  path, match it against each diagnostic's `file`. Given an `id` that is not
  in `contracts`, open each file the diagnostics name and read its `id`; the
  one that carries yours is this contract. Report the diagnostics as they
  are. An invalid contract is the fixed point every check compares against,
  so nothing built on it can be verified.
- **`valid: false` in `contracts`: stop**, the same way. It appears only when
  two files declare the same `id` (a `duplicate-contract-id` diagnostic):
  each one validated on its own, and which is this component's is a question
  for whoever owns them.
- **No match in `contracts` or `diagnostics`: stop.** Say there is no
  contract for that component. Do not
  write one from the request and build against your own guess: a contract is
  a decision about the component's API, and a silently invented one makes the
  audit prove nothing. Writing one is the sibling skill
  [`skills/design-delta-author/SKILL.md`](../design-delta-author/SKILL.md)
  (`design-delta-author`): it takes the request to a validated contract,
  asking what the request leaves open, and hands back here.

### 2. Read the contract and the project before writing anything

Read the whole contract, then check it can be built at all:

- **No `sources.code.path`**: it is a draft with nowhere to build to. Stop
  and ask for the path; do not pick one.
- **A file already exists at `sources.code.path`**: this is an update, not a
  new component. Skip to [Updating](#updating-a-component-whose-contract-changed).
- **Any `_scaffold` key** anywhere in it: each one marks a decision nobody
  has made yet. List them under "ambiguous" in the report (step 7); build
  what the rest of the contract states and nothing the note leaves open.

Then read the project. Assume nothing it does not show you:

- `design-delta.json` at the project root: `paths.componentsDir`,
  `paths.contractsDir`, `paths.tokensFile`, `paths.styleRoots`, every key
  under `conventions`, and any `rules` or `exemptions` entry. Read its
  `_`-prefixed keys too; that is where a project records local decisions.
- **One sibling**: an existing component with a contract, close in shape to
  the one you are building (same kind of props, a stylesheet if yours has
  one). Read its contract and every file beside it. It is the pattern for
  where files go, how they are named, how a prop becomes a class or an
  attribute, how a token is referenced in a stylesheet, what is exported and
  from where, and what a test and any example or documentation file look
  like. Run the audit (step 5) for the sibling's `id` first: a sibling with
  findings of its own is a bad pattern, so pick another or say so.
- The project's own instructions for agents and contributors, and its
  `package.json` scripts: they name the gate you run in step 6 and any
  generator the project wants used for new components. A project's own
  scaffolding command is worth using for the file shells only when it leaves
  the contract alone: some draft a contract of their own, or refuse a
  directory that already holds one. If it would write, replace or move the
  contract, do not run it; write the files by hand in the sibling's shape.
- **Generated inputs.** If the stylesheet the tokens are emitted into (under
  `paths.styleRoots`) is build output and is missing or stale, run the
  project's token build first. An audit against tokens that were never
  emitted reports the wrong thing.

### 3. Generate what `sources` names

Write the file at `sources.code.path`, and the one at `sources.code.styles`
when the contract names one, in the sibling's idiom. Every statement in the
contract becomes something in the code, and nothing else does:

| The contract says                                      | The code has                                                                                                                                     |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `title`                                                | the exported component, under exactly that name                                                                                                  |
| a key under `props`                                    | a prop of exactly that name                                                                                                                      |
| `type`                                                 | that type; `slot` is arbitrary renderable content                                                                                                |
| `type: "enum"` with `values`                           | exactly those values, same spelling and case, no more and no fewer                                                                               |
| `default`                                              | that default, in the code, for that prop                                                                                                         |
| `required: true`, or `required: false`                 | a required prop, or an optional one                                                                                                              |
| `code: "none"` on a prop                               | **no prop.** A design-only axis: realize it the way the styles say (below), never as a passed value                                              |
| `design: "none"`, or any other `design` marker         | an ordinary prop; `design` markers describe the design tool's side and change nothing in code                                                    |
| an `anatomy` node with `element`                       | that element, at that place in the tree; `children` gives the order                                                                              |
| `codeClass`                                            | that class on that element, and a rule for it in the stylesheet: the audit reports a node it finds no rule for (`styles/element-unmapped`)       |
| `content: { "$prop": "x" }`                            | that element renders prop `x`                                                                                                                    |
| `presentIf: "x"`                                       | that element renders only when prop `x` is set                                                                                                   |
| `attributes`                                           | each attribute, with that literal value, on that element                                                                                         |
| `instanceOf`                                           | the named component rendered at that place; read its contract for how to call it                                                                 |
| `anatomy.$variants`                                    | one rendered branch per variant, each with the root element it declares                                                                          |
| `codegen.className`, `codegen.domPassthrough`          | a `className` passthrough, and the named element's native props passed through, as the sibling does it                                           |
| a `styles` value `{ "token": "a.b.c" }`                | that property set from that token, referenced the way the sibling's stylesheet references tokens; never the token's literal value                |
| a `styles` value `"raw(…)"`                            | that literal, on purpose                                                                                                                         |
| a `styles` variant whose `when` names an ordinary prop | a rule the element's selector reaches for that prop value, written the way the sibling writes its variants                                       |
| a `styles` variant whose `when` names a `code: "none"` | the state it stands for, as the stylesheet's own mechanism: `hover` is `:hover`, `pressed` is `:active`, `focus` is `:focus` or `:focus-visible` |
| a prop combination in `invalidVariantCombinations`     | nothing in code; it is checked on the design side only                                                                                           |

**Tokens come from the project.** Resolve every token path against
`paths.tokensFile` before using it. A path that is not there is a contract
question (step 6), not a reason to write the value in by hand or to pick a
near match. Anything the contract's `styles` block does not mention (layout,
alignment, display) is implementation: follow the sibling, and still take
every color, space, size, radius and type value from a token.

**Realize the whole contract.** Before moving on, go down the contract once
more and tick each prop, default, enum value, slot, anatomy node and style
binding against a line you wrote. A prop the code has and the contract lacks
is drift exactly as much as the reverse.

### 4. Add what the sibling has beside it, and nothing it lacks

List the files in the sibling's directory, and every other place the sibling
is named in the project (a search for its `title` and its `id` finds them:
an index or barrel export, a registry, a documentation page, an example or
story file, a test, a design-tool binding file). For each, add the
equivalent for the new component, in the same shape.

Add nothing the sibling does not have. No test framework the project does
not use, no documentation page where siblings have none, no extra exports.
A documentation page is the one file here with a procedure of its own:
[`skills/design-delta-docs/SKILL.md`](../design-delta-docs/SKILL.md) writes
it from the contract, and keeps what the contract states apart from what a
person has to write. If a file the sibling carries cannot be written truthfully yet (a binding
file that needs a design-tool address the contract's `sources.design` does
not give), do what the project's own instructions say for that case and name
it in the report.

A test exercises what the contract declares: each enum value, each default,
each slot, each conditional node.

### 5. Audit the component until it has no findings

```
npx design-delta audit --json --contract <id>
```

`--contract` takes the contract's `id` and scopes the report to that
component: `findings` holds every entry whose `entity` is the `id`, or starts
with the `id` followed by a `.` (an element of it, as in `<id>.root`), or is
a file the contract's `sources.code` names. The audit still runs over the
whole project, so these are the same findings the full run reports, and
`scope.findings` says how many the project has in all. A file you wrote that
the contract does not name is not in the scoped list: if you added one,
check the unscoped `audit --json` for its path too. A `tokens`-surface
finding is never in the scoped list, `tokens/var-unresolved` included: its
`entity` is the custom-property name, not the component. If your code
references a custom property, check the unscoped audit for a
`tokens/var-unresolved` naming it. Leave every finding
outside the scope alone: it predates you, and fixing it is
a different task, the one
[`skills/design-delta-resolve/SKILL.md`](../design-delta-resolve/SKILL.md)
describes for a project's whole list.

Four things make an empty list mean something:

- **`skipped`**: if the payload has a `skipped` entry for `components` or
  `anatomy`, that surface did not run and the component is
  unchecked, not clean. Fix what the reason names (it is usually a missing
  install) or report it; do not call the build verified.
- **`decided`**: an entry here with this component's `entity` is a finding an
  exemption in the project's config hid. A new component should need none.
  Report any you see; never add one.
- **Every severity counts.** `warn` and `review` findings do not fail the
  project's gate by default, and they are still findings. The target is none
  of any severity.
- **Shorthands are not compared.** A token written inside a shorthand
  declaration (`background: var(…)`, `border: 1px solid var(…)`) does not say
  which property it satisfies, so the audit stays silent about that binding
  rather than guess, even when the token is the wrong one. Write the longhand
  the contract's property names (`background-color` for `background`) where
  the project's stylesheets allow it; where they do not, check each such
  binding against the contract by eye and say so in the report.

**Some of those findings are not the code's to clear.** Every finding carries
a `side`. A `side: "design"` finding is about the design tool's component,
and a `side: "spec"` finding other than `coverage/contract-only` is about the
contract itself: `coverage/unfinished-contract` (its `_scaffold` keys),
`coverage/design-missing` (its `sources.design` resolves to nothing),
`components/intent-unverified` and `components/intent-stale` (its `intent`
hash). No change to the code removes any of them, and the contract and the
design tool are not yours to edit here. Set them aside as the **reported**
list for step 7; do not loop on them. Everything else for this component is
the **loop** list (`coverage/contract-only` among it: writing the file at
`sources.code.path` clears it).

For each finding on the loop list: read the file it names, change **the
code** so it matches the contract, and run the audit again. Repeat until the
loop list is empty, or until what is left is step 6's. The rule behind any
`ruleId` is described in [rules.md](../../docs/rules.md).

### 6. When the code cannot match: stop, and say which kind it is

Some findings on step 5's loop list cannot be cleared from the code side.
There are two kinds, and they are reported differently. (The spec-side and
design-side findings step 5 set aside are neither: they go into the report
as they are.)

**A contract question.** The contract asks for something the code cannot
truthfully do:

- it binds a token the project does not have;
- it states two things that cannot both hold (an anatomy node whose content
  is a prop the contract marks `code: "none"`);
- clearing the finding would mean breaking one of the project's own rules.

Stop, leave the code in its best matching state, and report it: the finding
as the engine printed it, what the contract says, what the code would need,
and the smallest contract change that would resolve it. The person who owns
the contract decides.

**Something the engine could not check.** A `review` finding that says the
engine could not compare a part of the component
(`anatomy/coverage-partial`, `anatomy/coverage-declined`), while the code
already does what the contract says. The usual cause is the contract itself: a node
it marks `presentIf` is rendered conditionally, so the component has more
than one tree and the engine compares only what every branch shares. Read
the code against the contract yourself at each position the finding names,
then report the finding as the remainder, with what you checked by hand.
Do not bend the code to silence it: rendering a conditional node
unconditionally to get a clean report makes the code disagree with the
contract.

In both cases: **never edit the contract to make the audit pass**, and never
add an `exemptions` or `rules` entry to hide a finding. Either one turns the
check into a statement that the code matches whatever the code is.

Then run the project's own gate, the command its instructions or
`package.json` name for "everything passes before a change is done". It
usually includes `design-delta verify` plus the project's type check, lint
and tests. Fix what it reports in the files you wrote. If it fails on
something that was failing before you started, say so with the evidence;
do not fix unrelated code under this task.

### 7. Report

- **Created**: every file written or changed, one line each.
- **Audit**: the command run, the number of loop-list findings left for this
  component (zero, or each one that remains with its `ruleId` and which of
  step 6's two kinds it is), each spec-side or design-side finding step 5
  set aside with its `ruleId` and `side`, and whether any surface was
  skipped.
- **Gate**: the project's gate command and its result.
- **Ambiguous**: everything in the contract you had to interpret, every
  `_scaffold` note, every contract question from step 6, and every file from
  step 4 you could not write truthfully. "Nothing" is a valid entry; leaving
  the section out is not.

## Updating a component whose contract changed

The same loop, without the generation step. Run step 1, read as in step 2,
then go straight to step 5: the audit's findings for the component are the
list of what the code no longer matches. Fix each in the code, carry the
change into the files from step 4 that mirror it (a test for a new enum
value, an example for a new prop), and finish with steps 6 and 7.

Change only what a finding or the contract's diff calls for. A prop the
contract dropped is removed from the code, and so is every use of it the
project's gate then reports.

## What this does not cover

- **Writing or changing a contract.** That is the authoring skill,
  [`skills/design-delta-author/SKILL.md`](../design-delta-author/SKILL.md);
  what each contract construct means is in
  [contract-authoring-guide.md](../../docs/contract-authoring-guide.md).
- **The design tool.** Nothing here creates or edits a design-tool component,
  and a design-side finding (`side: "design"`) for the component is reported,
  not fixed. Building the component in the design tool from the same
  contract is
  [`skills/design-delta-build-design/SKILL.md`](../design-delta-build-design/SKILL.md).
- **Behavior a contract cannot state.** Interaction logic, data fetching,
  focus management and animation are not in a contract, so the audit cannot
  prove them. Build what the request asks, cover it with the project's own
  tests, and say in the report that the audit does not vouch for it.
- **New tokens.** A value with no token is a contract question or a token
  task, never a literal in the stylesheet.
- **Visual correctness.** A clean audit says the code binds what the contract
  declares. It does not say the result looks right. The complement is a
  visual before/after check: render the component in each of its variants
  and states, look at it, and for an update compare it against how it
  rendered before the change. Use whatever this project has for that; say in
  the report whether it was done.

## Hard limits

- Never invent a contract, and never build without one.
- Never edit a contract, an exemption or a rule severity to clear a finding.
- Never write a literal where the contract names a token.
- Never turn a `code: "none"` axis into a prop.
- Never report a clean build without saying which surfaces ran.
- Never add a file, dependency or pattern the project's other components do
  not have.

## How a consumer links this file

Claude Code does not discover skills inside `node_modules`. `design-delta
init` and `design-delta dock` each write a stub at `.claude/skills/design-delta-build/SKILL.md` that
points here, the same way they link the audit skill; the stub carries no
procedure of its own, so it cannot disagree with the installed version.
