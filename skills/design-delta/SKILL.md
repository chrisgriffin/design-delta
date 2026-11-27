---
name: design-delta
description: Anything design-delta in a project — run or interpret an audit of its code and its design tool against the per-component *.contract.json contracts, write or change a contract, build a component to its contract, write a component's documentation page, add, rename, deprecate or remove a design token, refresh the design snapshot, or work a list of findings down. Use for any design-delta, design-system, contract or design-token request, or when a component or token looks out of sync with its contract — this skill routes to the packaged procedure for the task.
---

# design-delta — the engine's own instruction set

This file ships inside `design-delta` and describes **exactly
the version installed** in this project. It is the canonical replacement for
hand-maintained prose about engine behavior in a consumer repo: engine facts
live here (and in the [package docs](../../docs/) it links), project facts
live in the project's own `design-delta.json`.

**Read alongside this, always:** the project's `design-delta.json` at its
repo root — especially its `_`-prefixed keys (`_knownFindings`, `_doc`, …),
which are documentary comments the schema deliberately permits at every
level. That is where a consumer records its severity decisions, known-open
findings, and local caveats. This file never describes any one project.

## Route the task first

This skill is where every design-delta request lands. If the task is not
running or interpreting an audit, read the procedure skill for it, beside
this file in the installed package, and follow that instead:

| The task                                          | Read and follow                                                            |
| ------------------------------------------------- | -------------------------------------------------------------------------- |
| Write, draft, finish or change a contract         | [`skills/design-delta-author/SKILL.md`](../design-delta-author/SKILL.md)   |
| Build a component, or update one to its contract  | [`skills/design-delta-build/SKILL.md`](../design-delta-build/SKILL.md)     |
| Refresh or re-gather the design snapshot          | [`skills/design-delta-refresh/SKILL.md`](../design-delta-refresh/SKILL.md) |
| Work a long list of findings down                 | [`skills/design-delta-resolve/SKILL.md`](../design-delta-resolve/SKILL.md) |
| Write or refresh a component's documentation page | [`skills/design-delta-docs/SKILL.md`](../design-delta-docs/SKILL.md)       |
| Add, rename, deprecate or remove a token          | [`skills/design-delta-token/SKILL.md`](../design-delta-token/SKILL.md)     |

A project's `.claude/skills/` may not have a stub for every row: a skill
added in a release is reached through this table until the project re-runs
`design-delta dock`.

## The model

A per-component **contract** (`*.contract.json`) is the single fixed point.
Every check compares one side against the contract, never side against side:

- **contract ↔ code** — does the implementation match?
- **contract ↔ design** — does the design tool match? (Only when the config
  sets `design.provider`; otherwise the design side skips with a stated
  reason.)

Anything present on one side with no contract is a **coverage** finding — an
inventory fact, not an error. The engine is deterministic and, on the audit
path, read-only: it never edits code or the design tool, and it files no
issues. Full contract authoring reference:
[contract-authoring-guide.md](../../docs/contract-authoring-guide.md).

## Commands

Full reference with every flag and exit code: [cli.md](../../docs/cli.md).
The short map:

| Command                                               | What it does                                                                                                          |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `contracts`                                           | schema- + semantically-validate every contract                                                                        |
| `audit`                                               | read-only census + diff across the configured surfaces; `--contract <id>` scopes the report to one component          |
| `verify`                                              | the composed CI gate — invalid contract or gating finding fails it                                                    |
| `lint`                                                | static token-system rules (separate from `verify`, never run by it)                                                   |
| `report`                                              | render findings to artifacts (`md,terminal,sarif,pr-comment`)                                                         |
| `init` / `dock`                                       | scaffold config / a Claude Code hook + skills into the consumer                                                       |
| `gather` / `ingest`                                   | design-side census: `gather` prints a plan, `ingest` normalizes results                                               |
| `scaffold` / `snapshot` / `movers` / `impact` / `map` | draft contracts; write the `isNew` baseline; diff since it; blast radius; ownership overview — **all code-side only** |
| `mcp`                                                 | read-only MCP server over stdio: contracts + tokens for a coding agent, every answer version-stamped                  |

Every command reads `design-delta.json` at the project root by default
(`--config <path>` overrides); `--json` on any command emits one
machine-readable document on stdout. Config field reference (generated from
the schema): [config-reference.md](../../docs/config-reference.md).

## What gates and what doesn't

Three severities — `error`, `warn`, `review` — documented with every rule in
the generated [rules.md](../../docs/rules.md); what the engine deliberately
does not check is in [deferred-rules.md](../../docs/deferred-rules.md).
The load-bearing facts:

