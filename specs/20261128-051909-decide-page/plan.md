# Plan: `design-delta decide`

Spec: [spec.md](./spec.md).

## Technical context

- Node ESM, no new runtime dependency. The server is `node:http`, the id
  hash `node:crypto`, the page plain HTML with inline CSS and JS.
- Layering (ADR-001 D4, `__tests__/layering.test.js`): the pure parts
  (piles, grouping, recommendations, page render, answer application to a
  config object) live in `src/core/`. The command (clock, filesystem,
  server) lives in `src/cli/commands/decide.mjs`. Nothing names a vendor or
  framework.
- The command gets its findings exactly as `report` does: it calls
  `runAudit(["--json"])` and `runLint(["--json"])` into a `sink()` and
  parses the payloads. No second assembly of the checks.

## Design

### `src/core/piles.mjs`: the resolve skill's table, as code

`pileOf(finding)` returns `code | contract | design | tokens-config |
review`, by the rules of the resolve skill's step 3 table, in its stated
precedence: a row naming the rule wins over a row that only catches the
side. The two conditional rules resolve to the cautious pile: since the
engine cannot tell whether `coverage/contract-only`'s path or its build is
wrong, it is `contract` (the resolve skill may still reclassify it to code
after reading the project). An unnamed rule follows the default: `spec`
goes to `contract`, `design` to `design`, a `review` severity to `review`,
a `code`-side `error`/`warn` on `components`, `styles` or `anatomy` to
`code` (the table's Code row), and anything else to `review`. A code-side
finding on a component whose contract failed validation goes to `contract`;
`decide` passes the invalid set in. The lint rules that read a contract or
the design file are named: `contract` and `design`.

Exports the table itself (`PILE_RULES`) so the skill, docs and tests read
one copy.

### `src/core/recommendations.mjs`: the per-rule table

`RECOMMENDATIONS[ruleId] = { options: [...], recommended, reason }`, one
entry for every rule in the registries (`src/cli/rule-registry.mjs`
already gathers them). The options are the subset of
`fix-code | change-contract | change-design | accept | waive | track`
that can clear the rule. Defaults by pile fill in what a rule entry does not
override, so the table stays short: for example `contract` → recommend
`change-contract`; `design` → `change-design`; `tokens-config` → `accept`
for `token-unreferenced`/`token-unemitted` (a scale kept complete),
`remove-exemption` as `coverage/stale-exemption`'s only option (an
exemption under that rule could never take effect); `review` → `accept`. Every reason
is one plain sentence.

Test (`__tests__/core-recommendations.test.js`): every registered rule
resolves to an entry; every `recommended` is in its `options`; no entry
names a rule the registry lacks.

### `src/core/decisions.mjs`: grouping, ids, answers

- `buildDecisions({ findings, decided, previous })` → `{ decisions,
codeCount, done }`. It groups non-code findings by `ruleId` + pile and
  sorts by severity, then rule. `id` = first 12 hex characters of the sha256
  of `ruleId|pile|sorted entities`. `previous` is the decisions file:
  entries whose findings still exist mark their decision `answered`, and
  entries whose findings are all gone come back in `done`.
- `applyAnswers({ config, decisionsFile, decisions, answers })` → `{ config,
decisionsFile, written }`, pure. It validates every answer against its
  decision (known id, offered option, selected entities ⊆ decision's,
  `track` has `issue`, `accept`/`waive` have `reason`) and throws a list of
  errors before changing anything. Exemption answers append
  `{entity, decision, reason, issue?}` under `exemptions[ruleId]`, leaving
  existing keys in order and `_` keys untouched, and skipping an entity
  already listed. Action answers replace any earlier entry for the same
  decision id.

### `src/core/decisions-page.mjs`: the page

`renderDecisionsPage({ decisions, codeCount, done, snapshotAge, mode,
token })` returns one HTML string. It uses inline `<style>` with
`prefers-color-scheme`, plus `<fieldset>`/`<legend>` radio groups per
decision, entity checkboxes, and reason and issue fields. The recommended
radio is `checked` and labeled "Recommended" with its reason; a decision
already answered with a change opens on "Decide later" instead, listing
every answer on file, so a save for another decision never rewrites it. A small inline
script handles saving: in `serve` mode it `fetch("/answers", POST)`s with
the token header; in `static` mode it builds the answers JSON and offers it
as a download (`Blob` + `a[download]`), with a copy button as a fallback.
It needs no network request beyond the same-origin post. The data is
embedded as a JSON `<script type="application/json">` block, escaped so
`</script>` in a message cannot break out. Deterministic for the same
input.

### `src/cli/commands/decide.mjs`

