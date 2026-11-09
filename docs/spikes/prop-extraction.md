# Spike: extracting a component's prop surface (`react-docgen-typescript` vs. our own)

Whether `react-docgen-typescript` reads a component's prop surface well
enough to stand in for a hand-written extractor.

- **Date:** 2026-07-31 · **Issue:** #98 · **ADR:** D10 (buy the undifferentiated
  parts) told us to spike `react-docgen-typescript` before writing an extractor.
- **Method:** ran `react-docgen-typescript@2.4.0` against a real design system's
  components on three TypeScript versions, read-only.

## Verdict: **write our own** against the TypeScript compiler API

Not the answer D10 hoped for. The library gets the easy things right and fails
the specific thing this check is built on.

## What it does well

Against a real `Button` whose props type is an intersection —
`{…local…} & LinkContentProps & ButtonHTMLAttributes<…> & AnchorHTMLAttributes<…>`:

- **Enum unions resolve with their values** (`size?: "sm" | "md" | "lg"` →
  `values: [sm, md, lg]`). This was the main question and it passes.
- **Defaults are read** from destructuring (`size = "md"` → `md`).
- **First-party intersection arms are included** while React's DOM attribute
  types are excluded — 9 props instead of 300 — via
  `propFilter: p => !p.parent || !/node_modules/.test(p.parent.fileName)`.
  Notably this is the exact case the old engine needed a dedicated fix for.

## Why it still loses

1. **It silently drops `children`.** Even declared first-party as
   `children: string`, no key matching `/child/i` appears in the output — at any
   filter setting, including no filter at all (300 props, none of them
   `children`). Verified against a second component: its first-party `label`
   is present, `children` is not, so this is specific to `children` rather than
   a filtering artifact.

   This is disqualifying on its own. A contract that declares `children` — the
   real one does, carrying a design-side rename deviation — would produce
   **"contract declares `children`, code does not"**: a false finding, on the
   first component, from the check whose entire acceptance gate is _zero false
   findings_. Working around it means reading `children` from the AST ourselves,
   i.e. writing part of the extractor anyway.

2. **It crashes on TypeScript 7.** `TypeError: Cannot read properties of
undefined (reading 'React')` at `ts.JsxEmit` — TS 7 is the Go rewrite and its
   Node API surface moved. Fine on 5.9.3 and on 6.0.3 (what the consuming
   project runs today), so this is a future risk rather than a present blocker,
   but it is a risk on a dependency we would not control.

3. **Enum values carry `undefined` as a member** (`[undefined, "sm", "md",
"lg"]` for an optional prop), so every value list needs post-filtering.

4. **First-party detection depends on `parent === undefined`**, which is
   incidental behavior rather than a documented contract.

That is four adaptations layered over someone else's abstraction, one of which
means writing extraction code regardless.

## Consequences

- `src/sources/react/extract.mjs` reads the prop surface directly from the
  **TypeScript compiler API**: exact control over intersection walking, over
  `children`, and over what counts as first-party.
- `typescript` becomes an **optional peer dependency**, loaded lazily at call
  time, so a consumer who never runs the components check does not need it
  installed. (The old engine did this for a second reason too — importing the
  compiler eagerly crashed under jsdom.)
- The three behaviors above become **fixture tests**: `children` declared
  first-party is extracted; an optional enum's values exclude `undefined`;
  React's DOM props are excluded while a first-party intersection arm is kept.
  They are the cases that decided this, so they are the cases that must not
  regress.

## What would change this

If `react-docgen-typescript` ever reports `children`, the calculus flips — the
other three issues are all workable. Worth re-checking at a major bump rather
than never.

## Follow-up: the program has to be built with the project's `paths`

Owning the compiler API means owning its configuration, and the first real
contract authored against a live design system found that we had not.

The engine built its program from a hardcoded set of compiler options with no
`baseUrl` and no `paths`. Any prop whose type came through a path alias
(`import type { Theme } from "@/lib/theme"`) therefore could not resolve;
TypeScript handed back the **error type**, and the classifier — which had no
case for "unresolved" — fell through to its `slot` default. A prop typed
`"light" | "dark"` was reported as a slot, and the parity check turned that
into a confident `error`-severity mismatch against a contract that was right.

Two things were wrong, and both mattered:

1. **The options.** Only `baseUrl` and `paths` are read out of the consumer's
   `tsconfig.json` — deliberately not the rest. This program exists to read
   types, not to reproduce the project's build; inheriting `strict` would
   change what an optional prop's type even is, and the engine's answer must
   not depend on how the consumer compiles.
2. **`baseUrl` is not optional in practice.** `paths` entries are relative
   (`"@/*": ["./*"]`) and TypeScript resolves them against `baseUrl`, falling
   back to the _current working directory_ when it is unset. The engine runs
   from its own directory, so a tsconfig that omits `baseUrl` — the common
   case — resolved every alias into the wrong tree. It is pinned to the
   tsconfig's own location.

Measured across the same design system, `unknown` fell from 8 props to 2 and
the resolved enums rose accordingly.

The deeper fix is the classifier's, though. **An unresolved type is not a
slot.** `slot` is a claim about shape; the error type means we could not look.
It now classifies as `unknown`, detected by _type flags_ rather than by
stringifying — the error type prints as the alias's own name (`"Theme"`), not
`"any"`, so a string comparison never sees it. The parity check declines the
comparison for an `unknown` and emits `components/prop-type-unresolved` at
`review`, so the gap stays visible instead of becoming a false finding — the
same posture the token and style checks already take toward what they could
not resolve.
