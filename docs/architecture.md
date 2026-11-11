# Architecture

How this repo works, written for a person rather than a parser. It is living
documentation: it describes the repo as it is on `develop` today, and a change
that adds, removes or renames a directory, or changes what a part does,
updates this file in the same PR.

## What it is

design-delta is a command-line tool that finds **drift**: the gap that opens up
between what a design system says a component should be, what the code actually
implements, and what the design tool actually shows. It is published as the npm
package `design-delta` and used by projects that own a design
system, either by hand or as a CI gate.

The thing it compares against is a **contract** — one JSON file per component,
checked into the project, stating the component's props, its element structure
and its styling in terms of design tokens. The contract is the source of truth.
The engine never compares code against the design tool directly; it compares
each of them against the contract, in two independent directions, so there is
never a question of which side is right.

## How it works

A run starts with a project's `design-delta.json` config and its contracts, and
ends with a list of **findings**. A finding is one small, uniform record — which
rule raised it, how serious it is, which surface it belongs to, which entity it
is about, and a message. Everything the tool prints is a rendering of that one
shape.

The work happens in five layers inside `src/`, and they only ever flow one way:

- `src/core/` — the pure centre. The finding shape, the rule registry and
  severity resolution, config loading and validation, the health score, state,
  progress reporting and terminal rendering. Pure is about the import graph — it
  imports nothing from the other layers — not the filesystem: it reads the
  project's config and `state.json`, and the engine's own schemas and
  `package.json`.
- `src/spec/` — the contract layer. Loads each `*.contract.json`, validates it
  against `schema/contract.schema.json`, applies the semantic checks a schema
  cannot express (styling that names an element the anatomy never declared, for
  instance), and hands the checkers one reduced view.
- `src/sources/` — the code side. It turns a codebase into a normalized
  **census**: a plain, sorted list of what is there. `src/sources/react/` is the
  framework **adapter** — the module that knows one UI framework's syntax and
  translates it into the neutral census shape. React is the only adapter today,
  and it is the only place in the repo allowed to say "React" or "JSX".
- `src/providers/` — the design side, by the same trick. A design tool is a
  **provider**: a module behind a five-member interface that censuses that
  tool's components and tokens. `src/providers/figma/` is the only one, and
  the only place allowed to name Figma. Exactly one provider is active per run,
  chosen in config, and a provider declares which surfaces it can actually read
  so an unreadable one is skipped with a stated reason rather than reported as
  agreement.
- `src/modules/` — the checkers themselves: `tokens`, `components`, `styles`,
  `anatomy` and `lint`. Each is a pure function that takes two already-loaded
  censuses and returns findings. It may not reach the filesystem, which is what
  lets every one of them be driven by fixture data in a test.

`src/cli/` is the one place any of that is invoked from. It holds the single
`design-delta` executable, one file per subcommand under `src/cli/commands/`,
and the read-only MCP server that exposes contracts and findings to a coding
agent.

The common path is `audit`: load the config and the contracts, census the code
side, census the design side from whatever the provider layer has on disk, run
the checkers, resolve each finding's severity against the project's config, and
print the result. `verify` is `audit` composed into a CI gate — it also runs the
`lint` pass to compute the run's health score, and it exits non-zero on an
invalid contract, on a finding at or above `--fail-on`'s threshold (`error` by
default), or on a score below `--fail-below` when that is given. `report` writes
the same findings out as markdown, SARIF or a PR comment.

The design side takes an extra step, because the engine has no agent inside it
and never calls a design tool. `gather` prints a plan — which tool to call, for
which targets, where to put each raw response — an agent carries it out, and
`ingest` normalizes the results into the snapshots `audit` reads as plain data.

The rest of the top level supports that core:

- `schema/` — the JSON Schemas for the config, contracts, design snapshots and
  the state file. The config schema is closed: an unknown key fails the load
  with a message rather than being silently ignored.
- `docs/` — this reference, including `docs/adr/` for the repo's decision
  records and `docs/spikes/` for the investigations behind them. Two files here
  are generated and never hand-edited: `docs/config-reference.md` and
  `docs/rules.md`.
