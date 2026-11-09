# Spike: what to delegate to `@terrazzo/parser`'s lint layer, and what to port

Which token lint rules to delegate to `@terrazzo/parser` and which to port,
measured rather than assumed.

ADR-001 Phase 3 opens with an instruction rather than a design: _"first map
which token rules `@terrazzo/parser`'s lint layer already covers — delegate
those, port the rest."_ This is that map.

Two sources of truth were read: Terrazzo 2.5.0's `RECOMMENDED_CONFIG` (run
against a real design system's `tokens.json`, 657 leaves), and v1's
`drift-lint.mjs` reference, recovered from git history — 18 rules, since
deleted with the rest of v1 (D14).

## Terrazzo ships real rules, not just a harness

`lintRunner` plus 17 `core/*` rules. Measured against a real token file:

| rule family               | findings | verdict                          |
| ------------------------- | -------: | -------------------------------- |
| `core/valid-*` (16 rules) |    **0** | **delegate** — free, and correct |
| `core/consistent-naming`  |  **798** | delegate ONLY when configured    |

**The `valid-*` family is a clean win.** `valid-color`, `valid-dimension`,
`valid-typography`, `valid-shadow`, and the rest check that a token's `$value`
actually matches its `$type`. They found nothing on a real system — which is
the point: they cost nothing on a healthy design system and catch genuinely
malformed tokens. Reimplementing them would be pure duplication of DTCG spec
knowledge that Terrazzo already tracks.

One thing that measurement corrected: on a synthetic fixture, `valid-color`
fires on every hex-string color, demanding DTCG's object notation
(`"#ff0000"` → `{colorSpace, components}`). That looked like a guaranteed flood
until the real file was counted: **0 hex-string colors, 132 in object form.**
The design system is already modern DTCG. The rule is safe here — but the
result depends entirely on the consumer's token vintage, so it is delegated as
a rule a consumer can turn off, not as an assumption.

**`consistent-naming` cannot ship on by default.** 798 findings on 657 leaves,
every one of them the same non-defect: the rule defaults to `kebab-case`, and
this system is camelCase with numeric segments (`base.borderWidth.0`,
`base.color.neutral50Opaque.05`). v1's own `naming/camel-case` rule allowed
"camelCase, pure numeric, or a recognized t-shirt keyword" — i.e. v1 had
already discovered that a naming rule is meaningless without the project's
naming convention. Delegated, but off unless configured.

## v1's 18 rules, triaged

The filter is CLAUDE.md's hard rule: **nothing consumer-specific, anywhere.**
Several v1 rules fail it outright — they encode one design system's vocabulary
as engine truth, which is exactly the leak this rewrite exists to not repeat.

### Already implemented in the rewrite (do not rebuild)

| v1 rule                       | now                                            |
| ----------------------------- | ---------------------------------------------- |
| `hygiene/stale-var-reference` | `tokens/var-unresolved`                        |
| `hygiene/dead-primitive`      | `tokens/token-unreferenced` (review; see #106) |
| `structure/dtcg-shape`        | Terrazzo's parse + `core/valid-*`              |

### Delegate to Terrazzo

`naming/camel-case` → `core/consistent-naming` (configured), and the whole
`core/valid-*` family, which v1 had no equivalent for.

### Port, but ONLY config-driven

These encode a real, widely-held idea whose _vocabulary_ is consumer-specific.
Each needs its namespaces/enums read from config, never hardcoded:

- `tier/base-no-alias`, `tier/system-must-alias-base`,
  `tier/component-must-alias-system` — the "tiers alias downward, primitives
  hold raw values" idea is general; the literal names `base`/`system`/
  `component` are one project's. Config supplies an ordered tier list.
- `scale/tshirt-canonical`, `scale/no-legacy-ordinal` — a canonical ordered
  scale is general; the enum is not.
- `state/vocabulary` — a closed set of state names is general; the set is not.
- `color/monotonic-ramp` — "a numeric ramp's lightness moves monotonically" is
  a genuinely general invariant, but which paths are ramps is not.
- `component/file-bundle`, `component/kebab-case-dir`, `component/line-budget`
  — the conventions already exist in config (`stylesSuffix`,
  `nonComponentFileSuffixes`); the budget is an option with no honest default.
  All three shipped or were scoped, then later removed/dropped entirely
  (2026-08-06, #142) — not because this categorization was wrong at the time,
  but because design-delta's mission was drawn narrower afterward: design↔dev
  parity and design-system governance, not general code quality. Left as-is
  here rather than recategorized under "Drop" below, since that would
  misrepresent what this spike concluded when it was written.

### Drop — consumer-specific, no general rule underneath

- `naming/compound-word-review` — a curated word list (`extrawide`,
  `uppercasewide`, `headingalt`, `highcontrast`). One project's vocabulary.
- `structure/duplicate-namespace` — hardcoded to a single known pair
  (`base.size` vs `base.sizing`). Not a rule, a note about one repo.
- `color/no-hue-at-system` — assumes a specific `system.color.{fg,bg,border,
gradient}` shape.
- `typography/fluid-pair` — v1 itself marked it "likely dormant".

## Consequences for Phase 3

1. The lint module is **smaller than v1's 2,005 lines by construction**: three
   rules are already built, seventeen are delegated, and four are dropped.
2. Terrazzo's findings must be **mapped onto the D5 finding shape** so `lint`
   output is indistinguishable from every other surface — one report, one
   severity mechanism, per D5.
3. Terrazzo's parser **throws** where our census degrades: the real token file
   has two unresolvable aliases that our tokens module already reports as
   diagnostics, and `parse()` refuses the whole file over them. The lint path
   must not be able to fail a run that `audit` survives.
4. No ported rule may hardcode a namespace, an enum, or a word list. A rule
   with nothing configured stays **silent**, never guesses — the same posture
   `element-unmapped` and `prop-type-unresolved` already take.
