# Spec: a packaged skill that adds, renames, deprecates and removes a token

## Overview

The authoring and build skills both stop at a missing token: adding one is "a token task, outside this procedure", and no packaged skill picks that task up. A token change is also the change with the widest reach in a design system: a renamed or removed token breaks every contract that binds it, every stylesheet that references it and every token that aliases it, and the engine does not report a contract binding a token that no longer exists. This adds a packaged skill, `design-delta-token`, that owns a change to the project's DTCG tokens file (`paths.tokensFile`): adding a token, renaming one, and deprecating or removing one. It measures what the change touches before making it, asks rather than invents the decisions a token carries, edits only the tokens file, and hands every contract and code edit a rename or removal needs to the skill that owns it.

## User scenarios

- A build stopped because a component needs a value the project has no token for. Someone asks for the token, is asked once for the name, tier and value the request left open (each with a recommendation), and the token lands in the tokens file in the shape its siblings use.
- Someone asks to rename a token. Before anything changes they get the list of what references it: the code (from `impact`), the contracts that bind it, the tokens that alias it and the config entries that name it. The tokens file changes; every contract and stylesheet is left as it was and listed for the author and build skills.
- Someone asks to remove a token that is still referenced. The skill says what still uses it and recommends deprecating it first; a removal goes ahead only when nothing references it or the owner says so.
- Run unattended, the skill writes what is decided and marks each open decision where the owner will find it, rather than picking a name or a value.
- A project set up with `init` or `dock` finds the skill through a stub, as it finds the others.

## Functional requirements

- FR-001: A packaged skill `skills/design-delta-token/SKILL.md`, in the structure, tone and project-neutral stance of the other packaged skills. It names no framework, styling system or design tool; it reads the token layout, tiers and naming from the project.
- FR-002: It covers three changes: add a token, rename a token, and deprecate or remove a token.
- FR-003: Before a rename, deprecation or removal it lists the blast radius: code references from `design-delta impact <token> --json`, contracts that bind the token, tokens that alias it, and config entries that name it. Where `impact` does not cover one of these, the skill says so and says how to find it.
- FR-004: A token's name, tier and value are decisions. The skill settles each from the request or the project's conventions, asks every open one in one message with a recommendation, and, when nobody can answer, writes nothing it would have to guess and reports each open decision.
- FR-005: It edits only the tokens file. It never edits a contract or a stylesheet to follow a rename or a removal: contract edits go to the authoring skill's "Changing a contract that exists", code edits to the build skill's update procedure, each listed with what has to change.
- FR-006: It validates with `contracts`, `lint` and `audit`, comparing before and after, and reports every finding the change added or cleared.
- FR-007: The authoring and build skills' "token task" lines point to it, and the router skill names it beside its siblings.
- FR-008: `dock` and `init` each write a stub for it, guarded like the others.

## Success criteria

- [ ] `skills/design-delta-token/SKILL.md` ships in the package and covers adding, renaming, and deprecating or removing a token, listing what a rename or removal touches before making it.
- [ ] The skill asks for every open name, tier and value decision together, and edits no contract or stylesheet: it hands contract edits to the authoring skill and code edits to the build skill.
- [ ] The authoring and build skills point a missing token to the new skill, and the router skill names it.
- [ ] `design-delta dock` and `design-delta init` each write a guarded stub at `.claude/skills/design-delta-token/SKILL.md`.
- [ ] **Runnable:** `test -f skills/design-delta-token/SKILL.md && npm run verify` exits 0 (exits 1 on `develop`, where the skill does not exist).

## Out of scope

- A `design-delta` subcommand that edits tokens: the audit path stays read-only.
- Extending `impact` to report contract bindings or aliases: the skill finds those by search and says so.
- Editing the design tool's variables, or the project's emitted token stylesheet by hand (that is the project's token build).
- A stub for the doctor skill: unchanged.
