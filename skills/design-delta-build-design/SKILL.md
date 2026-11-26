---
name: design-delta-build-design
description: Build a component in the design tool from its *.contract.json contract — create or update the design-tool component with the session's own design-tool tools so every design-side property, variant, layer and variable binding the contract states is there, the way this project's other design components do it, then refresh the design snapshot and run the design-delta audit until that component reports no design-side findings. Use when asked to build, create, add or draw a component in the design tool from a contract, or to bring a design-tool component back in line after its contract changed.
---

# design-delta build-design — from a contract to a design component the audit accepts

This file ships inside `design-delta` and describes **exactly the version
installed** in this project. It is the design-side twin of
[`skills/design-delta-build/SKILL.md`](../design-delta-build/SKILL.md), which
takes the same contract to code. Its sibling
[`skills/design-delta/SKILL.md`](../design-delta/SKILL.md) explains the model
and how to read a finding; read it first if a finding below is unclear.

**The contract is the spec, and the audit is the proof.** A contract says
what the design side of a component carries: which properties, under which
names, with which values; which axes exist only in design; which layers, in
what order, of what kind; which token each element binds. This procedure
builds that in the design tool, then has the engine compare the design tool
against the same contract. You are done when the engine has nothing
design-side to say about the component, never when the component looks
right.

**The engine never touches the design tool, and neither does anything here
but you.** design-delta has no agent inside it: it cannot create a
component, and it only ever reads the design side from a snapshot an agent
saved. Every write in this procedure is made by this session, with the
design tool's own tools. Without them, nothing here can run (step 2).

**Three things this file never does.** It names no design tool, framework or
styling system: those are this project's, and step 3 reads them from the
project. It never changes what a contract says about a component: when the
design tool cannot be made to match, that is a question for whoever owns the
contract (step 7). And it never creates a variable, a style or a token: a
binding with nothing to bind to is reported, not made up.

## What it takes

One contract, given as a path to a `*.contract.json` file or as a component
`id`, and a session connected to the design tool with tools that can create
and edit components there. Everything else is read from the project.

## Steps

### 1. Find the contract, or stop

```
npx design-delta contracts --json
```

Exactly as in the build skill's step 1: a contract that failed validation is
only in `diagnostics`, under its `file`, and a `valid: false` entry is a
duplicate `id`.

- **A diagnostic names this contract's file, or its entry says
  `valid: false`: stop**, and report the diagnostics as they are.
- **No contract for the component: stop**, and say so. Do not build from the
  request or from a design you were shown: a design component built from
  your own guess makes the audit prove nothing. Writing a contract is
  [`skills/design-delta-author/SKILL.md`](../design-delta-author/SKILL.md)
  (`design-delta-author`).

### 2. Check there is a design side, and that this session can write to it

```
npx design-delta gather
```

- **Exit `1`**: the message is the reason, usually that no `design.provider`
  is configured. Stop and report it. A project with no provider has no
  design side to build.
- **Exit `0`**: a provider is configured. Note it; step 3 reads how its
  components look.

Then check the session's own tools. This procedure needs the design tool's
tools that **create and edit** a component, its properties and variants, its
layers, and a layer's variable bindings, and the ones that read them back.
Reading alone is not enough.

- **The session has none of the design tool's tools, or only ones that
  read: stop**, before writing anything. Report which provider the project
  uses and that this session cannot write to it. Do not improvise: a design
  built by hand-editing an exported file, by another tool's import, or by
  any path that is not the design tool's own editing tools is not a design
  component the gather reads back as built.
- **It has them**: carry on.

### 3. Read the contract, the snapshot and a sibling before writing anything

Read the whole contract, then decide which case this is:

- **`sources.design` is absent**: look for the component in the design tool
  before creating one. A component designed before its contract was written
  is already there with no contract addressing it: run
  `npx design-delta audit --json` (no `--contract`, so the design side's
  uncontracted components are reported) and read every
  `coverage/design-only` finding, then search `design-components.json` under
  `paths.snapshotDir` for an entry named for the contract's `title` the way
  the sibling's name relates to its own (below). If one matches, it is this
  component: record its address in `sources.design` as step 5 says, refresh
  (step 6), and take the
  [Updating](#updating-a-design-component-whose-contract-changed) path.
  Creating a second one leaves the first as drift and points the contract at
  the duplicate. More than one could be it: ask which; unattended, stop and
  report them. None matches: a new design component, and step 5 creates it.
- **`sources.design` is present**: run
  `npx design-delta audit --json --contract <id>`. A
  `coverage/design-missing` finding means the address resolves to nothing in
  the snapshot. Refresh first (step 6) in case the snapshot is stale; if it
  still resolves to nothing, **stop**: the contract names a component that is
  not there, and no tool can create one at an address someone else chose.
  That is a contract question (step 7). Otherwise the component exists, and
  this is an update: skip to
  [Updating](#updating-a-design-component-whose-contract-changed).
- **Any `_scaffold` key** anywhere in the contract: each one marks a decision
  nobody has made. List them under "ambiguous" in the report (step 8); build
  what the rest of the contract states and nothing the note leaves open.

Then read the project. Assume nothing it does not show you:

- `design-delta.json` at the project root: `design.provider`,
  `design.options`, `paths.snapshotDir`, `paths.tokensFile`, any `rules` or
  `exemptions` entry, and its `_`-prefixed keys, where a project records
  local decisions.
- **The design snapshot's age.** If the audit's `provenance` shows a
  components or tokens snapshot that is missing, stale or of unknown age,
  run the refresh first, as step 6 says, so the sibling below and the
  variables in step 4 are read as they are now.
- **One sibling design component**: a component with a contract that carries
  `sources.design`, close in shape to the one you are building (the same
  kinds of properties, a design-only axis if yours has one), whose
  `npx design-delta audit --json --contract <sibling>` has no `side: "design"`
  finding. Find its entry in `design-components.json` under
  `paths.snapshotDir` (the entry whose address fields carry the values the
  sibling's `sources.design` gives) and open the component itself with the
  session's tools. It is the pattern for everything that is the design
  tool's vocabulary rather than the contract's: what a component is named,
  where in the file it sits, how a set of values becomes a variant property,
  how a flag or a text property is made, how a layer's visibility follows a
  flag, how a text layer shows a text property, how a token's path is
  spelled as a variable's name (its contract's `styles` beside its entry's
  `usedVars`), and the shape of a `sources.design` address. A sibling with
  design-side findings is a bad pattern: pick another, or say so.
- **No sibling has a design address**: this would be the project's first
  design component the engine checks, and every one of those conventions is
  a decision. Ask once, together, with the answer you would recommend from
  what the design file already holds. Unattended, stop and report the
  questions.
- **Which design file a new component goes in.** The request names it, or it
  is the file the sibling's component lives in. When neither settles it
  (siblings live in more than one file and the request names none), ask.
  Unattended, stop. Never pick a file on your own.

### 4. Settle what the design component carries

Every statement in the contract that the design side is compared on becomes
something in the design component, and nothing else does. Where the design
tool's own way of making it differs from what is written here, the sibling
wins: these say what has to exist, the sibling says how.

| The contract says                                                              | The design component has                                                                                                                                                                                  |
| ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `title`                                                                        | the component, named the way the sibling's name relates to its contract's `title`                                                                                                                         |
| a key under `props`, with no `design` marker                                   | a property of exactly that name, of the kind its `type` is                                                                                                                                                |
| `type: "enum"` with `values`                                                   | a variant property with exactly those values, same spelling and case, no more and no fewer                                                                                                                |
| `type: "boolean"`                                                              | a flag property                                                                                                                                                                                           |
| `type: "string"`                                                               | a text property                                                                                                                                                                                           |
| `type: "slot"`                                                                 | a slot property, the way the sibling makes one                                                                                                                                                            |
| `type: "number"` or `type: "function"`, with no marker                         | what a sibling with such a property has. With none, a contract question (step 7): contracts usually mark these `design: "none"`, and this one does not say what the design side carries                   |
| `default`                                                                      | that value as the property's default, where the design tool has one; the audit does not compare it                                                                                                        |
| `required`, `nullable`, `description`, `accepts`, `minChildren`, `maxChildren` | nothing the audit compares on the design side; carry a description over only where the sibling's properties carry one                                                                                     |
| `design: "none"`                                                               | **no property.** It must not appear in design; one that does is a finding                                                                                                                                 |
| `design: "unverified"`                                                         | nothing. The contract does not say how design models it; list it under "ambiguous"                                                                                                                        |
| `design: { "name": … }` with a `reason`                                        | the property under that `name`, of the prop's own kind                                                                                                                                                    |
| `design: { "mechanism": … }`                                                   | the property under its `name`, of the kind the mechanism names: `toggle` a flag, `text` a text property, `instance` a slot                                                                                |
| `gates` on a `toggle`                                                          | also a slot property of that name, the region the flag shows or hides                                                                                                                                     |
| `code: "none"` on a prop                                                       | the property its `type` makes, by the rows above (a variant property for an `enum`, a flag for a `boolean`, …): the marker says only that it exists in design and not in code, never what kind it is      |
| `code: "unverified"` on a prop                                                 | an ordinary property; the marker is about the code side                                                                                                                                                   |
| `invalidVariantCombinations`                                                   | none of those combinations as a variant, and every other combination of the variant properties as one. Leaving out one the contract does not list is a contract question (step 7)                         |
| an `anatomy` node                                                              | a layer named the node's name, or its `designLayer` when it has one, under its parent's layer, in `children` order                                                                                        |
| a node's `type`                                                                | a layer of that kind (`container`, `text`, a shape, `instance`, …), made the way the sibling makes that kind                                                                                              |
| a node's `instanceOf`                                                          | an instance of that component's design counterpart, the one its contract's `sources.design` addresses. With none, leave the node unbuilt and report it: that component comes first, from its own contract |
| a node's `presentIf`                                                           | a layer whose visibility the named flag property controls, the way the sibling does it                                                                                                                    |
| a node's `content` naming a prop                                               | a text layer showing that text property, the way the sibling does it                                                                                                                                      |
| a node's `element`, `attributes`, `codeClass`                                  | nothing: they are the code side's                                                                                                                                                                         |
| `anatomy.$variants`                                                            | nothing extra: rendered shapes are how the code branches, and the design side is compared on the base anatomy                                                                                             |
| a `styles` value `{ "token": "a.b.c" }`                                        | that property on that layer bound to the variable that is the token's counterpart (below); never the token's value typed in                                                                               |
| a `styles` value `"raw(…)"`                                                    | that literal, on purpose                                                                                                                                                                                  |
| a `styles` variant entry                                                       | that binding in every variant its `when` names, including a `when` that names a `code: "none"` axis                                                                                                       |
| `subcomponents`                                                                | nothing here: a subcomponent carries no design address of its own, so the audit compares none                                                                                                             |
| `sources`                                                                      | `sources.design` is the component's address (step 5); `sources.code` is the code side's                                                                                                                   |
| `id`, `$schema`, `schemaVersion`, `status`, `description`, `intent`, `codegen` | nothing in the design component                                                                                                                                                                           |

**A variant set is compared through one variant.** When the component is a
set of variants, the audit compares the anatomy against the first variant by
name, and assumes the others share its layers. Give every variant the same
layer structure, and change only what the contract's variant entries change.

**Bind only variables that map to tokens the project has.** For every token
a `styles` value names:

```
npx design-delta impact <token.path> --json
```

Exit `0` with `"kind": "token"` means the project has it. Exit `1` means it
does not: that is a contract question (step 7), not a reason to bind a
near match. Then find the token's variable in the design tool: the variable
the sibling binds for the same token path, or, for a token no sibling binds,
the one named for it the way the sibling's variables are named for theirs.

- **Exactly one**: bind it.
- **None**: do not bind anything there, and do not create a variable. The
  design tool has no counterpart for the token; that is a token task, and it
  goes in the report.
- **More than one could be it**: ask which. Never pick one because its value
  matches the token's: two variables with one value are two decisions, and a
  match by value is how a component ends up bound to a primitive instead of
  the token its contract names.

Anything the contract's `styles` block does not mention (layout, alignment,
auto-sizing) is the design tool's own implementation: follow the sibling,
and still take every color, space, size, radius and type value from a
variable where the sibling does.

**Settle everything before writing.** Go down the contract once more and
tick each prop, value, axis, node and binding against a line in your plan.
Where the plan is short of a decision the contract or the sibling does not
settle, ask, once, every question together, with the answer you would
recommend. Unattended, leave that part unbuilt and list it as ambiguous.

### 5. Build it, then record where it is

Create the component in the file step 3 settled, with the session's
design-tool tools, from the plan in step 4: the properties and variants
first, then the layers in each variant, then the bindings. Change nothing
else in the file: no other component, no variable, no style.

**Record the address.** For a component the contract had no `sources.design`
for, the audit cannot match it to its contract until the contract says where
it is. Read the new component's address back with the session's tools, and
write it into the contract as `sources.design`, in exactly the shape the
sibling's contract uses. This is the one change this procedure makes to a
contract: it records where the component was built, not what the component
is. Touch nothing else in the file. Then:

```
npx design-delta contracts --json
npx design-delta gather --bindings
```

The contract must still validate, and the bindings plan must name the new
address among its targets. A `sources.design` whose shape the provider does
not accept validates and is still gathered by nobody: if the plan does not
name it, the shape is wrong. Fix it to the sibling's shape before going on.

### 6. Refresh the design snapshot

The audit reads the design side from the snapshot, never from the design
tool, so nothing you built exists for it yet. Run
[`skills/design-delta-refresh/SKILL.md`](../design-delta-refresh/SKILL.md)'s
procedure, all of it: the components pass, then the bindings pass (the one
that reads layers and bound variables), and the tokens pass when step 3
found that snapshot stale. Do not shorten it: its rules about saving each
response whole are what keep the snapshot honest. A pass the refresh could
not run is a part of the component the audit cannot see; carry it to the
report.

### 7. Audit the component until it has no design-side findings

```
npx design-delta audit --json --contract <id>
```

The **loop list** is every finding here with `"side": "design"`: a property
missing, unexpected or of the wrong kind (`components/prop-missing`,
`components/prop-unexpected`, `components/prop-type-mismatch`), variant
values that disagree (`components/enum-values-mismatch`), combinations that
should not exist or do not (`components/variant-combinations-mismatch`), a
layer missing, unexpected or of the wrong kind (`anatomy/node-missing`,
`anatomy/node-unexpected`, `anatomy/element-mismatch`), and a token no bound
variable maps to (`styles/design-binding-missing`). Everything else for this
component, code side or spec side, is the **reported** list for step 8: no
change in the design tool removes it, and the code and the contract are not
yours to change here. `coverage/unfinished-contract` belongs there too.

For each finding on the loop list: change **the design component** so it
matches the contract, then run step 6's refresh again the way step 6 says,
the components pass and then the bindings pass, and audit again. Never run
one pass alone here: properties are the components pass's, but variant
combinations, layers and bound variables (`variantCombinations`, `layers`,
`usedVars`) are the bindings pass's, so a components-only refresh leaves
`components/variant-combinations-mismatch` and every anatomy and binding
finding reading the old design. When the fix is a binding
(`styles/design-binding-missing`), choose the variable by step 4's rules, all
of them: `impact` first, the variable the sibling binds or names the same
way, ask when more than one could be it, never by value. Repeat until the
loop list is empty, or until what is left is one of the two kinds below.

An empty loop list means something only when the design side was compared.
None of these is a clean build; each is "nothing compared, not verified",
and the report says which:

- **`coverage/design-missing` for this contract** (it is `side: "spec"`, so
  it is not on the loop list): the address resolves to nothing in the
  snapshot, and the property, variant, anatomy and binding checks all skip
  the component. The refresh missed the component, or the address is wrong.
  Refresh again. If it stays and step 5 wrote the address, its shape is
  wrong: fix it to the sibling's. If the contract already had it, stop on it
  as a contract question, as step 3 says.
- **`skipped.design`**: the components snapshot did not load, and nothing
  design-side was compared.
- **`skipped.designAnatomy`**: no component carries a layer tree; the
  bindings pass has not run, and the layers are unchecked.
- **`skipped.tokens`**: the token census did not load, and the binding check
  needs it, so no binding was compared.
- **The component's entry in `design-components.json` lacks a field the
  bindings pass writes**: with no `usedVars` its bindings are skipped
  silently, and with no `variantCombinations` its combinations are, with no
  `skipped` entry either way. Read the entry; a missing field is a bindings
  pass that did not reach this component.

Fix the refresh, or report it; do not call the build verified. Three more
things bound what a non-empty comparison says:

- **`skipped.designBindings`** counts declared bindings the comparison could
  not reach, with an example reason: a property the design tool cannot
  express as a variable, a token that resolves to zero, a redirect in
  `design.options`. Each is real, and none is drift; report them, and set
  those values the way the sibling does.
- **Bindings are checked per component, not per layer.**
  `styles/design-binding-missing` fires when nothing anywhere in the
  component binds the token. It does not say the right layer binds it. Check
  each binding against the contract's element by eye, and say so in the
  report.
- **What the design side is not compared on.** A default, a layer's text, a
  layer's visibility following its flag, and every variant but the first are
  not compared. Nor are two kinds of layer: a node with `presentIf` is never
  reported missing, so an optional layer you forgot audits clean; and when
  two layers under one parent have names that fold to the same name, the
  audit cannot tell which is which and reports nothing missing or unexpected
  under that parent. The audit vouches for none of them: check them by eye
  against step 4's plan, every `presentIf` node's layer and every parent with
  two such layers included, and say which you checked.

When the design tool cannot match, stop on that finding and say which kind
it is:

- **A contract question.** The contract asks for something the design tool
  cannot truthfully carry: a token the project lacks, or one with no variable
  in the design tool; a prop type nothing in design is typed as, with no
  marker; an address that resolves to nothing; two statements that cannot
  both hold. Leave the component in its best matching state, and report the
  finding as printed, what the contract says, what the design tool would
  need, and the smallest contract change that would settle it.
- **Something the engine could not check.** A `review` finding that says the
  engine could not reach a verdict, while the component already does what
  the contract says. Read the component against the contract yourself where
  it points, and report it with what you checked.

In both cases: **never edit the contract to make the audit pass** (the
address in step 5 is the one write), and never add an `exemptions` or
`rules` entry to hide a finding.

### 8. Report

- **Created**: the component, its properties and variants, its layers and
  its bindings, one line each; for an update, what changed.
- **Address**: the `sources.design` written in step 5, or that the contract
  already had one.
- **Refresh**: the passes run, and any that could not be.
- **Audit**: the command, the design-side findings left for this component
  (zero, or each with its `ruleId` and which of step 7's two kinds it is),
  every finding on the reported list with its `ruleId` and `side`, every
  `skipped` entry, and each "nothing compared, not verified" case step 7
  lists that held.
- **Checked by eye**: what step 7 says the audit does not compare, every
  `presentIf` layer and every parent whose layer names fold together
  included, and what you found.
- **Drift**: anything in the design tool that still disagrees with the
  contract, and why it was left.
- **Ambiguous**: every `_scaffold` note, every `design: "unverified"` prop,
  every question asked or left open, every binding with no variable, every
  contract question. "Nothing" is a valid entry; leaving the section out is
  not.

## Updating a design component whose contract changed

The same loop, without creating anything. Run step 1 and step 2, read as in
step 3, refresh (step 6), then go straight to step 7: the audit's design-side
findings for the component are the list of what the design component no
longer matches. Fix each in the design tool as step 7 says, a binding by
step 4's variable rules, refresh as step 7 says, and audit again, then
report as in step 8.

Change only what a finding or the contract's diff calls for. A property the
contract dropped is removed from the design component. A design component
other components use as an instance is shared: before removing or renaming
a property or a variant, find where it is used with the session's tools,
and list what the change affects in the report.

## What this does not cover

- **Writing or changing a contract.** That is
  [`skills/design-delta-author/SKILL.md`](../design-delta-author/SKILL.md);
  what each construct means is the
  [contract authoring guide](../../docs/contract-authoring-guide.md).
- **The code.** Building the component in code is
  [`skills/design-delta-build/SKILL.md`](../design-delta-build/SKILL.md), and
  a code-side finding for the component is reported here, never fixed.
- **New variables, styles or tokens.** A binding with no variable is a token
  task, never a variable made up to fill it.
- **Connecting the session to the design tool.** Step 2 stops when the tools
  are not there.
- **Visual correctness.** A clean audit says the design component carries
  what the contract declares. It does not say it looks right. Look at each
  variant, say whether you did, and compare it with the sibling.

## Hard limits

- Never build without a contract, and never build a design component the
  contract does not describe.
- Never change a contract, except to record the address of a component this
  procedure created, or of the existing one step 3 found for it, in the
  sibling's shape.
- Never create, rename or delete a variable, a style or another component.
- Never bind a variable chosen by its value, and never type in a value where
  the contract names a token.
- Never write to the design tool through anything but the session's own
  design-tool tools, and never start without them.
- Never edit a snapshot file by hand, or report a clean build without saying
  which refresh passes ran and which surfaces were skipped.

## How a consumer links this file

Claude Code does not discover skills inside `node_modules`. `design-delta
init` and `design-delta dock` each write a stub at `.claude/skills/design-delta-build-design/SKILL.md` that
points here, the same way they link the other packaged skills; the stub
carries no procedure of its own, so it cannot disagree with the installed
version.
