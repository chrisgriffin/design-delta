# Design-provider contract

This documents what a provider must export, verified against the current
Figma provider rather than assumed from ADR-003 — every shape below was
re-checked against `src/providers/figma/index.mjs` and `normalize.mjs`
directly.

`core/` and `modules/` compare normalized censuses and never name a design
tool (ADR-001 D12, enforced by `__tests__/layering.test.js`) — only
`src/providers/<name>/` may. Figma is the only provider today
(`src/providers/figma/`), and D16 calls the framework adapter its "exact
symmetric twin" — but only the adapter half had a written contract
([`framework-adapter-contract.md`](./framework-adapter-contract.md)). With
one implementation, the provider interface is only discoverable by reading
the Figma provider and inferring it — the expensive kind of undocumented
boundary, which silently becomes "whatever Figma happens to do" the moment a
second provider exists.

The interface was shaped against the one provider that exists, so a second
provider gets a vote when it arrives.

## Registration and selection

A provider is one module, `src/providers/<name>/index.mjs`, registered in
`src/providers/index.mjs`:

```js
const LOADERS = {
  figma: () => import("./figma/index.mjs"),
}
```

`LOADERS` is a **static allowlist of dynamic `import()`s, never a module
path built from config**: `design.provider` is project-authored input, and
building a specifier out of it would let a config typo (or something worse)
resolve an arbitrary path. One provider is active at a time —
`loadProvider(config)` reads `design.provider`, returns
`{ok: true, provider}` or `{ok: false, reason}`, and guards the lookup with
`Object.hasOwn` so `"constructor"` in config cannot resolve a prototype
member. `cli/` is exempt from the layering test's vendor guard precisely
because it only ever reaches a provider through this loaded object, never a
static import.

## The five required members (ADR-001 D12)

### `name`

The provider's config key, verbatim: `"figma"`.

### `capabilities`

```
{components: boolean, tokens: boolean}
```

What this provider can actually census. A surface it cannot read **skips
with a stated reason** rather than reporting false parity — the reader of a
capability is the CLI layer, which never plans a gather or reads a snapshot
for a surface the provider declares off.

### `sourceSchema`

A JSON Schema for a contract's `sources.design` block — the block is opaque
to `core/`/`spec/`/`modules/` (`contract.schema.json` deliberately does not
constrain it), and this schema is the provider claiming its shape. Figma's:
`{fileKey, nodeId}`, `additionalProperties: false`, nodeId matching
`^\d+[:-]\d+$` (a URL hands an author a hyphen, the gather path a colon —
normalization is the provider's job downstream).

### `censusComponents(ctx)`

Raw gather payload → normalized component census, for ONE gathered file.
`ingest` calls it once per raw envelope and concatenates:

```
censusComponents({fileKey, payload}) →
  {components: object[], skipped: number, payloadValid: boolean}
```

`payloadValid: false` means the payload isn't this provider's expected shape
at all — **"couldn't census this file," never a silent empty census**. The
caller reports it; the provider never guesses. A census entry is "the
published component" (a component set, or a variant-less component — never a
variant child), carrying at minimum the fields the snapshot schema
(`schema/design-components.schema.json`) requires: the address fields the
provider's own `componentAddress` reads, `name`, and whatever prop-source
fields its own `componentProps` reads.

### `censusTokens(ctx)`

Same contract for the token side, one call per gathered node:

```
censusTokens({payload, tool?, index?}) →
  {tokens: object[], skipped: number, payloadValid: boolean,
   unresolved?: {name: string, reason: string}[]}
```

One entry per distinct variable NAME observed, deduplicated by the caller
across nodes (first occurrence wins in gather-target order). The name is the
provider's own path vocabulary and stays opaque to the engine — matching is
by name candidate first (ADR-003 Amendment 4), by value as coverage.

`unresolved` names the entries the provider could not census AND can give a
reason for — `ingest` reports each one with its reason, instead of folding it
into `skipped`'s count. An entry with no honest value belongs in one or the
other; inventing one is never the third option.

### `indexTokens(payloads)` — optional (issue #517)

```
indexTokens([{payload, tool?}, …]) → object   // opaque to the engine
```

