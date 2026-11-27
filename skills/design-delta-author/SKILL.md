---
name: design-delta-author
description: Author a component's *.contract.json contract — from a described component, from a design-tool component in the project's design snapshot, or from existing code — so that it validates and states every decision, props, types, defaults, enum values, slots, anatomy, token bindings and sources, asking rather than inventing wherever the request leaves the component's API open. Use when asked to write, draft, add or finish a contract, to spec a new component, or when a build stopped because a component has no contract.
---

# design-delta author — from a request to a contract that states every decision

This file ships inside `design-delta` and describes **exactly the version
installed** in this project. What each contract construct means, and when to
reach for it, is the
[contract authoring guide](../../docs/contract-authoring-guide.md): read it
before writing a field you have not written before. This file is the
procedure around it, and repeats none of it.

**A contract is a list of decisions, and each one belongs to somebody.** The
name of a prop, whether it is required, what it defaults to, which values an
enum takes, what the component renders and which token colors it: once
written, the code is built to match and the audit holds it there. So the work
here is less writing JSON than finding out which of those decisions the
request already made, which the project's conventions make, and which nobody
has made yet. The last kind you **ask**. You never fill one in.

**Two things this file never does.** It names no framework, styling system,
design tool or file layout: those are this project's, and step 2 reads them
from the project. And it never builds the component: that is the sibling
skill [`skills/design-delta-build/SKILL.md`](../design-delta-build/SKILL.md),
which this procedure hands off to at the end.

## What it takes

A request for one component, and one of three starting points (step 3 picks):
existing code, a component in the project's design snapshot, or a description
alone.

## Steps

### 1. Check there is no contract already

```
npx design-delta contracts --json
```

Look for the component in `contracts` (by `id`) and in `diagnostics` (open
each file a diagnostic names and read its `id`: a contract that fails
validation is listed only there).

