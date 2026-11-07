# Contract authoring guide

How to author a contract: one JSON file per component,
`<name>.contract.json`, declaring its API, its structure, and the design
tokens it binds.

A contract is the fixed point (ADR-001 D1). Every check compares one side —
code, or (Phase 5) the design tool — against **this file**, never side
against side directly, so
code↔design agreement holds by transitivity once both individually match the
contract.

This is a narrative walkthrough, built outward from three real,
adjudicated-clean contracts — `eyebrow` (the simplest shape), `card` (a
medium one introducing deviation and multi-axis variants), and `button` (the
hardest: every deviation marker, an anatomy the checker had to decline rather
than guess at). For the full field-by-field shape, see
[`schema/contract.schema.json`](../schema/contract.schema.json) directly —
this guide explains **why** each construct exists and **when** to reach for
it, not every field in isolation.

Validate what you write with `design-delta contracts` — see
[Validating what you wrote](#validating-what-you-wrote) at the end.

## Start from `scaffold`, not a blank file

Before hand-authoring, run `design-delta scaffold <Component>` (or
`design-delta scaffold --uncontracted` for every uncontracted component in
one pass) — see [`docs/cli.md`'s `scaffold` section](./cli.md#scaffold--draft-a-contract-from-the-props-census-phase-6)
for flags and exit codes. It drafts `id`, `title`, `sources.code.path`,
`props`, `anatomy`, and `styles` from the code's own census, so the
hand-authoring walkthrough below starts from a draft to review rather than an
empty file.

`scaffold` does **not** draft `sources.design` or `codegen` — those stay
hand-authored regardless of whether you scaffold first. It does draft
`anatomy.<node>.attributes` for the accessibility-relevant literals it can
read (`role`, `aria-*`, `type`, `alt`, `for`, …) and never for `className`,
event handlers, or `data-*` — a contract pins intent, not implementation.

Wherever the census can't confidently resolve a value, scaffold leaves a
`_scaffold: {todo: "…"}` note in its place instead of guessing — an anatomy
node with branches that disagree, a nested custom component, a style
variable matching zero or several tokens. `_scaffold` is schema-valid: every
object in the contract schema declares a `^_` `patternProperties` escape
hatch precisely so these notes can live alongside real fields without
failing validation. They aren't meant to stay, though — `grep -r _scaffold`
finds every one that still needs a human decision, and
`coverage/unfinished-contract` (a `warn`-severity rule) reports any
contract still carrying one, so a draft that's been forgotten shows up in
the audit report rather than silently passing as finished.

## The minimum

Only two fields are required:

```json
{
  "id": "eyebrow",
  "title": "Eyebrow"
}
```

- `id` — stable, kebab-case, unique across the contract set. Every finding,
  report row, and exemption refers to a component by this id — renaming it
  later is a breaking change to a consumer's exemptions config.
- `title` — PascalCase, matching the exported code component (`Eyebrow`).

Everything else is optional and additive. A contract with only `id`/`title`
and no `sources.code.path` is a legitimate draft — `src/modules/components.mjs`
skips it entirely rather than reporting `coverage/contract-only`, since
declaring no code source yet is not the same claim as declaring a wrong one.

Add `$schema` for editor completion:

```json
{
  "$schema": "../../node_modules/design-delta/schema/contract.schema.json",
  "id": "eyebrow",
  "title": "Eyebrow"
}
```

## A first real one: `eyebrow`

The simplest of the three real contracts — one prop, one enum, one anatomy
node, one style block:

```json
{
  "id": "eyebrow",
  "title": "Eyebrow",
  "status": "published",
  "sources": {
    "code": {
      "path": "components/eyebrow/eyebrow.tsx",
      "styles": "components/eyebrow/eyebrow.module.scss"
    }
  },
  "codegen": {
    "className": true,
    "domPassthrough": "div",
    "exampleContent": "Label"
  },
  "props": {
    "children": { "type": "slot", "required": false },
    "size": {
      "type": "enum",
      "values": ["sm", "lg"],
      "default": "lg",
      "required": false
    }
  },
  "anatomy": {
    "root": {
      "type": "container",
      "element": "div",
      "codeClass": "cgEyebrow",
      "content": { "$prop": "children" }
    }
  },
  "styles": {
    "root": {
      "base": {
        "margin": { "blockEnd": { "token": "system.stack.xs" } },
        "color": { "token": "system.color.fg.muted" }
      },
      "variants": [
        {
          "when": { "size": "sm" },
          "font": { "token": "system.typography.bodymono.xs.regular" }
        },
        {
          "when": { "size": "lg" },
          "font": { "token": "system.typography.bodymono.md.regular" }
        }
      ]
    }
  }
}
```

Walking it section by section:

**`sources.code`** — `path` is required; `styles` names the sibling style
file the `styles` block below is checked against. `sources.design` is absent
here on purpose (Phase 5 territory) — see [`sources`](#sources) below.

**`codegen`** — directives for the generated design-to-code binding file
(universal framework boilerplate, never a design property): `className`
says the component accepts a `className` passthrough, `domPassthrough`
names the DOM element its native props flow onto, `exampleContent` supplies
the text child the generator needs when children aren't a modeled prop.
The file these directives produce is generator-owned — edits to it are
overwritten, not reconciled; the one customization that survives is an
`"authored"` example body. See [who owns a generated
file](./cli.md#who-owns-a-generated-file) before touching one by hand.

**`props`** — keyed by the CODE prop name. `children` is `type: "slot"`
(arbitrary renderable content) and `required: false`; `size` is
`type: "enum"` with its `values` in code casing — enum matching is exact and
case-sensitive everywhere in this engine (`Size`/`SM` vs `size`/`sm` is
drift, never a near-match), so the casing you write here IS the casing code
must use. Values may be numbers when the code type is a numeric union
(`columns: 2 | 3` → `values: [2, 3]`); the design side then accepts the exact
string forms `"2"`/`"3"`, since a design tool's variant options are always
strings — the one boundary exception to exactness (ADR-001 D1 amendment).

**`anatomy`** — structure only, never styling (that split is deliberate: the
legacy v1 format mixed the two into one `elements` map per variant, which
made every element's styling readable only by reconstructing it across
several variant blocks). One node, `root`: a `container` rendering as a
`div`, carrying the `cgEyebrow` class, whose content is bound to the
`children` prop via `{ "$prop": "children" }` — the prop-binding shape,
not a literal string.

**`styles`** — element-major: each anatomy element (here, just `root`)
carries its `base` bindings, then the `variants` that override them for a
given prop configuration. Every value here is a **token reference**,
`{ "token": "<dot.path>" }` — the path is checked against the project's DTCG
tokens file, which IS the token contract (ADR-001 D3), never a design
tool's variable id. `when` sits alongside the style properties it overrides,
not nested a level deeper — no style property is or ever will be named
`when`, so the flatter shape costs nothing.

## Adding complexity: `card`

`card` introduces three things `eyebrow` didn't need: a prop with genuinely
no design counterpart, a prop the design tool names differently, and
multiple independent variant axes.

```json
"props": {
  "children": {
    "type": "slot",
    "design": { "name": "Content", "reason": "the design tool names the card's children slot `Content`" }
  },
  "customBgColor": {
    "type": "string",
    "required": false
  },
  "theme": {
    "type": "enum",
    "values": ["light", "dark"],
    "required": false
  }
}
```

(`customBgColor` and `theme` are genuinely code-only — no `design` deviation
marker exists to declare "no design counterpart at all" for a prop that
simply doesn't map onto anything design-side; the real contract's own
comments explain why: `customBgColor` sets an inline CSS custom property,
which a design tool expresses by picking a fill, not by passing a color
string, and `theme` applies an ambient class rather than being a genuine
component property. See [Deviation markers](#deviation-markers-code-none-design-none-design-unverified)
below for the markers that DO exist and when each applies.)

**`design: { name, reason }`** on `children` records a genuine rename: the
design tool calls this slot `Content`, code calls it `children`. `reason`
is required — so the next reader knows the rename was a deliberate,
confirmed fact, not a guess.

**Independent variant axes.** `card` has three enum props —
`background`, `borderRadius`, `padding` — each producing its OWN `variants`
entries, matched independently:

```json
"variants": [
  { "when": { "background": "highContrast" }, "background": { "token": "system.color.bg.high-contrast.default" } },
  { "when": { "borderRadius": "lg" }, "borderRadius": { "token": "system.radius.lg" }, "padding": { "all": { "token": "system.inset.lg" } } },
  { "when": { "padding": "none" }, "padding": { "all": "raw(0)" } }
]
```

A `when` can name more than one prop (all must match for that entry to
apply), but there is no cross-product requirement — you don't need one entry
per combination of every axis, only one entry per combination that actually
changes something. `borderRadius: lg` and `padding: none` both touch
`padding`; whichever entries match apply in the order written, later
entries overriding earlier ones for keys they share.

**`raw(...)`** — `"raw(0)"`, `"raw(transparent)"` — a DELIBERATE non-token
value. Explicit so an untokenized value reads as a recorded decision, not
an oversight: `system.radius.none` doesn't exist as a token, so `raw(0)`
says exactly that, on purpose, rather than silently omitting the property.

**Edge-value precedence.** `padding: { "all": ... }` sets every edge;
`{ "block": ..., "inline": ... }` sets the two logical axes; a single named
edge (`blockStart`, `inlineEnd`, …) is most specific. Precedence is
individual edge > axis > `all` — never a positional four-element array,
which v1 used and which is unreadable and silently order-dependent.

## The hardest case: `button`

`button` is the contract with every deviation marker in use, the widest
prop surface, and an anatomy the checker declines rather than guesses at.

### Deviation markers: `code: "none"`, `design: "none"`, `design: "unverified"`

A deviation marker records a **non-derivable fact** about how one side
represents a prop — never a way to paper over a wrong value. The schema's
own words on this are worth repeating verbatim, because getting it backwards
converts real drift into permanent fiction, which is the one thing this
engine exists to prevent: a marker is **never** used to pin a known-wrong
value or casing.

```json
"state": {
  "type": "enum",
  "values": ["resting", "hover"],
  "code": "none"
},
"breakpoint": {
  "type": "enum",
  "values": ["xs", "xl"],
  "code": "none"
},
"iconBefore": {
  "type": "slot",
  "required": false,
  "design": "unverified"
},
"iconSize": {
  "type": "enum",
  "values": ["sm", "md", "lg", "xs"],
  "required": false,
  "design": "none"
}
```

| Marker                        | On     | Means                                                                                                                                                                                                                                                                                                                                                                                               |
| ----------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `code: "none"`                | a prop | Design-only axis. Code must **not** carry it as a prop — `button`'s `state` is realized as the CSS `:hover` pseudo-class, `breakpoint` as an SCSS `@media` query, never as a passed value.                                                                                                                                                                                                          |
| `design: "none"`              | a prop | Code-only axis, the mirror image. `button`'s `iconSize` sizes a rendered `<Icon>`; the design tool's button icons are preset instances at fixed sizes, so there's nothing on that side to compare against.                                                                                                                                                                                          |
| `design: "unverified"`        | a prop | The projection isn't confirmed yet — no finding is raised, no parity is asserted, in either direction. `button`'s `iconBefore`/`iconAfter` carry this because the design tool models the icon as a boolean toggling a preset arrow while code takes a `ReactNode` — the identifier matches on both sides, but the mechanisms genuinely differ, and that hasn't been resolved into a firm claim yet. |
| `design: { name, reason }`    | a prop | A genuine rename — see `card.children` above.                                                                                                                                                                                                                                                                                                                                                       |
| `design: { name, mechanism }` | a prop | Same prop, modelled a different way by construction — see below.                                                                                                                                                                                                                                                                                                                                    |

`code`'s only two values are `none`/`unverified` (no rename shape — nothing
on the code side has a "different name" the way a design tool's slot might).

### A different mechanism, not a different value: `design: { mechanism }`

Some props exist on both sides under one name and still cannot share a type,
because the two tools model them differently **by construction**. Declare the
translation with `mechanism`, and the type comparison runs against the type
that mechanism implies instead of the contract's own:

```json
"topSlot": {
  "type": "slot",
  "required": false,
  "design": {
    "name": "hasTopSlot",
    "mechanism": "toggle",
    "reason": "a design slot always occupies space, so the symbol needs a boolean beside it to hide the region; code just omits the child"
  }
},
"children": {
  "type": "slot",
  "design": { "name": "Label", "mechanism": "text" }
},
"src": {
  "type": "string",
  "design": { "name": "Content", "mechanism": "instance" }
}
```

| `mechanism` | The design side carries | For a prop that in code is                                          |
| ----------- | ----------------------- | ------------------------------------------------------------------- |
| `toggle`    | `boolean`               | a slot whose region the design tool hides with a boolean            |
| `text`      | `string`                | a slot taking arbitrary content, where design takes text            |
| `instance`  | `slot`                  | a plain value (a URL) the design tool can only swap an instance for |

The vocabulary is **closed** — anything else is a real mismatch, and
`design-delta contracts` rejects it. `reason` is required on a bare rename and
optional once `mechanism` is given, since the mechanism already names the
translation; write one anyway when the "why" isn't obvious from the name.

When the design component carries the region itself as a slot beside the
toggle — a slot plus a `has*` boolean is the usual shape of an optional
region — name that slot with `gates` (`toggle` only, and only on a prop whose
own `type` is `slot`):

```json
"eyebrow": {
  "type": "slot",
  "required": false,
  "design": { "name": "hasEyebrow", "mechanism": "toggle", "gates": "eyebrow" }
}
```

The generated binding's true branch then renders that slot
(`figma.boolean("hasEyebrow", { true: figma.instance("eyebrow"), false: undefined })`)
instead of a placeholder, so it is compared like any other mapping, and the
design side must carry `eyebrow` as a slot. Without `gates`, the true branch
is a gap an author fills by hand, and what they write there is not compared.

That true branch is a component instance, so the code prop has to be one a
component instance can fill: `gates` is rejected on any prop whose `type` is
not `slot`, even though `mechanism: "toggle"` itself is legal on `string` and
`boolean` props too (issue #503).

This is a **redirection** of the check, never a suppression: the prop must
still exist under its design name, and the design side must still model it the
declared way. The day someone re-models `hasTopSlot` as text, the finding comes
back — which is exactly what an `exemptions` entry (hides it from every report)
and `design: "unverified"` (drops the presence check too) would not do.

### Styling a state: `when: { "state": "hover" }`

A `code: "none"` prop is not only a parity marker — it is how a contract
binds tokens to an **interaction state**. `state` is a prop like any other
inside `styles.<element>.variants[].when`, and because the contract marks it
`code: "none"`, the style check looks for the pseudo-class that state is
realized as (`:hover`), never for a `.hover` class:

```json
"variants": [
  { "when": { "state": "hover" }, "background": { "token": "system.color.bg.elevation-3.default" } },
  { "when": { "variant": "inverse", "state": "hover" }, "background": { "token": "system.color.bg.elevation-0.inverse" } }
]
```

The design vocabulary is what you write — `hover`, `pressed` (→ `:active`),
`focus`/`focused` (→ `:focus` or `:focus-visible`, whichever one the
stylesheet has; both present is ambiguous and stays unmapped), `disabled`,
`checked`. A multi-key `when` resolves one key at a time, the state last:
`variant: inverse` finds `.cgButton.inverse`, then `state: hover` finds
`.cgButton.inverse:hover` nested under it. Every step must match exactly one
selector; a variant the check cannot place is reported as
`styles/variant-unmapped` (review) rather than silently skipped, so an
unstyled state never reads as a clean one.

### The anatomy that had to decline

`button` renders one of two roots — a Next `<Link>` when `href` is set, a
plain `<button>` otherwise:

```json
"anatomy": {
  "root": {
    "type": "container",
    "element": "button",
    "codeClass": "cgButton",
    "content": { "$prop": "children" }
  }
}
```

The contract above asserts only the `<button>` branch. This is not an
oversight — the anatomy checker reads the component's actual RETURNED tree,
and a component whose render function returns more than one shape produces
`anatomy/coverage-declined` rather than guessing which branch a one-shape
contract is supposed to describe. Declining is the honest answer when the
code doesn't reduce to a single structure; asserting one branch and
silently ignoring the other would be inventing certainty the code doesn't
have.

### `$variants` — saying the other branch out loud

The gap that leaves is in what a contract can **say**, not in what the
walker can see, so ADR-002 gave `anatomy` an optional `$variants` block. It
sits in the same map as the nodes:

```json
"anatomy": {
  "root": {
    "type": "container",
    "element": "button",
    "codeClass": "cgButton",
    "content": { "$prop": "children" }
  },

  "$variants": {
    "asLink": {
      "when": "href is set",
      "root": { "type": "container", "element": "a" }
    }
  }
}
```

**You do not have to write this from scratch.** `scaffold` drafts the block
whenever the census carries the component's branches: the first becomes the
base anatomy, each later one a variant named from its own root element, with
a `when` placeholder marked `_scaffold` for you to replace — see
[`docs/cli.md`'s `scaffold` section](./cli.md#scaffold--draft-a-contract-from-the-props-census-phase-6).

**A variant is a partial override, not a second tree.** Name only the nodes
that DIFFER; everything else is inherited from the base anatomy. `button`'s
two branches differ in exactly one node, so `asLink` is three lines rather
than a duplicated tree — and a node that isn't duplicated can't drift from
its copy.

**`$variants` is not a node name, and cannot be mistaken for one.** A node
name must match `^[A-Za-z][A-Za-z0-9]*$`, so a `$`-prefixed key can never
collide with one. It is the second sigil this map reserves: `^_` is the
first and means "comment, discard"; `$variants` is its opposite and survives
loading, because a later stage reads it. No other `$`-prefixed key is
accepted, in `anatomy` or anywhere else.

**`when` is a note for a human, never a predicate.** This engine is static,
so it cannot know whether `href` is set at runtime — `when` is a free-text
string precisely so it can't be mistaken for something enforced. Variants
are told apart by their **root element** and nothing else, which is why two
variants declaring the same `root.element` — or a variant declaring the base
anatomy's — are rejected at load time with an `ambiguous-variant-root`
diagnostic naming both: the engine will not pick one. (`when` sits flat alongside the node names, so it's the one name a
variant's own nodes may not use.)

**A variant's nodes are checked like any other.** Every node under
`$variants.<name>` answers to the same semantic rules a base node does — an
unknown child, a `content.$prop` or `presentIf` naming an undeclared prop, an
`instanceOf` pointing at no subcomponent — and its diagnostics name the
variant (`anatomy.$variants.asLink.root.children[1]`). Because a variant
resolves to the base tree with its own nodes layered over it, `styles` keys
and `children` references resolve against the **union** of the base and every
variant's nodes: a node only one branch renders is still a real node, so
styling it or parenting it is legitimate.

**A variant overrides the base field by field.** A node the variant names
keeps every field of the base node it does not restate, which is why
`asLink` above changes `root`'s `element` without repeating the `children`
list the base declares. A node the variant does not name at all is inherited
whole.

**Writing the block turns the check on.** Each rendered branch is matched to
the shape claiming its root element — the base anatomy, or one of the
variants — and the matched pair is compared with the same node, content and
attribute rules any single-tree component gets, so `button` with `$variants`
no longer reports `anatomy/coverage-declined`. What the match cannot place is
reported, never guessed: a branch no shape claims is
`anatomy/variant-unexpected`, and a declared shape nothing renders is
`anatomy/variant-missing`. A component whose contract declares no `$variants`
still declines exactly as before, and so does one where the match itself is
ambiguous — two shapes claiming one root element, or a shape with no root
element to match on. `$variants` is a top-level `anatomy` affordance only: a
`subcomponents.<Name>.anatomy` still takes the plain node map.

Because `$variants` is additive and optional, it does **not** bump
`schemaVersion` — see [that section](#schemaversion--which-schema-this-contract-was-written-against)
for the convention.

### The rest of `button`'s props, for reference

```json
"hasUnderline": { "type": "boolean", "required": false, "design": "none" },
"className": { "type": "string", "required": false },
"href": { "type": "string", "required": false },
"onClick": { "type": "function", "required": false }
```

`type: "function"` and `type: "boolean"` need no `values` (that's `enum`
only — the schema rejects `values` on any other type). `className` and
`href` are plain strings the component forwards or branches on.

## Anatomy node types

Beyond `container` (an element wrapping other content) and the plain string
literal already seen, `anatomy` accepts: `text`, `glyph`, `vector`, `slot`,
`instance` (a nested component — `instanceOf` names it, or
`#/subcomponents/<Name>` for one rolled up into this contract), `line`,
`ellipse`, `rectangle`, `polygon`, `star`. A node also carries:

- `children` — child node names, in render order, each name declared
  elsewhere in this `anatomy` block.
- `attributes` — DOM attributes the node must carry, with their literal
  values: `{ "role": "button", "aria-label": "Close", "type": "button" }`.
  This is where a contract pins its accessibility surface. Only what you
  declare is checked — the code setting attributes you didn't name is not
  drift — and a value the code computes is `review`, never an `error`; a
  spread onto the element makes every declared attribute `review`, since
  anything may arrive through it. A bare boolean attribute is `"true"`.
- `presentIf` — the prop name that conditionally renders this node at all.
- `designLayer` — the design-tool layer name, when it differs from the
  node's own name (tool-neutral naming — v1 named this field after its one
  design tool). This is what the design side of `anatomy/*` looks the node up
  by; without it the node's own name is used, folded for case and separators
  (`iconLeft` finds a layer named `Icon Left`). Declare it only when the two
  genuinely differ by more than that.

## Style properties and the token/raw grammar

`styles` accepts only TOKEN-BEARING design properties — never layout
mechanics like flex direction or alignment, which are implementation, not
design contract; including them would turn the contract into a second
stylesheet to keep hand-synced with the real one. The full property list:
`padding`, `margin`, `inset`, `borderWidth`, `borderRadius`, `gap`, `border`
(an object: `width`/`color`/`style`), `background`, `color`, `maxWidth`,
`font`, `fontFamily`, `fontSize`, `fontWeight`, `lineHeight`.

Every value is either:

- **A token reference** — `{ "token": "system.radius.full" }`. The dot-path
  is checked against the project's tokens file; nothing here is pinned to
  any particular namespace (v1 hardcoded `^system\.` and had to patch
  around its own schema at runtime to un-hardcode it — this format never
  repeats that).
- **A deliberate raw value** — `"raw(transparent)"`, `"raw(1px)"` — see
  [`raw(...)`](#adding-complexity-card) above.

Three properties accept a structured grammar instead of (or alongside) a
bare value, each with its own precedence order, most-specific-wins:

- **Edges** (`padding`/`margin`/`inset`/`borderWidth`): `all` < axis
  (`block`/`inline`) < a named edge (`blockStart`/`blockEnd`/`inlineStart`/`inlineEnd`).
- **Corners** (`borderRadius`): `all` < a named corner
  (`startStart`/`startEnd`/`endStart`/`endEnd`).
- **Gap axes** (`gap`): `all` < `row`/`column`.

## `sources`

```json
"sources": {
  "code": { "path": "components/button/button.tsx", "styles": "components/button/button.module.scss" },
  "design": { "fileKey": "…", "nodeId": "…" }
}
```

`sources.code.path` is the only required field anywhere in `sources`.
`sources.design` is deliberately OPAQUE to this schema (ADR-001 D12): the
engine never learns a design tool's own addressing vocabulary — Figma's
`fileKey`/`nodeId` shape is validated by that provider's own `sourceSchema`,
not by `contract.schema.json`. An absent `sources.design` declares no design
counterpart, which is itself a checkable fact — not an error.

**This release checks contract↔code only** (ADR-001 D13/D15). A
`sources.design` block is accepted and stored today, but nothing yet reads
it to check contract↔design parity — that lands in Phase 5, post-release.
Authoring it now is not wasted: the field is already the right shape for
when that check exists.

## `invalidVariantCombinations` — checked on the design side

A list of prop configurations that must never occur:

```json
"invalidVariantCombinations": [
  { "size": "lg", "variant": "ghost" }
]
```

`components/variant-combinations-mismatch` ([issue #403](https://github.com/chrisgriffin/design-delta/issues/403))
reads it, and reports two things at once for one component: a combination the
design component set **publishes** that an entry here forbids, and a
combination the contract **implies** — the product of its enum props' values,
minus every forbidden one — that the design set does not have. It is the
combination-level twin of `components/enum-values-mismatch`, which compares
which values a prop offers rather than which of their combinations exist.

**The matching semantics, exactly:**

- An entry is a **partial** configuration — an AND over only the props it
  names, every other prop irrelevant. `{ "size": "lg", "variant": "ghost" }`
  forbids the two together whatever else is set; `{ "variant": "ghost" }`
  forbids every combination containing it.
- Values match **exactly and case-sensitively**, type included (ADR-001 D1) —
  `"Ghost"` is not `"ghost"`, and `"2"` is not `2`. The one exception is the
  same design boundary `components/enum-values-mismatch` makes: when a
  contract enum's values are all numbers, a design value that is that
  number's exact string form matches, because a design tool's variant options
  are strings by construction.
- Every named prop must be a **declared `enum` prop** with an **in-set
  value**. One that is not fails the contract at load
  (`unknown-variant-prop` / `invalid-variant-value`), the same two
  diagnostics a style variant's `when` gets — an entry that can never match
  is an authoring mistake, not a silent no-op. An **empty entry** is rejected
  by the schema: "every combination is invalid" is not an intent this field
  can express.
- A prop the contract **excludes from the design side** (`design: "none"` or
  `design: "unverified"`) is not compared, so an entry naming it never
  matches — its constraint is unverifiable there. A prop renamed with
  `design: { "name": … }` is read under its design name.

**What it needs to run at all.** The rule is silent — never "the two sides
agree", always "there is nothing to compare" — unless all of these hold:

- the contract declares at least one `invalidVariantCombinations` entry
  (this field is what turns the check on; a contract without one is never
  compared this way),
- a bindings gather has run for the component — `gather --bindings` then
  `ingest --bindings`, which is what puts `variantCombinations` on its
  `design-components.json` entry, and
- the design set's combinations name every compared enum prop — when they
  don't, the two sides disagree about the prop set itself, which
  `components/prop-missing` / `components/prop-unexpected` already report
  per prop.

**Never checked against code, deliberately** — [issue #111](https://github.com/chrisgriffin/design-delta/issues/111).
A component's code-side props are a TYPE — an enum of possible values per
prop — never an enumeration of which combinations actually get rendered
together, so a static code extractor has no signal to check this against.
That is true even when a component's author expressed the constraint via a
TypeScript discriminated union: this engine's extractor classifies each prop
independently and does not resolve cross-prop type dependencies. A design
tool's component set does enumerate its variants, which is why the design
side can check what the code side cannot.

It ships at `review` severity until it has been adjudicated against a real
project — no contract had exercised the field when the rule was written, so
nothing yet measures how often a design set legitimately omits a combination
its contract implies.

## Subcomponents

Rare — one occurrence in the whole v1 corpus this format migrated from — so
this is a pointer, not a worked example: `subcomponents` rolls up an
internal component with no independent design-tool symbol and no standalone
usability. It repeats the top-level shape minus `sources.design` (a rolled-up
component has nothing to address independently), and `anatomy` references it
via `instanceOf: "#/subcomponents/<Name>"`. See
[`schema/contract.schema.json`](../schema/contract.schema.json)'s
`subcomponent` definition for the exact fields.

## `intent` — what the API surface cannot say

Every other field in a contract is a checkable fact. `intent` is the one
block that is not: it tells a reader — a person, or an agent choosing
between components — when this component is the right choice and when it
is not.

```json
"description": "A short, standalone call to action.",
"intent": {
  "usedFor": "One primary action per view: submit, continue, confirm.",
  "misusedAs": "Navigation between pages, or as a toggle.",
  "useInstead": "link-cta for navigation; chip for a toggle.",
  "verifiedAgainst": "0d5608d7dc59e16258b278f952e318a2befcecb99ef130d2e6f3fb1cb046587f"
}
```

`description` is the purpose line and already exists — `intent` does not
repeat it. Write the three prose fields so that two people describing the
same component would land on comparable text: name the _situations_
(`usedFor`), the _mistake_ (`misusedAs`), and the _component_ to reach for
instead, by its contract id (`useInstead`), so the pointer can be followed.

The engine cannot check whether the text is true. It checks whether the
text is **about the current code**: `verifiedAgainst` is the component's
`codeHash` — the same `hashJson` of its props census that `snapshot`
writes to `state.json` — at the time the text was last reviewed.
`components/intent-unverified` (review) fires when the block has no hash,
and `components/intent-stale` (review) when the props have changed since;
both messages carry the current hash, so recording it is a paste, never a
lookup. Paste it **whole** — the check is an equality against the full
sha256 digest, so a shortened prefix would be permanently stale; the schema
requires all 64 hex characters rather than letting that value through.
A contract with no `intent` block is checked for nothing here.

## `schemaVersion` — which schema this contract was written against

The contract schema carries a top-level `version` (today: `1`), and a
contract may state which one it targets:

```json
"schemaVersion": 1
```

Absent means current, so an unannotated contract is always read as the
schema the engine ships — `scaffold` stamps the value, hand-authored
contracts may leave it out. It is an integer, not semver: this package is
`0.x` and promises no compatibility between releases, so the honest thing
to count is **breaking schema changes** and nothing else.

The convention, which is what makes the number worth writing down:

- **Bumps only when a contract that validated before would not validate
  after** — a field removed, renamed, re-typed, or made required.
- **Never bumps for an additive optional field.** Every contract written
  against the older schema still validates, so there is nothing to detect.

What the engine does with it:

| Contract says              | Engine reads | Result                                                                                                                                            |
| -------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| newer than the engine      | older        | refused with `contract-schema-newer`, before validation — the fix is to upgrade the engine, and "unknown key" would have been the wrong diagnosis |
| older, still validates     | newer        | nothing — the change since was additive                                                                                                           |
| older, no longer validates | newer        | the schema errors, preceded by one `contract-schema-outdated` naming both versions — so a stale contract reads as "migrate", not "typo hunt"      |

No migration tool exists. Knowing a contract is stale is the prerequisite;
rewriting it is separate work.

## Validating what you wrote

```bash
design-delta contracts               # every contract under paths.contractsDir
design-delta contracts --dir <path>  # a specific directory instead
```

Exits `0` when every contract validates against the schema (including the
vacuous case of none authored yet), `1` when anything produced a
diagnostic. `--json` for a machine-readable summary.

A contract that doesn't validate makes every finding downstream of it
meaningless — this is the command to run first, and the one CI should run
ahead of everything else.

## What happens next

Once a contract validates, `design-delta audit` (or the composed
`design-delta verify` CI gate) compares the real component against it —
props, anatomy, styles, token bindings — and reports where they disagree.
See the [config reference](./config-reference.md) for how a project points
the engine at its own `componentsDir`/`tokensFile`/conventions, and the
[README](../README.md) for the full command list.
