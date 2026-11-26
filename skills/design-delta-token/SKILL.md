---
name: design-delta-token
description: Change a project's DTCG tokens file — add a token, rename one, or deprecate or remove one — listing first everything the change touches (the code that references the token, the contracts that bind it, the tokens that alias it and the config entries that name it), asking rather than inventing the token's name, tier and value, editing only the tokens file, and handing every contract and code edit the change needs to the authoring and build skills. Use when a component needs a token the project does not have, when asked to add, rename, deprecate or remove a design token, or when a contract or build stopped on a missing token.
---

# design-delta token — changing the tokens every contract and stylesheet builds on

This file ships inside `design-delta` and describes **exactly the version
installed** in this project. Its sibling
[`skills/design-delta/SKILL.md`](../design-delta/SKILL.md) explains the model
and how to read a finding; the full reference for every command used here is
[cli.md](../../docs/cli.md).

**The tokens file is the token contract.** Every contract binds a token by its
path, every stylesheet references the custom property the token emits as, and
other tokens alias it. So a token is a decision other decisions are built on:
its name is what they all spell, its tier says what may use it, and its value
is what they all show. Changing one is cheap to type and expensive to get
wrong, because most of what it breaks the engine does not report by name.

**The engine sees less of a token change than you would expect.** Checked
against this version:

- `design-delta contracts` validates a contract that binds a path the tokens
  file no longer has. Nothing in the engine reports that contract by name.
- `design-delta impact <token> --json` reports **code** references only, and
  only for a token the tokens file still has: once it is renamed or removed,
  asking about the old path exits `1`.
- A token that aliases a path that is gone is dropped from the token census,
  and the audit says so only in its `diagnostics`, as `unresolvable-alias`.

So this procedure measures what the change touches **before** it makes it,
and the list it builds is the only complete record of what is left to move.

**Two things this file never does.** It names no framework, styling system,
design tool or token build: those are this project's, and step 1 reads them
from the project. And it edits nothing but the tokens file: a contract or a
stylesheet that still names the old token is listed and handed on, never
edited here to follow the change (step 7).

## What it takes

One change: a token to add, a token to rename (and its new name), or a token
to deprecate or remove. A group of tokens is the same change made for each
token in it; take step 3 for every one.

## Steps

### 1. Read the project before deciding anything

- `design-delta.json` at the project root: `paths.tokensFile` (one file, or a
  directory of them), `paths.resolvedTokensFile`, `paths.styleRoots`,
  `paths.contractsDir`, `paths.componentsDir`, `conventions.cssVarPrefix`,
  the `lint` block (its `tiers` list the project's tiers, lowest first, by
  each token id's first segment; its `vocabularies` close the names a token
  may take), every `rules` option and `exemptions` entry that names a token
  id or prefix, `design.options` when a design provider is set, and the
  `_`-prefixed keys, where a project records local decisions.
- **The tokens file.** Read it, and the tokens next to where the change goes:
  they settle everything that is convention rather than decision, the file a
  token of this kind lives in, how a group is nested, how a name is cased,
  whether `$type` sits on the token or its group, whether siblings carry
  `$description`, how modes are written, and whether a token in this tier
  holds a literal value or aliases one in a lower tier.
- **The project's own instructions** for agents and contributors, and its
  `package.json` scripts. They may say which tiers components may bind, and
  they name the token build: the step that emits tokens into the stylesheets
  under `paths.styleRoots`. If that output is generated, step 6 runs it.

### 2. Take the list before you change anything

If step 1 found the stylesheets under `paths.styleRoots` are the token
build's output, run the project's token build first, exactly as step 6 will:
a fresh checkout with that output gitignored or stale otherwise reports
findings here that step 6's rebuilt run clears, and the change gets the
credit for clearing them.

```
npx design-delta contracts --json
npx design-delta audit --json
npx design-delta lint --json
```

Keep all three documents outside the project's tracked files: step 6
compares against them. Read the audit's `diagnostics` too; an
`unresolvable-alias` already there is not yours, and you need to know it was
there before you started.

### 3. Measure what the change touches

**Which spelling of the id each search uses.** A project that keeps each
mode as its own top-level set (`system/light` beside `system/dark`) spells
one token two ways. The census id carries the set: `impact` takes
`system/light.color.bg.primary`, and asks about one mode's copy. A contract
binds, and a `design.options.tokenMap` entry names, the collapsed id with the
mode dropped: `system.color.bg.primary`. An alias inside the tokens file is
written the way the file writes it, usually the collapsed id between sibling
mode sets; search both. Below, `<token.path>` is the census id for `impact`
and the collapsed id for the contract and config searches. Run `impact` once
per mode set, and a rename, deprecation or removal applies to the token in
every mode set, never one.

