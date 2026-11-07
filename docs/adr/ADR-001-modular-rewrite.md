---
status: accepted
date: 2026-07-30
status-note: "amended 2026-07-31; the date is likewise amended 2026-07-31 for D12 provider abstraction, D13 phase inversion, D2 format decisions and D15 contract-to-code-only MVP"
deciders: "the maintainer"
informed-by: "full architecture audit of v0.5.4 (12,470 lines, 681 tests) and evaluation of nvillapiano/component-contracts, https://github.com/nvillapiano/component-contracts"
---

# ADR-001: design-delta — spec-basis modular rewrite

## Context

### What v1 is

`design-delta` v0.5.x is a deterministic audit engine: an agent (or
the REST gather CLI) snapshots the Figma side, the engine diffs snapshots against
the code side across four surfaces (tokens, components/Code Connect, mockups,
icons), and emits a markdown report. A separate linter (`drift-lint`) runs 18
static rules, and a spec path (`*.component.yml` → conformance + Code Connect
codegen) covers components that have specs.

It works — the first consumer runs it green — but five releases of accretion have
left structural debt that a feature-at-a-time approach can no longer pay down:

1. **Two competing conformance models.** Components with a `*.component.yml` get
   the spec-as-fixed-point model (`code-nonconforming` / `figma-nonconforming` /
   `spec-inconsistent`, no direction-guessing). Components without one get the
   reconcile model (`figma-only` / `code-only` / deltas with guessed `direction`,
   waivers, tolerances). Which model applies is decided by whether someone wrote
   a YAML file, and the two models have different finding shapes
   (`surface/kind/direction` vs `kind/side`).
2. **Three parallel change-detection mechanisms.** The `deltaKey` census baseline,
   the fingerprint-hash visual tripwire, and git timestamps each have their own
   storage, schema, module, and report vocabulary (`·🆕`, Visual check queue,
   `direction`). Three answers to one question: "did this change since last run?"
3. **A 148-line fingerprint function copy-pasted four times** — byte-identical in
   three Figma-sandbox gather scripts, plus a fourth REST-field-name variant in
   `gather-rest.mjs` whose hashes are documented as _not_ byte-compatible with
   the other three (switching gather methods forces a full false-positive sweep).
4. **Six snapshot schemas for three natural data groups.** `component-vardefs.json`
   is a projection of `component-hygiene.json`; `components.json`,
   `component-fingerprints.json`, and `baseline.fingerprints` hold three
   overlapping copies of the same per-component facts, reconciled by `ingest`
   writing to both and `runAudit` "reconstituting" from the baseline.
5. **Consumer identity still leaks into engine defaults** — `groupedDirs:
["heroes","print"]`, the rainbow `gradientMap`, the vivid/opaque
   `aliasFoldingRules`, hardcoded America/Los_Angeles dates, `/designer` and
   `/engineer` role strings in report actions, a hardcoded `components` dir in
   the extract CLI, and a hardcoded baseline path in `select-movers`.
6. **Three severity mechanisms** (`rules`, legacy `lint.severityOverrides`,
   legacy `tokenHygiene.flagRawFills`) with a documented precedence chain; three
   flag parsers; two renderers for the same snapshot ref shape; `SEVERITY_RANK`
   defined twice; a `lib/` module that imports the 2,005-line linter to get one
   constant.
7. **No interactive setup and no progress feedback.** Adoption is a manual
   8-placeholder skill edit plus a hand-written config; long runs print nothing
   until the report lands.

### Goals for the engine (2026-07-30)

- **Primary:** catch design-delta deltas between Figma and code, **using the spec
  as the basis**.
- **Secondary:** lint tokens and components — runnable against tokens only,
  components only, or both.
- Highly configurable via `config.json`.
- Interactive terminal setup (`init` wizard) and live terminal feedback while
  tasks run.
- Clear module boundaries — tokens / components / lint — built and hardened **one
  module at a time**.
