# CLI reference

Every subcommand of the single `design-delta` bin (ADR-001 D4/D8) — its
flags, its exit codes, and its `--json` payload shape.

One entry point, in-process subcommands, one flag parser. Hand-written, not
generated (unlike
[`docs/config-reference.md`](./config-reference.md) and
[`docs/rules.md`](./rules.md), which mirror a single machine-readable source
1:1) — verified against `src/cli/commands/*.mjs` directly rather than assumed.

## Global flags

Every subcommand accepts these, pulled out of `argv` before dispatch:

| Flag              | Meaning                                                      |
| ----------------- | ------------------------------------------------------------ |
| `--quiet`         | silence progress output (stderr only — never affects stdout) |
| `--config <path>` | path to the project config (default: `design-delta.json`)    |
| `--help`, `-h`    | show the grouped subcommand listing                          |
| `--version`, `-V` | print the installed package version                          |

Two stream invariants hold across every subcommand below (ADR-001 D8):
progress goes to **stderr** via the injected progress bus, never stdout; and
`--json` writes **one JSON document to stdout and nothing else**, so it can be
piped straight into `jq` regardless of how noisy the run was.

`design-delta` with no subcommand, or `--help`, prints the same grouped
listing (grouped by the ADR phase that implements each one) and exits `0`.
An unknown subcommand exits `1` and, for a close-enough typo, suggests the
nearest known name.

## `audit` — read-only census and diff (Phase 1/2)

```
design-delta audit [--components] [--tokens] [--styles] [--anatomy] [--code-only] [--staged] [--json] [--check]
```

Runs every implemented contract↔code surface. Four independent surfaces:
`--components` (prop/API parity), `--tokens` (token↔CSS-var parity),
`--styles` (contract style bindings vs the stylesheet), `--anatomy` (declared
element tree vs what a component actually renders). Passing none of the four
runs **all of them** — "everything implemented." Passing one or more selects
only those. `--code-only` skips the design side entirely (Phase 5.1) — no
provider load, no snapshot read, no `coverage/design-only`/`coverage/design-
missing`/`side: "design"` finding of any kind, even where one would otherwise
fire.

### The design side (Phase 5.1 coverage + Phase 5.2 prop parity, `--components`; Phase 5.3 value coverage, `--tokens`)

When `design.provider` is configured AND `design-components.json` (written by
`ingest`) exists and validates, the `--components` surface also resolves
every loaded contract's `sources.design` against it: `coverage/design-only`
(a real design-tool component no contract addresses) and `coverage/design-
missing` (a contract's `sources.design` doesn't resolve).