**For an add**, check the name is free:

```
npx design-delta impact <new.token.path> --json
```

Exit `1` saying there is no token with that id is what you want. Exit `0`
means the project already has it: stop, and report that the token exists.

`impact` matches the exact id only, so two clashes it cannot see are yours
to check in the tokens file, every file in it when it is a directory:

- **The path is a group already.** Adding `color.bg` beside
  `color.bg.primary` turns a group into a node that is both a token and a
  group. Search for any token whose path starts with `<new.token.path>.`;
  finding one is a clash.
- **An ancestor is a token.** Adding `color.bg.primary.hover` under the
  token `color.bg.primary` does the same from below. Run `impact` for each
  ancestor path (`color.bg.primary`, then `color.bg`, then `color`); an exit
  `0` on any is a clash.

Either clash: stop, and report the existing token or group that the new path
collides with. Its name is step 4's to settle again, never yours to pick.

**For a rename, a deprecation or a removal**, run each of these for the
token as it is now, before the tokens file changes:

| What references it | How to find it                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| code               | `npx design-delta impact <token.path> --json`. `usedBy` is every file and line that references the token; `vars` is the custom-property names they reference it by. Exit `1` means the project has no token at that path: stop and say so. Mark each `usedBy` line that sits in the token build's own output: the build rewrites it, so step 7 hands it to no one                                 |
| its declaration    | `usedBy` holds `var()` usages only, never the line that declares the custom property. Search `paths.styleRoots` for the declaration `<name>:` of the token's custom property (the name `vars` gives, or `conventions.cssVarPrefix` and the id joined by hyphens when `vars` is empty), and record whether the file is the token build's output or hand-written                                    |
| contracts          | `impact` does not report these. Search every file under `paths.contractsDir` for the path as a quoted string, `"<token.path>"`, and record each contract file, the element under `styles`, and the property (and the variant's `when`, for a binding inside a variant)                                                                                                                            |
| other tokens       | `impact` does not report these either. Search the tokens file, every file in it when it is a directory, for the alias `{<token.path>}`; and `paths.resolvedTokensFile` too when the project sets it                                                                                                                                                                                               |
| config             | search `design-delta.json` for the token's id, for each custom-property name in `vars` and the declared one (a var-centric finding's entity, so its exemption names the var), and for each ancestor prefix of the id (`color.bg.primary`, `color.bg`, `color`): an `exemptions` entry, a `rules` option (an `ignorePrefixes` prefix), a `lint` vocabulary path, a `design.options.tokenMap` entry |
| the design side    | only when `design.provider` is set: the audit's findings for this token on the `tokens` surface say whether a design variable is paired with it. A rename breaks that pairing by name, and a `design.options.tokenMap` entry naming the old id then reports `tokens/design-token-map-unknown`. Both are the design side's to follow; nothing here edits the design tool                           |

`usedBy` covers what the scan reads, `paths.componentsDir` and
`paths.styleRoots`. If the project references tokens anywhere else (a
stylesheet outside those, a script that reads the tokens file), search it
too, and say in the report where you looked.

This list is what step 7 hands on, and the report's first section. Write it
down now: after the change, the engine can no longer give you its code half
and never gave you the rest.

### 4. Settle every decision, and ask the ones still open

| Decision            | Never open: the project settles it                          | Open unless the request states it                                                          |
| ------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| the file and group  | where siblings of this kind live                            | which group, when two would fit                                                            |
| the name            | its case, and any `lint` vocabulary for the leaf            | the words                                                                                  |
| the tier            | which tiers exist, from `lint` and the project instructions | which tier this token is in                                                                |
| `$type`             | what the value's kind requires                              |                                                                                            |
| the value           | whether this tier holds a literal or an alias, per siblings | the literal, or which lower-tier token it aliases; per mode, where siblings carry modes    |
| `$description`      | whether siblings carry one                                  | its words, where they do                                                                   |
| a rename's new name | its case and vocabulary                                     | the words, always                                                                          |
| a deprecation       |                                                             | that it is deprecated, and what replaces it                                                |
| a removal           |                                                             | that it goes, when step 3 found anything still referencing it                              |
| a removal's aliases |                                                             | for each token step 3 found aliasing it, the token it aliases instead, or that it goes too |