- **By default only `error`-severity findings gate** `verify` and
  `audit --check`. `warn`/`review` are reported; `verify --fail-on` can
  lower the threshold so they gate too. `lint` reports and never gates.
- A project can override any rule's severity (`rules` in config) or waive a
  specific entity (`exemptions`) — check the project's config before
  reasoning about why a finding does or doesn't fail a run.
- `review` findings are real work, not noise: the engine could not reach a
  verdict, and the call is a human's to make.
- Report/finding shape (ids, `side`, `isNew`, counts):
  [report-structure.md](../../docs/report-structure.md).

## The design side is snapshot-based, never live

The engine has no agent inside it and never calls a design tool:

1. `gather` **computes and prints a plan** (which tool calls, which
   arguments, which output paths) — an agent session with the relevant MCP
   tools executes that plan and saves each raw response.
2. `ingest` normalizes those raw files into the snapshot files under the
   config's `snapshotDir`.
3. `audit`/`verify`/`report` **only ever read that committed snapshot.** A
   stale snapshot reads as current — before trusting a design-side result,
   check when the snapshot files last changed (`git log` on them), not when
   the audit ran.

The procedure for bringing that snapshot up to date, step by step and with
what to do when a session lacks the design tool's tools, is the sibling skill
[`skills/design-delta-refresh/SKILL.md`](../design-delta-refresh/SKILL.md).

`snapshot`/`movers`/`impact`/`map` are a separate, **code-side-only**
mechanism (`state.json`, documented in
[state-shape.md](../../docs/state-shape.md)) — don't mistake them for the
design-side read above.

## Validating a finding before acting on it

"The engine reported it" starts the analysis, it doesn't end it:

- Reproduce against the exact installed version before calling something an
  engine bug — a script failure is just as likely the consumer calling a
  removed API.
- A workaround comment citing an upstream issue isn't proof the issue is
  still open — after a version bump, re-add the thing the workaround avoids,
  re-run, and confirm the finding actually clears before dropping it.
- Never `.skip`/blanket-disable a rule to make `review` findings disappear;
  they each need a human read.

## How a consumer links this file

Claude Code does not discover skills inside `node_modules`, so a consumer
keeps a thin, discovered stub at `.claude/skills/design-delta/SKILL.md`:
trigger phrases in its frontmatter, and a body that says to read **this
file** (`node_modules/design-delta/skills/design-delta/SKILL.md`)
first, then the project's `design-delta.json` `_`-prefixed keys for local
decisions. The stub carries no engine prose, so the only part of it that
can go stale is the description it copies from this file; this file
versions with the engine, so it can't disagree with the installed CLI. A
version bump is the whole update: every stub's procedure comes from the
installed package, and `design-delta dock --check` exits 1 when a stub is
missing or its copied description is out of date.

**Writing a contract** and **building from one** are sibling skills.
[`skills/design-delta-author/SKILL.md`](../design-delta-author/SKILL.md)
takes a request to a validated contract, asking rather than inventing where
the request leaves the component's API open.
[`skills/design-delta-build/SKILL.md`](../design-delta-build/SKILL.md) takes
that contract to code and then uses the audit above as the proof.
[`skills/design-delta-refresh/SKILL.md`](../design-delta-refresh/SKILL.md)
refreshes the design snapshot, and
[`skills/design-delta-resolve/SKILL.md`](../design-delta-resolve/SKILL.md)
works a project's whole list of findings down, sorting each by who can clear
it.
[`skills/design-delta-docs/SKILL.md`](../design-delta-docs/SKILL.md) writes a
component's documentation page from its contract, in the project's own
documentation format, and rewrites only its generated sections when the
contract changes.
[`skills/design-delta-token/SKILL.md`](../design-delta-token/SKILL.md) adds,
renames, deprecates or removes a token in the project's tokens file, listing
first every contract, stylesheet and token that references it and handing
their edits to the authoring and build skills.
[`skills/design-delta-adopt/SKILL.md`](../design-delta-adopt/SKILL.md) takes
a project that has never used the engine to a confirmed config, its most-used
components contracted through the authoring skill, a `snapshot` baseline and
a CI gate at the strictest level it already passes, and hands what is left to
the resolve skill. `init` and `dock` each write a stub for each under
`.claude/skills/`, in a directory of the skill's own name, the same way.

Migrating an existing hand-written skill: delete every statement about
engine behavior (commands, flags, rules, severities, snapshot semantics) in
favor of the link, and move any project-specific facts worth keeping into
`design-delta.json`'s `_`-prefixed keys.