Once a contract's design address **resolves**, its props are compared the
same way the code side already is — the same rule ids
(`components/prop-missing`/`prop-unexpected`/`prop-type-mismatch`/`enum-
values-mismatch`), reported with `side: "design"` instead of `side: "code"`.
A prop's `design` deviation marker governs the comparison the same way `code`
does on the code side, plus one shape `code` has no equivalent for: `design:
{name, reason}` records a genuine rename, and the design-side lookup happens
under that name instead of the contract's own prop key. `components/prop-
default-mismatch` and `components/prop-optionality-mismatch` never fire
design-side — the active provider's normalized props carry neither a default
nor a required/optional fact, so there is nothing to compare.

Independently, when `design-tokens.json` (written by `ingest --tokens`)
exists and validates, the `--tokens` surface compares each design variable
against the code-side token census in two steps (ADR-003 Amendment 4). First
it derives the variable's **candidate** code tokens by name: split on `/`,
fold each segment, match every token whose trailing id segments equal it
(mode heads collapsed), drop any the value's shape rules out (`Font(…)` can
only be `typography`). A single-segment name matches only a token directly
under a root (`none` → `system.none`), never a nested one.
Exactly one candidate asserts identity — the two values are compared and a
difference is `tokens/design-token-mismatch` (`error`).

When both sides are **mode-scoped** and share at least one mode name — code
declares `system/light.*` and `system/dark.*`, the variable carries a value
per mode in `values` — each shared mode is compared against its own code
token and the finding names the mode, instead of one folded value being
accepted whenever any mode agrees (which is how a dark-mode value drifting
alone stayed invisible). A mode present on only one side is
`tokens/design-mode-missing` (`warn`), in both directions. Mode names are
folded for case and separators, so `Light` meets `light` and `High Contrast`
meets `high-contrast`. Sharing a mode name is the gate: a snapshot with no
`values`, an unthemed code token, and a single-mode design collection named
`Mode 1` each share nothing, so the folded comparison runs unchanged and no
mode finding is raised.

A text style against
a `typography` token is compared **field by field** on a canonical form
(family folded; weight as a number, `SemiBold` → 600; size in px; line
height as a ratio; letter spacing in em), and the finding names the field
that differs with both values; a field either side cannot express (a
`lineHeight: AUTO`) is left out, never assumed. More than one is
`tokens/design-token-ambiguous` (`review`), listing them, never guessing.
None is design-only: when the value shows up under another code token,
`tokens/design-token-unmatched` (`review`) names those tokens
(`data.sameValue`); when it shows up nowhere,
`tokens/design-value-untracked`. The other direction is
`tokens/code-token-undesigned` (`review`): a code token no variable maps to
(or might, for an ambiguous one), reported only under a top-level group at
least one variable maps into — a group design never gathered says nothing
about parity. `counts.tokenParity`
(`{ matched, mismatched, ambiguous, designOnly, codeOnly }`) totals the
outcomes; every compared variable lands in exactly one of the first four.
The counts describe the tokens, not the report: a rule turned `"off"` or an
exempted finding still counts toward its outcome. A variable mapped to `null`
in `tokenMap` is outside parity entirely. A `tokenMap` id the code census
lacks (a typo, a renamed token) is `tokens/design-token-map-unknown` (`warn`)
and pairs nothing: a single-id entry counts as design-only, and a per-mode
entry compares only its known ids (#653). A mode-scoped id
(`system/dark.color.fg`) is named with the collapsed id `tokenMap` takes
(`system.color.fg`), and a single-id entry keeps the same-value hint in
`data.sameValue` (#659).

Before the candidate step, top-level `tokenMapping` (#569) applies the
project's naming convention: `aliasFoldingRules` rewrite a variable's name
into a code path (`color/blue-vivid/50` → `color.vividBlue.50`), and a
`collections` entry whose `collection` matches the variable's census
collection names the code root it maps into (`prefix: "base"` tries the exact
token `base.color.vividBlue.50` first) — or, with `prefix: null`, takes that
collection out of the comparison and out of `counts.tokenParity` entirely.
When the exact token does not exist, the candidate step runs on the folded
name.

`design.options` shapes the candidate step per project, validated by the
provider's `configSchema`: `tokenMap` (`"<variable name>": "<token id>"`,
or `null` to declare a variable has no code token) is the answer when
present; `codeAuthoritativeGroups` (`["system.print"]`) drops candidates
under those prefixes — tokens the design tool has no counterpart for by
construction; `codeOnlyGroups` (`["system.layout"]`) keeps
`tokens/code-token-undesigned` quiet under those prefixes; `ignoreVariables` (substrings, or `/regex/`) skips foreign-
library noise entirely; `includePrivateComponents` (`true`) counts the
tool's private components — a name or path segment starting with `.` or
`_`, kept out of the published library by convention — under
`coverage/design-only`, which skips them by default and states how many in
one `design-private-components-excluded` diagnostic (issue #460); `units` (`{ "letterSpacing": "%" }`, by name prefix,
longest match wins) declares the unit a bare-number variable is in — a
design tool's `FLOAT` carries none, and the engine never infers one, so
without a declaration such a variable against an `em` token is incomparable
and stays under coverage; `"ms"`/`"s"` declare a bare number a duration, so
it compares against a `150ms` token instead of coinciding with a `150px` one
(a variable the tool itself types as a duration needs no declaration — the
provider renders it with its unit).
All four default empty; nothing in the engine names a project's tokens.

Only ONE case is silent, not a diagnostic — `design.provider` genuinely unset
(nothing configured, the same "surface skips, it doesn't fail the run"
convention a missing `tokens.json` follows). Every other outcome is "looked
and it was broken," and gets a `design-*` reason on both `skipped` and
`diagnostics`: `design.provider` naming an unknown provider
(`design-provider-invalid`), `design-components.json` existing but failing
its own schema (`design-snapshot-invalid`, `skipped.design`), or `design-
tokens.json` existing but failing its own schema (`design-token-snapshot-
invalid`, `skipped.designTokens`) — the two snapshot files are validated,
and reported, independently of each other.

### `--staged` — audit the change, not the codebase

`--staged` narrows the run to the files `git diff --staged --name-only`
reports, resolved against `process.cwd()` like every other path here. It is
what makes `audit`/`verify` usable in a pre-commit hook on a large codebase.

Only the **code-side censuses** are scoped: the component files, their
stylesheets, and the CSS custom-property scan. Everything a changed file is **compared against** stays whole — the
token census, the component-usage census, and the contracts themselves. A
staged component is still checked against the full token file, so a `var(--x)`
backed by a token nobody restaged is still resolved rather than reported
missing.

Seven rules do not run at all, and say so on the `skipped` channel with the
reason `requires full-codebase visibility, incompatible with --staged`:

| Rule                              | Why a partial scope cannot answer it                                                                                                                |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `coverage/uncontracted-component` | an unstaged contract reads as a component nobody contracted                                                                                         |
| `coverage/contract-only`          | an unstaged component reads as a contract pointing at code that is gone                                                                             |
| `coverage/stale-exemption`        | a waiver whose finding is out of scope reads as a waiver matching nothing                                                                           |
| `tokens/token-unreferenced`       | "no component references this token" is a codebase-wide claim by construction — under a staged scope it fires for nearly every token in the project |
| `tokens/token-unemitted`          | same claim, other half — every unstaged declaration reads as never emitted                                                                          |
| `coverage/design-only`            | a git diff never touches Figma — `designCensus` is never staged-scoped, so an unstaged run would flag every unmatched design component              |
| `coverage/design-missing`         | same reasoning, the other direction — the contract list this compares against the census is never staged-scoped either                              |
| `tokens/design-value-untracked`   | same reasoning again — `designTokenCensus` is a project-wide value census, never staged-scoped                                                      |

`tokens/token-untracked`, `tokens/var-unresolved` and
`tokens/emitted-value-mismatch` are **not** skipped: each is a fact about an
occurrence in a file that was actually scanned, so scoping the scan scopes them
honestly. A `var()` an emitted value points into an unstaged file stays
unresolved, and the comparison stays silent rather than guess.

An empty staged diff is a legitimate, clean, empty scope — every code-side
count is `0`, no findings, exit `0`. A staged list that cannot be READ (not a
git repository, `git` not on `PATH`) is an error and exits `1`: "we could not
establish the scope" is not the same answer as "the scope is empty."

`--since <ref>` is deliberately not implemented, and `lint` deliberately has no
`--staged`: its single surface is the token file, and skipping the whole
command because that file was not in the staged diff would hide real
config-level findings.

### `isNew` — new since the last `snapshot`

If [`state.json`](./state-shape.md) exists at `paths.stateFile`, `audit`
reads it (read-only — see that file's own docs) and tags each finding whose
entity is a contracted component with `isNew: true`/`false`. No prior
snapshot, or a finding outside `state.json`'s scope (tokens, lint,
uncontracted entities), leaves `isNew` off the finding entirely. Full
semantics: [`docs/report-structure.md`](./report-structure.md#isnew--new-since-the-last-snapshot).

**Exit codes:** `0` unless `--check` is given AND an error-severity finding
exists across whichever surfaces ran. `audit` is a read-only report — a
contract that failed to load, or a tokens file that failed to parse, is
surfaced either way but never itself flips the exit code. `1` on a flag error,
an unreadable `--config` target, or an unknown rule id in `rules`/`exemptions`.

**`--json` payload:**

```
{
  command: "audit",
  componentsDir: string,
  tokensFile: string,
  provenance?: {              // present when design.provider is configured (issue #389) — ONE of:
    designComponents?: { gatheredAt?, planHash?, providerVersion?, engineVersion?, files?, normalizationStale? } | null,
    designTokens?:     { gatheredAt?, planHash?, providerVersion?, engineVersion?, files?, normalizationStale? } | null,
                              //   null: that snapshot is absent or invalid; {}: it predates provenance
                              //   normalizationStale: the snapshot was normalized by an engine older than the
                              //   provider's normalizationSince for it (issue #458) — the same text as the
                              //   design-[token-]snapshot-normalization-stale diagnostic; re-ingest to clear
    notConsulted?: string,    // the run never read the design side (--code-only, or a scope without components/tokens)
    unavailable?: string,     // the provider failed to load — the same text as the design-provider-invalid diagnostic
  },
  counts: {
    contracts?: number,       // present when components/styles/anatomy ran
    components?: number,      // present when --components ran
    tokens?: number,          // present when --tokens ran
    cssVars?: number,         // present when --tokens ran
    styleFiles?: number,      // present when --styles ran
    styleDeclarations?: number, // present when --styles ran — total CSS
                               // declarations censused in contracted style
                               // files, the "style bindings" denominator the
                               // health score (issue #219) normalizes against
    anatomyComponents?: number, // present when --anatomy ran
    tokenParity?: {           // present when the design token census ran
      matched: number, mismatched: number, ambiguous: number,
      designOnly: number, codeOnly: number,
    },
    findings: number,
    exempted: number,         // always present, even at 0
  },
  findings: Finding[],        // see docs/report-structure.md
  decided: DecidedFinding[],  // always present; every exempted finding, see
                              // docs/report-structure.md § `decided`
  diagnostics: Diagnostic[],  // deduplicated across surfaces
  skipped?: {                 // present only if something did not run
    components?: string,      // reason (e.g. no `typescript` install)
    tokens?: string,
    anatomy?: string,
    design?: string,          // the design-components.json side
    designTokens?: string,    // the design-tokens.json side
    designAnatomy?: string,   // anatomy's design half: no layer tree, or --staged
    [ruleId: string]: string, // a rule skipped by --staged, keyed by its id
  },
}
```

Each key in `counts` only appears when its surface actually ran, so a
`--tokens`-only run's JSON has no `components`/`styleFiles`/`anatomyComponents`
keys at all — their absence, not a zero, is what "did not run" looks like.

## `lint` — static best-practice checks over the token system (Phase 3)

```
design-delta lint [--json] [--rule <id>]
```

One surface: tokens. Silence is the default and the point — a project with no
`lint.rules`/`lint.tiers`/`lint.vocabularies`/`lint.rampPaths` configured, and
no top-level `rules` entry naming an opt-in rule, gets zero findings, never a
starter opinion. Two rules have no `lint.*` block and turn on only when
`rules` names them at a severity other than `off`: `lint/unknown-dollar-field`
needs nothing else, and `lint/tier-alias-missing` also needs `lint.tiers`.
`--rule` takes **one** id (not repeatable) and filters by the _delegated_ rule
id a consumer sees in a report (e.g. `core/valid-color`), not the engine's own
`lint/token-rule`.

**Exit codes:** `0` normally — `lint` reports, it never gates (that is what
`verify` is for). `1` on a flag error or an unknown rule id in
`rules`/`exemptions`.

**`--json` payload:**

```
{
  findings: Finding[],
  decided: DecidedFinding[],  // every exempted finding with its decision
  counts: { error: number, warn: number, review: number, exempted: number },
  diagnostics: Diagnostic[],
}
```

## `verify` — the composed CI gate (Phase 2)

```
design-delta verify [--json] [--staged] [--fail-on <error|warn|review|none>] [--fail-below <0-100>]
```

One pass/fail gate: every contract validates, AND every contract↔code surface
(reusing `audit` wholesale, so the gate and the report can never disagree
about what was checked) reports no finding at or above `--fail-on`'s
severity. Needs no design tool — no credentials, no network, no provider. A
surface that could not be read (missing tokens file, `typescript` not
installed) is a diagnostic and does **not** fail the run — "we could not
look" is not "we looked and it is wrong." The one exception: an invalid
contract fails outright, since it is the fixed point every other check
compares against, regardless of `--fail-on`.

`--fail-on` picks the threshold severity — that severity and everything worse
than it (worst-first: `error` > `warn` > `review`) fails the gate; anything
milder is reported only. `--fail-on none` relaxes the finding check entirely,
leaving only contract validity gating. Default `error`, matching the gate
before `--fail-on` existed.

`--staged` is handed straight to `audit`, so the gate scopes to the staged
change exactly the way the report does — same scoping, same four skipped
rules, all documented under [`audit`](#--staged--audit-the-change-not-the-codebase)
above. Contract validation is deliberately **not** scoped: a contract that
does not validate is a defect in the fixed point every other check compares
against, staged or not. This is the flag a pre-commit hook wants.

`--fail-below <score>` (issue #219) gates on the run's [health
score](./report-structure.md#health-score) — an integer 0-100 — instead of
(or alongside) severity. It **composes with `--fail-on`, never replaces it**:
either gate can fail the run on its own, and both are always computed and
reported regardless of which one is configured. Omitted by default — a
project that never asks for a score gate never gets one, the same "editing a
config must never silently turn an informational run into a red pipeline"
rule `audit` itself follows.

**Not available under `--staged`.** The score's Token Health denominator and
Consistency pillar are always project-wide, never staged-scoped, so a
staged-scoped score would not measure what `--fail-below` claims — `verify
--staged` reports `healthScore: null` and refuses `--fail-below` outright (an
error, not a silent skip) rather than gate on a number that reads clean
regardless of the actual drift. See
[report-structure.md](./report-structure.md#health-score).

**Exit codes:** `1` if any contract fails to validate, any finding is at or
above `--fail-on`'s severity, OR the health score is below `--fail-below`.
`0` otherwise.

**`--json` payload:**

```
{
  ok: boolean,
  failOn: "error" | "warn" | "review" | "none",
  failBelow: number | null,   // null unless --fail-below was given
  contracts: { ok: boolean, checked: number, diagnostics: Diagnostic[] },
  findings: { counts: {error, warn, review, exempted}, total: number },
  healthScore: number | null,        // 0-100, or null under --staged (see above)
  healthScorePillars: {
    valueDiscipline: number,   // 0-60
    tokenHealth: number,       // 0-20
    consistency: number,       // 0-10
    criticalIssues: number,    // 0-10
  } | null,                    // null under --staged, same as healthScore
  diagnostics: Diagnostic[],  // from the underlying audit — reported, never gating
}
```

## `report` — export findings as artifacts (Phase 3)

```
design-delta report [--format <name,...>] [--out <path>] [--components] [--tokens] [--styles] [--anatomy] [--code-only] [--no-timestamp]
```

Runs the same checks as `audit` (again reused wholesale, never re-composed)
and renders them as one or more artifacts instead of a single terminal report.
`--format` is a comma-separated list; default is `md,terminal`. The scope
flags (`--components`/`--tokens`/`--styles`/`--anatomy`/`--code-only`) pass
straight through to the underlying `audit`.

| Format       | Output                                                                                                                                                                            |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `terminal`   | writes to **stdout** — the same human-readable summary `audit` renders (severity → rule → entity, worst first)                                                                    |
| `md`         | writes `drift-report.md` under `paths.reportDir` (or `--out`) — see [`docs/report-structure.md`](./report-structure.md) for its structure                                         |
| `sarif`      | writes `drift-report.sarif` under `paths.reportDir` (or `--out`) — a SARIF 2.1.0 log for GitHub code-scanning ingestion, see [`docs/report-structure.md`](./report-structure.md)  |
| `pr-comment` | writes `drift-report-pr-comment.md` under `paths.reportDir` (or `--out`) — a compact block sized for a single PR comment, see [`docs/report-structure.md`](./report-structure.md) |

`terminal`, `md`, and `pr-comment` each render a `Health score: N/100 (…)`
line ([issue #219](./report-structure.md#health-score)) — the same score
`verify --fail-below` gates on, computed once and shared by both commands.
`sarif` does not carry it (SARIF is finding-oriented; an aggregate score has
no field to render there). `report` has no `--json` flag of its own (below),
so this is where the score shows up for `report` — run `verify --json` for
the machine-readable number.

**Not rendered when a scope flag narrows the run** (`--components`/`--tokens`/
`--styles`/`--anatomy`) — a pillar whose surface never ran would otherwise
read its own missing census as "nothing to grade" and score full marks,
inflating the total. Only an unscoped `report` computes one; see
[report-structure.md](./report-structure.md#health-score).

`--no-timestamp` omits the "generated at" line, for byte-comparison in CI.
Which artifacts were written is reported on **stderr** (`wrote <path>`), never
stdout — stdout stays exactly the rendered `terminal` output for anything
piping it.

**Exit codes:** `0` normally. `1` on an unknown `--format` name, a flag error,
or a failure writing an artifact to disk.

No `--json` flag — `report`'s whole purpose is human/artifact output; run
`audit --json` directly for the machine-readable payload.

## `contracts` — validate every contract (Phase 1)

```
design-delta contracts [--json] [--dir <path>]
```

Schema- and semantically-validates every contract under `paths.contractsDir`
(or `--dir`, which overrides only that one path for this run). Reads and
reports — never writes a contract, never reaches a design tool or the network.

**Exit codes:** `0` when every contract is valid, including the vacuous case
of none authored yet. `1` when any contract produced a diagnostic. Never `2` —
that code is reserved for "not implemented yet."

**`--json` payload:**

```
{
  command: "contracts",
  ok: boolean,
  contractsDir: string,
  counts: { files: number, valid: number, invalid: number, diagnostics: number },
  contracts: [{ id: string, file: string, valid: boolean }],
  diagnostics: Diagnostic[],
}
```

## `scaffold` — draft a contract from the props census (Phase 6)

```
design-delta scaffold <Component> [--json] [--config <path>]
design-delta scaffold --uncontracted [--json] [--config <path>]
```

Drafts a `*.contract.json` from a component's props census, rather than
requiring hand-authoring from scratch. `<Component>` is the PascalCase
exported name (`SampleButton`); it must match a `.tsx` file's basename,
kebab-cased, under the configured `componentsDir` (`SampleButton` →
`sample-button.tsx`) — the same convention this repo's own contract fixtures
use.

`--uncontracted` drafts a contract for **every** code component with no
contract in one pass, instead of hand-driving one invocation per component.
The worklist is the same census `coverage/uncontracted-component` uses: every
confirmed component plus every confirmed-but-unreadable-props file, minus
whatever `sources.code.path` an already-loaded contract claims — so an
existing contract is never overwritten. A per-component refusal (props
unreadable, or an output path an existing file already occupies) skips only
that component, with its reason on stderr, and never aborts the pass; the
title used for a scaffolded component is the component's own real exported
name when the census could resolve one, falling back to a guess inferred from
its file's basename — the same way `<Component>` matching works in reverse —
only when it could not, so a filename that loses information (`APIButton`
from `apibutton.tsx`) still drafts the correct `"title": "APIButton"`.
`--uncontracted` and
`<Component>` are mutually exclusive: a positional name alongside the flag is
a flag error, not a filter.

Scope is **props, anatomy, and styles** — `id`, `title`, `sources.code.path`,
`props`, (issue #235) `anatomy` drafted from the same file's structural
census (`sources/react/jsx.mjs`), and (issue #236) `styles` drafted from the
component's own style census (`sources/styles.mjs`). `sources.design` and
`codegen` are omitted entirely, not placeholdered: `codegen`'s own
model-builder already substitutes a placeholder when `sources.design` is
absent.

Refuses (clear error, no partial file written) rather than emitting an empty
shell when: no file matches `<Component>`, more than one file matches
(ambiguous — never guesses which), the component's props could not be read
(no TypeScript install, or a confirmed component whose props extraction
failed), or a contract already exists at the target path (never overwrites).
Anatomy is never a refusal reason — a component whose render shape the
structural census declines to resolve (a `.map()`, a conditional root, a
fragment, …) still gets a props-only contract; `anatomy` is simply omitted
for it, the same "omit, don't guess" rule `sources.design`/`codegen` already
follow.

The one decline that still drafts an `anatomy` is **divergent roots** — a
component returning DIFFERENT root elements on different branches (`<a>` when
`href` is set, a `<button>` otherwise). No single tree describes it, but the
adapter carries every candidate tree (ADR-002 D5), so omitting would discard
what the census read rather than refuse to guess. The first branch becomes the
base `anatomy` and each further one a `$variants` entry (ADR-002 D1/D2)
holding **only the nodes that differ from the base** (D3, partial override) —
a node the base already describes identically is inherited, never repeated:

```json
"anatomy": {
  "root": { "type": "container", "element": "a", "content": { "$prop": "label" } },
  "$variants": {
    "asButton": {
      "when": "TODO: say when this branch renders",
      "_scaffold": { "todo": "`when` is documentation for a human reader, …" },
      "root": { "type": "container", "element": "button", "content": { "$prop": "label" } }
    }
  }
}
```

Each variant is named from its own root element (`asButton`, `asLink`). `when`
is drafted as a **placeholder, never an invented condition**: it is
documentation the engine cannot check (ADR-002 D4), so it carries the same
`_scaffold: {todo: "…"}` marker every other unresolved value gets. Two
variants declaring the same root element, or a variant declaring the base's,
are `ambiguous-variant-root` at load time, so a branch whose root the base or
another variant already claims is **reported in a `_scaffold` note rather
than drafted** — a scaffolded contract always loads.

When the census resolves only **partially** — the component renders more
than one branch sharing a root, and the branches disagree at some position —
the drafted `anatomy` still covers everything the branches agree on. Each
disagreeing position still gets a node (never silently dropped), with no
`element`/`content` guessed for it and a `_scaffold: {todo: "…"}` note
explaining why, so a human author can grep for `_scaffold` and know exactly
what still needs review. A nested custom component also carries this same
`_scaffold` marker, drafted as `type: "instance"` since scaffold cannot
confirm which contract it should point at.

`styles` (issue #236) drafts once `anatomy` exists — `styles` keys must name
a declared `anatomy` element (schema-enforced), so with no anatomy there is
nothing to key a `styles` block off. It reads the component's style file at
`<component-basename><conventions.stylesSuffix>` (the co-location convention
this repo's own fixtures use), maps each anatomy element to a selector with
the SAME rule `styles/element-unmapped` enforces (`modules/styles.mjs`'s
`locateElementSelector`/`locateVariantSelector`), and drafts each mapped
element's `base` and, per declared `enum` prop value, `variants`. An element
the census cannot confidently map to a selector is simply left out of
`styles` — never a `_scaffold` placeholder, matching the review-tier
`styles/element-unmapped` note the audit path itself would emit for it. A
plain CSS literal drafts as the schema's `raw(...)` escape hatch. A `var(--x)`
reference resolves to a token binding (`{token: "<id>"}`, issue #261) when its
name matches **exactly one** token in the project's own `tokens.json`
census — the same var-name hypothesis `tokens/token-untracked` already runs,
so a scaffolded binding can never disagree with that check. A var matching
**zero or 2+** tokens is left for a human via `_scaffold: {todo: "…"}`
instead, naming every match for the 2+ case rather than guessing among them
(several tokens can legitimately share one CSS var — issue #191). Absent
`conventions.stylesSuffix`, no style file on disk, no `tokens.json`, or no
anatomy element mapping to a selector all mean `styles`/a token binding is
simply omitted, never a refusal reason — same as `anatomy`.

**Exit codes:** `0` on a successful scaffold — for `--uncontracted`, on a
completed pass, including one that drafted nothing because no component was
uncontracted. `1` on any refusal above, a flag/config error (a positional
`<Component>` alongside `--uncontracted` included), or a components census
that could not run at all (e.g. no TypeScript install).

**`--json` payload:** without `--uncontracted`, a single record; with it, an
array of the same per-component record (empty when nothing was uncontracted):

```
{
  command: "scaffold",
  id: string,
  title: string,
  file: string,
  output: string,
  propCount: number,
  anatomyNodeCount: number,
  anatomyVariantCount: number,
  anatomyPartial: boolean,
  stylesFile: string|undefined,
  styleElementCount: number,
  styleUnmappedCount: number,
  styleTokenBindingCount: number,
}
```

## `init` — interactive setup wizard (Phase 4)

```
design-delta init [--yes]
```

Writes `design-delta.json`. Detects real values from the filesystem
(`paths.tokensFile`, `paths.componentsDir`, `paths.contractsDir`,
`conventions.cssVarPrefix`) and presents each as a confirmable prompt default
— never asserts a value unconfirmed. `paths.tokensFile` may be a single DTCG
file or a directory of them; detection proposes a directory only when no
single-file candidate matches. Also prompts for `design.provider`,
offering every provider `src/providers/index.mjs` can resolve plus an
explicit "None" choice; picking "None" writes no `design` block (and clears
an existing `design.provider` if the config already had one). `design.options`
is never prompted for or written — its shape is provider-specific and out of
scope here (issue #280). `--yes` accepts every detected/existing value
without asking (CI scaffolding, not a way to skip the decisions silently); an
existing `design.provider` is kept as-is rather than being overwritten.
Re-running against an existing config reads it first and merges in only the
fields above — everything else a prior run or hand-edit added (e.g. `lint`,
`rules`, `report`) survives untouched.

Also writes `.claude/skills/design-delta/SKILL.md` — a generated stub that
links to this package's canonical skill (`skills/design-delta/SKILL.md`,
read from the installed `node_modules/design-delta`) since
Claude Code never discovers a skill inside `node_modules` itself. This is
`dock`'s third template (below), written through the same writer `dock` uses
— one scaffold path, not two — so it carries no engine prose of its own and
is safe to regenerate on every `init`/`dock` run. If a file already exists
at that path and was not generated by design-delta, it is left untouched and
reported as `skipped` — see `dock` below.

Interactive — no `--json`. **Exit codes:** `0` on success, `1` on an error
(e.g. an existing config that can't be read, or a write failure).

## `dock` — scaffold a Claude Code hook + skills (Phase 6)

```
design-delta dock [--dir <path>] [--json]
```

Writes three generic templates under `--dir` (default `.claude`, resolved
against the current working directory): a `hooks/design-delta-verify.mjs`
PostToolUse hook that shells out to `design-delta verify --json` and turns a
failing gate into stderr feedback + a non-zero exit, a
`skills/design-delta-verify/SKILL.md` skill telling an agent to run
`verify`/`lint --json` and fix what they report before calling a change done,
and a `skills/design-delta/SKILL.md` stub (issue #336) that links to this
package's own canonical skill instead of restating it. The generated hook is
not wired into `.claude/settings.json` automatically — its own top-of-file
comment documents the exact `PostToolUse` entry to add. `init` (above) writes
the linked stub too, through this same template and writer.

Nothing in any template names a project, a path, or a convention outside
what `design-delta verify`/`lint` themselves already read from the consumer's
own config — the artifacts are generic by construction, not by omission.

Overwrites the hook and `skills/design-delta-verify/SKILL.md`: both are
generated templates at names this package chose for itself, with no user
content to preserve, so re-running `dock` after an engine upgrade picks up
template changes.

**`skills/design-delta/SKILL.md` is the exception** — that is a name a
project may already use for its own hand-maintained skill, which this
package does not own. Its generated form carries the line ``Generated by
`design-delta init`/`dock` ``, and `dock`/`init` write it only when the
existing file carries that marker (or does not exist yet). Anything else is
left byte-for-byte untouched and reported with the action `skipped` — `SKIP`
in the human output. To hand a generated stub back to your own maintenance,
delete the marker line; to replace your own file with the generated stub,
move yours aside and re-run.

**Exit codes:** `0` unless a flag error or an unwritable `--dir` occurs (`1`).

**`--json` payload:**

```
{
  command: "dock",
  dir: string,               // the --dir value (or default), as given
  files: [
    { path: string, action: "wrote" | "up-to-date" | "skipped" },
    ...
  ],
}
```

`"skipped"` only ever appears for `skills/design-delta/SKILL.md`, and means
a consumer-owned file was found there and left alone (see above).

## `snapshot` — write state.json with per-entity code/spec hashes (Phase 6)

```
design-delta snapshot [--json]
```

Writes `state.json` at `paths.stateFile` (default
`.agents/design-delta/state.json`): one entity per contracted, readable
component, `component:<id>`, each carrying a deterministic `codeHash` (from
the live props census) and `specHash` (from the contract body). See
[`docs/state-shape.md`](./state-shape.md) for the full schema.

The **only** command that writes state — `audit`/`verify` read it (never
write it) to tag findings `isNew`, see `audit`'s own section above and
[`docs/report-structure.md`](./report-structure.md#isnew--new-since-the-last-snapshot).
`lint`/`report` are unaffected by its existence either way. Scope is
components only for now; a token's own DTCG entry already is both its code
and its spec, so it doesn't split into a code/spec hash pair the same way a
component does.

An orphan contract (no `sources.code.path`) or an unreadable component is
skipped with a stated reason — the same "surface skips, it doesn't fail the
run" convention `audit` already follows.

**Exit codes:** `0` unless a flag or config error occurs (`1`).

**`--json` payload:**

```
{
  command: "snapshot",
  output: string,             // paths.stateFile, as written
  counts: { entities: number, skipped: number },
  skipped: [{ id: string, reason: string }],
}
```

## `movers` — entities changed since the last `snapshot` (Phase 6)

```
design-delta movers [--json]
```

A read-only derived query over `state.json` (ADR-001 D6): recomputes each
contracted component's live `codeHash`/`specHash` the same way `snapshot`
does and lists every entity where a recomputed hash disagrees with what the
prior `snapshot` run recorded. Never writes `state.json` — that stays
`snapshot`'s alone.

No `state.json` present (no prior `snapshot` run) is not an error: it prints
"no prior run recorded, nothing to compare" and exits `0`.

Scope matches `snapshot`: components only, compared against whatever a prior
run recorded there — an entity `snapshot` skipped or that didn't exist yet
isn't "changed," so it isn't listed. `designHash` comparison arrives with the
Phase 5 design provider.

**Exit codes:** `0` unless a flag, config, or `state.json` parse error occurs
(`1`).

**`--json` payload:**

```
{
  command: "movers",
  moved: [{ kind: string, id: string, reason: string }],
  sinceRun: string | null,   // prior state.json's `lastRun`, null if none
}
```

## `impact` — blast-radius query (Phase 6)

```
design-delta impact <entity> [--json]
```

A read-only query — never writes anything — answering "what references this,
before I change it": every file that imports/uses a component, or every place
a token is referenced. Both branches reuse an existing census rather than
recomputing "what references this" a second way: the component branch is
`sources/code.mjs`'s `censusComponentUsage` (issue #223); the token branch is
the token census plus the same candidate-custom-property-name hypothesis
`tokens/token-unreferenced` already computes (see
[`docs/rules.md`](./rules.md)).

`<entity>`'s KIND is decided by its shape, not a flag: a dotted id
(`color.bg.primary`) is a token; a bare PascalCase name with no dot
(`SampleButton`) is a component — the same `<Component>` convention
`scaffold` already established. An entity that is neither is a flag error,
not a guess.

For a component, `<Component>` resolves exactly like `scaffold <Component>`
does: the PascalCase name must match one `.tsx` file's basename, kebab-cased,
under the configured `componentsDir`. No match, or more than one match
(ambiguous — never guesses which), is an error. Resolution needs no
contract — it reads the componentsDir file tree directly, the same scope
`censusComponentUsage` itself scans, so `impact` works even for a component
nobody has contracted yet.

For a token, `<token.id>` must be an id the token census actually has (a
DTCG dot path, e.g. `color.bg.primary`) — an id absent from
`paths.tokensFile` is an error. `usedBy` covers `var(--x)` REFERENCES only
(never declarations) across every custom-property name the token hypothesizes
— the same one-token-can-emit-many-vars handling a DTCG composite (`shadow`,
`typography`, …) needs, see [`docs/rules.md`](./rules.md)'s
`tokens/token-unreferenced` entry. A token with nothing referencing any of
its candidate vars reports an empty `usedBy`, not an error — the same
"observed absence, not asserted absence" caveat that rule's own severity
carries (the scan only covers `componentsDir`/`styleRoots`).

**Exit codes:** `0` unless a flag/config error, an entity matching neither
kind, no matching component file (or more than one), or no token with the
given id occurs (`1`).

**`--json` payload:**

```
{
  command: "impact",
  entity: string,
  kind: "component" | "token",
  file?: string,        // component only: the matched componentsDir-relative file
  vars?: string[],       // token only: the candidate var name(s) actually referenced
  usedBy: [{ file: string, line: number }],
}
```

## `map` — system-wide ownership overview (Phase 6)

```
design-delta map [--json]
```

A read-only query — never writes anything — reporting, across the whole
scanned tree, who owns what: how much of the codebase is contract-driven
(D1: a component IS owned iff it has a contract) versus unmanaged surface.
design-delta's framing is contract-driven rather than convention-based.

No new census and no new rule: `map` reuses `audit`'s own `--components
--tokens` surfaces wholesale (the same reason `verify`/`report` reuse `audit`
rather than re-composing its checks — a second assembly would drift from the
first the moment a rule changes). `components.contracted` is never counted
directly; it's every loaded contract minus the ones `coverage/contract-only`
already found homeless and minus the ones with no `sources.code.path` at all
(`components.draft`, below), so it can never disagree with that rule about
who counts as contract-only. `tokens.unreferenced` is the set of distinct token
ids named across every `tokens/token-unreferenced` and `tokens/token-unemitted`
finding's `data.tokens` — both rules group multiple token ids under one finding when they share a
candidate CSS var, so this counts ids, not findings.

**Neither count is a confirmed fact — read the caveats before trusting a
number:**

- **`components`/`tokens` are `null`, not a confidently-wrong count, when
  `audit` skipped that surface** (no `typescript` installed, an unparseable
  `tokens.json`) — the same "a skipped surface is not everything" rule
  [`report-structure.md`](./report-structure.md) already applies. Check
  `skipped` (below) before reading either as zero unmanaged surface.
- **`exempted`** is `audit`'s own `counts.exempted`, surfaced because an
  exempted `coverage/contract-only`/`tokens/token-unreferenced` finding is
  invisible to `map` entirely — `contracted`/`referenced` can silently
  include an exempted entity; `audit --json`'s `decided` names which
  ones. The same hazard applies if a project turns
  `coverage/contract-only`, `tokens/token-unreferenced` or
  `tokens/token-unemitted` `"off"` entirely in `rules` — the finding never exists to begin with, and `contracted`/
  `referenced` read exactly like a genuinely clean project either way.
- **`tokens.referenced` means "not flagged unreferenced," not "confirmed
  referenced."** A token scoped out by `tokens/token-unreferenced`'s own
  `ignorePrefixes` or `ignoreSources` option (both scope
  `tokens/token-unemitted` too), or
  under a rule turned `"off"`, is never evaluated
  at all and reads as referenced here — `map` has no signal distinguishing
  "confirmed" from "never checked."
- **`components.draft`** lists every contract with no `sources.code.path` at
  all — an aspirational contract with nothing yet to compare against
  (`modules/components.mjs`'s own term). Neither
  `coverage/uncontracted-component` nor `coverage/contract-only` ever fires
  for one, so `map` loads contracts directly to give it its own bucket
  rather than silently folding it into `contracted`.

**Exit codes:** `0` unless a flag/config error occurs, or the inner audit
produces no readable result (`1`) — a skipped surface does not fail the
command, matching every other skip in this engine (diagnostics report, they
never gate).

**`--json` payload:**

```
{
  command: "map",
  components: {
    contracted: number,
    uncontracted: string[],   // same set coverage/uncontracted-component finds
    contractOnly: string[],   // same set coverage/contract-only finds
    draft: string[],          // contracts with no sources.code.path at all
  } | null,                   // null when audit skipped the components surface
  tokens: { total: number, referenced: number, unreferenced: number } | null,
                               // null when audit skipped the tokens surface
  exempted: number,           // audit's counts.exempted — see caveats above
  skipped?: { components?: string, tokens?: string },  // present only if non-empty
}
```

## `query` — read-only inventory questions (Phase 6)

```
design-delta query <subject> [--json]
```

A read-only query — never writes anything — answering a question ABOUT the
project rather than reporting drift IN it. It registers no rule, produces no
findings, reads no `rules`/`exemptions` severity, and nothing gates on it;
[`docs/rules.md`](./rules.md) is deliberately silent about it.

One subject today, `raw-values`. `query` is already the namespace a second
one would land in, but the general framing is not built ahead of a second
real caller.

### `query raw-values`

Lists every literal CSS declaration in the project's stylesheets, and says
for each whether any token carries that exact value.

Scans every file under the configured `paths.componentsDir` and
`paths.styleRoots` whose name ends in `conventions.stylesSuffix` — the same
config-driven scan `censusCssVars` uses, and the same one the removed
`styles/raw-value-uncontracted` rule used to run. An unconfigured
`stylesSuffix` means nothing to scan, which is an empty listing, not an error.

A `var(--x)` reference is not a literal and never appears. `matchesToken` is
an EXACT match against the token's CSS-OUTPUT value (`cssValue`), never a
fuzzy or nearest-token distance: a token whose authored `$value` is
`#111111` may census as `#111`, and a composite type that expands to multiple
CSS properties (`typography`, occasionally `shadow`/`border`) has no single
`cssValue` at all and so can never match one declaration.