What counts as stated: the request said it, or a source the request points
at shows it (a design token snapshot, a value a contract question named).
What does not: "the nearest token in the scale", a value that happens to
match one already in the file, or your own preference. Never pick a token's
value because it is close to another's, and never pick its name because a
sibling's pattern suggests one.

**Ask the open ones once, together, before writing anything.** One message,
each question with the answer you would recommend and why, so the person can
reply "yes to all" or change two of them. Recommend from what the project
shows: a tier from where the components that will bind it bind today, a name
from the vocabulary its siblings use, a value from the request's source. A
recommendation is not an answer: it goes in the question, never in the file.

**When nobody can answer** (an unattended run, or the question comes back
unanswered): the tokens file has no place for a marked placeholder that still
parses, so write nothing a decision is still open on. A token with an open
name, tier or value is not added; a rename with no new name is not made; a
removal of a token something still references is not made, nor one whose
aliasing tokens have no new target decided. A deprecation
whose replacement is open is written with `"$deprecated": true` and no
replacement named. Report each open decision as the question its owner
answers (step 8).

### 5. Make the change, in the tokens file only

**Adding.** Write the token where its siblings live, in their shape, with
what step 4 settled. Then hand back to whoever asked: a contract waiting on
the token is `design-delta-author`'s step 5, and a build waiting on one is
`design-delta-build`'s step 6. Neither needs anything else from here.

**Renaming.** Move the token to its new path, keeping its `$type`, `$value`,
`$description` and `$extensions` as they were; a rename changes no value. A
`$type`, `$deprecated` or `$extensions` the token inherits from its group
(step 1 found where this file puts them) does not move with it: when the new
group does not declare the same ones, write them onto the token itself, so
it reads the same at its new path as at its old.
Then update every alias step 3 found inside the tokens file to the new path:
an alias is part of the token system, and leaving one behind drops the
aliasing token from the census. Nothing outside the tokens file changes here.
Every contract and stylesheet step 3 listed now names a path, or a custom
property, that is gone: that is step 7's list.

**Deprecating.** Add `$deprecated` to the token: a string saying what to use
instead, written so a reader can act on it (`"Use <other.token.path>."`), or
`true` when nothing replaces it. The token stays, with its value, and keeps
working; nothing in the engine reports a deprecated token still in use, so
step 3's list is the migration list, and step 7 hands it on.

**Removing.** Only when step 3 found nothing referencing the token, or the
owner, shown that list, decided to remove it anyway. Otherwise recommend
deprecating it first, with its replacement, and stop. When it does go,
first point each token that aliased it at the target step 4 settled, or
remove that token too where step 4 settled it goes (and take step 3 for it
first: it may be referenced in turn). Then remove the token, and any group it
leaves empty, and nothing else. No alias is left pointing at the path.

### 6. Validate, and compare with the list before

If the stylesheets under `paths.styleRoots` are the token build's output, run
the project's token build first: an audit against tokens that were never
emitted, or against a stylesheet still declaring the old ones, reports the
wrong thing. Then:

```
npx design-delta contracts --json
npx design-delta lint --json
npx design-delta audit --json
```

Compare each with step 2's, matching findings on `ruleId`, `entity` and
`data`, and read `diagnostics` and `skipped` on both:

- **`contracts`**: the same as before. A contract that binds the old path
  still validates; that is the engine, not evidence the contract is fine.
- **The audit's `diagnostics`**: no new `unresolvable-alias`. One there names
  an alias you left behind: fix it in the tokens file, and run this step again.
- **`decided`**: compare it too. A new entry there is a finding the change
  caused that an existing exemption hides (an exemption written for a
  custom-property name the rename made unresolved, say): report it with the
  exemption that hides it.
- **`skipped`**: nothing new. A tokens surface that stopped loading means
  the tokens file no longer parses; fix what the reason names.
- **`lint`**: a finding on a token you wrote (a name outside its vocabulary,
  `lint/tier-alias-inverted`, `lint/tier-alias-missing`) is a mistake in what
  you wrote, or a decision step 4 got wrong. Fix it in the tokens file, or
  take it back to the owner. Never change the `lint` config to clear it.

What is expected to appear, and why:

