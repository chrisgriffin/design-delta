# Framework-adapter census contract

This documents what a framework adapter must produce, verified against the
current React adapter rather than assumed from its own docblocks — every
shape below was re-checked against `src/sources/react/extract.mjs` and
`src/sources/react/jsx.mjs` directly.

`core/` and `modules/` compare normalized censuses and never name a
framework (ADR-001 D16, enforced by `__tests__/layering.test.js`) — only
`src/sources/<framework>/` may. React is the only adapter today
(`src/sources/react/`), and the shapes it produces are already
framework-neutral: an Angular template or a web component's shadow DOM maps
onto the same tree directly. But with one implementation, that contract is
only discoverable by reading the React adapter and inferring it — the
expensive kind of undocumented boundary, which silently becomes "whatever
React happens to do" the moment a second adapter exists.

(The design-tool half of this boundary has its own twin document —
[`provider-contract.md`](./provider-contract.md), per ADR-001 D16's "exact
symmetric twin" — this one covers only the framework adapter.)

**The adapter object itself** is
`src/sources/<framework>/adapter.mjs`, registered in
`src/sources/frameworks.mjs` and selected by the project's `code.framework`
config key ([issue #117](https://github.com/chrisgriffin/design-delta/issues/117)):
`{ name, conventions: { componentFileExtension, nonComponentFileSuffixes },
extractComponent, extractComponents, findComponentFiles, extractJsxComponent,
extractJsxComponents }`. The shapes those functions return are documented
below; the object was shaped against the one adapter that exists, so a
second adapter gets a vote on the interface when it arrives.

## Props census

Feeds `modules/components.mjs`'s prop-parity check. One entry per prop:

```
{name, type, values?, default?, required}

type ∈ boolean | string | number | enum | slot | function | unknown
```

- `values` — present only when `type: "enum"`, the canonical values in code
  casing.
- `type: "slot"` — arbitrary renderable content (React's `ReactNode`, roughly).
- `type: "unknown"` — the type could not be resolved (an unresolvable import,
  a path alias with no tsconfig, …). **Not `"slot"`** — the parity check
  declines the comparison for an unknown-typed prop rather than inventing a
  mismatch against whatever the contract declares.

**Per-component envelope** (`extractComponent`):

```
{ ok: true,  component: {file, props, name?, namedExport}, diagnostics: [] }
{ ok: false, componentConfirmed: true,  component: null, diagnostics: [...] }  // component found, props unreadable
{ ok: false, componentConfirmed: false, component: null, diagnostics: [...] }  // no component here at all
```

`name` is the declaration's own exported identifier when one was read, and
`namedExport` says whether it is a NAMED export (`export const X`,
`export function X`) rather than the file's default export — what a
generated import of the component has to match (issue #453).

`componentConfirmed` is the answer to a DIFFERENT question than `ok`: whether
this file declares an exported component AT ALL, independent of whether its
props could be read. The distinction exists because the two failure modes
need different treatment downstream — a component whose props are unreadable
still belongs on the contract worklist; a file that declares no component
(a re-export barrel, a constants module) does not, and adding it would invent
authoring work. Collapsing the two into one `ok: false` was a real defect
(issue #132): 21 of 100 components on a real design system were silently
absent from the coverage report because their props happened to be
unreadable, and nothing distinguished that from "not a component."

**Whole-set envelope** (`extractComponents`):

```
{ ok, skipped, components: [...], unreadableProps: [...], diagnostics: [...] }
```

`components` holds only files that extracted CLEANLY — a props list a parity
check can compare against a contract. `unreadableProps` is a separate list of
relative file paths: CONFIRMED components (`componentConfirmed: true`) whose
props could not be read. The two lists are kept apart deliberately — an entry
with no prop list must never reach the parity path, where it would report
every contracted prop as missing from code — but a consumer of this census
(coverage, in particular) needs to see both to stay honest about what it
covers.

## Structural (tree) census

Feeds `modules/anatomy.mjs`'s structure-parity check. One node per rendered
element:

```
{kind: "element",    tag,   children: StructuralNode[]}
{kind: "component",  name,  children: StructuralNode[]}
{kind: "text",       value}
{kind: "expression", prop}
{kind: "unknown"}
{kind: "unresolved"}
```

- `kind: "element"` — a DOM tag (`div`, `button`).
- `kind: "component"` — another component instance, by name.
- `kind: "expression"` — dynamic content bound to a prop
  (`{props.label}` → `{kind: "expression", prop: "label"}`) — never a name
  filtered out by convention; the parser reads exactly what the JSX
  interpolates.
- `kind: "unknown"` — content whose shape the walker declined to interpret
  further (a call expression the walker doesn't special-case, etc.) —
  content-only, doesn't affect the surrounding structure.
- `kind: "unresolved"` — a STRUCTURAL position that exists but whose contents
  the adapter will not name: the component renders several branches and they
  disagree here. Counts as a structural child (the position is real; only its
  contents are unknown), and the checker asserts nothing about it. Emit this
  rather than picking a branch.

An `element` node may also carry `attributes` — its DOM attributes by name,
each a literal string as written (a bare `disabled` is `"true"`), or
`{unresolved: true}` when the value is computed. A spread onto the element
(`{...rest}`) sets `attributesResolved: false` on the node: any attribute may
arrive through it, so an attribute's absence from the map means nothing.
Across branches, an attribute survives the fold only where every branch
sets the same literal; otherwise it is `{unresolved: true}`. Components
never carry `attributes` — their props are their own contract's business.

A node may also carry `childrenResolved: false` with `children: []`, meaning
the branches rendered DIFFERENT NUMBERS of children here. That is "not known",
never "none" — an adapter must not collapse the two, and a checker reading
`children: []` as "renders nothing" would manufacture a missing-node finding
out of an explicit unknown. Differing-length lists are never aligned
positionally, because doing so synthesizes a tree matching neither branch.

**Per-component envelope** (`extractJsxComponent`):

```
{ ok: true,  component: {file, resolvable: true,  root: StructuralNode},  diagnostics: [] }
{ ok: true,  component: {file, resolvable: true,  root, partial: true, unresolvedAt: [...]}, diagnostics: [] }
{ ok: true,  component: {file, resolvable: false, reason},                diagnostics: [] }
{ ok: true,  component: {file, resolvable: false, reason, branches: [StructuralNode, ...]}, diagnostics: [] }
```

`partial: true` means the component renders more than one tree and `root` is
the INTERSECTION of them — only what every branch agrees on. `unresolvedAt`
lists the positions that diverged, and reporting it is mandatory, not
cosmetic: a partial comparison that reads as a complete one is precisely the
false-finding class this contract exists to prevent. Set both or neither; an
intersection that found no disagreement is a complete answer and must NOT be
flagged partial, or the checker will hedge on a tree it can fully trust.

**The branch-bearing form** (ADR-002 D5) is the last line above: a declined
component that carries the trees it renders, under `branches`. Required for
`divergent-roots` — the one reason where every branch DID resolve to a tree
and only their roots disagree — and produced for no other reason today, since
nothing else has a complete set of trees to carry. The rules:

- Each entry is a `StructuralNode` root, in the source order the branches are
  written; the vocabulary is the same one `root` uses, attributes included.
- Present ONLY when every rendering branch resolved on its own. A branch that
  declines (a nested Fragment, say) means the field is OMITTED, never a
  shortened list: a list holding some of the branches reads as all of them,
  which is the same false-finding class as guessing which branch counts.
- It changes nothing else. The component is still declined, with the same
  `reason`, and a checker that ignores `branches` behaves exactly as before —
  matching them against a contract's variants is a separate step.

`resolvable: false` is a first-class answer, not a failure to be papered
over — a component whose render function does not reduce to ONE statically
determinable tree must decline rather than guess which shape a contract's
`anatomy` is supposed to describe: once ANY of the conditions below is true,
there is no single tree this module can honestly hand `modules/anatomy.mjs`,
and a partial answer built by guessing which branch "counts" is exactly the
false-finding class this check exists to avoid. `anatomy/coverage-declined`
reports exactly this, for a component a contract exists to compare against.
Every `reason` the adapter produces, checked in source order — the FIRST one
encountered wins when more than one applies:

| `reason`             | when                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `multiple-returns`   | some rendering branch has no nameable root (a ternary, a bare call), so neither "they share a root" nor "their roots differ" can be claimed. Branches that DO all share a nameable root no longer decline at all — they are intersected, see below                                                                                                                                                                                                  |
| `divergent-roots`    | every rendering branch resolves to a plain JSX root and those roots are DIFFERENT elements, so no common structure exists to describe. Split from `multiple-returns` because no resolver change can reconcile it — it needs a variant-keyed contract, a schema decision — whereas branches sharing a root can in principle be compared on what is invariant across them. The one reason that carries `branches` (see the branch-bearing form above) |
| `no-jsx-returned`    | either zero returns exist in a block body, or EVERY return renders nothing, or the sole rendering return's argument isn't a JSX element/self-closing element (a bare identifier, a string)                                                                                                                                                                                                                                                          |
| `conditional-render` | a ternary or `&&`/`\|\|`/`??` is the WHOLE returned expression, leaving no determinate root. As a JSX CHILD these no longer decline: a ternary child becomes an `unresolved` position and a logical one withholds its parent's child list, since the rest of the tree stays knowable                                                                                                                                                                |
| `fragment`           | a Fragment (`<>…</>` or `<React.Fragment>`) appears as the root or anywhere nested — its real root is more than one element with no single wrapping node, which a real anatomy contract's single `root` can't express                                                                                                                                                                                                                               |
| `unsupported-shape`  | the sole return's argument is some other expression the walker does not attempt to classify (a bare call expression, a template literal, …) — the catch-all for "any shape the walker cannot fully resolve," never a place to keep inventing new named reasons                                                                                                                                                                                      |

Measured directly against a real design system's actual census (not
assumed): **10 of 99 components (10.1%) decline**, split `divergent-roots` 5 /
`no-jsx-returned` 3 / `unsupported-shape` 1 / `fragment` 1. Of the 89 that
resolve, **30 resolve PARTIALLY** — a real tree with one or more regions the
walker declined to name, each reported in `unresolvedAt` rather than guessed.

Two reasons match nothing in this codebase at all. `multiple-returns` survives
only for a branch with no nameable root. `dynamic-list` was RETIRED outright:
a `.map(...)` child now withholds its parent's child list instead of declining
the component, and a `.map(...)` as a whole returned expression is
`unsupported-shape`, so no path could still produce it. [Issue #110](https://github.com/chrisgriffin/design-delta/issues/110)
records why resolving that tail is deferred, likely permanently: it would
need symbolic execution of render paths, which a static walker cannot do
without inventing answers.

**Whole-set envelope** (`extractJsxComponents`):

```
{ ok, skipped, components: [...], diagnostics: [...] }
```

Same shape and same rules as the props census's whole-set envelope, minus
`unreadableProps` — the tree census has no equivalent "confirmed but
unreadable" state; a component either resolves to one tree or declines with a
stated reason.

## Rules that apply beyond the shapes themselves

- **Determinism.** Same input, same census, same order — every list above is
  explicitly sorted (by `file`, alphabetically), never left to filesystem or
  `Map` iteration order.
- **A single bad file never aborts the set.** One file's diagnostic doesn't
  stop the rest from extracting — `spec/contracts.mjs`'s `loadContracts`
  follows the same rule.
- **A missing `typescript` install is reported once, not per file** —
  `skipped: true` on the whole-set envelope, since nothing in the set COULD
  extract without it (an optional peer dependency, loaded lazily).

## What's still React-specific here, by design

The higher-order-component unwrapping (`forwardRef`/`memo`, and which type
argument carries the props type for each) lives in
[`src/sources/react/hoc.mjs`](../src/sources/react/hoc.mjs) — genuinely React
vocabulary, not part of the adapter CONTRACT above. A second adapter's own
equivalent (Angular has no analog; a web component might) is that adapter's
own concern, not something this document prescribes.