**This is an inventory, not a check.** "Use tokens, not literals" belongs in
the project's own stylelint config, where it fires at edit time — an
uncontracted literal is a fact about a stylesheet, not a disagreement between
a contract and one of its sides, which is why the rule form of this scan was
removed (issue #490). Use this when you want to ask what is there.

A style file the scan finds but the census cannot read (missing, unreadable)
is reported as a `diagnostic` beside the listing, never dropped silently — it
is already absent from `files`, so staying quiet would put an undercount
forward as a complete answer. It does not change the exit code: the answer
still stands for every other file.

**Exit codes:** `0` for an answer, however many literals it contains — an
inventory has no failing size, and a diagnostic about one unreadable file is
still an answer. `1` only when the command cannot answer at all: a flag
error, an unknown or missing subject, an unreadable config, or a failed token
census (reporting every literal as unmatched because the tokens never loaded
would be a dishonest answer, not an empty one).

**`--json` payload:**

```
{
  command: "query",
  subject: "raw-values",
  files: number,            // style files actually censused
  literals: [{
    file: string,           // project-relative, POSIX separators
    selector: string,
    property: string,
    value: string,
    matchesToken: boolean,  // exact match against some token's cssValue
  }],
  diagnostics?: [{ code: string, file: string, message: string }],
                            // omitted entirely when there are none
}
```

## `gather` — print the plan an agent needs to census the design side (Phase 5.1 components + Phase 5.3 tokens)

```
design-delta gather [--tokens] [--bindings] [--config <path>]
```

The engine is a deterministic Node CLI with no agent inside it, so `gather`
never calls a design tool itself — it decides WHAT to gather and prints that
as one JSON document: which MCP tool to run, with which arguments, for which
targets, and where to write each raw response. An agent reads the plan, runs
it, and writes each raw response verbatim; `ingest` is what turns those raw
files into the normalized snapshot `audit`/`verify` read.

No `--tokens`: the COMPONENT plan — one target per addressed contract's FILE
KEY, since the component-listing tool has a bulk per-file form. `--tokens`:
the TOKEN plan instead — TWO targets per addressed file key, both Desktop
Bridge tools that read the file the agent has open: `figma_get_variables`
(every local variable, with its type, typed value per mode, alias target and
collection) and `figma_get_text_styles` (every local text style, with
unit-bearing line height and letter spacing). Structured, file-level, any
plan tier (issue #380). The two plans are separate (different tools,
different output files), run as two separate agent passes, matching how
`ingest`/`ingest --tokens` write to two distinct snapshot files.

Scope is the union of every loaded contract's `sources.design` — never a
config list, so an address no contract references is never gathered, and one
it does is never missed. A contract with no `sources.design`, or one whose
shape the active provider doesn't recognize, contributes nothing to either
plan.

**Exit codes:** `0` once a plan is printed — including the vacuous
`targets: []` plan when no contract resolves an address, a legitimate
project state, not a failure; `1` when `design.provider` is unset or names an
unknown provider.

**stdout payload** (always JSON — there is no human-formatted variant, since
the plan's one consumer is an agent):

```
// no --tokens
{
  provider: string,
  tool: string,               // the MCP tool the agent should call
  targets: [{
    fileKey: string,
    args: object,             // arguments to pass the tool, per target
    outputPath: string,       // where the agent should write the raw response
  }],
  planHash: string,
}

// --tokens
{
  provider: string,
  tool: string,               // the variables tool; each target names its own
  targets: [{
    fileKey: string,
    tool: string,             // figma_get_variables | figma_get_text_styles
    args: object,
    outputPath: string,
  }],
  planHash: string,
}
```

`--bindings` (issue #401, retargeted by #417) prints a third plan: **one
target per addressed FILE**, each naming the provider's in-plugin execution
tool and carrying that file's node ids. `ingest --bindings` merges each node's
result onto the matching `design-components.json` entry as `usedVars`, which
is what `styles/design-binding-missing` compares against. A `COMPONENT_SET`'s
result also carries its variant children, so the merge adds
`variantCombinations` — which combinations the set actually publishes, what
`components/variant-combinations-mismatch` compares against (issue #403).
Like the other plans, `gather` only prints it; an agent executes.

**What the agent does, per target:** open the target's `fileUrl`, run the
named tool once with the target's `args.code`, and write the result verbatim
to `outputPath`. One call per file, not per node.

**What the script returns** — an object keyed by node id, each value
`{name, type, nodes, layers, usedVars, unresolved}`, plus `variantChildren`
for a `COMPONENT_SET`:

- `usedVars` — the variable names the node's tree binds, resolved **inside**
  the design tool, one lookup per bound id.
- `unresolved` — the bound ids that would not resolve. Reported rather than
  passed off as names, so an unresolvable gather is visibly empty instead of
  quietly wrong; `ingest` rejects an opaque id reaching `usedVars` anyway.
- `nodes` — how many nodes the walk visited, the walk's own sanity check.
- `layers` (issue #462) — the SHAPE of that same walk: each node's `name`,
  `type` and `children`. `ingest --bindings` merges it as the entry's
  `layers`, which the design side of the anatomy surface (issue #402)
  compares a contract's declared anatomy against. An **instance's** children
  are not returned — its subtree is another component's contract to answer
  for, and the census records it as `childrenResolved: false` — though the
  walk still descends into one for `usedVars`, since what a component binds
  includes what its instances bind. A result from before #462 carries no
  `layers`, and the entry keeps whatever an earlier gather recorded rather
  than reading as "carries no layers".
- A node the script cannot find carries `{error}` instead, and `ingest` skips
  it with that reason rather than merging an empty answer.

**Hidden nodes are walked on purpose.** A hidden node is a prop-toggled
(`presentIf`) part of the component, and its bindings are real; a census that
skipped them would under-report. Measured live 2026-09-08: two of one
component's nine bindings sit on hidden nodes.

**Why in-plugin resolution** (issue #417): the deep-component tool this plan
named first returns `boundVariables` as opaque ids whenever the bound
variables are **library** imports — every real consumer's shape. Measured
live twice, it resolved zero names on both sampled components, where the
in-plugin walk resolved 9/9 and 13/13 with nothing unresolved. Envelopes from
the old per-node tool still ingest: `ingest --bindings` tells the two apart by
whether the envelope addresses a single node or a whole file.

## `ingest <raw-file...>` — normalize an agent's raw gather output (Phase 5.1 components + Phase 5.3 tokens)

```
design-delta ingest <raw-file...> [--tokens] [--bindings] [--config <path>] [--json]
```

Validates, normalizes, and hashes an agent's raw gather output, then writes a
design-side snapshot `audit`/`verify` read. This is the ONE place hashing
happens for the design side (ADR-001 D6) — the agent that ran `gather`'s plan
wrote each raw response verbatim and computed nothing, so the normalizer here
is the sole source of every hash.

Each `<raw-file>` is one envelope a `gather` plan named as an output path,
read relative to the working directory (a token envelope carries the `tool`
that produced it — `figma_get_variables` or `figma_get_text_styles` — or,
from a gather before issue #380, a `nodeId` and a flat `get_variable_defs`
map, which still ingests). A raw file that
doesn't parse as JSON, or doesn't match the expected envelope shape, is
SKIPPED with a stated reason — one bad file never blocks ingesting the rest.

No `--tokens`: every surviving file's components are combined, sorted by
file key then node ID (so the same set of raw files always writes the same
bytes regardless of argument order), and written to `design-components.json`.
`--tokens`: handed to the token census instead, DEDUPLICATED by name (raw
file paths are sorted before processing, so which file "wins" a name
collision is independent of argument order), sorted by name, and written to
`design-tokens.json` — a separate file, since D7 fixes two independent
design-side snapshots. Both snapshots carry `provenance` (issue #389) —
the newest `gatheredAt` across the ingested envelopes, and `planHash` /
`providerVersion` when every envelope agrees — taken from the envelopes,
never from the clock, so `report` can state the design side's basis. Since
0.19.0 it also carries `engineVersion`, this package's own version (issue
#458): normalization happens here, at ingest, so a committed snapshot's
values are only as current as the engine that wrote them. When a provider's
normalization changes what a stored value looks like (0.18.1 began
rendering a duration variable as `<n>s`), `audit` compares the two and
reports a `design-token-snapshot-normalization-stale` (or
`design-snapshot-normalization-stale`) diagnostic naming both versions —
the fix is always the same: re-run `gather` and `ingest` for that pass. A
snapshot with no `engineVersion` (nothing before 0.19.0 stamped one) is
judged by its stored values through the provider's own `staleShape`, and a
provider that cannot tell stays silent rather than call a fresh census stale.
Every record keeps a comparable string `value`; a
structured gather adds `kind` (`variable` | `textStyle`), `resolvedType`,
typed `values` per mode name, `collection`, `aliasOf`, and for a text style
`style` with its unit-bearing fields — additive, so a snapshot written before
issue #380 still reads. Either way the assembled snapshot is schema-validated
before a single byte is written.

### A partial gather never drops another pass's fields (issue #418)

`gather` has three passes and they share one pair of snapshots, so running
only some of them — the normal case when a session can reach some of the
provider's tools but not all of them — must not silently take the missing
passes' fields with it. `usedVars` and `variantCombinations` are the only
fields owned by a pass other than the one that assembles the file they live
in: `ingest --bindings` writes both, and both live on a
`design-components.json` entry. Raw envelopes are
gitignored, so a field dropped this way is unrecoverable from the repo.

| Partial gather      | What `ingest` does                                                                                                                                                                                                                        |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **components** only | CARRIES the bindings pass's fields forward from the previous `design-components.json`, matched by the same `fileKey`/`nodeId` address the bindings merge used — never overwrites them with nothing. Reported as `bindingsCarriedForward`. |
| **bindings** only   | Merges as always when a census exists. With no `design-components.json` to merge onto, FAILS (`1`) naming the components pass, and writes nothing — the run stops rather than half-producing a census.                                    |
| **tokens** only     | Nothing to preserve: `design-tokens.json` shares no field with either other pass, and `design-components.json` is left untouched.                                                                                                         |

A previous bindings-pass record whose address is **not** in the new census is
counted as `bindingsDropped` and named in `skipped` — that component is gone
from the census, so there is nothing to carry it onto. This reports rather
than fails on purpose: a component legitimately deleted from the design file
would otherwise wedge every later `ingest` behind an error no re-gather could
clear. Re-run `gather --bindings` + `ingest --bindings` if those components
do still exist.

**Exit codes:** `0` once the snapshot is written (even when every raw file
was skipped and the census is empty — a legitimate state to report, not a
failure); `1` when no raw files were given, when `design.provider` is unset
or unknown, when `--bindings` has no `design-components.json` to merge onto,
or when the assembled snapshot fails its own schema.

**`--json` payload:**

```
// no --tokens / --bindings
{
  command: "ingest",
  snapshotPath: string,          // design-components.json
  counts: {
    components: number,
    filesIngested: number,
    bindingsCarriedForward: number,  // bindings fields kept from the previous census
    bindingsDropped: number,         // previous bindings records matching no entry
    skipped: number,
  },
  skipped: [{ file: string, reason: string }],
}

// --tokens
{
  command: "ingest",
  snapshotPath: string,          // design-tokens.json
  counts: { tokens: number, filesIngested: number, skipped: number },
  skipped: [{ file: string, reason: string }],
}

// --bindings (no bindings* counts — this IS the pass that owns those fields)
{
  command: "ingest",
  snapshotPath: string,          // design-components.json
  counts: { components: number, filesIngested: number, skipped: number },
  skipped: [{ file: string, reason: string }],
}
```

## `mcp` — serve contracts and tokens to a coding agent (Phase 7)

```
design-delta mcp [--config <path>]
```

A read-only [MCP](https://modelcontextprotocol.io) server over stdio: an
agent that connects gets the project's contracts and tokens in a form it can
reason over, from the same loaders `audit` and `contracts` use. A subcommand,
not a second bin — D8 collapsed eleven bins into one on purpose. Local and
development use only, by decision: no auth, no network, no hosting story.

Point an agent's MCP config at the project root:

```json
{
  "mcpServers": {
    "design-delta": { "command": "npx", "args": ["design-delta", "mcp"] }
  }
}
```

**Read-only by construction.** Eleven tools, none of which writes; the module
imports nothing that can. Every call re-reads the project from disk, so there
is no snapshot to go stale and nothing the server says can drift from what
`audit` would report.

| tool               | input                                       | returns                                                                                                                                                                                                                                   |
| ------------------ | ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `list_components`  | —                                           | every contracted component: id, title, description, status, `intent`, prop names                                                                                                                                                          |
| `get_contract`     | `{ id }`                                    | the full contract, or `nothingFits: true` with the known ids — never a near match                                                                                                                                                         |
| `find_component`   | `{ description }`                           | components ranked by deterministic word overlap over id/title/description/intent; `nothingFits: true` with a reason                                                                                                                       |
| `list_tokens`      | `{ prefix? }`                               | tokens under an id prefix: id, `$type`, resolved CSS value, alias target                                                                                                                                                                  |
| `find_token`       | `{ use }`                                   | tokens ranked by word overlap over their ids; `nothingFits: true` with a reason                                                                                                                                                           |
| `get_coverage`     | `{ missing? }`                              | coverage counts plus one row per component — contract, draft, design source, binding file (`present`/`missing`/`stale`/`compare-unreliable`/`not-applicable`); `missing` is `contract`, `binding-file` or `design-source`                 |
| `get_findings`     | `{ entity?, ruleId?, severity?, surface? }` | the findings `audit --json` and `lint --json` report, filtered by exact match, plus matching exempted findings under `decided`; an unknown rule id, severity or surface is an error (with `knownRuleIds` for a rule), never an empty list |
| `get_impact`       | `{ entity }`                                | `impact --json`: every file and line referencing a component (PascalCase) or token (dotted id)                                                                                                                                            |
| `get_movers`       | —                                           | `movers --json`: contracted components whose hashes changed since the last `snapshot`                                                                                                                                                     |
| `query_raw_values` | —                                           | `query raw-values --json`: every literal CSS declaration, and whether a token carries that exact value                                                                                                                                    |
| `list_rules`       | `{ surface? }`                              | every rule: id, surface, description, default severity, and the severity this project's config resolves                                                                                                                                   |

**Coverage is `map`'s answer, not a second one.** `get_coverage` runs the
same `audit` `map` runs and reads its findings (`coverage/*`,
`components/binding-file-*`), so its counts cannot disagree with `map --json`
or `audit --json`. A count whose check did not run is `null`, never `0`:
binding-file counts need a design provider that knows binding files and a
configured `conventions.codeConnectSuffix`, and the
design counts also need `design-components.json` (`provenance.designComponents`
says when it was absent or invalid). A binding file is only expected for a
contract that declares a design source (#448), so every other row is
`not-applicable`, not `missing`. An exempted finding is invisible here, as it
is to `map` — `exempted` says how many there were, and `get_findings`
returns them under `decided`. A config `audit` refuses
(an unknown rule id, say) is an error naming why, never an empty answer.

**The command's answer, not a second one.** `get_findings`, `get_impact`,
`get_movers` and `query_raw_values` run the matching command in-process with
`--json` and return what it prints (minus its `command`/`subject` echo), so a
tool and its command cannot disagree. A command that cannot answer — it exits
non-zero — is an error carrying its stderr; stderr from a run that did answer
(say, `movers` not comparing design hashes) comes back as `notes`.

**One version, stated.** Every result carries `version: { package,
contractSchema }`. A call whose arguments name a different `version` fails
with a JSON-RPC error saying which version this server reflects — it never
answers quietly from the one it has.

**Search is deterministic, not clever.** Ranking is the count of the query's
words (folded, three or more letters, stopwords dropped) that appear in the
candidate's text, ties broken by id. Two agents asking the same question get
the same answer, and "nothing fits" is a real answer: the two search tools
return `matches: []` with `nothingFits: true` and the words that matched
nothing, rather than the closest thing.

stdout carries only JSON-RPC response lines (the D8 stream invariant — a
stray line would corrupt the transport); progress and errors go to stderr.
Exits `0` when stdin closes, `1` on a flag or config error.