- `scripts/` — the two generators for those files, plus `scripts/ci/`, the
  guards CI runs over the published package, `action.yml` and the schemas, and
  `check-ruleset.mjs`, run by hand, which compares the required-check record
  against the live branch rulesets ([`docs/ci.md`](ci.md)).
- `skills/` — the tool's own Claude Code instructions, versioned with the engine
  and shipped in the package so a consuming agent reads the behaviour the
  installed version actually has.
- `__tests__/` — the Jest suite, with its fixtures and helpers. It carries the
  layering test that fails the build when a module imports across a boundary it
  shouldn't, which keeps the layers above a fact rather than a habit.
- `specs/` — the Spec Kit spec folder for each piece of work, written before
  the code.
- `.github/` — the workflows.

At the repo root, `action.yml` wraps `verify` as a composite GitHub Action, and
`package.json` declares what ships: `src`, `schema`, `docs` and `skills`, with
one `design-delta` bin.

## How it connects

**Outward.** The engine publishes to the public npm registry as
`design-delta`, so a consuming project installs it like any dependency and wires `verify` into its own CI —
either directly or through this repo's composite Action, pinned to an exact
`vX.Y.Z` tag. Nothing about any particular design system is baked in; a consumer
supplies its contracts, its tokens file and its `design-delta.json`. New rules
are adjudicated against a real codebase, a real consumer codebase,
before they ship, because a fixture written to match its own assumption proves
nothing.

**Inward.** Runtime dependencies are few and all public: `@terrazzo/parser` and
`@terrazzo/token-tools` for reading a DTCG tokens file, `ajv` and `ajv-formats`
for schema validation, `@clack/prompts` for the `init` wizard. `typescript` is
an optional peer, loaded lazily for the code-side prop census. Every dependency
being public is what lets CI run with no registry auth.

**The build loop.** Six of the seven workflows in `.github/workflows/` are thin
stubs that call a reusable workflow in the public
[chrisgriffin/workflows](https://github.com/chrisgriffin/workflows) repo,
pinned at its `v1` tag. The seventh, `publish.yml`, runs its own steps: it is
the manual fallback that publishes the package by hand when
`create-github-release.yml`'s own publish step failed. This repo carries no
agent harness of its own and never commits `.agents/`: the build loop that
runs it lays its role protocols over a checkout at run time. The flow is one
way — that loop drives this repo, this repo drives its consumers, and nothing
here reaches back into either.

## Running it

```bash
npm ci                    # Node 22 or newer
npm run verify            # the whole gate: `npm run checks`, then `npm test`
```

`npm run checks` is the `checks` job's chain — formatting, ESLint and the
integrity checks, listed once in `package.json`, with no build, browser or
token needed. `npm test` is the whole Jest suite.

Run the CLI from the checkout with `node src/cli/main.mjs <subcommand>`, or
`--help` for the full list. Releases are automated from Conventional Commits —
never hand-bump `version`.

## Where to look next

- [`README.md`](../README.md) — the model, the subcommand tour and the contract
  shape; [`CLAUDE.md`](../CLAUDE.md) is the rulebook for working in this repo.
- [`docs/cli.md`](./cli.md) — every subcommand, flag and output in detail.
- [`docs/rules.md`](./rules.md) and [`docs/deferred-rules.md`](./deferred-rules.md)
  — what the engine checks, and what it deliberately does not.
- [`docs/report-structure.md`](./report-structure.md) and
  [`docs/state-shape.md`](./state-shape.md) — the finding shape, the severities,
  surfaces and health score, and the `state.json` a `snapshot` writes.
- [`docs/contract-authoring-guide.md`](./contract-authoring-guide.md) and
  [`docs/config-reference.md`](./config-reference.md) — authoring both inputs.
- [`docs/framework-adapter-contract.md`](./framework-adapter-contract.md) and
  [`docs/provider-contract.md`](./provider-contract.md) — what a new adapter or
  provider must produce.
- [`docs/github-action.md`](./github-action.md), [`docs/ci.md`](./ci.md),
  [`docs/testing.md`](./testing.md) and [`docs/releasing.md`](./releasing.md) —
  the Action, the CI job layout, the suite and the release flow.
- [`docs/adr/`](./adr/README.md) — the decision records that explain why it is
  built this way; ADR-001 is the authority on the layering and the phase order.