Flags: `--json`, `--no-serve`, `--port <n>`, `--out <path>`,
`--apply <file>`, `--no-timestamp`.

1. Resolve config, run audit + lint into sinks, read the decisions file if
   present, `buildDecisions`.
2. `--json`: print and exit 0. Write nothing.
3. `--apply`: read and validate the answers file (`schema/decide-answers.schema.json`),
   then `applyAnswers`, validate the new config with `validateConfig`, and
   write the config and decisions file. Exit 1 with every error and write
   nothing on any failure.
4. `--no-serve`: write `decisions.html` to `reportDir` (or `--out`), print
   the path, exit 0.
5. Default: create a token (`randomBytes`) and an `http` server on
   `127.0.0.1`. `GET /` serves the page and `POST /answers` checks the
   `x-design-delta-token` header and `content-type: application/json`, then
   applies the answers as in step 3, replies with the result, and closes
   the server. Any other request gets a 404. The command prints the address,
   resolves when the server closes, and returns 0. SIGINT closes it and
   returns 130 with nothing written. `ctx.serve` is injectable, so tests
   drive the handler without a socket. One test does bind a real socket to
   check the host.
6. Prune: on every run but `--json`, when any `done` entries exist, the
   decisions file drops them, and the command lists them on stderr. An
   entry is `done` only when its rule ran (`audit --json`'s and
   `lint --json`'s `evaluatedRules`, plus a read design snapshot for a
   design-pile rule). A save re-reads the config and the decisions file and
   refuses when either changed on disk since the run started.

Register in `SUBCOMMANDS` (summary "answer the findings code cannot clear:
a local page, recommended answers, written back").

### Schemas

- `schema/config.schema.json`: `paths.decisionsFile`. Default
  `.agents/design-delta/decisions.json` in `DEFAULT_PATHS`.
- `schema/decisions.schema.json`: the decisions file, `{ version: 1,
entries: [{ id, ruleId, pile, entities, answer, note? }] }`.
- `schema/decide-answers.schema.json`: the page's save, `{ version: 1,
answers: [{ id, answer, entities, reason?, issue?, note? }] }`.
- `node scripts/ci/check-schemas.mjs` covers the new files. Check that it
  globs `schema/`, and add them if it lists files.

### Resolve skill

The step 3 table is replaced by a pointer: the pile is `decide --json`'s
`pile`, and the rules are `src/core/piles.mjs`. Its "Two piles deserve a
second look" text stays. Step 1 gains "read the decisions file". Step 5
works `fix-code` entries. A new step makes `change-contract` entries'
contract change, and that is the one exception to step 6 and the hard
limits, worded as "only what an entry in the decisions file records". The
report step ends with `decide`.

## Surfaces touched

- `src/core/piles.mjs`, `src/core/recommendations.mjs`, `src/core/decisions.mjs`, `src/core/decisions-page.mjs` — new pure modules
- `src/cli/commands/decide.mjs`, `src/cli/main.mjs` — the new subcommand and its `SUBCOMMANDS` row
- `src/core/config.mjs` — `DEFAULT_PATHS.decisionsFile`
- `schema/config.schema.json` — `paths.decisionsFile`; `schema/decisions.schema.json`, `schema/decide-answers.schema.json` — new
- `docs/config-reference.md` — regenerated (`node scripts/generate-config-reference.mjs`)
- `docs/cli.md` — a `## decide` section (`__tests__/cli-subcommand-docs.test.js` requires it)
- `README.md` — the `## Usage` listing line for `design-delta decide` (same test), plus a sentence in the agent-skills section that resolve ends by handing over `decide`
- `docs/architecture.md` — the new `core/` modules where it lists them
- `skills/design-delta-resolve/SKILL.md` — pile table becomes a pointer; reads and acts on the decisions file; ends with `decide`
- `skills/design-delta/SKILL.md` (router) — lists `decide` where it lists commands, if it does
- `__tests__/` — `cli-decide.test.js`, `core-piles.test.js`, `core-recommendations.test.js`, `core-decisions.test.js`, `core-decisions-page.test.js`
- `package.json` `files` — `schema/` and `src/` already shipped; `scripts/ci/check-package.sh` confirms the new schemas are in the tarball
- CHANGELOG — generated by the release PR from the `feat:` commit; not hand-edited
- published surface (new command, config key, two schemas) — covered by the README, docs and schema lines above
- migration — none: additive only; an existing config validates unchanged, and nothing reads the decisions file until a project runs `decide`
- cost — none: no workflow, trigger or cron added
- ops after-merge issue — none owed: no living note covers these paths (checked)