| Change      | Expected                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| add         | `tokens/token-unreferenced` for the new token (or `tokens/token-unemitted`, when the token build does not emit it yet): nothing binds it until a contract and a component do. When the new token aliases a token nothing referenced before, that token's `tokens/token-unreferenced` or `tokens/token-unemitted` disappears: an alias is a reference                                                                                                                                                                                                                                  |
| rename      | `tokens/var-unresolved` for each name in step 3's `vars`, where code still references it and nothing declares it; where a hand-written stylesheet still declares the old custom property, `tokens/token-untracked` for that name instead, and `tokens/token-unemitted` for the new path until something declares it; `tokens/token-unreferenced` for the new path until that code moves, unless another token aliases it; `coverage/stale-exemption` for an exemption naming the old id. Nothing for a contract still binding the old path: step 3's list is the only record of those |
| deprecation | nothing: the token and everything referencing it are unchanged                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| removal     | `tokens/var-unresolved` for any name in step 3's `vars` still referenced and declared nowhere; `tokens/token-untracked` instead where a hand-written stylesheet still declares it; `coverage/stale-exemption` for an exemption naming it                                                                                                                                                                                                                                                                                                                                              |

Every other finding that appeared, and every one that disappeared, is
explained in the report or is a regression. Never clear one by editing a
contract, a stylesheet, an exemption or a rule's severity: each of those is
step 7's or the owner's.

### 7. Hand on what the change left pointing at the old token

For a rename, a deprecation or a removal, step 3's list is now work for other
owners. This procedure does none of it.

- **Contracts**: each contract file, element, property and variant that binds
  the old path, and what it should bind now (the new path, the replacement a
  deprecation names, or an open question for a removal). Contract edits are
  the authoring skill's
  [Changing a contract that exists](../design-delta-author/SKILL.md#changing-a-contract-that-exists).
  Hand them over first: the code is built to match the contract.
- **Code**: each file and line from `usedBy`, with the custom-property name it
  references now and the one it should reference. Code edits are the build
  skill's
  [Updating a component whose contract changed](../design-delta-build/SKILL.md#updating-a-component-whose-contract-changed),
  run for the component whose code it is. A reference in a file that belongs
  to no component is listed for the project's own owner of that file. A
  reference in the token build's own output is left out: the build that
  step 6 ran rewrites it, and that output is never edited by hand. A
  declaration step 3 found in a hand-written stylesheet is listed here, for
  that stylesheet's owner.
- **Config**: each entry step 3 found that names the old id. It is the config
  owner's to update or remove; never edited here.
- **Design side**: when a design variable was paired with the token, that the
  pairing now needs the design file's owner, or a `design.options.tokenMap`
  entry, and that a refresh is
  [`skills/design-delta-refresh/SKILL.md`](../design-delta-refresh/SKILL.md)'s.

A rename lands safely only once every contract and every reference above has
moved. Until then the project's gate may fail on `tokens/var-unresolved`; say
so rather than hide it.

### 8. Report

- **Change**: what was added, renamed, deprecated or removed, and the file it
  is in.
- **Touched**: step 3's list, grouped as code, contracts, other tokens,
  config and design side, with where each was found. "None" per group is a
  valid entry; leaving a group out is not.
- **Decisions**: each one, and where its answer came from: the request, the
  project's convention, or the answer to a question you asked.
- **Open**: every decision still open, written as the question its owner
  answers, and what was not written because of it. "None" is a valid entry;
  leaving the section out is not.
- **Validation**: the findings and diagnostics that appeared and disappeared
  between step 2 and step 6, each with its reason from step 6's table or why
  it is not on it, and whether the token build was run.
- **Handed on**: step 7's lists, each with the skill or owner it goes to.

## What this does not cover

- **Editing a contract or a component's code.** A rename or removal lists
  them; the authoring and build skills change them.
- **The token build.** How tokens become stylesheets is the project's own
  step. This procedure runs it and never edits its output by hand.
- **The design tool.** Nothing here creates, renames or reads a design
  variable directly. A design-side consequence is reported, and the snapshot
  is refreshed by `design-delta-refresh`.
- **Deciding a token's name, tier or value.** Each is asked or reported open.
- **Cleaning up unused tokens.** A token nothing references is a finding for
  the token system's owner; removing it is a decision, made here only when it
  is asked for.

## Hard limits

- Never add a token with a name, tier or value nobody decided.
- Never rename, deprecate or remove a token before step 3's list is written
  down.
- Never edit a contract, a stylesheet, an exemption, a rule or the design
  tool to follow a token change.
- Never leave an alias inside the tokens file pointing at a path that is gone.
- Never remove a token something still references without the owner's
  decision.
- Never report a change as complete while step 3's list has entries no owner
  has been handed.

## How a consumer links this file

Claude Code does not discover skills inside `node_modules`. `design-delta
init` and `design-delta dock` each write a stub at `.claude/skills/design-delta-token/SKILL.md` that
points here, the same way they link the other packaged skills; the stub
carries no procedure of its own, so it cannot disagree with the installed
version.
