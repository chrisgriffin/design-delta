# Testing

The suite proves the engine is deterministic and honest: the same inputs give
the same findings, every layer stays inside its boundary, and a doc that
mirrors code says what the code says.

## The gate

- CI runs this repo's gate on every PR; the commands are the `run:` steps of
  its CI workflow in `.github/workflows/`.
- A PR merges only when that gate is green.
- Run the same commands locally before pushing. A failing test is fixed in
  the code, never by weakening the assertion.
- A behavior change starts with a test that fails without it.

## Running tests

- `npm run verify` — the whole local gate, one command: `npm run checks`,
  then `npm test`. Run it before pushing.
- `npm run checks` — the fast checks chain. Its steps are listed once, in
  `package.json`'s `checks` script, run cheapest-first so the first failure
  stops it; CI's `checks` job runs this script and nothing else, so a step
  added there is a step CI runs.
- `npm test` — the whole Jest suite. The script sets
  `NODE_OPTIONS=--experimental-vm-modules`, which is what lets Jest's VM load
  this native-ESM source with no transform step, so run the script and never
  bare `jest`. CI runs it as the `test_22` job on Node 22, and again on Node
  24 and 26 on a push to `main`.

What each step of the chain checks:

- Prettier — formatting. `.prettierignore` carves out only generated files,
  `package.json`/`package-lock.json`, build/scratch output (`coverage/`,
  `tmp-*/`), and the laid `.agents/` and `.specify/` trees.
- `npm run lint` — ESLint, from the shared `@chrisgriffin/config` base plus
  the overrides in `eslint.config.mjs`, each with its reason.
- `check-action.sh` — `action.yml` is a valid composite action.
- `check-package.sh` — the published surface: `files`, `bin`, `exports` and
  the `npm pack` contents.
- `check-schemas.mjs` — every JSON Schema under `schema/` compiles.
- The two reference generators with `--check` — the generated docs match
  their sources; re-run either without `--check` to regenerate.

Nothing needs a build, a browser or a registry token first.

## What is tested

- **Unit, per layer** — `__tests__/core-*`, `modules-*`, `sources-*`,
  `spec-*` and `providers-*` cover one `src/` layer each with injected data,
  which is what the layering in ADR-001 D4 exists to make possible.
- **Subcommands** — `__tests__/cli-*` run each `design-delta` subcommand
  in-process and assert its findings, its exit code and its `--json` payload.
- **Boundaries** — `__tests__/layering.test.js` enforces the import graph
  plus the vendor (D12) and framework (D16) vocabulary guards, each with a
  negative control so a guard that matches nothing fails.
- **Docs against code** — `__tests__/docs-parity.test.js`,
  `cli-subcommand-docs.test.js`, `rules-reference.test.js` and
  `coupled-files.test.js` compare a doc's tables and paths against the schema,
  registry, `action.yml` or CLAUDE.md section they mirror.
- **Consumer-read strings** — `__tests__/adr-citations.test.js` holds every
  ADR a rule description or a drafted `_scaffold` note cites to the form
  `design-delta's ADR-NNN`, since both are read in a consumer's own repo:
  the notes a scaffold run drafts, and every string and template literal in
  `src/spec/scaffold.mjs`, so a note no fixture reaches is held too.
  Its scan lives once in `helpers/adr-citations.mjs`; `helpers/rule-arrays.mjs`
  finds every exported rule registry by shape, shared with
  `rules-reference.test.js` and `cli-rule-registry.test.js`.
- **Repo invariants** — `__tests__/ci-workflow.test.js`,
  `workflow-stubs.test.js`, `workflow-timeouts.test.js` and
  `registry-url.test.js` pin the job-to-check mapping, the reusable-workflow
  stubs, every `timeout-minutes`, and the three places the registry URL is
  written.
- **End to end** — `__tests__/synthetic-project.test.js` materializes a whole
  synthetic project on disk and runs config resolution against it.

What the suite cannot reach: no test calls a design tool or the network — the
provider tests read recorded raw envelopes — and no test runs against a real
consumer's design system. That half is adjudication by a person against
a consumer project, per ADR-001's working method, and a green suite has
repeatedly not been sufficient on its own.

## Adding a test

- A new suite is `__tests__/<area>-<subject>.test.js`, matching the area
  prefixes above, and Jest picks it up from `**/__tests__/**/*.test.js`.
- Fixtures go under `__tests__/fixtures/` and helpers under
  `__tests__/helpers/`; both are imported, never collected as suites
  (`jest.config.mjs`'s `testPathIgnorePatterns`). Reuse
  `helpers/synthetic-project.mjs` for anything that needs a project on disk.
- A false finding becomes a fixture test before its fix, so the class cannot
  come back.
- Never `.skip(` or `.only(` to get past a failure.
