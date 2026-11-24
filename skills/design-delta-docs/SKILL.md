---
name: design-delta-docs
description: Write or refresh a component's documentation page from its *.contract.json contract — purpose, props with types, defaults and enum values, slots, states, anatomy, the token each element binds, and usage guidance — in the documentation format this project already uses, stating only what the contract states and marking every place it is silent as needing a person, so that running it again after the contract changes rewrites only the generated parts. Use when asked to document a component, to write, generate or update its documentation page, or when a component's page no longer matches its contract.
---

# design-delta docs — from a contract to a page that says what the contract says

This file ships inside `design-delta` and describes **exactly the version
installed** in this project. Its sibling
[`skills/design-delta/SKILL.md`](../design-delta/SKILL.md) explains the model
and how to read a finding. What each contract construct means is the
[contract authoring guide](../../docs/contract-authoring-guide.md): read its
section before documenting a construct you have not met. This file is the
procedure around both, and repeats neither.

**The page says what the contract says, and nothing else.** A contract
already states a component's props, their types, defaults and enum values,
its slots, the elements it renders, its states and the token each element
binds. A documentation page that restates those by hand is a second copy,
and it goes stale the day the contract changes. This procedure writes that
part of the page from the contract, so it can be written again whenever the
contract moves. What the contract does not state, the page does not state
either: it carries a question for a person in that place, never your answer.

**Two kinds of text live on one page.** What this procedure generates sits
between markers and is rewritten on every run. Everything outside the
markers is a person's, and no run touches it; the one exception is the open
questions this procedure leaves there until somebody answers them (step 5).
That split is what lets the page be refreshed without losing what somebody
wrote.

**Two things this file never does.** It names no framework, documentation
tool or file layout: those are this project's, and step 3 reads them from
the project. And it never changes a contract or a component's code: a page
that looks wrong because the contract is wrong is a contract change, and
that is the sibling skill
[`skills/design-delta-author/SKILL.md`](../design-delta-author/SKILL.md).

## What it takes

One contract, given as a path to a `*.contract.json` file or as a component
`id`. Everything else is read from the project.

## Steps

### 1. Find the contract, or stop

```
npx design-delta contracts --json
```

A contract that validated is in `contracts`, as `{ id, file, valid }`. One
that failed is only in `diagnostics`, under its `file`.

- **A diagnostic names this contract's file, or its entry says
  `valid: false`: stop**, and report the diagnostics as they are. A page
  generated from an invalid contract documents nothing anyone agreed to.
- **No contract for the component: stop**, and say so. Do not document the
  component from its code: the code is what is checked against the contract,
  not a second source for it. Writing a contract is `design-delta-author`.

### 2. Check whether the code agrees with the contract

```
npx design-delta audit --json --contract <id>
```

The page describes the contract. Whether the code does what the page says is
a separate fact, and the reader of your report needs it:

- **No findings, and no `skipped` entry for `components`, `styles` or
  `anatomy`**: the code matches, and the page describes both.
- **`coverage/contract-only`**: the component is not built yet. A page for it
  documents something nobody can use; say so and stop, unless the request
  asked for the page anyway.
- **`coverage/unfinished-contract`**: the contract carries `_scaffold` notes,
  decisions nobody has made. Step 4 carries each one to the page as
  undecided.
- **`components/intent-unverified` or `components/intent-stale`**: the
  contract's usage guidance has not been reviewed against the component's
  current props. Step 4 says what the page does with it.
- **Any other finding**: the code disagrees with the contract somewhere. The
  page still states the contract, which is the fixed point; never bend the
  page toward what the code does. Carry on, and put the findings first in the
  report. Bringing the code back in line is the update procedure in
  [`skills/design-delta-build/SKILL.md`](../design-delta-build/SKILL.md).
- **A `skipped` entry**: that surface did not run, so agreement is unknown,
  not confirmed. Report it that way.

### 3. Read how this project documents a component

Assume nothing the project does not show you.

- `design-delta.json` at the project root: `paths.contractsDir`,
  `paths.componentsDir`, and its `_`-prefixed keys, where a project records
  local decisions.
- The project's own instructions for agents and contributors, and its
  `package.json` scripts: they name the command that builds or checks its
  documentation (step 7).
- **A sibling's page.** Take a component close in shape to this one, with a
  contract, and search the project for its `title` and its `id` outside its
  own code and tests. A documentation page for it settles everything that is
  convention: the format and file extension, where a page lives and what it
  is called, its metadata block, its headings and what each section is named,
  how a table is written, how a token is shown (by the path the contract
  writes, or by the name the stylesheet uses), how an example is embedded,
  and how the page is registered so the documentation picks it up (a
  navigation list, an index, a pattern the tool loads files by). Read the
  whole page. A sibling's page that carries this procedure's header line
  (step 6) is the better pattern: it is the same split of generated and
  hand-written text. A hand-written one is a pattern for format, not for
  what to say.
