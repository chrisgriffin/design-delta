# Spike: `@terrazzo/parser` fit for the tokens module

Whether `@terrazzo/parser` parses and resolves a real design system's DTCG
token file well enough for the tokens module to build on.

- **Date:** 2026-07-30 · **ADR:** ADR-001 Phase 0.5 spike #3 (D10)
- **Method:** parsed a consumer's real `tokens/json/tokens.json` with
  `@terrazzo/parser@2.5.0` (`parse()` + `defineConfig()`), read-only, file
  untouched.

## Verdict: **adopt-after-cleanup**

The file is two alias fixes away from parsing clean. With those patched
in-memory, Terrazzo parses **657 tokens** with full alias resolution
(`aliasOf` chains resolved, e.g. `base.lineHeight.16 → base.spacing.16`) and
modern DTCG color objects (`colorSpace`/`components`) accepted natively.

## Findings

1. **As-is, parsing fails** on the first unresolvable alias. Exactly **2 of
   314** aliases are the problem — both `focusRing` entries reference the
   _logical_ `system.*` namespace (`{system.color.border.primary.default}` /
   `…inverse}`), which doesn't physically exist: the file's top-level groups
   are Figma-style `base`, `system/light`, `system/dark`. The other 312
   aliases resolve literally.
   **~~Cleanup (a consumer project side):~~ RETRACTED 2026-08-04 — do not apply.**
   This proposed pointing each alias at its mode-qualified target
   (`{system/dark.color.border.primary.default}`,
   `{system/light.color.border.primary.inverse}`), "verified to make the parse
   succeed." That verification was against `@terrazzo/parser` parsing
   `tokens.json` DIRECTLY, which is not what that project does: a project-owned
   prep step folds every `system/<mode>.color.*` group into one `system.color.*`
   before the parser runs, so the **bare** form is the only one that resolves in
   the document Terrazzo actually reads. Applying this cleanup fails that
   project's token build outright (`parser:init: Could not resolve alias`).
   The aliases are correct as authored. See
   [#176](https://github.com/chrisgriffin/design-delta/issues/176) — the engine
   now reads `paths.resolvedTokensFile` so it judges the parsed document rather
   than asserting the authored one is broken.
   **Superseded for this shape by
   [#564](https://github.com/chrisgriffin/design-delta/issues/564):** the
   engine reads two or more `x/<mode>` top-level sets as modes of `x` when it
   resolves aliases, so these two `focusRing` entries need no
   `paths.resolvedTokensFile` and are censused rather than excluded. The field
   still owns every prep step that inference does not cover — a rename, and a
   reference that resolves only in a SIBLING mode's set, which is deliberately
   left alone so no mode's value stands in for another's.
2. **Mode semantics stay our layer.** Terrazzo treats `system/light` and
   `system/dark` as ordinary separate groups (277 base-tier + 146
   system-tier ids among the 657). Collapsing them into one logical token
   with modes — v1's `tokenMapping.collections` job — remains engine work in
   `modules/tokens.mjs`. Terrazzo replaces parsing/validation/alias
   resolution, not the mode model.
3. **Its lint layer runs on this file out of the box** — `core/consistent-naming`
   flagged every numeric scale name (`base.borderWidth.0` etc.) against its
   default kebab-case rule. Two implications for Phase 3: the delegation path
   is real, and its defaults must be explicitly configured (numeric scale
   names are intentional in this system; default-on rules would be false
   positives).

## Consequences for the plan

- D10 stands: adopt `@terrazzo/parser` for Phase 1's code-side token loading.
- Add the 2-alias cleanup to the a consumer project prep list (before slice 1a
  runs against it).
- Phase 3 lint delegation must ship a Terrazzo lint config, not inherit
  defaults.
