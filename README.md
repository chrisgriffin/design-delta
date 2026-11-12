# design-delta

A deterministic **design-delta engine**. A per-component **contract** is the
source of truth; the engine reports where the code and the design tool disagree
with it.

> **Status: 0.27.0 is released but not yet on npm.
> [`design-delta`](https://www.npmjs.com/package/design-delta) publishes to npm
> from the next release.**
> Architecture and phase order are tracked in
> [`docs/adr/ADR-001-modular-rewrite.md`](./docs/adr/ADR-001-modular-rewrite.md).
> The engine was developed privately through 0.26.0 and cut into this repo at
> that version, so its history starts here. An `#N` reference in the code or docs
> from before the copy points at the engine's original tracker, not this repo's.

## Install

Once the package is on npm (see the status note above):

```bash
npm install --save-dev design-delta
npx design-delta init
```

It publishes as a public, unscoped package: no registry auth.

## The model

One comparison, in two directions — never design against code directly:

- **contract ↔ code** — does the implementation match the contract?
- **contract ↔ design** — does the design tool match the contract?

If both hold, the two sides agree by transitivity. There is no direction to
guess, no reconciliation, and no tolerance vocabulary. Anything present on one
side with no contract is a **coverage** finding, which doubles as the authoring
worklist.

Contract↔code parity ships first and needs no design tool at all (D13).

## The design tool is a provider

The engine does not know what Figma is. A design tool is a **provider** behind a
small interface — `name`, `capabilities`, `sourceSchema`, `censusComponents`,
`censusTokens` — and Figma is simply the first one. Sketch, Penpot, or anything
else is a sibling module (D12). What a provider must export is documented in
[`docs/provider-contract.md`](./docs/provider-contract.md), the twin of the
framework adapter's own contract.

One provider is active at a time, chosen in config. A provider declares what it
can actually census, so a surface it cannot read **skips with a stated reason**
rather than reporting false parity.

## Usage

```bash
design-delta --help       # every subcommand, grouped by the phase that lands it

# Phase 1 — Contracts
design-delta contracts    # schema- and semantically-validate every contract

# Phase 2 — Code-side parity + CI gate
design-delta audit        # read-only census and diff across configured surfaces
design-delta verify       # composed CI gate — contracts valid + code conformance

# Phase 3 — Findings workflow
design-delta lint         # static best-practice rules over the token system
design-delta report       # export the findings as artifacts (markdown, terminal)

# Phase 4 — Config init
design-delta init         # interactive setup: detects/prompts, writes design-delta.json

# Phase 5 — Design provider layer
design-delta gather       # print the plan an agent needs to census the design side
design-delta ingest       # normalize raw gather output into design snapshots

# Phase 6 — Engine ergonomics
design-delta scaffold     # draft a contract from the props census
design-delta snapshot     # write state.json with per-entity code/spec hashes
design-delta movers       # entities changed since the last snapshot
design-delta impact       # blast-radius query for a component or token
design-delta map          # system-wide ownership overview
design-delta query        # read-only inventory questions: raw-values lists literal CSS declarations
design-delta dock         # scaffold a Claude Code hook + skill

# Phase 7 — Agent access
design-delta mcp          # read-only MCP server: contracts and tokens for a coding agent
```

`verify` is the one command a project's CI actually wires in: it needs no design
tool (contract↔code parity only, D13) and fails on either an invalid contract or
an error-severity finding from `audit` — `review`/`warn` findings are reported,
never gating. It also runs the `lint` pass internally on every non-staged
invocation to compute the run's [health score](./docs/report-structure.md#health-score),
which `--fail-below <0-100>` can gate on alongside severity; `lint` stays a
separate command for reading those findings on their own.
[`action.yml`](./action.yml) wraps it as a composite GitHub Action, with an
optional SARIF upload — see [`docs/github-action.md`](./docs/github-action.md).

`gather`/`ingest` (Phase 5.1) census the design side through a provider —
`gather` prints the plan an agent needs to run (never touching a design tool
itself), `ingest` normalizes what the agent gathered into the on-disk
snapshot `audit` reads. `movers`, `impact`, `map`, and `query` are implemented
— see [`docs/cli.md`](./docs/cli.md).

## Findings

Every finding carries the id of the rule that raised it (`tokens/var-unresolved`,
`styles/raw-value`), grouped into six surfaces — `tokens`, `components`,
`styles`, `anatomy`, `lint`, `coverage`. A rule's severity is a default a
project overrides in config, and `"off"` disables it outright.

See the [rule reference](./docs/rules.md) (generated from the registries) for
every rule, what it reports, and its default severity. For what the engine
deliberately doesn't check yet, and why, see [deferred
rules](./docs/deferred-rules.md).

