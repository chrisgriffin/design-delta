# Report structure

The shape every check reports through, and the two artifacts that render it.

Hand-written, not generated — see [`docs/cli.md`](./cli.md) for the same note
on why. Verified against `src/core/findings.mjs` and `src/core/report.mjs`
directly.

## The finding (ADR-001 D5)

Every check — tokens, components, styles, anatomy, lint, coverage — emits
exactly one shape:

```
{ ruleId, severity, surface, side, entity, message, data?, isNew? }
```

| Field      | Meaning                                                                                                                       |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `ruleId`   | the stable id of the rule that raised it — see [`docs/rules.md`](./rules.md) for the full registry                            |
| `severity` | `error` \| `warn` \| `review` — always resolved, never `"off"` (a rule resolved to `"off"` produces no finding at all)        |
| `surface`  | `tokens` \| `components` \| `styles` \| `anatomy` \| `lint` \| `coverage` — which check family raised it                      |
| `side`     | `design` \| `code` \| `spec` \| `both` — which side of the comparison the drift is attributed to                              |
| `entity`   | the thing the finding is about — a token path, a component/file path, or a shared identity a group of findings collapsed onto |
| `message`  | the human-readable sentence                                                                                                   |
| `data`     | optional, rule-specific detail (e.g. a grouped token finding's `tokens`/`expectedVar`)                                        |
| `isNew`    | optional (issue #243) — see below                                                                                             |

### `isNew` — new since the last `snapshot`

`audit`/`verify` read [`state.json`](./state-shape.md) (`paths.stateFile`) if
it exists — never write it — and use it to tag findings whose entity is a
contracted component (`state.json`'s only scope today, [`docs/state-shape.md`](./state-shape.md)):

- `isNew: true` — the entity's current `codeHash`/`specHash` has no matching
  entry in `state.json`, or the matching entry's hash differs. Covers both a
  component that changed since the snapshot and one that didn't exist yet.
- `isNew: false` — the entity's current `codeHash` and `specHash` both match
  `state.json`'s entry — nothing has changed since the last snapshot.
- **`isNew` is omitted entirely** — no prior snapshot to compare against
  (`state.json` doesn't exist, or is unreadable), or the finding's entity
  isn't a contracted component (a token, a lint finding, an uncontracted
  component or stylesheet) and so was never in `state.json`'s scope to begin
  with. Absence is a distinct, honest third state — never guessed as `true`
  or `false`.

Run `design-delta snapshot` to write (or refresh) `state.json` before relying
on `isNew` — it is the only command that writes it.

### Severities

| Severity | Meaning                                                                                                                                                                                 |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `error`  | A definite contradiction: both sides were read successfully and they disagree. The only severity that fails a gated command's exit code (`lint`, `verify`, `audit --check`).            |
| `warn`   | Real drift the engine is confident about, which is not on its own a defect — an undeclared prop, a hardcoded value, a custom property outside the token system. Reported, never gating. |
| `review` | The engine could not reach a verdict, or the answer is a human's to give. Reported so an unanswered question is never mistaken for a clean result. Never gating.                        |

### Surfaces

| Surface      | About                                                                                                                                                                                                 |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tokens`     | The token layer itself — which tokens a contract declares, which custom properties the code declares, and which of them the code actually references.                                                 |
| `components` | A component's public API: each prop's presence, type, enum values, default value, and required/optional status, compared between the contract and the code.                                           |
| `styles`     | Where a component's styles get their values — whether each element/property pair binds the token the contract declares, binds a different one, or hardcodes a literal instead.                        |
| `anatomy`    | The structure a component renders — which nodes exist, at which positions, as which elements, with which content bound — compared against the anatomy the contract declares.                          |
| `lint`       | Static best-practice checks that need no contract at all. Silent until a project configures it.                                                                                                       |
| `coverage`   | What the run could NOT compare, and what it was told to skip: a component with no contract, a contract with no component, an exemption that no longer matches anything. A worklist rather than drift. |

## Ordering

Findings are always sorted, never left in whatever order a census produced
them (`core/findings.mjs`'s `sortFindings` — surface, then a natural,
numeric-aware `entity` comparison, splitting on `.` or `/`). Same run, same
inputs, same order — determinism is the point.

## `counts` and `exempted`

Every JSON payload that carries findings also carries a `counts` object.
`exempted` is **always present, even at 0** — a run can go from N findings to
zero, and the number that explains the difference must never be silently
implied. A clean report and a fully-waived report must not read the same.

## `decided`

`audit --json` and `lint --json` also carry `decided`, **always present, even
empty**: every finding an exemption matched, sorted like `findings`, with one
extra field:

```
decision: {
  kind: "waived" | "tracked" | "accepted",
  reason: string | null,
  issue: string | null,     // set for `tracked`, optional otherwise
  exemption: string,        // the entity or glob in config that matched
}
```

A decided finding never gates `verify` and never counts toward the severity
totals; `counts.exempted` equals `decided.length`. The human `audit`, `lint`
and `report` output list them in a "DECISIONS" section grouped by kind.

## Health score

`verify` and `report` (issue #219, `core/health-score.mjs`) turn a run's
findings into a single 0-100 score, so a project can track drift as one
trending number instead of a raw finding count that only ever grows with the
codebase. `audit`/`lint` on their own do not compute it — it is a composed
view over both, built by `cli/gather-health-score.mjs` the same way `verify`
already composes `audit`'s own contract-validity check: reused, never
re-derived, so the score can never disagree with what the underlying commands
actually found.

**Four pillars**, weights pinned to a published four-pillar split (the issue's
plan, 2026-08-12):

| Pillar           | Points | Findings                                                                         | Denominator (the pillar's own "censused surface area")                                                                                                                           |
| ---------------- | -----: | -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Value Discipline |   0-60 | `styles/raw-value`                                                               | `counts.styleDeclarations` — every CSS declaration censused in contracted style files                                                                                            |
| Token Health     |   0-20 | `tokens/token-unreferenced`, `tokens/token-unemitted`, `tokens/token-untracked`  | `counts.tokens`                                                                                                                                                                  |
| Consistency      |   0-10 | `lint/tier-alias-inverted`, `lint/vocabulary-invalid`, `lint/ramp-not-monotonic` | `counts.tokens`                                                                                                                                                                  |
| Critical Issues  |   0-10 | every `error`-severity finding, any surface                                      | `counts.components + counts.tokens + counts.styleFiles + counts.anatomyComponents` — no single surface owns "critical", so this pillar normalizes against the run's overall size |

Each pillar's sub-score is `points × (1 − density)`, where `density` is its
matching finding count divided by its denominator, clamped to `[0, 1]` so a
pathological count above the denominator floors the pillar at 0 rather than
going negative. **Density-normalized, deliberately**: every pillar is a RATE,
never a raw count, so a codebase twice the size with proportionally the same
drift scores the same — the point of a number meant to be compared release
over release as a project grows. A denominator of zero (the surface never ran,
or censused nothing) reads as "nothing to grade" and awards that pillar full
marks, not zero.

`healthScorePillars` in `verify --json` (and the score line `report` renders)
always sums to exactly `healthScore` — each pillar is rounded once, and the
total is the sum of the already-rounded pillars, never a separately-rounded
figure that could disagree with them.

The score is computed from the SAME `exempted`/`rules: "off"`-filtered
findings every other view of a run sees (above: "a clean report and a
fully-waived report must not read the same") — a fully-waived project reads
100/100, exactly as a genuinely clean one does. This is consistent with how
`--fail-on` already treats waivers, not a gap specific to the score.

**Not computed under `--staged`.** Token Health's denominator (`counts.tokens`)
and Consistency's findings (`lint`) are always project-wide, never scoped to
the staged change — the same reason `--staged`'s own scope limits are listed
above. A staged-scoped numerator over an unscoped denominator would not be a
measurement, so `verify --staged` reports no score at all, and rejects
`--fail-below` outright rather than gate on one.

**Not computed under a narrowed `report` scope, either.** `report
--components` (or `--tokens`/`--styles`/`--anatomy`) runs a genuine partial
census, not a staged subset of a full one — a pillar whose surface never ran
has a zero/missing denominator, which the density rule above reads as
"nothing to grade" and awards full marks. Left as-is, a narrowed `report`
invocation would print an inflated score (every un-run pillar maxed out)
rather than an honest one. Any of the four scope flags skips the score the
same way `--staged` does; only an unscoped `report` run computes one.

`verify --fail-below <score>` gates on the total, composing with (never
replacing) `--fail-on`'s severity gate — see [`docs/cli.md`](./cli.md#verify--the-composed-ci-gate-phase-2).

## `diagnostics` — what the run could NOT check

```
{ code, message, file? }   // or `path` in place of `file`, depending on origin
```

Diagnostics are **not findings and never gate** (except `verify`'s one
exception: an invalid contract). They report a gap in the run itself — a
tokens file that failed to parse, `typescript` not installed, a stylesheet
that would not read — as distinct from a real disagreement between contract
and code. `audit`'s own diagnostics are deduplicated across surfaces, since
the props and anatomy censuses parse the same files independently and would
otherwise report the same unreadable file twice.

### The design side of the `styles` surface

`styles` findings carry `side: "code"` when the comparison is contract ↔
stylesheet, and `side: "design"` for `styles/design-binding-missing`
(issue #401): a token the contract declares that no variable the design
component binds maps to — component-level, from the `usedVars` field
`ingest --bindings` merges onto the design component census. When the
component binds a token that the declared token aliases at any depth,
the finding stays (a component binds the declared token, not the one under
it), and its message names the bound token (as a primitive when it aliases
nothing itself) and says to bind the declared token, with the bound token's
id in `data.boundAliasTarget` (issue #686). A snapshot
without `usedVars` produces no design-side styles findings at all: the
bindings gather is opt-in, and absence of data is never reported as drift.

## The `report` command's `md` artifact

`design-delta report` (default formats `md,terminal`) writes
`drift-report.md` under `paths.reportDir` with this fixed structure
(`core/report.mjs`'s `renderFindingsMarkdown`):

```
# Design drift report

_Generated <timestamp>_        (omitted by --no-timestamp)

_Design side: components gathered <ISO date>; tokens gathered <ISO date>_
                               (always present — or "none — no design provider
                                configured", "not consulted (<why>) — …",
                                "unavailable — <provider load error>",
                                "<side>: no snapshot", or
                                "committed snapshot, gather date unknown" for a
                                snapshot written before provenance was recorded)

## Summary

**N finding(s)** — E error · W warn · R review

**Health score: N/100 (value discipline N/60, token health N/20, consistency N/10, critical issues N/10)**

| censused  | count |
| --------- | ----: |
| ...every counts.* key except `findings`... |

### Not checked                (only if `skipped` is non-empty)

- **<surface>** — <reason>

## Findings

### <severity> — N          (one section per severity present, worst first)

#### `<rule id>` (N)         (one per rule, biggest count first, then id)

> **<side>** — <report.actions[side] prose, if configured>   (one line per side present)

| side | entity | detail |
| ---- | ------ | ------ |
| ...one row per finding, in entity order... |

## Diagnostics

| code | detail |
| ---- | ------ |
| ...one row per diagnostic, or "None."... |
```

Every table is padded to its widest cell — columns aligned, the delimiter
row the same width as the column, a right-aligned numeric column ending in
`:`. This is the shape Prettier's markdown formatter produces, so a
consumer that commits the report and formats it sees a diff proportional
to what changed rather than a whole-file repad. Whitespace runs inside a
cell are folded to one space before measuring, for the same reason.

Findings render grouped by severity, then by rule, then by entity —
`groupFindingsBySeverityAndRule` — so the report answers "what is wrong,
worst first, and on which entities" without a reader scanning hundreds of
reviews to find the errors. `report.actions` (config) is prose shown once per
`side` actually present under a rule, not attributed to the rule as a whole —
a rule can mix sides (`components/prop-unexpected` fires on `code` and
`design`), and misattributing one side's fix advice to the whole table would
tell a reader to fix the wrong half.

The `terminal` format renders the health score line first, then the same
findings as `audit`'s own human output — a severity summary, then the same
severity → rule → entity grouping as plain text:

```
ERROR — 13
  components/prop-type-mismatch (8)
    card-grid      [design]: prop "mb" is typed "boolean" in the contract but "enum" in the design component
    content-image  [design]: prop "src" is typed "string" in the contract but "slot" in the design component
    …
  styles/binding-missing (2)
    …

WARN — 50
  …
```

— written to stdout instead of a file. `md`/`pr-comment`
place the score line after the finding count instead, in their `## Summary`
section — each format's own natural reading order, not a shared one.

## The `report` command's `sarif` artifact

`design-delta report --format sarif` writes `drift-report.sarif` under
`paths.reportDir`: a [SARIF 2.1.0](https://sarifweb.azurewebsites.net/) log of
the same findings, for GitHub code-scanning to ingest as inline PR annotations
(`github/codeql-action/upload-sarif` — the workflow wiring is a separate,
companion issue; this only emits the file). One `results[]` entry per finding:

| SARIF field                                          | Finding field                                                                                                                          |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `ruleId`                                             | `ruleId`                                                                                                                               |
| `level`                                              | `severity`, mapped `error`→`error`, `warn`→`warning`, `review`→`note`                                                                  |
| `message.text`                                       | `message`                                                                                                                              |
| `locations[0].physicalLocation.artifactLocation.uri` | `data.file` when the finding carries one, else `entity` — the same identifying string a report table renders as the finding's location |
| `locations[0].physicalLocation.region.startLine`     | `data.line`, **only** alongside `data.file` — omitted otherwise, never invented                                                        |

`data.file`/`data.line` are the one real file position a finding carries, and
they are emitted together or not at all: a line number under a uri that is not
a file (a token path, a component id) is not a location a consumer can resolve.
Today `lint` findings are the pair's only source — the tokens file being linted,
with the line the violation sits on.

`tool.driver.rules` lists every `ruleId` present in the run once, sorted, so a
consumer's rule reference (GitHub's own UI, or `docs/rules.md`) has an id to
resolve against.

## The `report` command's `pr-comment` artifact

`md` is a standalone document; `pr-comment` is sized to be pasted into a
single PR comment instead — a summary line plus a flat, worst-first findings
table, no per-surface breakdown (`core/report.mjs`'s
`renderFindingsPrComment`):

```
## Design drift

_Generated <timestamp>_        (omitted by --no-timestamp)

**N finding(s)** — E error · W warn · R review

**Health score: N/100 (value discipline N/60, token health N/20, consistency N/10, critical issues N/10)**

| severity | side | entity | rule | detail |
| --- | --- | --- | --- | --- |
| ...one row per finding, worst-severity-first (`sortFindings`)... |

_…N more finding(s) not shown — see the full report._   (only if truncated)
```

The whole block is kept under a hard `maxLength` budget (`PR_COMMENT_MAX_LENGTH`,
60000 chars — comfortably under GitHub's 65536-char comment limit) by adding
rows until the next one would cross it, then stopping — the omitted count is
always stated, never silently dropped. Writes to
`drift-report-pr-comment.md` under `paths.reportDir` (or `--out`).
