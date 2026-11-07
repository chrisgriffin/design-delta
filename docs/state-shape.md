# State shape

The `state.json` file `design-delta snapshot` writes (roadmap #216, ADR-001
D6).

Hand-written, not generated — see [`docs/cli.md`](./cli.md) for the same
note on why. Verified against `src/core/state.mjs` and
`schema/state.schema.json` directly.

## Why this file exists

Every other command in this engine is a fresh census, every run — there is
no memory of a prior run to compare against. `state.json` is that memory:
one deterministic hash per entity, written by `snapshot` and read by
`audit`/`verify` (issue #243) to answer "what changed since last time" — see
[`docs/report-structure.md`](./report-structure.md)'s `isNew` section for
what they do with it.

**Written only by `snapshot`.** `audit`/`verify`/`lint`/`report` never touch
this file — writing it would break the audit path's read-only guarantee
(`CLAUDE.md`). `audit`/`verify` open it read-only, same as any other project
file they compare against; nothing here ever calls the writer.

## The document

```
{
  entities: { "<kind>:<id>": EntityState, ... },
  lastRun: string,             // ISO 8601 timestamp of this snapshot
  lastRunByScope?: {
    components?: string,       // ISO 8601, when the components scope last ran
    tokens?: string,           // reserved — this slice never writes it
  },
}
```

### `EntityState`

```
{
  codeHash: string,            // deterministic hash of the entity's code-side census
  specHash?: string,           // deterministic hash of its contract body, when it has one
  designHash?: string,         // the design census's own hash for the entity's design counterpart — OMITTED, never null, when it has none
  lastSeen: string,            // ISO 8601, when this entity was last observed
}
```

`designHash` is read, not computed: `snapshot` takes the provider's own
per-component `treeHash` from the committed `design-components.json` for the
component a contract's `sources.design` resolves to (issue #481) — the engine
never hashes a design tool's payload itself. Its absence is itself
meaningful: no design counterpart resolved for this entity (no provider, no
snapshot, or no `sources.design`), not "the design side matched." `movers`
reports a changed `designHash` the way it reports a code or contract change,
so a re-gathered design side shows up as movement. The key is never guessed.

## Entity keys

`"<kind>:<id>"` — today, only `component:<contract-id>` (e.g.
`"component:button"`), one per contract with a readable `sources.code.path`.
A contract with no code source, or whose component the props census
couldn't read, has no entry at all — never a placeholder hash.

**Tokens are out of scope for this slice.** A token's own DTCG entry already
is both its code and its spec (`src/modules/tokens.mjs`'s own docblock,
D3) — it doesn't split into a `codeHash`/`specHash` pair the same way a
component does, so token entities are a deliberate future extension, not an
oversight.

## Hashing

`core/state.mjs`'s `hashJson` — a sha256 hex digest of the value's JSON
representation, with every object's keys recursively sorted first. The same
logical value always hashes the same, independent of the key insertion
order whatever upstream census code happened to build it in.

- `codeHash` — `hashJson` of the component's props census (`{name, type,
values?, default?, required}[]`, from `sources/react/extract.mjs`).
- `specHash` — `hashJson` of the contract body with `^_`-prefixed comment
  keys stripped (`spec/contracts.mjs`'s `stripCommentKeys`) — a comment edit
  never moves the hash.