## Agent skill

The package ships its canonical Claude Code skill at
[`skills/design-delta/SKILL.md`](./skills/design-delta/SKILL.md) — the
engine's own instruction set, versioned with it. Skills inside
`node_modules` are not auto-discovered, so a consumer keeps a thin stub at
`.claude/skills/design-delta/SKILL.md` that links to it; the stub carries
triggers only, so engine behavior is never restated where it can go stale.
The skill's own last section documents the stub and the migration path.

## Contracts

One component per file, `*.contract.json`, validated against
[`schema/contract.schema.json`](./schema/contract.schema.json). JSON is the only
serialization: `_`-prefixed keys are permitted at every level and carry the
reasoning a YAML `#` comment would have held, so a second format bought nothing.

```jsonc
{
  "id": "button",
  "title": "Button",
  "sources": {
    "code": { "path": "components/button/button.tsx" },
    "design": {
      "...": "opaque to the engine — the active provider validates it",
    },
  },
  "props": {
    "size": { "type": "enum", "values": ["sm", "md", "lg"], "default": "md" },
    "state": {
      "type": "enum",
      "values": ["resting", "hover"],
      "code": "none",
      "_why": "Design-only axis; code realizes it as :hover, not a prop.",
    },
  },
  "anatomy": { "root": { "type": "container", "element": "button" } },
  "styles": {
    "root": {
      "base": { "borderRadius": { "token": "system.radius.full" } },
      "variants": [
        {
          "when": { "size": "lg" },
          "padding": { "inline": { "token": "system.inset.lg" } },
        },
      ],
    },
  },
}
```

Structure lives in `anatomy`, styling in `styles`, and each answers one
question. Token references point at ids in the project's DTCG tokens file —
which **is** the token contract — never at a design tool's variable ids.

See the [contract authoring guide](./docs/contract-authoring-guide.md) for a
narrative walkthrough, built outward from real contracts, of every field
above.

## Configuration

Driven by a config validated against
[`schema/config.schema.json`](./schema/config.schema.json) (draft 2020-12, run
through ajv). Every field is optional, but the schema is **closed** — an unknown
key fails the load with an "allowed: …" message rather than being silently
ignored. See the [config reference](./docs/config-reference.md) (generated
from the schema) for every field, its type, and its default.

Every default is empty or a genuinely neutral, ecosystem-wide convention.
Nothing about any particular design system ships as a default; a project
configures what differs.

## Layout

```
src/core/       the finding model, rule engine, config, progress bus — pure
src/sources/    code-side census (the only fs/network code on the code side)
  react/        the React/TypeScript adapter — the only place naming a framework
src/spec/       contract loading and validation
src/providers/  design-tool adapters — one active per config (Phase 5)
  figma/        the Figma provider — the only place naming a design tool
src/modules/    the domain checks: pure (censuses, contracts, config) → findings
src/cli/        the single `design-delta` bin
```

The boundaries are enforced by a test, not a convention:
[`__tests__/layering.test.js`](./__tests__/layering.test.js) fails the build if a
module reaches somewhere it shouldn't — notably `modules/` may never import
`sources/`, because a check that can read the filesystem is a check you cannot
drive with fixture data.

See the [framework-adapter contract](./docs/framework-adapter-contract.md)
for exactly what `src/sources/<framework>/` must produce — the census shapes
`modules/` consumes, verified against the current React adapter. Its twin,
the [design-provider contract](./docs/provider-contract.md), does the same
for `src/providers/<name>/`, verified against the current Figma provider.

## Development

```bash
npm run verify   # `npm run checks`, then `npm test`: all of CI but the CLAUDE.md budget
```

`npm test` is native-ESM Jest. `npm run checks` is the rest of what CI runs —
formatting, ESLint, and the integrity checks listed once in `package.json` —
including `check-package.sh`, which catches what the suite structurally
cannot, since a dropped `files` entry or a renamed `bin` leaves the tests
green and breaks a consumer's install.
The one CI step neither runs is `CLAUDE.md`'s byte budget, which only CI's
`checks` job holds (`claude_md_budget` in `ci.yml`).

Every dependency is public: CI needs no registry auth, which keeps fork PRs
working.
