# Claude Instructions — design-delta

The rulebook for working in this repo. Every rule here is load-bearing.
How the repo works, for a person: [`docs/architecture.md`](./docs/architecture.md).

`design-delta` is a **deterministic, config-driven design-delta
engine**: a per-component **contract** is the source of truth, and the engine
reports where the code and the design tool disagree with it.

[`docs/adr/ADR-001-modular-rewrite.md`](./docs/adr/ADR-001-modular-rewrite.md)
is the authority on the architecture and the phase order.

Three rules the ADR makes non-negotiable, because each was violated in the old
engine and cost real rework:

- **Nothing consumer-specific, anywhere.** Not in defaults, not in tests, not in
  comments. If a change only makes sense for one project, it belongs in that
  project's `design-delta.json`.
- **Nothing vendor-specific outside its provider.** A design tool is a provider
  (D12); `src/providers/<name>/` is the only place that may name one.
- **Nothing framework-specific outside its adapter.** A UI framework is an
  adapter (D16); `src/sources/<framework>/` is the only place that may name
  one. `core/` and `modules/` compare normalized censuses and must not say
  "JSX"/"React" — in identifiers _or_ in finding messages, which consumers read
  in reports. Enforced by `__tests__/layering.test.js`.

## Stack & layout

- **Node ESM** (`.mjs`, `"type": "module"`), five runtime deps
  (`@terrazzo/parser`, `@terrazzo/token-tools`, `@clack/prompts`, `ajv`,
  `ajv-formats`; `typescript` is an optional peer); the engine is deterministic
  and (for the audit path) read-only.
- `src/` is layered per ADR-001 D4 — see § Architecture for the layers and
  their direction of flow; `__tests__/layering.test.js` enforces it, not
  convention. `sources/<framework>/` holds each framework adapter (`react/`
  today); the single `design-delta` bin lives in `cli/`.
- `schema/` holds JSON Schemas for the config and snapshots; `docs/` is the
  generic engine reference, indexed in `docs/architecture.md`.
- **Two docs are generated, never hand-edited**: `docs/config-reference.md`
  (from `schema/config.schema.json`) and `docs/rules.md` (from the rule
  registries). Add a rule, or reword its `description`, and re-run
  `node scripts/generate-rules-reference.mjs` — the `checks` CI job fails on a
  stale copy.

## Architecture

Five layers, one direction of flow: `src/sources/` turns a framework's code
into a normalized census; `src/spec/` turns a project's contracts into the
same shape; `src/modules/` compares the two through `src/core/`'s pure
findings/rules/config; `src/providers/` bring in a design tool's own census
the same way; `src/cli/` is the one place any of this is invoked from.
`schema/` and `docs/` are reference alongside the flow, not a layer in it.

The couplings no test or CI can catch — touch the left, do the right in the
same change:

| If you touch                                                                                                                                                                  | Then                                                                                                                                                                                                                                                |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| a job id in `.github/workflows/ci.yml`                                                                                                                                        | the live branch ruleset's required check names (`gh api repos/chrisgriffin/design-delta/rulesets`) — `__tests__/ci-workflow.test.js` only pins the record in `scripts/ci/required-checks.mjs`; `node scripts/ci/check-ruleset.mjs` compares it live |
| the registry URL in `package.json`'s `publishConfig`, `.github/workflows/create-github-release.yml`'s `npm_registry_url`, or `.github/workflows/publish.yml`'s `registry-url` | the other two — `__tests__/registry-url.test.js` compares all three to each other and fails naming the file that disagrees (#506); moving all three together stays green                                                                            |
| `action.yml`'s `inputs:`                                                                                                                                                      | `docs/github-action.md`'s Inputs table — `__tests__/docs-parity.test.js` compares the two as sets and per-default, and fails naming the side that disagrees (#519); an empty `default:` and the table's `_(unset)_` read as the same thing          |
| `src/core/state.mjs` or `schema/state.schema.json`                                                                                                                            | `docs/state-shape.md` — `__tests__/docs-parity.test.js` compares its code blocks against the schema's properties and `required`, in both directions, and fails naming the field that disagrees (#520)                                               |

## Coding standards

- **TypeScript-free ESM**; 2-space indent. **Prettier owns formatting**
  (`arrowParens: "avoid"`, `semi: false`) — run `npx prettier --write` before commit.
- **Deterministic + honest output.** The audit path never edits Figma or tokens
  and never files/triages issues — it emits a report. Don't add side effects to it.
- New behavior ships with a test in `__tests__/` and, if it changes the config
  surface, a `schema/` update.

## Testing

Jest (`NODE_OPTIONS=--experimental-vm-modules jest`): **`npm test`**. Tests are the
gate — keep them green; never `.skip(`/`.only(` to get past a failure.

## CI

`.github/workflows/ci.yml` runs on every PR into `develop`/`main`; every job is
a thin stub calling a reusable workflow in the public `chrisgriffin/workflows` repo. Run these locally
before opening a PR rather than discovering a red check:

- `test_22` — `npm test` on Node 22 (`test_24` and `test_26` run it again on a
  push to `main` only)
- `checks` — `npx prettier --check .`, `bash scripts/ci/check-action.sh`,
  `bash scripts/ci/check-package.sh`, `node scripts/ci/check-schemas.mjs`, plus
  `generate-config-reference.mjs` and `generate-rules-reference.mjs` under
  `scripts/`, both with `--check`

- `check-package.sh` catches what `npm test` structurally cannot: this is a
  published library, so a dropped `files` entry or a renamed `bin` leaves the
  suite green and breaks consumers on their next `npm ci`.
- `.prettierignore` carves out only what `docs/testing.md` lists — never a
  source file.
- **A ruleset edit lands _before_ the workflow change that renames or gates a
  check**, or every PR blocks forever on a check that can no longer report.
  `__tests__/ci-workflow.test.js` locks the job-id-to-check mapping.
- **CI must need no registry auth.** Every dependency is public, which is what
  keeps a fork PR working. Never add one that needs a token to install.

Job layout, the billed-minute reasoning behind it, and the history of the
required-check names: [`docs/ci.md`](docs/ci.md).

## Git & release

Git workflow rules are the fleet's: `.agents/build.md` and
`.agents/_conventions.md`.

- **Releases are automated — never hand-bump `version`.** Push to `develop`
  keeps a rolling `release/next` PR up to date; merging it into `main` cuts the
  release and publishes to npm. The workflow-by-workflow mechanism,
  including why two steps need a real human click, is in
  [`docs/releasing.md`](docs/releasing.md).
- **Never write a `BREAKING CHANGE:` footer or a `feat!:`/`fix!:` subject**
  (decided 2026-08-03). This package stays `0.x` until it is stable, `0.x`
  promises no compatibility anyway, and 1.0.0 is the maintainer's call, never a
  marker's. A genuinely breaking change still ships — describe it in the
  commit body and the PR, without the marker. How the bump is computed:
  [`docs/releasing.md`](docs/releasing.md).

## Agent harness

**This repo carries no harness**: a plain buildable project that receives PRs
from a bot. The build loop that runs it lays its role protocols over a
checkout at runtime. **Never commit `.agents/`.**

**Standing constraint: the six workflow stubs (`ci`, `claude-mention`,
`create-github-release`, `evaluator-gate`, `release-pr`,
`sync-main-to-develop`) `uses:` the public
[`chrisgriffin/workflows`](https://github.com/chrisgriffin/workflows) repo
and nothing else.** A public repo's `uses:` of a private repo's workflow
fails before starting, zero jobs scheduled, no check to notice;
`__tests__/ci-workflow.test.js` pins it. Each stub passes its secrets by
name, never `secrets: inherit`.

(`design-delta.json` throughout `src/` and `docs/` is _this tool's own_
config file in the projects it audits — nothing to do with a harness.)