A variable in one gathered file can alias a variable in another (a design
tool's own library subscription), and a census that only ever sees one
payload cannot resolve it. A provider MAY export `indexTokens`: `ingest`
reads every raw token envelope first, calls this once with all of them, and
hands the result back to each `censusTokens` call as `index` — never reading
it, since what is in it is the provider's own vocabulary (D12). A provider
without one censuses exactly as before, one payload at a time.

## The optional sixth member (ADR-003 Amendment 3)

### `configSchema` + `validateDesignOptions(options)`

A provider MAY export a JSON Schema for its own `design.options` block, plus
the validator `audit` calls (`{valid, errors}`). Provider-specific config
lives here and nowhere else — leaving it in core config is exactly the leak
D12 exists to stop. Invalid options are a **diagnostic, never a crash and
never silently applied**: `audit` runs as if the block were absent, so a
typo'd key cannot quietly turn a mapping off. Figma's validates `tokenMap`,
`codeAuthoritativeGroups`, `ignoreVariables`, `units`,
`includePrivateComponents`.

A provider MAY also export `isPrivateComponent(component) → boolean` (issue
#460): whether the tool keeps that component out of its published library
by its own convention (Figma: a `.`- or `_`-prefixed name or path segment).
`audit` flags such entries `private: true` in the normalized census, so
`coverage/design-only` skips them and the run reports the count once; the
engine never learns the convention itself.

A provider MAY also export `censusUnit(component) → "variant-set" |
"component" | null` (issue #658): what kind of census unit a component is,
in the engine's own vocabulary. `audit` carries it as `unit` on the
normalized census entry, and the design side of the anatomy surface reads it
to compare a variant set's `root` children inside one of its variants rather
than among the variants themselves. Figma derives it from the entry's `type`
(`COMPONENT_SET`, `COMPONENT`); a provider without it leaves `unit` absent,
and every entry is compared as a plain component.

A provider MAY also export `unbindableProperties: string[]` (issue #492): the
style properties it cannot express as a node-level variable, by the contract's
own `styles` property names. `modules/styles.mjs`'s bindings comparison skips
a declared binding under one of them, with a stated reason, instead of
reporting drift no one can act on — the contract, the stylesheet and the
design file are all correct, and only the comparison was wrong. **Declared,
never inferred**: a rule that learned the limit from "nothing in this census
binds one" would go quiet on a thin census and silence real drift. Figma
declares `lineHeight` (authored as a literal on a text style) and `margin`
(flow spacing is the parent layer's, outside the component a contract
addresses). A provider that exports nothing here has every property compared,
exactly as before.

## The wiring members the CLI needs

D12 fixes the interface's REQUIRED members, not an exhaustive export list.
The Figma provider additionally exports — and `cli/` reaches every one only
through the loaded provider object:

| Member                                                         | Contract                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `designAddress(source)`                                        | `sources.design` → an opaque **match-key string**, or `null` when the shape isn't this provider's. This is what lets `modules/` never learn the block's shape: `audit` resolves it per contract and per census entry, and `modules/components.mjs` only ever compares two plain strings.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `componentAddress(component)`                                  | a normalized census entry → the SAME match-key vocabulary. The two MUST agree — the coverage check is "does one side's key exist in the other side's key set."                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `sourceFileKey(source)`                                        | just the file half of the address, for `gather`'s plan — which files to census, before any census exists to match full addresses against.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `buildGatherPlan(fileKeys, rawDir)`                            | the agent-readable plan `gather` prints: `{provider, tool, targets, planHash}`. The engine never touches a design tool itself — an agent executes the plan and drops raw envelopes for `ingest`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `buildTokenGatherPlan(addresses, rawDir)`                      | same, for the token side.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `componentProps(designComponent)`                              | one census entry → props in the **same `{name, type, values?}` shape the code census carries** (sorted by name), so `modules/components.mjs`'s ONE prop-parity algorithm runs unchanged against either side. No `default`/`required` — the design side has no such concepts, so those comparisons naturally never fire design-side rather than inventing values.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `validateDesignComponents(snapshot)`                           | schema-validate `design-components.json` before `ingest` writes it — the "never write invalid" discipline `core/state.mjs` applies to `state.json`. `{valid, errors}`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `normalizationSince`                                           | `{ tokens?: { version: string, staleShape?: (snapshot) => boolean }, components?: { … } }` — per snapshot, the engine version whose ingest-time normalization last changed what a stored value looks like, and `staleShape` for a snapshot that carries no `provenance.engineVersion` at all (issue #458). `audit` compares `engineVersion` against `version`; with none recorded it asks `staleShape`, and with neither answer available it stays silent — never a guess. A bare string is NOT accepted: audit reads `.version`, so a provider written as `{ tokens: "0.18.1" }` reports nothing. Optional; a provider that never changes its output shape can omit it.                                                                                                                                                                                                                                                                                                                                                                          |
| `validateDesignTokens(snapshot)`                               | same, for `design-tokens.json`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `buildBindingsGatherPlan(addresses, rawDir)`                   | the bindings plan `gather --bindings` prints (issue #401, retargeted by #417) — one target per addressed FILE, carrying that file's node ids and naming the tool that resolves bound variables INSIDE the design tool. The read-only surfaces return opaque ids for a LIBRARY variable, which is every real consumer's shape.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `censusBindings(ctx)`                                          | one PER-NODE raw bindings payload → `{usedVars, variantCombinations, payloadValid}`: the deduplicated, sorted variable names the tree binds, and the variant combinations its direct children enumerate (issue #403). `ingest --bindings` merges both onto the matching census entry; `variantCombinations` only for a `COMPONENT_SET` that produced any, so absent still means "not gathered".                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `censusBindingsBatch(ctx)`                                     | one PER-FILE raw bindings payload → `{entries, payloadValid}`: one `{nodeId, usedVars, variantCombinations}` record per node the gather covered, or `{nodeId, error}` for one it could not resolve. `ingest --bindings` picks this over `censusBindings` when the envelope addresses a file rather than a single node, and merges each record onto its own census entry. Optional — a provider without it ingests per-node envelopes only.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `censusLayers(ctx)`                                            | the SAME raw bindings payload → `{layers, payloadValid}`: the component's layer tree as `{name, type?, children?, childrenResolved?}`, in the engine's own node vocabulary (the contract's `anatomy.<node>.type` enum), never a design tool's raw node types. `ingest --bindings` merges it onto the matching census entry as `layers`; `modules/anatomy.mjs` compares a contract's declared anatomy against it. Optional — a provider without it merges `usedVars` alone.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `bindingPath(contract, config)`                                | where a contract's committed design-to-code binding file lives (issue #400), repo-relative, or `null` when the contract or config gives the provider nothing to bind — "not applicable", never a finding. Optional — `audit` and the MCP server skip binding status entirely for a provider without it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `bindingStatus(contract, config, apiView, committed, options)` | that file's status against what the contract would render: `{applicable: false, reason}` or `{applicable: true, outputPath, status, authored, expected}`, `status` one of `missing`/`stale`/`match`/`compare-unreliable`. `compare-unreliable` (issue #588) is for a difference the provider could not compare: the two sides differ as text, but the provider has no way to judge it — for the Figma provider, which parses both sides (issue #609), `typescript`, an optional peer, is not installed — so it carries `ceiling` — `[{id, detail}]`, `detail` being the sentence a consumer reads — instead of asserting drift. `expected` is the rendered text the contract says the file holds — the same text the comparison was made against, rendered once and carried out so a finding can show it (issue #579); the audit path still never writes. The CLI reads the committed file and passes its text in — fs stays out of the provider — and `modules/components.mjs` turns the status into findings. Required alongside `bindingPath`. |

## What the engine consumes

`audit` reduces the provider's snapshots to two plain structures before any
module sees them:

```
designCensus:      {entries: [{matchKey, name, props: [{name, type, values?}],
                               unit?, usedVars?, variantCombinations?, layers?}]}
designTokenCensus: {entries: [<the whole design-tokens.json token record>]}
```

Both snapshots live under the snapshot dir (`design-components.json`,
`design-tokens.json`), are written only by `ingest`, are validated by the
provider before writing and again on read, and **degrade like missing when
invalid** (ADR-001 D7) — with the reason carried into the report's
provenance line, so "not consulted" and "unavailable" are stated facts,
never silence.

## Rules that apply beyond the shapes themselves

- **Determinism.** Same raw input, same census, same order — every list is
  explicitly sorted; nothing depends on object-key or filesystem order.
- **`payloadValid: false` is not an empty census.** "Couldn't read this at
  all" and "read it, found nothing" are different answers, and the caller
  must be able to tell them apart (the same honesty rule as the adapter
  contract's `componentConfirmed`).
- **The provider never does network I/O.** The gather path is a printed plan
  an agent executes; the provider only interprets raw payloads and validates
  snapshots. The audit path stays read-only end to end.
- **Vendor vocabulary stops at the provider.** Raw payload field names,
  address shapes, name separators — all normalized inside
  `src/providers/<name>/` before anything crosses the boundary
  (`__tests__/layering.test.js`'s vendor guard fails a build that leaks).

## What's still Figma-specific here, by design

The nodeId shape (`^\d+[:-]\d+$`, colon-canonical), the `/`-segmented
variable names, and the agent gather plan's MCP tool names are genuinely
Figma vocabulary, not part of the provider CONTRACT above. A second
provider's own equivalents (Penpot addresses, Sketch symbol ids) are that
provider's own concern — what this document prescribes is only that they
normalize to the match-key, census, and props shapes the engine consumes.