- Evaluate [component-contracts](https://github.com/nvillapiano/component-contracts)
  as a replacement for the `*.component.yml` spec format.

### North Star and scope test (amended 2026-08-30)

**North Star: find drift.** design-delta exists to report where Figma, code,
and the contract disagree — and, secondarily, to lint the structure,
nomenclature, and best practices the contract and token schema define, since
a lint violation is drift against the contract before it becomes drift
against Figma. Anything that does not serve that is out of scope, however
useful it would be.

The test for any new command, rule, or feature:

> Does it produce a finding (a disagreement between Figma, code, and
> contract), sharpen one, or lint against a rule the contract or token schema
> defines? If not, it is out.

Applied to what has shipped, the surface sorts into three tiers:

| Tier                                            | Commands                                                            | Rule                                                                                                                                                                                                                |
| ----------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Core** — produces findings                    | `audit`, `verify`, `lint`, `contracts`, `report`, `gather`/`ingest` | Where investment goes. New rules and providers land here.                                                                                                                                                           |
| **Support** — needed to produce findings        | `init`, `scaffold`, `snapshot`/`movers`, the health score           | Maintained; grows only when a core need pulls it. The score stays a report line and gate.                                                                                                                           |
| **Adjacent** — reads the census, finds no drift | `mcp`, `impact`, `map`, `dock`                                      | No new census or checks of their own. They grow only by exposing what the core and support commands already compute — findings, or the census behind them — to someone working on drift (decided 2026-09-16: #513). |

One decision this amendment records: **`codegen` is replaced by a
finding.** The engine does not generate Figma Code Connect files. A missing
or stale binding is drift and is reported as a `components/*` finding through
the provider, the same as every other disagreement; `--write` and the
generator go. This closes the one place the read-only audit posture bent.

Lint stays bounded: a lint rule is in scope only where the contract or token
schema defines the convention it checks. A rule that encodes an opinion no
schema states is a general linter's job, not this engine's.

### Roadmap note

The engine's earlier North Star was to stay a boring, deterministic engine
without growing its surface. This ADR redirects it: the rewrite grows the
surface deliberately (init wizard, progress UX, spec-first model), and
accepting this ADR amends the North Star. What does **not**
change: deterministic, read-only audit path; zero-to-few runtime deps; nothing
consumer-specific hardcoded in the engine.

## Decision

> **Reading order note (amendment, 2026-07-31).** D1–D11 were written when Figma
> was assumed to _be_ the design side. **D12 supersedes that framing**: Figma is
> one provider behind an interface, and D13 inverts the phase order so
> contract↔code parity ships first. Where an earlier decision says "Figma" and
> the statement is really about _the design side_, read it as "the active design
> provider" — D12 governs. Mentions that genuinely mean Figma (what v1 did, what
> the Terrazzo spike measured, what the Figma provider itself does) are left
> alone, because changing those would falsify the record.

### D1 — The spec is the single basis for drift (one conformance model)

the engine keeps exactly one drift model: **spec as fixed point**. Every check compares
one side against the contract, never Figma against code directly:

- `spec ↔ design` — does the design tool's component/variable match the
  contract? (Figma is one provider among several — D12.)
- `spec ↔ code` — does the code component/token output match the contract?
- In-sync between design and code holds by transitivity. No direction-guessing,
  no tolerances, no per-delta waiver vocabulary.

Entities that exist on a side but have **no contract** produce **coverage
findings** (`coverage/uncontracted-component`, `coverage/design-only`,
`coverage/code-only`) — inventory facts with a severity, in the same finding
shape as everything else — not direction-guessed deltas. The old reconcile
machinery (delta census, `deriveDirection`, waiver claims-verification) is
deleted, not ported. The v1 `ignore` block survives only as rule-level
exemptions (D5).

This is the load-bearing decision. It makes the spec the basis, it is the
model v1's own docs call better-reasoned, and it is what
collapses most of v1's accumulated complexity: no baseline census, no
direction vocabulary, no dual finding taxonomies.

Carried forward unchanged from v1's hard-won lessons (these are law in the engine):

- Never infer drift from git alone; git is blind to design-side work.
- Never pixel-diff design renders against code renders; each side compares only
  to its own history, and design-vs-code visual comparison is a human A/B.
- Parity is full and exact, never case-insensitive (`Size`/`SM` vs `size`/`sm`
  is drift). _Amendment (2026-08-22, [#297](https://github.com/chrisgriffin/design-delta/issues/297)):_
  one boundary exception, on the design side only — a numeric contract enum
  value matches its exact string form from the design tool (`2` ↔ `"2"`),
  because variant options there are strings by construction and the
  alternative is a permanent false finding about the tool. Round-trip exact
  only (`"02"`, `"2.0"` still mismatch); the code side stays type-exact.
- A bound paint's fingerprint is its binding, not its resolved color.
- Ignore/exemption entries are claims to re-verify against the live census.

### D2 — Contract format: a native schema shaped like component-contracts, not a dependency on it

**Evaluation of component-contracts:** the format is good — platform-agnostic
JSON, one file per component, with `tokens` (semantic slot → token name), `props`
(typed, platform overrides), `variants`, `states`, `behavior`, `accessibility`,
`composition.slots` (with per-child `figma` rendering hints — `visible`,
`booleanProp`, `textProp`), `usage`, and a `changelog`. Its philosophy (contract
is source code; Figma and React are build targets) is exactly D1.

**But it cannot be a dependency:** the repo is unpublished (no npm package —
`@ds/schema` is a private workspace name), single-author, 3 stars, and its
schema is still moving (button contract went 2.0 → 2.3 with breaking renames).
Betting design-delta's core data format on an unversioned external repo trades a
verbose-but-owned format for an ergonomic-but-unowned one.

**Decision:** design-delta **owns its contract schema**
(`schema/contract.schema.json`), deliberately shaped like component-contracts —
same top-level vocabulary (`id`, `status`, `tokens`, `props`, `variants`,
`states`, `composition`) so a future importer/exporter is mechanical if that
project publishes — **plus** the drift-specific blocks the conformance engine
needs, promoted from v1's `$extensions.componentSpec` to first-class keys:

- `sources.code` (`path`, `styles`, `propsType`) and `sources.design` — where
  each side of this contract lives. `sources.design` is **opaque to the core
  schema** and validated by whichever design provider is active (D12): the
  engine never learns Figma's `fileKey`/`nodeId` vocabulary, or any other
  tool's.
- `styles` — token-bound style facts, **element-major** (decided 2026-07-31):
  each element carries its `base` styles and then its `variants` overrides
  (`- when: {size: lg}`), rather than v1's variant-major shape where one
  element's styling is scattered across `default.elements.*` and every
  `variants[].elements.*`. One element's styling reads in one place, in the
  order the SCSS it describes is written. Keeps v1's box grammars — `edgeValue`
  (padding/margin/inset/borderWidth), `cornerValue` (borderRadius) and
  `gapValue` — and their **named logical slots** (`all` / `block` / `inline` /
  `blockStart` … for edges, `all` / `startStart` … for corners, `all` / `row` /
  `column` for gaps), never positional arrays. _Naming both levels is a
  clarification, not a change: the earlier draft of this bullet listed the three
  grammar type names as though they were the slot keys, which they are not._
  Also keeps `raw(...)` for a deliberate non-token value, and the
  `{ token: … }` wrapper that disambiguates a token reference from a literal. Token refs are namespaced by the config's
  prefix — no hardcoded `^system\.`, so v1's runtime schema-mutation hack dies.
- `codegen` — the Code Connect generation directives (v1's
  `exampleContent`/`example`/`className`/`domPassthrough`).
- Per-prop `design`/`code` deviation markers (`none` / `unverified` /
  `{name, reason}`) with v1's rule intact: a marker documents a genuine
  deviation, never pins a known-wrong case. v1's corpus uses **125 of these**,
  so they are load-bearing, not speculative — but they lose v1's
  `$extensions.componentSpec` nesting, which was 203 of 3,720 corpus lines (5%)
  carrying no information at all.

**Format: JSON only** (decided 2026-07-31 — initially "JSON-first, YAML
accepted", tightened to JSON-only once built: _"Drop YAML. Let's just not
support it and keep it lean."_). `*.contract.json` is the sole authored form —
it matches component-contracts' serialization and gets `$schema` editor
completion for free, and contracts are authored directly. YAML's one real advantage for an
authored spec is comments, which `_`-prefixed keys already carry; accepting a
second serialization bought terser punctuation in exchange for two parse paths
and a parity test whose only job was proving they agreed. This rewrite deleted
three flag parsers, two ref renderers, and three severity mechanisms for
exactly that reason — two ways to do one thing is how v1 rotted. The objection that JSON cannot hold v1's inline
reasoning (_"HYGIENE: raw 1px — captured, flagged, not entrenched"_) is answered
by this repo's existing `^_` comment-key convention: `_comment` / `_doc` keys are
permitted at every level of the contract schema, exactly as they are in the
config schema. Reasoning survives; it just moves from `#` to a key.

One component per file, flat — v1's `components: {<key>: …}` single-entry map
wrapper is dropped (it cost two indent levels on every line of all 41 specs for
a map that never held more than one entry).

What the engine does **not** adopt from component-contracts: `usage`/`platformNotes`
prose blocks and multi-platform prop overrides are allowed-but-ignored (open
schema regions) — the engine checks web only; and no Style Dictionary
dependency (D3 keeps the token pipeline pluggable).

A `design-delta migrate` subcommand converts v1 `*.component.yml` →
`*.contract.json` mechanically (Phase 2), and the converter is the compatibility
story — the engine does not read v1 specs at runtime.

### D3 — The DTCG tokens file is the token contract

Tokens don't get separate contract files. The project's W3C-DTCG `tokens.json`
**is** the token spec, and the tokens module checks both sides against it:

- `spec ↔ figma`: every Figma variable/style maps (via configured collection +
  alias-folding rules) to a token in the file, with matching value/alias per
  mode; Figma-only variables and value mismatches are findings.
- `spec ↔ code`: every emitted CSS custom property (or other configured code
  output) resolves to a token; code-only vars and stale values are findings.
- `codeAuthoritative` groups (viewport-conditional values etc.) skip the Figma
  value comparison, as in v1.

This matches component-contracts' ADR-004 stance (DTCG as source of truth)
without importing Style Dictionary: how the consumer builds tokens.json into CSS
is their business; design-delta only verifies agreement.

### D4 — Module layout

```
src/
  core/            # everything domain-agnostic — no design tool, no fs paths from config
    config.mjs     #   load/validate config.json (ajv, closed schema, defaults)
    rules.mjs      #   ONE rule registry + severity resolution (off|error|warn|review)
    findings.mjs   #   ONE finding shape + grouping/sorting/severity rank
    state.mjs      #   ONE change-record store (D6)
    progress.mjs   #   progress-event bus → TTY renderer / plain lines / silent (D8)
    report.mjs     #   markdown + JSON + terminal renderers over findings
    io.mjs         #   readJson/writeStdout/prettierFormat
  providers/       # design-tool adapters (D12) — ONE is active per config
    figma/         #   the only place in the repo that may mention Figma
      index.mjs    #     name / capabilities / sourceSchema / censusComponents / censusTokens
      rest.mjs     #     REST gather
      agent/       #     paste-scripts for the agent/MCP path
  sources/         # side acquisition → normalized snapshots (the only fs/network code)
    code.mjs       #   code-side census: tokens.json, component files, css vars, Code Connect
    ingest.mjs     #   raw payloads → snapshots; ALL hashing happens here (D6)
    extract.mjs    #   TS-backed prop/variant extraction (lazy typescript, unchanged idea)
  spec/
    contracts.mjs  #   load/validate *.contract.{json,yml}; the contract API view
  modules/         # the three domain modules — pure: (snapshots, contracts, config) → findings
    tokens.mjs
    components.mjs #   conformance checks + coverage + Code Connect codegen model
    lint.mjs       #   static best-practice rules over the token system
  cli/
    main.mjs       #   single `design-delta` bin: subcommand routing, ONE flag parser
    init.mjs       #   interactive setup wizard (D8)
    commands/*.mjs #   thin: parse flags → call module → render via core/report
```

Layering is enforced by a lint check in CI (a simple import-graph test):
`core` imports nothing internal; `sources`/`spec` import only `core`; `modules`
import `core` + `spec` + snapshot _types_ (never `sources` — modules take
snapshots as arguments and never touch fs/network); `cli` imports everything.
That makes every module independently testable with injected data, which is what
"work one module at a time until reliable" requires, and fixes v1's inversions
(`lib/codegen-code-connect → drift-lint`, engines owning fs/git/argv).

The public barrel (`src/index.mjs`) exports only `core` + `modules` + `spec`
pure functions. CLIs and sources stay out of it, so importing the package never
loads the TypeScript extraction path. The `package.json` `exports` map is the
fence: the barrel (`.`) and `./schema/*` are the only importable paths, so
nothing else under `src/` can be deep-imported.

### D5 — One finding model, one rule engine

Every check in the engine — tokens, components, styles, lint, coverage — emits the same shape:

```js
{
  ruleId,    // "tokens/value-mismatch" | "components/prop-missing" | "styles/binding-missing" | "lint/camel-case" | "coverage/code-only" …
  severity,  // resolved: error | warn | review
  surface,   // tokens | components | styles | lint | coverage
  side,      // figma | code | spec | both
  entity,    // token path, component name, or file
  message,   // human sentence
  data,      // rule-specific structured detail (JSON-stable)
}
```

(`styles` is Phase 2b's addition, issue #103 — not yet foreseen when this
section was first written.)

One registry in `core/rules.mjs` declares every rule id with its default
severity and options schema. The config's single `rules` block (same syntax as
v1's: `"<id>": "off" | severity | [severity, options]`) is the **only** severity
mechanism — v1's `lint.severityOverrides`, `tokenHygiene.flagRawFills`, and the
separate hygiene annotator are not ported. Path-level exceptions use one
`exemptions` block (`{ "<ruleId>": ["<entity-or-glob>", …] }` with an optional
reason), which also absorbs v1's `ignore.waived/trackedGaps/separateEfforts`;
exempted entities that no longer exist in the census are reported
(`coverage/stale-exemption`) per the v1 lesson that ignore entries are claims.

v1's hygiene surface (raw fills, primitive bindings in Figma components) becomes
two ordinary lint rules with `side: "figma"` — same data, one less concept.

Exit-code policy carries over verbatim: `audit` exits 0 unless `--check`;
`lint`/`verify` exit 1 on error-severity findings; a missing Figma snapshot
skips its surface with a note and is never, alone, a failure.

### D6 — One change record, hashed Node-side

One state file, `state.json` (schema-validated, replacing `baseline.json` +
`component-fingerprints.json`):

```js
{
  entities: {
    "component:Button": { designHash, codeHash, specHash, lastSeen },
    "token:color.bg.primary": { designHash, codeHash, specHash, lastSeen },
    …
  },
  lastRun,
  lastRunByScope: { tokens, components },
}
```

All hashes are computed in `sources/ingest.mjs` from the **normalized snapshot
representation** — never inside the Figma sandbox. Consequences:

- The 148-line `fpData` function and its four copies are deleted. Gather scripts
  (MCP and REST alike) only enumerate and dump raw data; parity between gather
  methods is automatic because both feed the same normalizer before hashing.
- `newSinceLastRun`, the visual-check queue (figma-hash moved since last run),
  and code-changed detection (code-hash moved) are all derived from this one
  record. `select-movers` survives as a derived query (`design-delta movers`)
  for the MCP gather fast path, not a separate baseline-reading CLI.
- Git timestamps are demoted to report annotation ("code last touched …"), never
  an input to drift decisions (v1 lesson #1).

### D7 — Snapshot family: two files

| snapshot                 | contents                                                                                                | replaces (v1)                                                                                                                                                                                           |
| ------------------------ | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `design-tokens.json`     | variable collections/modes/values + text & paint styles, per configured file label                      | `tokens-global.json`, `tokens-web.json`                                                                                                                                                                 |
| `design-components.json` | per-component: nodeId, variantProperties, propertyDefinitions, usedVars, rawProps, normalized-tree hash | `components.json`, `component-hygiene.json`, `component-vardefs.json`, `component-fingerprints.json`, `icons.json` (icons are components with an `icon: true` flag from the configured icons page/file) |

(v1's `mockups.json` has no the engine successor — the mockups surface is killed, D9.)

Every snapshot is optional and schema-validated; invalid degrades like missing,
with a distinct reason (kept from v1). The code side is never snapshotted to
disk — it is read live per run, as in v1.

### D8 — CLI: one bin, an init wizard, and live progress

**One bin.** the engine ships a single `design-delta` executable with subcommands
(`init`, `audit`, `lint`, `report`, `verify`, `gather`, `ingest`, `contracts`
(validate), `codegen`, `migrate`, `movers`), all sharing `cli/main.mjs`'s one
flag parser and `--help`. The eleven v1 sibling bins are not ported; the
umbrella-spawns-bins architecture (three flag parsers, `spawnSync` indirection)
dies. Consumers wire `"drift:audit": "design-delta audit --report"` etc.

**`design-delta init`** — the interactive setup wizard:

1. Detects what it can: existing `config.json`, a DTCG-looking tokens file,
   candidate component dirs, style/Code Connect suffixes from a sample of files,
   whether `@figma/code-connect` is installed.
2. Prompts for what it can't: Figma file keys (tokens/components/icons), token
   env-var name (`FIGMA_TOKEN` default; the value itself is never stored in
   config — env only), css-var prefix, report dir, which surfaces to enable.
3. Writes `design-delta.json` with `$schema` wired, plus the
   snapshot/report dirs, and prints the suggested npm scripts and (optionally)
   copies the skill template with placeholders pre-filled from its answers.
4. Re-running `init` on an existing config becomes an update flow (shows current
   values as defaults). Non-interactive `--yes` accepts all detections for CI
   scaffolding.

Prompting uses **`@clack/prompts`** (public, tiny, no registry auth — satisfies
the CI rule) as a regular dependency imported only by `init` and progress
rendering. **Decided 2026-07-30: adopted** — see resolved open
question #3.

**Progress feedback.** `core/progress.mjs` is an event bus (`task:start`,
`task:update` (e.g. "components 40/112"), `task:done`, `task:skip` + reason).
Renderers: spinner/live lines when stderr is a TTY, plain timestamped lines when
not (CI logs), `--quiet` for silence. Two invariants: progress writes **only to
stderr** (stdout stays byte-deterministic for reports/JSON — piping is safe),
and renderers never see domain objects, only events (modules stay pure; they
receive an optional `onProgress` callback).

### D9 — Scope: what the engine drops, folds, and defers

- **Icons → folded into the components module** (an icons file/page is just a
  component census with `icon: true`; the name-parity check becomes component
  coverage rules). `icon-snapshot` as a concept disappears.
- **Mockups → killed (decided 2026-07-30).** The surface is the shallowest
  (instance name-parity per route), its frame-granularity matching needed a fix
  as recently as v0.5.4, and the engine`s coverage findings partially subsume its
value. Not ported; v1's `mockups.json`, `mockup-snapshot.schema.json`,
`mockupRouteMap` config, and the mockups gather scripts are deleted at
  cutover with a note in the migration guide.
- **Code Connect codegen → kept** (the first consumer depends on it), as part of
  the components module, generated from contracts (D2's `codegen` block).
- **`verify` → kept** as the composed Figma-free CI gate (contracts valid +
  code conformance + lint errors + optional new-drift gate), now a thin
  `cli/commands` composition instead of a fifth engine.
- **The report** keeps v1's two-part structure (What changed → Run log) and the
  entity-centric lint tables; `actionFor`'s hardcoded `/designer` `/engineer`
  strings become a configurable `report.actions` map (default: plain
  "design-side fix" / "code-side fix" prose).
- **Timezone** comes from config (`report.timeZone`, default UTC) — `pt-date.mjs`
  dies; the first consumer sets `America/Los_Angeles` in its config.
- **The skill template** (`skill/`) survives with fewer placeholders (init
  pre-fills most) and the same boundary: gather via agent, engine via CLI, report
  as deliverable, no issue-filing.

### D10 — Open-source leverage: buy the undifferentiated parts (decided 2026-07-30)

Prefer maintained open-source libraries wherever they replace undifferentiated
in-house code; build only the differentiated core (the spec↔figma↔code
conformance engine, coverage/drift findings, state hashing, report — no OSS
equivalent exists; everything comparable is SaaS). All candidates verified
publicly installable with no registry auth (the CI rule) as of 2026-07-30:

- **`@terrazzo/parser`** — DTCG parse/validate/alias-resolution for the code
  side of the tokens module. **Adopt in Phase 1** (evaluate first — hand-roll
  only what it demonstrably can't express) and **evaluate its lint rules in
  Phase 3** before porting v1's token rules one-for-one.
- **`@figma/rest-api-spec`** — official Figma REST typings, **dev-dependency**
  documenting `sources/figma-rest`'s shapes via JSDoc.
- **`react-docgen-typescript`** (or `react-docgen`) — **Phase 2 spike** against
  the first consumer's real components as a replacement for the hand-rolled TS
  prop/variant extractor; adopt only if it reads variant enum unions cleanly,
  else port v1's extractor as planned.
- **`@clack/prompts`** — init wizard + progress rendering (D8, open question #3).
- **Not adopted:** `commander`/`yargs` (the ported 100-line `parseFlags`
  suffices); `stylelint-declaration-strict-value` (good consumer-side
  recommendation, but contract-driven style checks — _this_ element must use
  _this_ token — can't be expressed there); Style Dictionary (a build system;
  the engine only verifies agreement, D3); component-contracts as a dependency
  (D2).

Constraint: any dependency that feeds the audit path must be pinned and
output-deterministic; a Terrazzo/docgen upgrade that changes normalized output
is a breaking change to state hashes and is released accordingly.

### D12 — The design tool is a provider, not the engine (decided 2026-07-31)

**Figma is one implementation of a design provider, decoupled from the engine.**
The engine knows only "a design side exists and can be censused"; it never
knows what Figma is. Sketch, Penpot, Pencil, or anything else is a sibling
module implementing the same interface.

This supersedes the earlier framing where Figma was baked into `sources/`. Two
things forced it: nothing about drift detection is Figma-specific, and Figma's
own limitations (variables gated behind Enterprise, `use_figma` only callable by
an agent) were leaking into the engine's architecture as if they were facts
about design systems rather than facts about one vendor.

**One active provider at a time.** Organizations pick a design tool; they do not
run two. Config enables one (`design.provider: "figma"`), and the contract's
`sources.design` block is validated by that provider, not by the core schema —
so Figma's `fileKey`/`nodeId` vocabulary lives in the Figma provider and nowhere
else. Multi-provider (a genuine Figma→Penpot migration) is deliberately **not**
built now; it is a smaller, later problem, and building for it today would add
machinery to serve a case that does not exist.

**The interface** (`providers/<name>/index.mjs`), deliberately small:

| member                  | job                                                                                    |
| ----------------------- | -------------------------------------------------------------------------------------- |
| `name`                  | the config key that selects it                                                         |
| `capabilities`          | what this provider can actually census (e.g. Figma REST: components yes, variables no) |
| `sourceSchema`          | JSON Schema for the contract's `sources.design` block                                  |
| `censusComponents(ctx)` | → normalized component census                                                          |
| `censusTokens(ctx)`     | → normalized variable/style census                                                     |

`capabilities` is what makes an honest engine possible: a surface a provider
cannot census **skips with a stated reason** rather than reporting false parity —
the same rule already applied to a missing snapshot. Figma's Enterprise gating
stops being an engine caveat and becomes one provider's declared capability.

Providers live in `src/providers/`, layered as peers of `sources/`: they may
import `core/`, never `modules/` or `spec/`. The layering test gains a rule that
**no file outside `src/providers/figma/` may mention Figma at all** — the same
enforcement style that keeps consumer identity out of the engine, applied to
vendor identity.

### D13 — Contract↔code parity comes first (decided 2026-07-31)

The phase order inverts: **contract↔code parity ships before any design-tool
parity.** Rationale: it is the easier half, and it is the
half that proves the contract is a real fixed point rather than a Figma mirror.

Consequences, all of them good:

- The critical path stops depending on design-tool access. The gather-
  determinism spike (#88) blocked everything under the old order; it now blocks
  only the provider phase, and the Figma PAT being revoked stops being urgent.
- D1's model is unchanged — spec↔code and spec↔design are still the only two
  comparisons, and in-sync still holds by transitivity. Only the build order
  moves.
- The first real check is **props/API parity** (contract props vs the `.tsx`'s
  exported prop surface): the most mechanical, least ambiguous, highest
  signal-per-effort check, and v1's most proven checker.

### D14 — No strangler: the old engine is deleted outright (decided 2026-07-31)

**Supersedes D11**, which planned to grow the new engine alongside the old one
and cut over at release. That plan existed to protect a consumer running the
old engine mid-flight. Two facts removed the need:

- **Nothing ships until the rewrite is done.** The consuming project installs a
  _published_ version from the registry, not this repo, so deleting the old
  source here cannot break it. It keeps running the last published release
  until it deliberately bumps.
- **The old engine's reports were not trustworthy anyway.** Preserving a
  working-but-unreliable path has value only if someone depends on it working;
  nobody did.

So there is no transitional migration: what is not needed is removed, and no
cruft is left behind.

So the old engine — every flat `src/*.mjs` engine, all of `src/lib/`, the
paste-script gather, its nine schemas, its ~660 tests, its docs and its skill
template — is **deleted in one commit** rather than carried. What survives is
what the new engine actually uses.

**The transitional names go with it, immediately rather than at a future
cutover.** D11's Phase-5 un-naming checklist is executed now: `__tests__/v2/`
is `__tests__/`, `design-delta2` is `design-delta`, and
`config.v2.schema.json` is `config.schema.json`. **No `v2` label survives
anywhere** — with nothing to distinguish the engine _from_, a version label on
its own modules is noise that would read as meaningful to the next person.

The cost, accepted knowingly: the old engine's behavior is now recoverable only
from git history and the last published package, not from the working tree. The
converter (`migrate`) is what carries the one thing that mattered — a
consumer's authored specs.

## Consequences

**Gains:** one drift model, one finding shape, one severity system, one flag
parser, one fingerprint implementation, one state file, three snapshots instead
of six, REST/MCP hash parity for free, a real setup story, visible progress,
and module boundaries that let each domain be hardened independently.

**Costs / risks:**

- A rewrite of a working tool. Mitigated by D11: strangler, ported tests,
  goldens, synthetic project, and the first consumer as the live acceptance rig at
  every phase.
- Dropping the reconcile model means uncontracted components get **coverage**
  findings, not per-prop deltas. Until the first consumer has contracts for
  everything it cares about, the audit is temporarily less granular for the
  uncontracted tail. Mitigation: `migrate` converts existing specs on day one,
  and coverage findings name exactly what's missing.
- The contract format is owned here, so schema evolution is our maintenance —
  the price of not depending on an unpublished repo (D2).
- state.json hashes change format at cutover → one-time "everything is new" run
  for consumers, announced in the the first release release notes (same caveat v1 already
  documented for gather-method switches — and the last time it will apply).
- `@clack/prompts` would be the first UX runtime dep; it is public and small,
  and confined to `cli/` (never loaded by the library surface). Fallback exists
  (D8).

## The plan

> Working agreement: one module at a time, hardened until reliable,
> then the next. Every phase ends green (`npm test`, prettier, schema, package
> CI jobs) and demo-able against the first consumer. Conventional commits, PRs to
> `develop`, each phase = several small PRs, not one monster.

### Working method — reliability gates (decided 2026-07-30)

Context for the implementer: v1's failure mode was **erratic output** — each
round of code fixes shifted the report in new ways (three change-detection
mechanisms that can disagree, hashes that differ across gather paths, a model
that flips when a spec file appears). The engine is built depth-first, and "done" is
judged on **output**, never on code quality. Four gates apply to every slice of
every phase:

1. **Vertical slices, adjudicated output.** A slice is gather → snapshot →
   diff → report for one narrow scope, run against the first consumer's real data.
   The maintainer walks every finding and marks it true or false. A
   slice is _working_ when a real run has **zero false findings**. Do not widen
   scope before that.
2. **Fixture ratchet.** Every false positive becomes a fixture test _before_
   its fix is written. The regression corpus only grows; an old problem
   returning is a test failure, not a rediscovery.
3. **Determinism gate.** Same inputs, two runs → byte-identical output — and
   two consecutive _gathers_ of the same unchanged Figma file → identical
   normalized snapshots. Gather noise is caught at the snapshot boundary, not
   downstream in a report row.
4. **Scoreboard.** Each acceptance run records findings-adjudicated-true vs
   false-positives (in the PR description). Progress is a visible number, run
   over run.

### D15 — The first release is contract↔code ONLY (decided 2026-07-31)

**The design side is deferred past the first release.** The first release is
an MVP to test rigorously, and the design side is a large layer of complexity
that waits until contract↔code is in a good place.

D13 already put contract↔code first. D15 goes further: the design provider
layer is not merely later, it is **out of the first release entirely**. What
ships is an engine that answers one question well — _does this codebase match
its own contracts?_ — and answers it with findings a person trusts.

**Why this is the right trade, not a retreat.** Every check built so far shipped
with a bug that only a real codebase exposed: a variant rule matching zero real
components, a style rule blind to 14% of real CSS, a token rule that would have
fired on most of a design system, a JSX walker that could not read 69% of real
components. Four for four. Adding the design side now would double the surface
that can be confidently wrong while the existing half is still unproven against
real contracts — because **no real contracts exist yet**. That is the actual
MVP blocker, and it is authoring work, not engine work.

**Consequences:**

- Phases renumbered: lint and the release move ahead of the provider layer,
  which becomes the LAST phase and is explicitly post-1.0-of-the-rewrite.
- The gather-determinism spike (#88) is deferred with it — nothing before the
  release depends on it.
- `sources.design` **stays in the contract schema**, still opaque (D12). It
  costs nothing, it is already validated by nobody, and removing then re-adding
  it would churn the format for no gain.
- **Code Connect codegen is kept but is not part of the MVP's promise.** It
  emits a design-facing artifact and cannot fill in the design node reference
  without a provider, so its output needs one line completed by hand. Built,
  tested, documented as such — not advertised as finished.
- The honest tension, named rather than hidden: a tool called _design-delta_
  will ship a first release that never looks at a design tool. What it detects
  is real drift — a component that has stopped matching its own contract is
  drift whether or not anything is compared to Figma — but the name promises
  more than the first release delivers, and that is a deliberate, temporary
  gap.

**What "rigorously test" means concretely**, since the phrase decides when the
MVP is done:

1. Real contracts authored for a meaningful slice of a real design system —
   by hand, in the consuming project (D14 deleted the migrator on purpose).
2. Every check run against them and **every finding adjudicated** true or
   false, by a person.
3. Every false finding becomes a fixture test **before** its fix (the working
   method's ratchet), so the class cannot return.
4. Zero false findings on a full run is the release gate. Not "tests pass" —
   tests have passed four times while the check was wrong.

### Phase 0 — Skeleton and contracts of the rewrite (small, fast)

1. Create `src/core/` with `findings.mjs`, `rules.mjs` (registry + resolution,
   ported from v1 `lib/rules.mjs` semantics), `progress.mjs` (bus + plain
   renderer), and `config.mjs` (the config schema, `schema/config.schema.json`,
   closed, with `$schema`, written fresh from D4–D9's needs; v1 schema untouched).
2. Create `cli/main.mjs` with the subcommand table, the single flag parser
   (port `lib/cli.mjs` `parseFlags`), `--help`, and a `design-delta2` **temporary**
   bin name so v1's `design-delta` keeps working until cutover (the cutover PR
   renames it).
3. Add the import-graph layering test (D4) and wire the new dirs into CI.
4. Port the synthetic-project fixture harness to a test entry (it will grow
   per phase).
5. Amend the North Star per this ADR (same PR series).

**Exit:** `design-delta2 --help` works; layering test green; ADR merged.

### Phase 0.5 — De-risking spikes

Cheap experiments targeting the plan's genuinely uncertain areas. Each produces
a write-up under `docs/spikes/`; a failed spike changes the plan _here_, before
code is built on the assumption.

1. **Terrazzo fit** — **DONE** (2026-07-30, `docs/spikes/terrazzo-fit.md`).
   Verdict adopt-after-cleanup: parses the consuming project's real tokens file
   (657 tokens, aliases resolved) once two malformed aliases are fixed.
2. **Contract authoring dry-run** (#89) — hand-author contracts for 2–3 real
   components against a draft `contract.schema.json` and judge the authoring
   experience on a blank page, not just post-conversion. **Plan drafted and
   grounded in the 41-spec corpus; see the issue.** No longer gates anything but
   its own phase, and needs no design-tool access.
3. **Gather determinism** (#88) — gather the same unchanged design file 5× and
   derive normalization rules from **observed** variance, not guesses. Under
   D13 this **no longer blocks the critical path**: it gates the provider phase
   only. Still required before any design-side hashing is trusted — this is
   where v1's erraticism lived.

**Exit:** each write-up committed before the phase that depends on it.

### Phase 1 — Contracts + contract↔code parity (D13)

The first phase that emits real findings, and it touches no design tool at all.

1. `schema/contract.schema.json` (D2) — flat, one component per file,
   element-major `styles`, first-class deviation markers, `^_` comment keys,
   `sources.design` left opaque for the active provider (D12).
2. `spec/contracts.mjs` — load `*.contract.json`, validate, expose the API view
   the checkers consume. `design-delta2 contracts` validates.
3. `migrate` — v1 `*.component.yml` → contract. **Proven by round-tripping
   the consuming project's full 41-spec corpus and diffing v1's conformance
   results against the engine`s**: any behavioral difference is a converter bug or a
   deliberate, recorded decision. That corpus is the acceptance rig.
4. `sources/react/extract.mjs` — the `.tsx` prop/variant surface (the D10
   `react-docgen-typescript` spike decides port-vs-adopt).
5. **`modules/components.mjs`, first checker only: props/API parity** —
   contract props vs the code's real exported surface (enum values, defaults,
   optionality, presence). Emits D5 findings; honors the `code: none` /
   `unverified` deviation markers.
6. Report + `audit --components --code-only`, with goldens.

**Exit:** the consuming project's contracts migrate cleanly and props/API parity
runs against real components with **zero false findings after adjudication**
(the working method's first gate). **Only then Phase 2.**

### Phase 2 — The rest of contract↔code parity

Still design-tool-free.

1. Token parity: the DTCG contract (D3) vs the emitted CSS custom properties —
   the diff on top of the census slice 1a already landed.
2. Style parity: contract `styles` token bindings vs what the SCSS declares.
3. Anatomy parity + Code Connect presence/codegen from contracts.
4. `verify` — the composed, design-tool-free CI gate. **Note this is now
   genuinely complete without a design tool**, which it never was in v1.

**Exit:** every contract↔code check adjudicated clean on the real corpus.

### Phase 3 — Lint module

1. `modules/lint.mjs`: static best-practice rules over the token system,
   onto the D5 finding shape and the one registry. Per D10, first map which
   token rules `@terrazzo/parser`'s lint layer already covers — delegate those,
   port the rest. A component-structure rule family (directory casing, sibling
   files, line budgets) was planned here too and later dropped (2026-08-06,
   #142) — general code hygiene with no relationship to tokens, contracts, or
   the design tool, out of design-delta's stated mission.
2. `lint [--json] [--rule <id>]`.
3. `report` — the combined view, trivial now that every surface shares one
   finding shape.

**Exit:** lint adjudicated clean on a real codebase.

### Phase 4 — MVP hardening and the first release (D15)

**The gate is adjudication, not a green suite.** Four checks so far passed
their tests while being wrong about real code; a passing suite is necessary and
has repeatedly not been sufficient.

1. **Author real contracts** for a meaningful slice of a real design system —
   by hand, in the consuming project. This is the actual blocker: the engine
   has never run against a real contract, because none exist.
2. **Adjudicate every finding** from a full run, true or false, by a person.
   Every false one becomes a fixture test BEFORE its fix.
3. `init` wizard (D8) — detection, prompts, config scaffolding, `--yes`.
4. Progress renderer TTY polish behind the existing bus.
5. Docs: engine reference, contract authoring guide, config reference generated
   from the schema. **State plainly that this release checks contract↔code
   only**, and that Code Connect codegen emits a design node reference to be
   completed by hand.
6. **Release.** Version per the repo's own flow; not 1.0.0 (decided 2026-07-31:
   0.x is honest for an engine this young).

**Exit:** zero false findings on a full real-codebase run; released.

### Phase 5 — The design provider layer (D12) + contract↔design parity

**Explicitly post-release (D15).** Everything below was Phase 3 before the
design side was deferred out of the MVP.

1. `providers/` interface: `name`, `capabilities`, `sourceSchema`,
   `censusComponents`, `censusTokens`. The layering test gains the rule that
   **no file outside `src/providers/figma/` may mention Figma**.
2. `providers/figma/` — gather (REST + agent/MCP paths), normalize, and hash
   **Node-side** per D6, so a single fingerprint implementation serves both
   paths. Gated on the gather-determinism spike (#88), itself deferred here.
3. Each module gains the spec↔design half of its checks, reusing the D5 finding
   shape. A capability a provider lacks skips with a stated reason.
4. Contract `sources.design` validated by the active provider's `sourceSchema`
   — the field already exists and is already opaque, so nothing in the format
   changes when this lands.

**Exit:** contract↔design parity adjudicated clean; both gather paths agree.

### Phase 6 — Post-MVP engine ergonomics (retro-defined, ADR-003)

Numbered after Phase 5 in `SUBCOMMANDS` because it was scoped after Phase 5 was
written, not because it ships later: **Phase 6 is post-MVP engine ergonomics,
shipped ahead of the provider layer** — `snapshot`, `scaffold`, `dock`.

### D16 — A UI framework is an adapter, the way a design tool is a provider (decided 2026-07-31)

**Other JS frameworks (Angular, web components) are roadmap, not now — but the
boundary that makes them cheap is built now.** Where the code can be
structured now to make that easier, it is.

This is the exact symmetric twin of D12. There, a **design tool** is a provider
and `src/providers/<name>/` is the only place that may name one. Here, a **UI
framework** is an adapter and `src/sources/<framework>/` is the only place that
may name one.

**The census was already the boundary.** Measured before deciding anything:
`core/`, `modules/components.mjs`, and `modules/styles.mjs` contained _zero_
framework references, and the two censuses the modules consume have nothing
React-specific in them:

- props — `{name, type, values?, default?, required}`
- tree — `{kind: "element"|"component"|"text"|"expression"|"unknown", tag, name, children}`

An Angular template or a web component's shadow DOM maps onto that tree
directly. The architecture was accidentally right; what was wrong was
vocabulary.

**The leak was naming, not imports.** `modules/anatomy.mjs` carried `jsxNode`,
`describeJsxNode`, and a user-visible `"rendered JSX"` message while its logic
was already framework-neutral. Import-based layering could never have caught
that — and a finding **message is a public surface**, read by consumers in
reports, so renaming it after a release would be a breaking change. That is why
this landed before the first release rather than alongside the second
framework.

**What this decision fixes in place:**

1. `core/` and `modules/` never name a UI framework — enforced by
   `__tests__/layering.test.js`, negative-controlled against the React adapter
   (where the terms belong) so the guard cannot rot into decoration.
2. The React readers live in `src/sources/react/` (`extract.mjs`, `jsx.mjs`).
3. `anatomy` speaks of _markup_ and _tree censuses_, never JSX.

The guard is a deliberate **substring** match, not `\b…\b`. The first version
used word boundaries and caught nothing: `\bjsx\b` does not match `jsxNode`,
and `\bjsx` does not match `describeJsxNode` — it would have missed the exact
identifiers that prompted it. An innocent word like "reactive" now trips it;
rewording is cheap, a decorative guard is not.

**Deliberately NOT done yet**, because both would design an interface against a
single example — the failure mode D12 avoided by writing the provider interface
only _after_ Figma was real:

- **#116** — document the census shapes as the adapter contract, including the
  rules that are not visible in the shape: `resolvable: false` is a first-class
  answer, `type: "unknown"` is not `slot`, and censuses are deterministic.
- **#117** — make the framework a config value (`code.framework`), with file
  conventions supplied by the adapter rather than `.tsx` defaults in
  `core/config.mjs`. Done: the suffixes now come from the adapter. The guard
  still exempts `core/config.mjs`, permanently, but only for the
  `DEFAULT_CODE = { framework: "react" }` default and the comment beside it:
  core imports nothing outside core, so the default framework name cannot be
  asked of `sources/` and has to be named where it is.

**One collision to settle before web components land:** `slot` is already a
prop type in the contract schema, and it is also a web-components term with a
narrower meaning. That needs a deliberate decision, not an accident.

## v1 → the engine disposition (implementer's map)

| v1                                                                        | the engine disposition                                                                                                                                 |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `cli.mjs` + 11 sibling bins                                               | one `cli/main.mjs` bin + `cli/commands/*` (D8)                                                                                                         |
| `drift-audit.mjs` (2,288)                                                 | split: diff cores → `modules/tokens                                                                                                                    | components`; fs/git census → `sources/code.mjs`; report → `core/report.mjs`; baseline → `core/state.mjs`; reconcile/direction machinery → **deleted** (D1) |
| `drift-lint.mjs` (2,005)                                                  | rules → `modules/lint.mjs`; collectors → `sources/code.mjs`; parser → `cli/main.mjs`                                                                   |
| `drift-report.mjs` / `verify.mjs`                                         | thin `cli/commands` compositions (Phase 3)                                                                                                             |
| `ingest.mjs` / `gather-rest.mjs` / `lib/figma-rest.mjs`                   | `sources/ingest.mjs` + `sources/figma-rest.mjs`; hashing centralized (D6)                                                                              |
| `src/figma-gather/*.js` (fpData ×3)                                       | regenerated minus fpData; enumerate/dump only                                                                                                          |
| `extract-component-props.mjs`                                             | `sources/react/extract.mjs` (same approach, real tests)                                                                                                |
| `validate-component-specs.mjs` + `component-spec.schema`                  | `spec/contracts.mjs` + `schema/contract.schema.json` + `migrate` (D2)                                                                                  |
| `conform-components.mjs` + `lib/component-conformance.mjs`                | `modules/components.mjs` (checkers ported, one finding shape)                                                                                          |
| `generate-code-connect.mjs` + `lib/codegen-code-connect.mjs`              | components-module codegen; linter import broken (Phase 2.5)                                                                                            |
| `select-movers.mjs`                                                       | `movers` derived query over `state.json`                                                                                                               |
| `lib/baseline.mjs` + `baseline.schema` + fingerprints schema              | `core/state.mjs` + one state schema (D6)                                                                                                               |
| `lib/rules.mjs` / `findings-presentation` / `group-findings` / `md-table` | `core/rules.mjs` + `core/findings.mjs` + `core/report.mjs`                                                                                             |
| `lib/figma-token-map.mjs` / `lib/token-diff.mjs`                          | `modules/tokens.mjs` internals (ported cores)                                                                                                          |
| `lib/figma-snapshot.mjs` + 6 snapshot schemas                             | 3 snapshot schemas (D7); one ref renderer                                                                                                              |
| `lib/config-schema.mjs`                                                   | `core/config.mjs` + the engine schema; consumer-specific defaults **removed** (empty/neutral defaults; the first consumer's values move to its config) |
| `lib/ignore.mjs` + config `ignore` block                                  | `exemptions` block on the one rule engine + `coverage/stale-exemption` (D5)                                                                            |
| `lib/pt-date.mjs`                                                         | `report.timeZone` config (D9)                                                                                                                          |
| `lib/names.mjs` / `token-naming.mjs` / `io.mjs` / `cli.mjs`(lib)          | ported into `core/` near-verbatim                                                                                                                      |
| hygiene surface + vardefs snapshot                                        | two lint rules over `design-components.json` (D5/D7)                                                                                                   |
| mockups surface                                                           | **killed** at cutover (D9, 2026-07-30)                                                                                                                 |
| `skill/`                                                                  | kept, fewer placeholders, init-aware (D9)                                                                                                              |

## Open questions

1. **Contract format sign-off (D2)** — **RESOLVED (decided 2026-07-30):** spec
   is the source of truth; design systems are moving machine-ready and
   component data is becoming real. The engine owns its contract schema, shaped like
   component-contracts, with the `migrate` converter from v1 specs.
2. **Mockups surface** — **RESOLVED (decided 2026-07-30): kill it.** Weakest
   surface, frame-granularity fragile, partially subsumed by the engine coverage
   findings. Deleted at cutover (D9); no the engine successor.
3. **`@clack/prompts` as the one UX dep** — **RESOLVED (decided 2026-07-30):
   adopt it** for init/progress, confined to `cli/`, never loaded by the
   library surface (D8/D10).
4. **Coverage granularity** — **RESOLVED (decided 2026-07-30):** pure
   spec-basis; no reconciliation remnant ("otherwise we're using
   reconciliation and that seems very messy between Figma and code").
   Uncontracted components get coverage findings only, which double as the
   authoring worklist.
