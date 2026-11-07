---
status: accepted
date: 2026-08-16
status-note: "accepted by Chris 2026-08-30 (issue #396). Every phase had shipped (5.0-5.3; 5.4 closed not-planned) and Amendments 1 and 3 were already enforced in code while this document still read Proposed; this line catches the status up to reality, and ADR-001's amendments now stand."
deciders: "Chris Griffin"
informed-by: "ADR-001 D12/D13/D15/D16; a fresh audit of this repo's provider-layer state (src/providers/ does not exist; gather and ingest are stubs); and a full inventory of the first consumer's real Figma data (contracts, Code Connect, baseline.json, Figma account access) - the only consumer this work is validated against."
---

# ADR-003: the Figma provider — phased, spec-basis contract↔design parity

## Context

ADR-001 D15 deferred the design side out of the first release entirely,
calling that gap deliberate and temporary: _"a tool called design-delta will
ship a first release that never looks at a design tool."_ v0.10.0 has since
shipped the whole contract↔code half — state/baseline (`snapshot`, `movers`,
`isNew`), a health score, CI surfaces (SARIF, PR-comment, a composite Action),
incremental mode (`--staged`), contract scaffolding, and a system-wide
ownership overview (`map`). The gap D15 named is now the only one left.

This ADR plans that work: **ADR-001's Phase 5** (the design provider layer +
contract↔design parity), decomposed into shippable phases. The operating model
matches how the contract↔code half was actually built: ship one phase, cut a
package, run it against `the first consumer`, adjudicate every finding, then the
next phase. No phase ships un-validated against a real design system.

### What changed since ADR-001 was written

Three things this ADR had to establish before any phase could be scoped, none
of which ADR-001 could have known:

1. **The Variables REST API is almost certainly closed to this project.**
   `the first consumer`'s Figma files live in the `CG/IO` organization at plan
   tier `org`. `GET /v1/files/:key/variables/local` is Enterprise-only, and
   Chris's one Enterprise seat is `View` on a _different_ organization. The
   personal access token on file is also expired (`403 Token expired`,
   verified against all six of the project's file keys). The **official Figma
   MCP plugin works today** — OAuth-authenticated, not plan-gated, verified
   live (`whoami`, `get_libraries`, `get_variable_defs` all succeeded in the
   session that produced this ADR). That is the only gather path this ADR
   schedules unconditionally.
2. **`the first consumer` already holds a real design-side corpus to validate
   against.** 54 of 99 contracts declare `sources.design`, uniformly
   `{fileKey, nodeId}` and no other shape; 225 hand-authored per-prop
   deviation markers (198 `"none"`, 15 `"unverified"`, 12 renames); 56
   complete Code Connect files; and `.agents/design-delta/baseline.json`
   holds 47 real component fingerprints with variable-ID bindings, produced
   by the retired v1 engine and read by nothing today.

## Three amendments to ADR-001

Each is a place the evidence above contradicts what D12 assumed when it was
written, named here rather than quietly worked around.

### Amendment 1 — D12's vendor guard scope

D12: _"no file outside `src/providers/figma/` may mention Figma at all."_
Verified inventory today, against the scope this amendment declares below:
**40 lines across eight files** (case-insensitive substring match, the same
one the guard will use — `src/modules/` is already clean).

| bucket                                                       | where                                                                                                                                                                                   | lines |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| **Renamed identifiers**, plus the prose that quotes them     | `core/findings.mjs`, `core/state.mjs`, `core/config.mjs`, `schema/state.schema.json`, and the `fileKeys` / `figmaVarNamespaces` / `figmaCollection` keys in `schema/config.schema.json` | 12    |
| **Prose only** — comments and schema `description` strings   | `sources/code.mjs` (2), `schema/contract.schema.json` (2), the remaining `description` strings in `schema/config.schema.json` (10)                                                      | 14    |
| **Structural** — a Figma-product renderer in the wrong layer | `spec/codegen.mjs`                                                                                                                                                                      | 14    |

The first bucket falls to the vocabulary rename (Phase 5.0, below) — verified
as a genuine no-op, not a judgment call: nothing in `src/` emits
`side: "figma"`, `figmaHash` is never written (only mentioned in a comment and
reserved in `state.schema.json`), and none of the renamed schema keys are set
in `the first consumer`'s current `design-delta.json`. The second is reworded in
that same commit — it is prose, so it costs nothing but words, and
`docs/config-reference.md` regenerates from those `description` strings anyway.

The third the rename cannot reach: `src/spec/codegen.mjs` renders
`import figma from "@figma/code-connect"` — Code Connect is a Figma product,
and a Figma-product renderer sitting in `spec/` is a real D12 violation, not a
wording gap.

**Amendment:** the guard's scope is `core/ + spec/ + sources/ + modules/ +
schema/*.json` — deliberately **wider** than D16's framework guard, which
covers `core/` and `modules/` only (`__tests__/layering.test.js`:
`for (const layer of ["core", "modules"])`, per ADR-001:813). D16 can stop
there because a framework adapter's own home, `sources/<framework>/`, is
outside its scope by design. A vendor leak is not shaped that way: the two
worst ones in the inventory above sit in `spec/` and `schema/*.json`, so a
`core/`+`modules/` scope would report this guard green while `spec/codegen.mjs`
imports `@figma/code-connect`. What this guard does borrow from D16 exactly is
the **match**: a case-insensitive substring, not a word boundary, for the
reason that guard already documents in place. `cli/` is out of the guard's
scope by construction: it selects a provider by config key and dynamic-imports
it, so it never names one.

The guard ships in Phase 5.0 — with the rename, so it is green from the day
it lands — carrying **one explicit, named, one-release exemption**:
`src/spec/codegen.mjs`. With the first two buckets closed in that same commit,
that file is the sole remaining violation within the guard's scope, and it is
not closed until Phase 5.1 moves the Code Connect renderer to
`providers/figma/codegen.mjs`. The exemption is deleted in the
same commit that move happens in — the guard is never green because of an
exemption sitting undisturbed across a release; it is green in 5.0 _with_ a
dated exemption, and green in 5.1 _without_ it.

### Amendment 2 — REST is conditional, not scheduled

D12 already anticipated this exact situation: _"Figma's Enterprise gating
stops being an engine caveat and becomes one provider's declared
capability."_ Given the evidence above, **Phase 5.4 (REST) does not get a
scheduled build.** It ships only if a live `200` from
`/v1/files/:key/variables/local` is observed against a real project file with
a fresh token. Until then, `capabilities.tokens.reason` carries the negative
result as printed output, and the MCP/agent path is the only one this ADR
commits to.

### Amendment 3 — provider config gets an optional sixth member

D12 fixed the provider interface at five members: `name`, `capabilities`,
`sourceSchema`, `censusComponents`, `censusTokens`. It never said where
provider-specific config (collection mappings, variable namespaces) lives,
and leaving it in core config is exactly the leak D12 exists to stop.

**Amendment:** the five required members are unchanged. A provider MAY
additionally export `configSchema`, validating its own `design.options`
block. It is not built until Phase 5.3, when there is a real options shape to
validate — the same restraint D12 itself used ("designing this interface
against one example now would repeat the mistake D12 avoided").

### Amendment 4 — name-based CANDIDATE matching is permitted for tokens

The "explicitly not building" list ruled out name-based matching for
components and tokens together, on the strength of 39 measured component
`nameAliases`. Phase 5.3 (#268) shipped the token side value-only on that
basis. The follow-up (#280) measured the token corpus itself before deciding:
a config-free rule — split the design name on `/`, fold each segment, match
every code token whose trailing id segments equal it, collapse mode heads,
drop candidates whose `$type` an unmistakable value shape rules out — maps
**131 of 171** of `the first consumer`'s design variables to exactly one token,
with no collection data and no gather change.

The component evidence does not transfer. A component carries a `nodeId`
address in its contract, so name-matching it would be choosing a worse
identity over a better one. A token has no address on either side; a
candidate by name, held to `candidateVarName`'s own discipline, is the
_only_ identity available.

**Amendment (decided 2026-08-29):** name-based matching stays off for
components. For tokens, `modules/tokens.mjs` may derive a **candidate set**
from a design variable's name — unique-or-null, kind-narrowed, overridable
per project through the provider's `design.options` (`tokenMap`,
`codeAuthoritativeGroups`, `ignoreVariables`, validated by the provider's
`configSchema` per Amendment 3). Exactly one candidate asserts identity and
compares values per token (`tokens/design-token-mismatch`, `error`); more
than one is reported, never guessed (`tokens/design-token-ambiguous`,
`review`); none falls back to the value-coverage rule #268 shipped.

## Decision — cross-cutting

### The `censusTokens` name is not a real collision

`src/sources/code.mjs` already exports a module-level `censusTokens` for the
code side. D12's `censusTokens` is a property read off a provider object
reached through a dynamic import — the two never share a namespace. The only
real ambiguity is human, at the one call site where both appear
(`audit.mjs`), resolved with a one-line import alias:
`import { censusTokens as censusCodeTokens } from "../../sources/code.mjs"`.
Neither public name changes.

### The vocabulary rename

Verified as a behavioral no-op against the current tree and against
`the first consumer`'s committed state:

| from                                                 | to                                                     |
| ---------------------------------------------------- | ------------------------------------------------------ |
| `SIDES = ["figma", "code", "spec", "both"]`          | `["design", "code", "spec", "both"]`                   |
| `figmaHash`                                          | `designHash`                                           |
| `figma-tokens.json` / `figma-components.json`        | `design-tokens.json` / `design-components.json`        |
| `config.fileKeys`                                    | deleted — replaced by contract-derived scope (below)   |
| `conventions.figmaVarNamespaces`                     | `conventions.designVarNamespaces`                      |
| `tokenMapping.collections.*.figmaCollection`         | `.collection`                                          |
| `codeConnectSuffix` default `".figma.tsx"`           | no default (matches `stylesSuffix`'s existing pattern) |
| `".figma.tsx"` in `nonComponentFileSuffixes` default | removed                                                |

One commit, one release. `docs/config-reference.md` is generated — regenerate
in the same commit or the `schema` CI job fails. Sequencing rule: the rename
lands before the vendor guard, in the same release, so the guard is green
from the moment it exists — accounting for the one named, dated exemption
Amendment 1 grants `spec/codegen.mjs` — and can never be added as decoration
over an _unacknowledged_ violation.

### How the agent gather path works

The engine is a deterministic Node CLI with no agent inside it, so `gather`
cannot call an MCP tool itself. **`gather` is a planner, not a fetcher** —
`the first consumer`'s own `tokens/scripts/sync-figma.mjs --snapshot <file>` is
the proven shape for this exact problem; this generalizes and schema-
validates it, importing none of its 1,531 consumer-specific lines.

1. `design-delta gather` prints, to stdout: which MCP tool to call, with
   which arguments, for which file keys, and where to write each raw
   response. It never touches the network.
2. An agent runs the plan and writes each raw response **verbatim** in a
   thin envelope: `{provider, providerVersion, planHash, fileKey, gatheredAt,
payload}`. It computes no hashes — D6 requires hashing to happen only in
   the Node-side normalizer, and an agent with nothing to hash with is what
   makes that enforceable rather than merely stated.
3. `design-delta ingest <raw…>` validates each raw file against the
   provider's own raw schema, normalizes it, hashes with the existing
   `hashJson` (`core/state.mjs`), and writes the two D7 snapshot files.
4. `audit` reads only the normalized snapshots, never a raw file.

Staleness: a `planHash` mismatch or a schema-invalid raw file both degrade
like a missing snapshot, with a distinct reason (D7). Snapshot age is
reported as a fact on the existing `skipped`-style channel, never as a rule —
the engine cannot know Figma changed, only how old its last look was, and a
`review` finding that fires on a calendar is noise. A staleness rule ships
when a real project is burned by a stale snapshot, not before.

### `sourceSchema` blesses `{fileKey, nodeId}` — nothing else

All 54 declaring contracts in `the first consumer` already use exactly this
shape. The schema accepts both nodeId separators — hyphen (what a Figma URL
gives an author: `?node-id=1-170`) and colon (what the API and the retired
`baseline.json` both return: `41:250`) — and canonicalizes to `:` in one
`normalizeNodeId()` inside the provider. The engine core never sees either
raw form. This also retires the one escape hatch in `spec/codegen.mjs` that
lets `sources.design` be a bare string used verbatim as a Code Connect
target — no contract uses it, and the reason it existed (no provider could
ever produce a real target) stops being true in Phase 5.1.

### Census scope replaces `config.fileKeys`

Scope is the union of every loaded contract's `sources.design.fileKey` — for
`the first consumer` that is three keys, from zero config. This also resolves a
real data-hygiene finding from the audit behind this ADR: one contract
(`hero-collage`) addresses a fileKey absent from both the legacy
`config.fileKeys` and `baseline.files` — an orphan under the old
config-list model. Deriving scope from contracts instead makes that
impossible by construction.

**Amended 2026-08-30 (issue #413, Chris):** the original `config.fileKeys`
removal happened while the project had restarted with no design file at all —
it was never a decision that files must not be configurable. `design.files`
(optional) now ADDS files to the contract-derived scope, for a file no
contract references yet; the derivation above stays primary and the orphan
class stays impossible.

### Census unit is the published component, not its variants

A `COMPONENT_SET` is one entity; its variant `COMPONENT` children are
properties of it, not separate entities. Getting this wrong floods
`coverage/design-only` with every variant of every component on the first
real run. `baseline.json`'s `Eyebrow` — a `COMPONENT_SET` with `size=lg`/
`size=sm` children — is the fixture this gets built and tested against.

### Matching is by nodeId only, never by name

`the first consumer`'s legacy config carries 39 `nameAliases` (Figma name → code
name) — measured, standing evidence that name-based matching mispairs on
this project. Contracts already carry an explicit address; use it.

### `baseline.json`'s 47 fingerprints are a spike input, not a migration source

Their hashes were computed by the retired v1 engine's `fpData` running
_inside_ the Figma sandbox — exactly what D6 forbids for the new engine — so
they are not reproducible by the new Node-side normalizer by construction.
ADR-001 already accepted a one-time "everything is new" run at cutover for
exactly this reason. The file is used for two things in the Phase 5.0 spike
— the concrete shape a bound-paint fingerprint must take (`"bv:fills":
"VariableID:…"` is the literal case of "a bound paint's fingerprint is its
binding, not its resolved color"), and a second, independent structural
observation to help separate "Figma changed since this file was captured"
from "the gather itself is nondeterministic." After the spike, it is read by
nothing and `the first consumer` is free to delete it.

### Phase numbering

This ADR's phases are **5.0 through 5.4**, a decomposition of ADR-001's
existing Phase 5 — no third numbering scheme. `SUBCOMMANDS[].phase` in
`src/cli/main.mjs` stays an integer for the `--help` grouping; sub-phase
resolution is this document's concern, not the CLI's.

Two labelling problems already in shipped code get corrected as part of this ADR's
housekeeping, since both are user-visible: `movers`, `impact` and `map` are
long-shipped but still print `phase: 5` in `--help` output, and a Phase 6
(`snapshot`, `scaffold`, `dock`) exists in the subcommand table with no
definition anywhere in ADR-001. This ADR retro-defines it in one sentence:
**Phase 6 is post-MVP engine ergonomics, shipped ahead of the provider
layer.**

## The phases

Each phase is one package release, validated against `the first consumer` before
the next phase starts.

### Phase 5.0 — Vocabulary + determinism

Two independent tracks, both prerequisites, neither blocking the other:

- **Rename** (the table above) + the prose rewording Amendment 1's second
  bucket names + the layering test amendment (`providers` in
  `LAYERS`/`ALLOWED`, `modules` forbidden from importing `providers` — which
  is what forces a provider's `censusComponents` to return the same
  normalized shape `sources/react/extract.mjs` already returns, the same
  boundary that made the D16 framework rename cheap) + the D12 vendor guard,
  modeled on the existing D16 guard including its negative control (this
  suite has shipped a regex that matched nothing once already), shipping
  green with the one dated `spec/codegen.mjs` exemption Amendment 1 names.
- **The gather-determinism spike** (issue #88): gather the same unchanged
  Figma file five times through the MCP path, diff the raw responses,
  derive the normalization allowlist from _observed_ variance — not a
  guess — cross-checked structurally against `baseline.json`'s 47
  fingerprints. Write-up: `docs/spikes/gather-determinism.md`.

**Validated by:** a byte-identical `the first consumer` audit report before and
after the rename — any diff is a rename bug, not a behavior change.

### Phase 5.1 — Addressing + coverage

`src/providers/index.mjs` (config-key → dynamic import loader) +
`src/providers/figma/{index,normalize,codegen}.mjs` +
`src/providers/figma/agent/plan.mjs` + `schema/design-components.schema.json`

- real `gather`/`ingest` commands, replacing the stubs + two coverage rules:
  `coverage/design-only` (a real Figma component with no contract) and
  **`coverage/design-missing`** (a contract's `sources.design` node does not
  resolve — not `coverage/spec-only`, which would collide in meaning with the
  already-shipped `coverage/contract-only`). No parity checking yet. A contract
  with no `sources.design` at all stays silent, mirroring the existing rule for
  a missing `sources.code.path`.

**Validated by:** all 54 addressed contracts resolve; all 45 without a
design block produce zero findings; `ingest` run twice on the same raw file
produces a byte-identical snapshot; and — the highest-value free check
available — every generated Code Connect target is diffed against
`the first consumer`'s 56 hand-maintained `.figma.tsx` files, with every
disagreement explained as either a stale hand-edit or a derivation bug.

### Phase 5.2 — Component parity

Because `modules/` cannot import `providers/`, the provider already returns
census data in the code-side's normalized shape, so `runComponentsCheck`
gains a `side` option and ships no new comparison logic — design findings
reuse the existing rule ids (`components/prop-missing`, etc.) with
`side: "design"` (D5: side is a field, not a rule identity). Implements the
exact mirror of the deviation markers already authored across 225 props in
`the first consumer`: `design: "none"` → presence is a finding; `"unverified"` →
never compared; `{name, reason}` → compared under the renamed identity;
`code: "none"` → ignored entirely by the design-side checker. Enum values
compare as a set — order is not compared, an explicit convention already
recorded in `the first consumer`'s own contracts.

**Validated by:** `button`'s two `code: "none"` axes (`state`, `breakpoint`)
must produce zero findings — the sharpest test in this phase, written as a
fixture before the code that must pass it.

### Phase 5.3 — Design token census

`censusTokens` for real, over the agent gather path + `schema/design-
tokens.schema.json` + `modules/tokens.mjs`'s spec↔design half + the
provider's `configSchema` (Amendment 3) for `the first consumer`'s existing
alias-folding and code-authoritative-group configuration. If the MCP
variable path turns out to be as gated as REST, this phase becomes a
declared `capabilities` skip and nothing more — a legitimate, pre-authorized
outcome, not a failed phase.

**Validated by:** the design-side token count landing in the same order of
magnitude as the 662 code-side tokens across their four collections, and
every code-authoritative group skipping its value comparison exactly as the
retired v1 engine did.

### Phase 5.4 — REST gather path (conditional)

Not scheduled. Ships only if a live `200` from
`/v1/files/:key/variables/local` is observed with a fresh token against a
real project file. The deliverable, if it ships, is a single equality:
byte-identical normalized snapshots from the REST and agent gather paths on
the same unchanged file — D6's actual claim, tested for the first time.

## Explicitly not building

- **`invalidVariantCombinations` (#111) and `designLayer`** — zero contracts
  in `the first consumer` use either. Both stay schema-only, exactly as they
  are today; a checker for a field with no users is how false-finding
  classes get born. They become checkable when a contract uses them.

  **Amended 2026-09-02 (issue #403, following Chris's acceptance of ADR-002
  in #411, which named this issue as unblocked):**
  `invalidVariantCombinations` is now read by
  `components/variant-combinations-mismatch`, against variant combinations
  the bindings pass reads off a component set's variant children. The
  false-finding guard this bullet asked for is kept rather than dropped: the
  rule only runs for a contract that declares the field, only against a
  design entry the bindings gather actually produced combinations for, and
  at `review` severity until it is adjudicated against a real project.
  `designLayer` is untouched and stays schema-only.

- **A snapshot-staleness rule.** Age is reported, not gated, until a real
  project is burned by a stale one.
- **Name-based component matching.** 39 measured `nameAliases` are the
  standing evidence against it. (Tokens are different — see Amendment 4.)
- **Anything imported from `tokens/scripts/sync-figma.mjs`.** Its
  `--snapshot <file>` shape is cited as prior art; none of its 1,531
  consumer-specific lines belong in the engine.

## Consequences

- The rename is a breaking change to the finding shape (`side`) and the
  state schema (`figmaHash`) in the abstract, but is verified to change zero
  bytes of any current consumer's output — so it ships as a normal `0.x`
  release with no `BREAKING CHANGE:` marker, per this repo's own
  `CLAUDE.md` rule against ever writing one.
- `the first consumer`'s legacy `.agents/design-delta/config.json` and
  `tokens/scripts/{sync-figma,build-token-map,build-component-map}.mjs`
  remain untouched by this ADR — they are consumer-side pipeline code, out
  of scope for the engine, and Phase 5.1 onward gives that project a real
  path to eventually retire them, which is a separate, later decision.
- Phase 5.4 may never ship. That is an accepted, named outcome of this ADR,
  not a gap in it.
