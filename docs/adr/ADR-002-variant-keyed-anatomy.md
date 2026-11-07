---
status: accepted
date: 2026-08-03
status-note: "accepted 2026-08-30 (issue #396), as the agreed direction for work not yet built: the schema's variant-keyed form and the resolver change do not exist yet, and acceptance is what moves them into the buildable queue. Direction originally chosen 2026-08-03."
deciders: "the maintainer"
informed-by: "issue #156, and measured runs against the first consumer (99 components censused)"
---

# ADR-002: variant-keyed anatomy for components with divergent roots

## Context

A component whose render function returns **different root elements** on
different branches has no single anatomy to describe. The canonical case is
`button`, one of only three contracted components in the first consumer and the
one that prompted #156:

```tsx
if (href) return <Link href={href}>{children}</Link>
return <button>{children}</button>
```

Its contract already documents the problem in a comment, which is where this
ADR really starts:

> Button renders one of TWO roots: a Next `<Link>` when `href` is set, a
> `<button>` otherwise. v1 asserted only `element: button` and this conversion
> does not invent the other branch — the anatomy check reads the returned tree,
> so a component with two returns declines rather than guessing which one this
> describes.

#156 shipped three stages that took anatomy coverage from 58/99 to 89/99, and
deliberately left this class alone, because **no resolver change reaches it.**
Where branches share a root the engine now intersects them and compares what is
invariant; where the roots differ there is no invariant to compare. The gap is
in what a contract can SAY, not in what the walker can see.

**Measured today:** `divergent-roots` is 5 of 99 components — `button`,
`contact-form`, `link-socials`, `link-cta`, `tracked-link` — and 5 of the 10
remaining declines. It is the largest single remaining category, and the only
one that is an expressiveness limit rather than genuinely unresolvable input.

## Decision

### D1 — `anatomy` gains optional variants; the existing shape keeps working

A contract may describe more than one tree. The existing single-tree form is
untouched and remains correct for the ~95% of components that have one:

```json
"anatomy": {
  "root": { "type": "container", "element": "button" },
  "label": { "type": "text", "content": { "$prop": "children" } }
}
```

### D2 — Variants live under `$variants`, because a node name cannot start with `$`

This is the trap worth stating plainly. `anatomy` is a **map of node names**
(`root`, `label`, …), so any plain key chosen for variants — `variants`,
`default`, `asLink` — could collide with a node someone legitimately named.
Structural disambiguation ("a variant has `root`, a node has `type`") would
work today and rot the first time either shape gains a field.

Node names are constrained by the schema to `^[A-Za-z][A-Za-z0-9]*$`, so a
`$`-prefixed key is **impossible to confuse with one by construction**, and the
`$` convention already appears throughout this project via DTCG and the
contract's own `$prop` binding.

**A sigil already exists in this exact map**, which is the strongest evidence
for the approach rather than against it: `anatomy` admits `^_` keys
(`schema/contract.schema.json`), and the loader strips them
(`spec/contracts.mjs`, `stripCommentKeys`). So the map already reserves one
prefix for "not a node", and that prefix means **comment, discard** — precisely
the wrong semantics for a variant, which must survive loading and be read. A
second sigil with load-bearing meaning is the natural extension, not a new
concept.

```json
"anatomy": {
  "root": { "type": "container", "element": "button" },
  "label": { "type": "text", "content": { "$prop": "children" } },

  "$variants": {
    "asLink": {
      "when": "href is set",
      "root": { "type": "container", "element": "a" }
    }
  }
}
```

### D3 — A variant is a partial override, not a whole second tree

A variant names only the nodes that DIFFER. Everything else is inherited from
the base anatomy. `button`'s two branches differ in exactly one node — the root
element — so its variant is three lines rather than a duplicated tree.

Repeating the whole tree per variant would make the common case (one node
differs) as expensive to author as the rare one, and every duplicated node
becomes a place for the two copies to drift.

### D4 — The engine matches variants to trees STRUCTURALLY, never by evaluating props

**This is the honesty constraint, and it limits what `when` can be.**

The adapter sees returned trees. It cannot know whether `href` is set — that is
a runtime value, and this engine is static and deterministic by construction
(ADR-001). So matching a contract variant to a code branch is done by **root
element**: the branch rendering `<a>` matches the variant declaring
`element: "a"`.