- **This component already has a page.** Read it:
  - it carries the header line and names this contract: this is a re-run.
    Go to [Running again](#running-again-after-the-contract-changed);
  - it has no header line: it is the project's own page, and not yours to
    rewrite. Stop and ask whether to add generated sections to it (the
    owner says where each goes), to replace it (they move theirs aside), or
    to leave it. Never edit it on your own decision.
- **No sibling has a page.** This would be the project's first, and its
  format and location are a decision. Look at what the project has for
  documentation: a tool that renders pages beside its component examples, a
  documentation site with a content directory, or neither. Then ask once:
  which format, where the page goes, and whether any configuration has to
  change for the page to be picked up, with the answer you would recommend
  and why. A configuration change is the owner's to approve; make it only
  with that approval, and name it in the report.

  **When nobody can answer** (an unattended run): write plain Markdown, in
  a file named for the contract's `id`, beside the contract. It needs no
  configuration and nothing has to load it. Say in the report that this is
  the fallback, that nothing publishes the file yet, and what the decision
  still owed is.

### 4. State what the contract states

Go down the contract. Every construct below has one place on the page, and
nothing reaches a generated section from anywhere else: not from the code,
not from a sibling's page, not from what components of this kind usually do.

| The contract has                                               | The page states                                                                                                                                                                                             |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `title`, `id`                                                  | the page's heading, and the `id` where siblings' pages show it                                                                                                                                              |
| `description`                                                  | the purpose line, word for word. Absent: a question (step 5)                                                                                                                                                |
| `status`                                                       | `draft` or `deprecated`, the way a sibling's page shows it, or one line under the heading. `published`, or absent: nothing                                                                                  |
| `intent.usedFor`, `intent.misusedAs`, `intent.useInstead`      | usage: when to use it, what it is mistaken for, what to use instead, each word for word. `useInstead` names components by contract `id`; link each to its page where it has one                             |
| `intent.verifiedAgainst`                                       | nothing. When step 2 reported `components/intent-unverified` or `components/intent-stale`, one line under the usage section saying the guidance has not been reviewed against the component's current props |
| a `props` entry, any `type` but `slot`, without `code: "none"` | a row in the props table: the name, its `type`, whether it is required (a prop that omits `required` is required), its `default`, whether it is `nullable`, and its `description`                           |
| `type: "boolean"`, `"string"`, `"number"` or `"function"`      | that type, as the sibling's page writes a type                                                                                                                                                              |
| `type: "enum"` with `values`                                   | every value, in the contract's order, in exactly its spelling and case                                                                                                                                      |
| a `props` entry with `type: "slot"`                            | a row in the slots section, never the props table: the name, whether it is required, the components it `accepts`, its `minChildren` and `maxChildren`, and its `description`                                |
| a `props` entry with `code: "none"`                            | a row in the states section, never the props table: the axis, its `values` and its `default`. It is not something a caller passes; it is a state the component is in (an interaction state, a breakpoint)   |
| a `props` entry with `code: "unverified"`                      | its row, with a note that the code side of this prop is not confirmed                                                                                                                                       |
| a `design` marker on a prop                                    | nothing. It describes the design tool's side. A project whose pages carry a design-name column gets `design.name` there, and nothing else                                                                   |
| `codegen.className`, `codegen.domPassthrough`                  | one line under the props table each: that the component accepts a `className`, and which element's native props pass through                                                                                |
| `codegen.exampleContent`, `codegen.example`                    | nothing. They shape a generated binding file, not the component                                                                                                                                             |
| `anatomy`                                                      | the anatomy section: every node from `root` down, nested in `children` order, each with its name, its `type` and its `element`                                                                              |
| a node's `content`                                             | what the node renders: the literal text, or the prop a `$prop` binding names                                                                                                                                |
| a node's `presentIf`                                           | that the node renders only when that prop is set                                                                                                                                                            |
| a node's `instanceOf`                                          | the component rendered there, linked to its page where it has one                                                                                                                                           |
| a node's `attributes`                                          | each attribute and its literal value, on that node. This is the accessibility surface the contract pins, and all of it that the page may state                                                              |
| a node's `codeClass`, `designLayer`                            | nothing, unless siblings' pages list class names                                                                                                                                                            |
| `anatomy.$variants`                                            | the rendered shapes: each variant's name, its `when` quoted as the note it is, and the nodes that differ from the base                                                                                      |
| `styles.<element>.base`                                        | the token bindings table: element, property, and the token path or the `raw(…)` value as written. A structured value is one row per leaf, named by its path (`padding.block`, `border.color`)               |
| a `styles.<element>.variants` entry                            | under that element, its `when` and the rows it overrides. When the `when` names a `code: "none"` prop, the rows go in the states section instead: they are what changes in that state                       |
| `invalidVariantCombinations`                                   | the combinations the component does not support, each as written                                                                                                                                            |
| `subcomponents`                                                | one subsection each, with the same sections in the same order                                                                                                                                               |
| `sources`                                                      | `sources.code.path` where siblings' pages show a source or import path. `sources.design` is an address in a design tool, never documentation                                                                |
| `$schema`, `schemaVersion`                                     | nothing                                                                                                                                                                                                     |
| a `_scaffold` note                                             | a question at the place it sits (step 5), carrying its `todo`. The undecided thing is not on the page                                                                                                       |
| any other key that starts with `_`                             | nothing. It is a comment for the contract's maintainers                                                                                                                                                     |

**Word for word.** A prop name, an enum value, a default, a token path: each
is copied, never tidied, translated or re-cased. Enum matching in this engine
is exact, so a page that writes `Small` for `sm` documents a value that does
not exist.

**A token by its name, never by its value.** The contract binds a path. What
that path resolves to can change without the contract changing, and the page
would then be wrong with nothing to say so. Write the value only where
siblings' pages show one through something that reads it live.

**One order, every run.** Sections in the order of the table above; props,
slots, states, nodes and bindings in the contract's own order. A section the
contract has nothing for is left out, heading and all, unless siblings' pages
keep an empty one; so is a table column no row has a value for. This is what makes a second run against an unchanged
contract change nothing.

### 5. Mark what the contract cannot say

A contract has no place for most of what a reader wants beyond the API. Each
of these is a question on the page, never prose you supply:

| The contract is silent on                                         | The question to leave                                                |
| ----------------------------------------------------------------- | -------------------------------------------------------------------- |
| purpose, with no `description`                                    | what the component is for, in one line                               |
| usage, with no `intent`                                           | when to use it, what it is mistaken for, and what to use instead     |
| behavior: what happens on a click, a key press, a change of focus | what each interaction does                                           |
| keyboard and focus order                                          | which keys it answers to, and where focus goes                       |
| accessibility beyond the declared `attributes`                    | its accessible name, and anything a screen-reader user needs to know |
| content: what belongs in a slot, how a label is worded, length    | what good content looks like here                                    |
| each `_scaffold` note                                             | its `todo`, as written                                               |

Write each as one line that starts `Needs a human:` and then the question,
worded so its owner can answer without opening the contract. Put it under the
heading the sibling's page uses for that subject, **outside** the markers;
where the sibling's page has no such heading, collect them in one list at the
end of the page. The phrase is fixed so the open ones can be searched for.

Leave out a question the page already answers in a person's own words. A
line that still starts `Needs a human:` is this procedure's, the one text
outside the markers that is: a person who answers it replaces it, and from
then on the text is theirs.

**Never answer one.** Not from the component's code, not from a similar
component, not from what is usual. Reading the code and writing "Escape
closes it" puts an unreviewed claim on a page people trust, and the next
change to the code makes it false with nothing to notice. If the request
itself states a behavior, quote it in the report and ask where it should
live; it still is not yours to write into the page as fact. A usage answer
that should be checked for staleness belongs in the contract's `intent`,
which is a contract change and `design-delta-author`'s.

### 6. Write the page, with its markers

Write the page where the sibling's lives, in the sibling's format. Three
lines mark what is generated, each written as a comment in the page's own
format (`<!-- … -->` in Markdown and HTML, `{/* … */}` in MDX), alone on its
line:

```
design-delta-docs: generated from <contract path>. Text between start and end markers is rewritten on every run; text outside them is yours.
design-delta-docs:start <section>
design-delta-docs:end <section>
```

- The first is the **header line**, once, as near the top as the format
  allows (after a metadata block, where the format has one). The path is the
  contract's, relative to the project root. It is what says this page may be
  refreshed: a page without it is never edited (step 3).
- A start and an end line wrap each generated section, heading included.
  `<section>` is one of `purpose`, `usage`, `props`, `slots`, `states`,
  `anatomy`, `shapes`, `tokens`, `combinations`, `subcomponents`, in that
  order.
- Nothing a person is meant to write goes between a start and an end line,
  and nothing generated goes outside one, the `Needs a human:` lines apart:
  they sit outside so that an answer written in their place is never
  overwritten.

Where siblings' pages embed examples from an example file, embed the ones
this component's example file already has, the same way, outside the
markers. Write no new example: that is the build skill's. A component with
none gets a `Needs a human:` line for it.

Then register the page the way the sibling's is registered, and change
nothing else. Where the project's tool already generates a page for the
component from its code, this page goes beside that one; replacing it is the
owner's call.

### 7. Check the page

- **Against the contract.** Read the page beside the contract once: every
  prop, enum value, default, slot, state, node, attribute and binding is
  there, spelled as the contract spells it, and nothing between markers is
  absent from the contract.
- **Through the project's own tools.** Run the command that builds or checks
  the project's documentation, and its formatter if it formats this kind of
  file. The page has to load, and what the formatter leaves is the form the
  generated sections take: write them that way, so the formatter does not
  move them on the next run.
- **As a reader.** A build that passes is not a page that renders. Open the
  built page once, or read what the build wrote for it: a table that came
  out as a row of pipes, or a marker that shows as text, is syntax this
  project's tool does not read as written. Write that construct in markup
  the tool does render, and build again. A sibling's page normally settles
  this; a first page is where it shows.
- **Twice.** Generate the sections once more from the same contract and
  compare with what is on disk. Any difference is a section that will churn
  on every run; fix how it is written until there is none.

### 8. Report

- **Page**: the file written, its format, where the format came from (a
  sibling's page, the answer to a question, or the unattended fallback), and
  any registration or configuration change.
- **Code agreement**: the scoped audit's findings for the component, each
  with its `ruleId`, or that there are none; and any surface that was
  skipped.
- **Stated**: the generated sections, by name.
- **Needs a human**: every `Needs a human:` line on the page, with its
  question. "None" is a valid entry; leaving the section out is not.
- **Left out**: anything in the contract with no place on the page, and
  anything the request asked for that the contract does not state.
- **Check**: the documentation command run, and its result.

## Running again after the contract changed

The same procedure, writing less. Run steps 1 and 2, read the project as in
step 3, then:

1. Read the page. Its header line must name this contract. If it names
   another, or there is none, stop: step 3 says what to ask.
2. For each section, in order, generate it from the contract as it is now
   (steps 4 and 6) and replace what is between that section's markers. Text
   between markers is overwritten without a merge; that is the agreement the
   header line states.
3. **A section the contract no longer has anything for**: remove it, markers
   included.
4. **A section the contract now has and the page does not**: add it in its
   place in the order. First look for a heading for that subject outside any
   markers: if a person has written that section themselves, or removed its
   markers to keep their own edit, it is theirs. Leave it, and report that
   the section is hand-maintained and what the contract now says for it.
5. **Never edit a person's text outside the markers.** Read it, though, and
   list in the report every place it names a prop, value, slot, state, node
   or token the contract no longer has. Those are a person's to change. The
   one exception is a line that still starts `Needs a human:`: remove it
   when the contract now answers it (a `description` or an `intent` was
   added), reword it when it names something the contract dropped, add one
   for anything newly silent, and list each in the report.
6. Run step 7. A run against a contract that did not change must leave the
   page byte for byte as it was: check with the project's version control.
   If it does not, either someone edited between markers, and that edit is
   now gone (say so, with the difference), or a section is not written in
   the form step 7 fixed.
7. Report as in step 8, with one line per section: unchanged, rewritten,
   added, removed, or left as hand-maintained.

A page whose contract was deleted, or whose `id` no longer exists, is
reported and left alone. Removing a page is the owner's.

## What this does not cover

- **Writing or changing a contract.** A page that needs something the
  contract lacks, an `intent` block included, is a contract change:
  `design-delta-author`.
- **The component's code, examples and tests.** Those are
  `design-delta-build`'s, and a disagreement between code and contract is
  reported here, never fixed.
- **Behavior a contract cannot state.** Interaction, focus management, data
  and animation are not in a contract, so they are questions on the page.
- **Pictures.** No screenshot, rendered preview or anatomy diagram is made
  here. Whatever the project's documentation renders from its examples, it
  renders on its own.
- **The design tool.** Nothing is read from it, and the design side's names
  for things stay off the page unless the project's pages already carry
  them.
- **Choosing a project's documentation system.** With none in place, the
  choice is asked, and the unattended fallback is a plain file.

## Hard limits

- Never state, between markers, anything the contract does not state.
- Never answer a `Needs a human:` question, and never remove one the
  contract does not now answer.
- Never edit a person's text outside the markers, or a page with no header
  line.
- Never write a name, a value or a token path other than as the contract
  spells it, and never a token's resolved value in place of its path.
- Never edit a contract, a component's code or, without the owner's
  approval, the project's documentation configuration.
- Never report a page as matching its component when the scoped audit has
  findings, or a surface was skipped.

## How a consumer links this file

Claude Code does not discover skills inside `node_modules`. `design-delta
init` and `design-delta dock` each write a stub at `.claude/skills/design-delta-docs/SKILL.md` that
points here, the same way they link the other packaged skills; the stub
carries no procedure of its own, so it cannot disagree with the installed
version.