- **A valid contract exists**: this is a change to it, not a new one. Go to
  [Changing a contract](#changing-a-contract-that-exists).
- **An invalid one exists**: fix what the diagnostics name, in that file. Do
  not write a second file beside it.
- **Any other diagnostic in the output**: report it and carry on. It is not
  yours, and you need to know it was there before you started.

### 2. Read the project before deciding anything

- `design-delta.json` at the project root: `paths.contractsDir`,
  `paths.componentsDir`, `paths.tokensFile`, `paths.snapshotDir`, every key
  under `conventions`, `design.provider`, any `lint` block (a project can
  constrain prop-name case and enum vocabularies there), and its
  `_`-prefixed keys, where a project records local decisions.
- **One sibling contract**, close in shape to the component asked for, and
  the files beside it. It settles everything that is convention rather than
  decision: where a contract file lives and what it is called, the form of
  `id` and `title`, how `sources.code.path` and `sources.code.styles` are
  laid out, the `$schema` path, whether contracts carry `status`, `codegen`,
  `description` or `intent`, how props and anatomy nodes are named, and what
  a `codeClass` looks like. Run `npx design-delta audit --json` and check the
  sibling's `id` has no findings: a sibling with findings is a bad pattern,
  so pick another or say so.
- **The tokens.** Read what is under `paths.tokensFile`, and the sibling's
  `styles` block for how a token path is written and which tier of tokens
  contracts bind in this project. A project that separates raw values from
  the tokens components may use says so in its own instructions; a contract
  binds only the tier those instructions allow.
- **The project's own instructions** for agents and contributors. They may
  name a generator for new components. Use one only if you know what it
  writes: some draft a contract of their own and the component's files with
  it, which is the build's job, not this one's.

### 3. Pick the starting point

**Code that already exists.** Draft from it, then review every field:

```
npx design-delta scaffold <Component>
```

`<Component>` is the exported name. The draft records what the code does
today, which is not the same as what was decided: a prop the code happens to
take, a default nobody chose. Treat each drafted field as a proposal to
confirm in step 4, and each `_scaffold` note as a question it is asking you.
`scaffold` never drafts `sources.design` or `codegen`.

**A design-tool component.** Only when `design.provider` is set **and** the
file `design-components.json` exists under `paths.snapshotDir`. The engine
never calls a design tool, and neither does this procedure: the snapshot is
the design side. Find the component's entry by `name` and read its
`propertyDefinitions`, `variantProperties` and, when present, `layers` and
`usedVars`.

- The snapshot can be stale and still read as current. Its `provenance`
  block says when it was gathered; state that date in your report, and if the
  component is not in the snapshot at all, say so and stop or continue from
  the description. Refreshing a snapshot is a separate task, the sibling
  skill
  [`skills/design-delta-refresh/SKILL.md`](../design-delta-refresh/SKILL.md).
- What the snapshot says is a fact about the **design side**. It is not yet
  the code API. A design property becomes a contract prop under the name the
  code will use, with the design name recorded on it when the two differ; a
  design-only axis (an interaction state, a breakpoint) is marked so it never
  becomes a prop. The guide's section on deviation markers has each form.
  Which design properties become code props, and under what names, is a
  decision (step 4).
- `sources.design` is the entry's own address. Its shape belongs to the
  provider: copy the shape from a sibling contract that has one. With no
  such sibling and no documentation of the shape in the project, leave it
  out and report it, rather than guess a shape.

**A description alone.** Everything comes from the request and the project's
conventions. Leave `sources.design` out: an absent design source declares no
design counterpart, which is true.

### 4. Settle every decision, and ask the ones still open

Go down this list. For each line, the answer comes from the request, from the
starting point (step 3), or from the sibling's convention (step 2). When none
of the three gives it, it is **open**.

| Decision                                                                | Never open: the convention settles it | Open unless the request or the starting point states it |
| ----------------------------------------------------------------------- | ------------------------------------- | ------------------------------------------------------- |
| `id`, `title`, the contract's file name and directory                   | their form, from the sibling          | the component's name itself                             |
| `sources.code.path`, `sources.code.styles`                              | the layout, from the sibling          |                                                         |
| which props exist                                                       |                                       | every prop                                              |
| a prop's name                                                           | its case, from the sibling or `lint`  | the word                                                |
| a prop's `type`                                                         |                                       | text or arbitrary content, a flag or a set of values    |
| an enum's `values`                                                      | their case, and any `lint` vocabulary | which values, and how many                              |
| `required`, and `default`                                               |                                       | both, for every prop                                    |
| which axes are design-only (an interaction state, a breakpoint)         |                                       | whether the component has the state at all              |
| `anatomy`: the elements, their order, what is conditional (`presentIf`) | class naming, from the sibling        | the element for each node, and what each one renders    |
| `anatomy.<node>.attributes`                                             |                                       | any role or label the component must carry              |
| `styles`: which token each property binds, per variant                  | how a path is written                 | every binding the request does not name (step 5)        |
| `codegen`, `status`, `description`, `intent`                            | whether siblings carry them           | their content, where siblings carry them                |

**A node needs something to style.** When the contract names a stylesheet,
the audit looks for a rule in it for every anatomy node except a nested
component instance, and reports a node it finds none for
(`styles/element-unmapped`). So for each node, either the contract binds at
least one property on it, or the build has to give it a rule the contract
does not ask for. A node with nothing to style is a reason to ask whether it
should be a node.

**Ask the open ones once, together, before writing the file.** One message,
each question with the answer you would recommend and why, so the person can
reply "yes to all" or change two of them. A recommendation is not an answer:
it goes in the question, never in the contract.

What counts as stated: the request said it, the code does it and the
requester confirmed the code is right, or the design snapshot shows it. What
does not: "components like this usually have it", a prop a sibling has, or
your own preference.

**When nobody can answer** (an unattended run, or the question comes back
unanswered): write everything that is decided, and put a `_scaffold` note at
exactly the undecided spot:

```json
"props": {
  "_scaffold": { "todo": "is the component dismissible, and if so is that a boolean prop or a callback?" },
  "tone": { "type": "enum", "values": ["info", "danger"], "default": "info", "required": false }
}
```

- The note goes on the nearest object that still validates **without** the
  undecided thing: an undecided prop is left out, with the note on `props`;
  an undecided binding is left out, with the note on that element's `base`
  or on the variant.
- Its `todo` is the question, written so the owner can answer it without
  reading anything else.
- Never write a value in beside the note "for now". A marked guess is still
  what the code gets built from.
- One note per pending decision, and none anywhere a decision was made. The
  audit reports any contract that carries one
  (`coverage/unfinished-contract`), so a note is a visible debt, not a
  comment.

### 5. Bind only tokens the project has

For every token a `styles` value names, check the path exists:

```
npx design-delta impact <token.path> --json
```

Exit `0` with `"kind": "token"` means the project has it. Exit `1` saying
there is no token with that id means it does not. **Nothing else in the
engine makes this check.** `design-delta contracts` validates a contract that
binds a path that does not exist, and once the component is built the audit
reports it, at best, as a stylesheet binding "a different token" than the
contract declares, never as a token that is missing. So this step is the only
place it is caught by name.

When the component needs a value and the project has no token for it, that is
an open decision like any other, with three possible answers and none of them
yours to pick alone: bind a different token that exists, write a deliberate
`raw(…)` value, or add a token first (a token task, outside this procedure:
the sibling skill
[`skills/design-delta-token/SKILL.md`](../design-delta-token/SKILL.md)).
Ask, or mark it. Never bind a path that is not there, and never pick the
nearest-looking token because its value happens to match.

A path that exists can still be the wrong tier: see step 2.

### 6. Check what is new to this project

A contract can validate and still ask for something this project has never
built, and the project's own gate is where that fails, after the build. Go
through the contract for anything no sibling contract does:

- a construct no sibling uses: a variant that restyles a child node rather
  than the root, a conditional node, a second rendered shape, a design-only
  state;
- a combination no sibling binds together: a foreground token on a background
  token, a type size with a line height.

For each, look for what in the project would judge it: its instructions, and
the checks its gate runs over a component's stylesheet or markup (a contrast
check, a stylesheet linter, a test that reads every component's styles).
Where one would reject it, that is an open decision: ask, with the
alternative a sibling already uses as your recommendation. Where you cannot
tell, keep it and list it in the report as new to this project, so the build
knows where to look first.

### 7. Write the file, then validate it

Write the contract where the sibling's lives, in the sibling's shape, then:

```
npx design-delta contracts --json
```

The new `id` must be in `contracts` with `"valid": true`, and no diagnostic
may name the file you wrote. Do not require `ok` to be `true`: it is `false`
while any contract in the project has a diagnostic, including one step 1
found and reported as not yours. Fix every diagnostic naming your file; each
is a mistake in what you wrote, not a question for anyone. Then:

```
npx design-delta audit --json --contract <id>
npx design-delta lint --json
```

`--contract` scopes the audit's `findings` to the new `id` and its elements;
an id the engine did not load exits `1`, for one of two causes the message
tells apart: `failed to load` means the contract has a diagnostic (it is
printed with the message; fix it), and `no contract with id` means the
contract is not where the project looks for contracts. For a contract whose code does not
exist yet, these are expected:

- `coverage/contract-only`: the contract names a code path with nothing
  there. The build clears it.
- `coverage/unfinished-contract`: one or more `_scaffold` notes remain. It
  lists where; that list must match the pending decisions in your report.

When the contract declares `sources.design` (the design-snapshot starting
point), the design side is compared too, so these are expected as well:

- `components/binding-file-missing`, when the project configures a
  binding-file convention: no binding file is committed yet. The build
  writes it, from the finding's `data.expected`.
- Any other design-side finding for the `id` (a `components/*`, `styles/*`,
  `anatomy/*` or `coverage/design-missing` finding comparing the contract
  with the design census) is a place the contract and the snapshot
  disagree. Read each: either the contract is wrong, and you fix it, or the
  difference is a decision, and it goes in the report with the finding's
  rule id. Never edit the contract only to make a finding go away.

Anything else for that `id` is worth reading before you hand off. For a
contract written over existing code, every finding for the `id` is a place
the code and the contract disagree: decide with the requester which side is
right, and never settle it by quietly editing the contract to match.

`lint` reports a prop or node name, or an enum value, that breaks a
convention the project configured. Fix those in the contract.

### 8. Read the contract once as its builder

Before reporting, read the file top to bottom as the person who has to build
from it with nothing else:

- every prop has a `type`, and `required` is written out: a prop that omits
  it is required, which is rarely what an omission meant;
- every optional prop that has a default states it;
- every enum lists its values, and every `when` in `styles` names a declared
  prop and one of its values;
- every anatomy node has an `element`, the nodes are in render order, each
  prop the component displays is some node's `content`, and each node has a
  binding or a stated reason to exist without one (step 4);
- every token-bearing property the component needs is bound or deliberately
  `raw(…)`, per variant;
- nothing is in the file that nobody decided.

### 9. Report, and hand off

- **Contract**: the file written, and that it validates.
- **Starting point**: code, design snapshot (with its gathered date) or
  description.
- **Decisions**: each one, and where its answer came from: the request, the
  starting point, the sibling's convention, or the answer to a question you
  asked.
- **Pending**: every `_scaffold` note, with its question. "None" is a valid
  entry; leaving the section out is not.
- **Tokens**: every path bound, and that each one resolved in step 5.
- **New to this project**: every construct or combination from step 6 that no
  sibling has, and whether the project's own checks were found to accept it.
- **Audit**: the findings for the new `id`: the expected ones from step 7
  for this starting point, and each design-side finding with what you
  decided about it. Any other finding is named with why it remains.

Then hand off to the build skill, **`design-delta-build`**, with the
contract's path. It builds what the contract states and leaves alone what a
`_scaffold` note leaves open, so a contract with pending decisions can be
built, but the component is not finished until they are answered.

## Changing a contract that exists

The same procedure for the part that changes. Read the contract and the
sibling (step 2), settle what the request changes and ask what it leaves open
(step 4), check any new token (step 5) and anything new to the project
(step 6), validate (step 7) and report.

A change to a contract with code behind it puts the code out of line with it
on purpose: the audit's findings for the `id` after the change are the list
of what the build skill's update procedure then brings back in line. Say so
in the report, with the findings. Renaming an `id` breaks every exemption in
the project's config that names it; search the config for the old `id`
first.

Never change a contract to make a finding go away. A finding says the code
and the contract disagree; if the code is the side that is wrong, the fix is
in the code.

## What this does not cover

- **Building the component.** That is `design-delta-build`.
- **Deciding for the owner.** Every open decision is asked or marked.
- **The design tool.** Nothing here creates, edits or reads a design-tool
  component directly; the design side is whatever the snapshot on disk says.
  Building the contract's component in the design tool is
  [`skills/design-delta-build-design/SKILL.md`](../design-delta-build-design/SKILL.md).
- **Refreshing the design snapshot.** A stale or missing snapshot is
  reported, and the contract is written from what is there; the refresh is
  `design-delta-refresh`.
- **New tokens.** A value with no token is a question, never a new token
  written by this procedure. Adding, renaming or removing one is
  `design-delta-token`.
- **Behavior a contract cannot state.** Interaction logic, focus management
  and data are not in a contract. Note in the report what the request asks
  for that the contract has no place to record, so the build does not lose
  it.

## Hard limits

- Never write a prop, a default, an enum value, an element or a binding that
  nobody decided.
- Never leave an undecided thing unmarked, and never mark a decided one.
- Never bind a token path the project does not have.
- Never hand off a contract `design-delta contracts` does not validate.
- Never edit a contract to clear a finding.
- Never write the component's code under this procedure.

## How a consumer links this file

Claude Code does not discover skills inside `node_modules`. `design-delta
init` and `design-delta dock` each write a stub at `.claude/skills/design-delta-author/SKILL.md` that
points here, the same way they link the audit and build skills; the stub
carries no procedure of its own, so it cannot disagree with the installed
version.