Therefore **`when` is documentation for a human reader, not a predicate the
engine evaluates.** It must be typed and named so that it cannot be mistaken
for something enforced — a free-text string, not a structured
`{"prop": "href", "equals": true}` that _looks_ executable and silently is not.
An unenforced field that appears enforced is exactly the failure
`invalidVariantCombinations` already represents in this schema
([#111](https://github.com/chrisgriffin/design-delta/issues/111): in the schema,
read by nothing), and repeating it knowingly would be worse than the first time.

Consequences of structural matching, all of which must be reported rather than
guessed:

- Two variants declaring the **same** root element are ambiguous. The contract
  is rejected at load time; the engine will not pick one.
- A code branch matching **no** declared variant is a finding — the component
  renders a shape the contract does not describe.
- A declared variant matching **no** code branch is a finding — the contract
  describes a shape the component does not render.

### D5 — The adapter must expose the candidate trees it currently discards

`sources/react/jsx.mjs` today returns `{resolvable: false, reason:
"divergent-roots"}` and throws the trees away. It will instead carry them, so
`modules/anatomy.mjs` can match. The census shape gains a branch-bearing form
alongside the resolved and declined ones, and
`docs/framework-adapter-contract.md` — the normative surface a non-React
adapter implements against — is updated in the same change.

## Consequences

- **The config schema changes.** Additive and backward-compatible: every
  existing contract stays valid, since `$variants` is optional and no current
  contract can contain a `$`-prefixed node name. It is still a published-surface
  change and needs a schema version note.
- **`0.x` stays `0.x`.** No `BREAKING CHANGE:` marker, per `CLAUDE.md` → _Git &
  release_ — the automation computes 1.0.0 from one, and this package stays
  pre-1.0 until stable.
- **Coverage:** 5 of 99 components on the first consumer become describable, and
  anatomy declines drop 10 → 5. The remaining 5 are genuinely unresolvable
  input (`no-jsx-returned` 3, `unsupported-shape` 1, `fragment` 1), not
  expressiveness limits.
- **This does not make anatomy checking exhaustive.** 30 of the 89 resolvable
  components today resolve only PARTIALLY (a `.map()` or conditional region
  withheld). Variants address divergent roots and nothing else.

## What this does NOT do

- It does not let a contract express "this node appears only when `href` is
  set" — `presentIf` already covers conditional nodes, and D4's structural
  matching cannot verify a prop condition anyway.
- It does not support nested or combinatorial variants (a component with two
  independent binary discriminators). No component in the measured set needs
  it, and building for it now would add machinery for a case that does not
  exist — the same call ADR-001 D12 made about multi-provider support.

## Ratified questions

The three questions this ADR left open were **ratified on 2026-09-07**
([#441](https://github.com/chrisgriffin/design-delta/issues/441)), each after it
had already shipped. None was reversed.

1. **`$variants` inside `anatomy` is the key** — not a sibling top-level
   `anatomyVariants` block keeping `anatomy` a pure node map. The map is
   already not one (`^_` comment keys live there and are stripped at load), and
   a `$`-prefixed key cannot collide with a node name by construction (D2).
   Shipped as `anatomy.$variants` in `schema/contract.schema.json`
   ([#424](https://github.com/chrisgriffin/design-delta/issues/424)).
2. **`when` exists, as free text the engine cannot check** — kept rather than
   dropped in favour of the variant name alone, and typed as a plain string so
   it cannot be mistaken for the predicate D4 says it can never be. Shipped as
   `anatomyVariant.when` in `schema/contract.schema.json`
   ([#424](https://github.com/chrisgriffin/design-delta/issues/424)), scaffolded
   in [#431](https://github.com/chrisgriffin/design-delta/issues/431).
3. **A variant is a partial override, not a whole second tree** — D3 as
   written: a variant names only the nodes that differ and inherits the rest,
   rather than duplicating the tree for readability. Shipped in the schema's
   `anatomyVariant` ([#435](https://github.com/chrisgriffin/design-delta/issues/435))
   and in the structural matching that reads it
   ([#429](https://github.com/chrisgriffin/design-delta/issues/429)).

## The plan

Gated on this ADR being accepted. Ordered so each step is independently
verifiable against the first consumer:

1. Adapter carries the candidate trees for a divergent-roots component (D5);
   adapter contract doc updated in the same change.
2. Schema accepts `$variants`, with load-time rejection of two variants
   declaring the same root element (D4).
3. `modules/anatomy.mjs` matches trees to variants structurally and emits the
   two unmatched-side findings.
4. `button`'s contract in the first consumer gains its `asLink` variant, and the
   run is adjudicated — the acceptance gate is that it produces zero false
   findings on the existing contract set.
