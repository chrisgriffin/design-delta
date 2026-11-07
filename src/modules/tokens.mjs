/**
 * tokens.mjs — token parity (ADR-001 D3/D5/D13, Phase 2a, issue #102): the
 * FIRST checker of Phase 2, comparing the codebase's own two censuses against
 * each other. Still design-tool-free (D13 — Phase 5 adds the spec↔design
 * half); this checker is entirely spec↔code.
 *
 * PURE: `runTokensCheck(tokenCensus, cssVarCensus, config) => findings[]`.
 * Never touches fs or network — `sources/code.mjs`'s `censusTokens`/
 * `censusCssVars` build both censuses; this module only ever compares two
 * already-loaded values in memory, the same layering contract
 * `modules/components.mjs` documents: a module that can reach the filesystem
 * cannot be driven by injected fixture data, which is how every domain module
 * here is hardened one module at a time (ADR-001's working method).
 *
 * D3's model: the project's DTCG `tokens.json` IS the token contract, so this
 * checker treats `tokenCensus.tokens` as the fixed point and `cssVarCensus.vars`
 * as the code's own account of what it emits and consumes. Each var entry
 * carries `declarations` (a literal `--x: value;` assignment) and `usages` (a
 * `var(--x)` reference) tracked SEPARATELY (`sources/code.mjs`) — this module
 * reads them as answers to two different questions: "did code write this
 * value down?" vs. "does code read this value?".
 *
 * VALUE COMPARISON, AGAINST THE BUILD'S OUTPUT (issue #627). D3 calls a
 * stale emitted value a finding but leaves the build itself to the consumer,
 * so the engine never runs a transform; it reads what the build already
 * wrote. `paths.styleRoots` is that path — it names where a project's
 * generated token stylesheets live — and `censusCssVars` lists each of their
 * declarations as `emitted`. `tokens/emitted-value-mismatch` compares every
 * one a token maps to (by `candidateVarName`) against that token's
 * `cssValue`, after `canonicalCssValue` on both sides: an emitter writing
 * `rgb(90.588% 88.235% 83.529%)` for `#e7e1d5` is the same color, and a naive
 * string compare reported 238 such false mismatches on a real design system.
 * A token's modes share one var and the engine cannot map a selector
 * (`[data-theme="dark"]`) to a mode, so agreement with ANY mode is silence.
 *
 * ---------------------------------------------------------------------------
 * THE MAPPING — token id ↔ custom-property name (read this before touching
 * anything below)
 * ---------------------------------------------------------------------------
 *
 * A token id is a DTCG dot path (`color.bg.primary`); a custom property is
 * `<cssVarPrefix><something>`. Nothing in the engine's inputs says what
 * `<something>` is — how a project's build turns tokens.json into CSS is the
 * consumer's business (D3), so this module never assumes a project's
 * namespace (the same leak ADR-001 forbids for directory names and file
 * keys, applied here to a naming convention instead).
 *
 * The one HYPOTHESIS this module tries, entirely config-driven off
 * `conventions.cssVarPrefix` — never a hardcoded namespace (`candidateVarName`
 * below):
 *
 *   1. Dash-join the id's segments: `color.bg.primary` -> `color-bg-primary`.
 *   2. Prepend the prefix as-is: `--color-bg-primary`.
 *   3. ONE refinement, still derived only from the same config value: if the
 *      id's OWN first segment textually equals the prefix's "root" (the
 *      prefix with its leading/trailing `-` stripped — `--acme-` -> `acme`),
 *      that segment is folded away before joining. A project whose token file
 *      groups everything under its own brand name AND prefixes its custom
 *      properties with that same name did not mean to say the name twice:
 *      `acme.color.fg` under prefix `--acme-` hypothesizes `--acme-color-fg`,
 *      not `--acme-acme-color-fg`. This still reads nothing but the prefix
 *      already in hand — it is not a second, independent guess.
 *
 * ONE TOKEN IS NOT ALWAYS ONE VAR. A DTCG COMPOSITE type (`typography`,
 * `border`, `shadow`, …) has an object `$value` whose keys are sub-properties,
 * and every emitter flattens each key into its own custom property —
 * `--x-font-size`, `--x-line-height` — usually alongside an `--x` shorthand
 * built from them. So the hypothesis above yields a SET of candidate names,
 * not one (`candidateVarNames`), and a token counts as referenced when ANY of
 * them is used. Assuming one-token-one-var reported every emitted sub-property
 * as `token-untracked` AND the token itself as `token-unreferenced`: 280 + 45
 * false findings on a real design system, the same double-report the
 * kebab-case rule fixed one layer down.
 *
 * That expansion is keyed on `$type` and never on "the value is an object" —
 * `color` and `dimension` normalize to objects too, and expanding them would
 * invent names no emitter writes (see `COMPOSITE_TYPES`).
 *
 * A candidate is a HYPOTHESIS, never a verdict. Whether it is safe to say
 * "this token IS this var" is decided by matching it against what
 * `cssVarCensus` actually observed, never by trusting the string transform on
 * its own — which is where every false finding in this checker would
 * otherwise come from.
 *
 * WHERE THIS MODULE STAYS SILENT (the hard requirement of this check):
 *
 *   - A token whose id, after the fold above, has nothing left to join (its
 *     id IS exactly the prefix's root, with no further segments) produces NO
 *     candidate and NO finding — an empty transform result is not a var name,
 *     it is a sign the hypothesis does not apply to this token, and guessing
 *     further would be exactly the false-finding class this check exists to
 *     avoid (`candidateVarName` returns `null`; every rule below treats a
 *     `null` candidate as "say nothing about this token").
 *   - `cssVarCensus.vars` scans only the configured component root
 *     (`sources/code.mjs`'s documented scope) — a real project's generated
 *     token stylesheet may live entirely outside it. So a USED var with no
 *     visible declaration is not automatically wrong: if it matches a
 *     token's candidate name, the token contract itself is treated as that
 *     var's resolution (D3 — the contract IS the source of truth) and
 *     `tokens/var-unresolved` stays silent for it. That rule fires only for a
 *     used var that matches NO token at all — the one case a build-scope gap
 *     cannot explain away.
 *
 * ---------------------------------------------------------------------------
 * THE DESIGN SIDE (ADR-003 Phase 5.3 + Amendment 4, `designTokenCensus`)
 * ---------------------------------------------------------------------------
 *
 * Two steps per design variable. First, IDENTITY by name — as a candidate
 * set, never a verdict (`candidateTokenIds`, ADR-003 Amendment 4, issue
 * #280): the variable's name is split on `/`, each segment folded, and every
 * code token whose trailing id segments equal it is a candidate (a
 * single-segment name only the token directly under a root; mode heads
 * collapsed; a `design.options.codeAuthoritativeGroups` prefix dropped; a
 * `$type` an unmistakable value shape rules out dropped; a
 * `design.options.tokenMap` entry the answer outright). Measured on a real
 * 171-variable corpus before it was written: 131 map to exactly one token
 * with no config at all. Exactly one candidate asserts identity and
 * compares THAT token's value — `tokens/design-token-mismatch` (error) when
 * both sides have one comparable form (`comparableForm`) and it differs;
 * more than one is `tokens/design-token-ambiguous` (review), listing them.
 *
 * Second, COVERAGE by value, for everything identity could not settle: a
 * variable with no candidate, or one whose identity is known but whose
 * value has no comparable form against it (a composite, an `em` against a
 * bare number) — `tokens/design-value-untracked`: does the value show up
 * ANYWHERE in the code-side census. This is what #268 shipped alone, and
 * it stays coarse on purpose: it can only say "this value has no code
 * counterpart," never which token.
 *
 * The component-side evidence against name matching (39 `nameAliases`) does
 * not transfer here: a component carries a `nodeId` address in its
 * contract; a token has no address on either side, so a name candidate
 * held to `candidateVarName`'s own unique-or-null discipline is the only
 * identity available.
 *
 * `designTokenCensus.entries[].value` is compared against every code
 * token's `cssValue` (never the raw DTCG `$value` — a color's raw value is a
 * structured object, never a string a design tool's flat value could equal;
 * `cssValue` is the one already-CSS-shaped string form both sides can
 * plausibly agree on), through THREE narrow, measured normalizations
 * (`normalizeValueForCompare`), all lossless CSS-spec transforms, not
 * heuristics: lowercased; a value that is WHOLLY one CSS string has its
 * quotes removed (`resolveTokenCssValue` quotes a font family whose name
 * contains a space — correct CSS, and the reason every `fontFamily`
 * variable was reported untracked while its code counterpart held the
 * identical text, issue #346 — while a multi-family stack keeps every quote
 * it has, since unwrapping there would splice two families into one
 * string); a bare numeric CSS value with a trailing `px` has that unit
 * stripped (a design provider's spacing/radius/border-width values come
 * back unitless, e.g. `"16"`, where the equivalent `cssValue` is `"16px"`);
 * and a 3- or 4-digit hex color is expanded to 6 or 8 digits (`cssValue`
 * minifies to shorthand whenever every byte's two hex digits repeat,
 * `#111111` -> `#111` and `#00000033` -> `#0003`, so an un-minified design
 * value for the exact same color would otherwise never match). No other
 * unit or format is touched; these are
 * three narrow, measured fixes, not a general unit-conversion engine.
 *
 * An entry with NO value — `""`, whitespace, or absent — is never compared
 * at all (issue #347). "Does not match any code token's value" would state
 * the outcome of a comparison the engine never performed: it read no value,
 * so it knows nothing about whether the two sides agree. `ingest` drops
 * such an entry with a stated skip reason before it can reach a snapshot;
 * the guard here is what keeps an already-committed snapshot, written
 * before that, from producing the same unactionable finding.
 *
 * PER-MODE COMPARISON — per mode, not one folded value (issue #404). A code
 * token set declares one token per mode (`system/light.color.fg.default`,
 * `system/dark.…`) and a design variable carries one value per mode in
 * `values`. Comparing a single folded value against ALL of them — agreement
 * with any mode is silence — cannot see a dark-mode value drifting on its
 * own, which is the whole gap this closes. When the two sides share at least
 * one mode NAME (folded for case and separators, so `Light` meets `light` and
 * `High Contrast` meets `high-contrast`), each shared mode is compared
 * against its own code token and `tokens/design-token-mismatch` names the
 * mode; a mode present on only one side is `tokens/design-mode-missing`
 * (`warn`), in both directions.
 *
 * A SHARED MODE NAME IS THE GATE, and it is what keeps this from firing on
 * data that cannot answer it (`compareModes` documents each case): a legacy
 * census with no `values` at all, an unthemed code token, and a design
 * collection whose only mode is the tool's placeholder name each share
 * nothing, so the folded comparison runs unchanged and no mode finding is
 * raised. Measured on the consuming project's committed snapshot before this
 * was written — 171 variables, zero carrying `values` — that is the live
 * shape, not a hypothetical.
 *
 * A per-mode `tokenMap` entry (issue #646) is the other way a variable gets
 * modes on the code side: `{"sm": "acme.layout.sm.gutter", "lg": […]}` names
 * one code token — or several, a tier and the base token that aliases it —
 * for each of the variable's modes, for a token set whose modes are not set
 * heads (a breakpoint tier). Each named token is stamped with its entry's
 * mode, so the two sides share that vocabulary by construction, and
 * `compareModes` pairs and compares them mode by mode exactly as above. Every
 * named token is claimed for parity; an id the code census lacks is
 * `tokens/design-token-map-unknown`, its mode is not also reported missing,
 * and an entry with no known id at all counts as design-only.
 *
 * The reverse direction — a code token with no design counterpart — is
 * deliberately NOT checked: the design census only covers whatever a
 * project's ADDRESSED contracts happened to gather (a fraction of the full
 * token file, unlike the code-side census which is exhaustive), so "no
 * design counterpart" would overwhelmingly mean "not sampled," not "missing"
 * — the same reasoning that keeps `tokens/token-unreferenced` from
 * splitting "never emitted" from "emitted outside the scanned tree" until
 * `paths.styleRoots` shows the census the token stylesheets (issue #562).
 */

import {
  compareEntities,
  makeFinding,
  sortFindings,
} from "../core/findings.mjs"
import { createRegistry, resolveRuleConfig } from "../core/rules.mjs"
import { resolveConfig, resolveTokenMapping } from "../core/config.mjs"
import { matchesEntity } from "../core/exemptions.mjs"
import { formatList } from "../core/text.mjs"
import { foldDesignName } from "./token-folding.mjs"
import { parseColor } from "@terrazzo/token-tools"
import { transformCSSValue } from "@terrazzo/token-tools/css"

// ---------------------------------------------------------------------------
// The rule registry for this module (ADR-001 D5's "one registry" — each
// domain module builds its own from the shared `core/rules.mjs` primitives).
// ---------------------------------------------------------------------------

export const RULES = [
  {
    id: "tokens/token-unreferenced",
    surface: "tokens",
    // Informational, never an error: most of a real design system's tokens
    // are not referenced by any one component set. Since issue #562 this is
    // the "emitted but unused" half — a token whose var is declared nowhere
    // goes to `tokens/token-unemitted` instead, but only when the census can
    // see the token stylesheets (`paths.styleRoots`, all on disk). Without
    // them it cannot tell "never emitted" from "emitted outside the scanned
    // tree", and this rule keeps both.
    defaultSeverity: "review",
    description:
      "No component references this token and no other token aliases it. When `paths.styleRoots` is configured and the token's var is declared nowhere in the scanned code, `tokens/token-unemitted` reports it instead.",
    // `ignorePrefixes` scopes the check by TOKEN ID PREFIX (issue #182).
    //
    // A design system deliberately keeps a colour ramp or spacing scale
    // complete even when the current component set consumes only part of it.
    // An unused primitive is raw material; an unused semantic token is dead
    // design-system surface. Only the second is worth a human, and without a
    // way to say so a project's only option was turning the whole rule off —
    // losing the second along with the first. Measured on a real design
    // system: 135 of 230 findings were primitive-scale steps.
    //
    // DEFAULTS TO EMPTY, and the project supplies its own prefixes. This
    // engine must not acquire an opinion about what "base" means or which
    // tier is primitive — that is a fact about a consumer's token
    // architecture, not about drift.
    //
    // `ignoreSources` scopes it by WHERE a token is authored instead (#640):
    // `*`-globs, the same form `exemptions` uses, matched against each token's
    // source file when `paths.tokensFile` is a directory. A project whose tiers
    // are folders (`primitives/`, `semantics/`) rather than id roots has no
    // prefix to name — its primitive and semantic ids share one `color` group.
    // Same rule as above: empty by default, the globs come from the project.
    options: { ignorePrefixes: [], ignoreSources: [] },
  },
  {
    id: "tokens/token-unemitted",
    surface: "tokens",
    // The other half of `tokens/token-unreferenced` (issue #562). `review`
    // like that rule: an unemitted token is often a deliberate design-only or
    // primitive token, and only a project can say which. Scoped by
    // `tokens/token-unreferenced`'s `ignorePrefixes` and `ignoreSources` — one
    // knob for both halves — so it declares no options of its own.
    defaultSeverity: "review",
    description:
      "No component references this token, no other token aliases it, and its var is declared nowhere in the scanned code — the build never emitted it. Raised only when `paths.styleRoots` is configured and every root exists; scoped by `tokens/token-unreferenced`'s `ignorePrefixes` and `ignoreSources`.",
  },
  {
    id: "tokens/emitted-value-mismatch",
    surface: "tokens",
    // `warn`, not `error`: identity is the same candidate-name hypothesis
    // every rule here uses, and the value canonicalization below is measured
    // on one real corpus (341 of 341 comparable declarations agreed). A
    // syntax it does not know yet should cost a warning, not a red `verify`.
    defaultSeverity: "warn",
    description:
      "A token's var is declared in a stylesheet under `paths.styleRoots` with a value that matches none of the token's values, in any mode — the build's output disagrees with tokens.json. Colors, `rem` and `var()` references are compared after canonicalization; a font stack may append fallbacks. Raised only when `paths.styleRoots` is configured and every root exists; silent when either side keeps an unresolvable `var()`.",
  },
  {
    id: "tokens/token-untracked",
    surface: "tokens",
    defaultSeverity: "warn",
    description:
      "A CSS custom property is declared in code with no token in the contract mapping to it — a hand-written value that escaped the token system.",
  },
  {
    id: "tokens/var-unresolved",
    surface: "tokens",
    defaultSeverity: "error",
    description:
      "A component uses var(--x) for a custom property with no declaration anywhere in the scanned code and no token in the contract accounting for it — almost always a typo, and a real bug.",
  },
  {
    id: "tokens/design-token-mismatch",
    surface: "tokens",
    defaultSeverity: "error",
    description:
      "A design variable maps to exactly one code token by name (ADR-003 Amendment 4's candidate rule, or an explicit `design.options.tokenMap` entry), and their resolved values differ — per mode, naming the mode, when both sides are mode-scoped and share a mode name; otherwise on the one folded value. This specific token is wrong on one side.",
  },
  {
    id: "tokens/design-token-ambiguous",
    surface: "tokens",
    defaultSeverity: "review",
    description:
      "A design variable's name matches more than one code token, so no identity was asserted and its value was not compared per-token — a coverage note; `design.options.tokenMap` resolves it for the project.",
  },
  {
    id: "tokens/design-token-map-unknown",
    surface: "tokens",
    // `warn`: the map is certainly wrong, but whether the entry or the token
    // is stale is the project's call, and the pairing it names was never
    // made — so nothing was compared, rather than something found different.
    defaultSeverity: "warn",
    description:
      "A `design.options.tokenMap` entry names a code token id the code census does not have — a typo, or a token since renamed. The pairing is not made on that id: a single-id entry counts as design-only, and a per-mode entry compares only its known ids. A mode-scoped id is named with the collapsed id `tokenMap` takes, and a single-id entry lists the code tokens holding the variable's value in `data.sameValue`.",
  },
  {
    id: "tokens/design-mode-missing",
    surface: "tokens",
    // `warn`, not `error`: a missing mode is real, confident drift, but it is
    // not on its own a contradiction — a theme may be mid-rollout on one side.
    // Only ever raised once the two sides are known to SHARE a mode
    // vocabulary (see the module docblock's per-mode section), which is what
    // keeps it off every unthemed token in a project.
    defaultSeverity: "warn",
    description:
      "A design variable and the code token it maps to share a mode vocabulary, but one side declares a mode the other has no counterpart for — a theme that exists in code with nothing in design, or the reverse.",
  },
  {
    id: "tokens/design-value-untracked",
    surface: "tokens",
    // Advisory, matching `tokens/token-unreferenced`'s tier: this is a
    // VALUE-based coverage check (ADR-003 Phase 5.3), not a name-matched
    // one — a design value with no code counterpart is a coarse signal, not
    // a confident "this is wrong." See the module docblock's design-side
    // section for why value, never name, is what this compares.
    defaultSeverity: "review",
    description:
      "A design variable's resolved value does not match any code token's resolved value, anywhere in the project — a coverage signal, not a per-token identity match (matching is by value, never by name).",
  },
  {
    id: "tokens/design-token-unmatched",
    surface: "tokens",
    // `review`: presence, not a contradiction — a design variable no code
    // token is named for, whose value code does carry under another name.
    defaultSeverity: "review",
    description:
      "A design variable matches no code token by name, but its value appears in code under another token — `data.sameValue` lists those tokens. The design-only half of token parity; `design.options.tokenMap` pairs it when one of them is the counterpart.",
  },
  {
    id: "tokens/code-token-undesigned",
    surface: "tokens",
    defaultSeverity: "review",
    description:
      "A code token no design variable maps to, under a top-level group the design side covers (at least one design variable maps to a token in it). The code-only half of token parity; `design.options.codeOnlyGroups` scopes out groups that are code-only by design.",
  },
]

export const registry = createRegistry(RULES)

// ---------------------------------------------------------------------------
// The mapping hypothesis — see the module docblock.
// ---------------------------------------------------------------------------

// The prefix's own "root" name, config's `cssVarPrefix` with its sigil
// dashes stripped — `--acme-` -> `acme`, `--` -> "" (the engine's own neutral
// default: no root, so the fold below never applies and the hypothesis is
// exactly "dash-join the whole id").
function sigilRoot(cssVarPrefix) {
  return String(cssVarPrefix).replace(/^-+/, "").replace(/-+$/, "")
}

/**
 * The one hypothesis this module ever forms for a token id: the candidate
 * CSS custom-property name it would carry if the project's build follows the
 * "dash-join, prefix, fold a redundant leading namespace" convention
 * described in the module docblock. Returns `null` when there is nothing
 * left to join after the fold (the id IS exactly the prefix's root) — a
 * signal to stay silent, not a name to report.
 *
 * @param {string} tokenId a DTCG dot path, e.g. "color.bg.primary"
 * @param {string} cssVarPrefix `conventions.cssVarPrefix`, e.g. "--acme-"
 * @returns {string|null}
 */
export function candidateVarName(tokenId, cssVarPrefix) {
  // A `/` in a segment separates a token set from its MODE (`system/light`,
  // `system/dark`) — alternate VALUES of one token, not different tokens. They
  // emit a single CSS var whose value the active theme swaps, so the mode is
  // dropped when deriving the var name.
  //
  // Without this, `system/light.color.bg.default` produced
  // `--system-system/light-color-bg-default`: a name containing a slash, which
  // no stylesheet can ever declare. Measured on a real design system, that was
  // 79 FALSE `tokens/var-unresolved` findings at error severity — every themed
  // colour reported as "used by a component but never declared".
  //
  // Generic on purpose: the rule is "strip anything after a `/` in a segment",
  // never a list of known set names. DTCG ids do not otherwise contain
  // slashes, so this cannot collide with an ordinary segment.
  // Token ids are conventionally camelCase (`borderWidth`); CSS custom
  // properties are conventionally kebab-case (`--system-border-width-thin`).
  // Every DTCG-ecosystem emitter (Terrazzo, Style Dictionary) does this
  // conversion, and without it the same token is reported TWICE as two
  // different false findings: `system.borderWidth.medium` as
  // `token-unreferenced` (expecting `--system-borderWidth-medium`, which
  // nothing declares) and `--system-border-width-medium` as `token-untracked`
  // (declared, apparently backed by no token).
  //
  // CSS-ecosystem convention, not one project's naming — the same class of
  // knowledge as the `.scss`/`.css` extensions this census already assumes.
  const segments = String(tokenId)
    .split(".")
    .map(segment => segment.split("/")[0])
    .map(segment =>
      segment.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase(),
    )
  const root = sigilRoot(cssVarPrefix)
  const shouldFold = root !== "" && segments[0] === root
  const used = shouldFold ? segments.slice(1) : segments
  if (used.length === 0) return null
  return `${cssVarPrefix}${used.join("-")}`
}

// The DTCG composite types: the ones the spec defines with an OBJECT `$value`
// whose keys are sub-properties of one conceptual token. Every DTCG emitter
// flattens each key into its own custom property, so ONE of these tokens
// corresponds to MANY vars (see `candidateVarNames`).
//
// Spec vocabulary, not one project's naming or one tool's output — the same
// class of knowledge as the `$value`/alias syntax this module already reads,
// and the reason it is a fixed set rather than config.
//
// KEYED ON `$type`, NEVER ON "the value is an object" — that distinction is
// the whole safety of this. A `color` normalizes to `{alpha, colorSpace,
// components}` and a `dimension` to `{value, unit}`; expanding those would
// hypothesize `--x-color-space` and `--x-unit`, names no emitter produces,
// and every one of them would silently absolve a genuinely untracked var.
const COMPOSITE_TYPES = new Set([
  "border",
  "gradient",
  "shadow",
  "strokeStyle",
  "transition",
  "typography",
])

/**
 * Every candidate custom-property name one token could correspond to: the
 * token's own name (`candidateVarName` above) plus, for a DTCG composite, one
 * per sub-property of its object `$value`.
 *
 * A composite emits both forms in practice — `--x-font-size` and friends for
 * the parts, and often an `--x` shorthand composed from them — and a component
 * may consume either. Treating only the parent name as "this token's var"
 * reported each emitted part as `token-untracked` and the token itself as
 * `token-unreferenced`: measured on a real design system, 280 + 45 false
 * findings from this one gap.
 *
 * Sub-property keys are camelCase in the spec (`fontSize`) and kebab-case in
 * CSS (`--x-font-size`), the same conversion `candidateVarName` applies to id
 * segments.
 *
 * @param {{id: string, $type?: string, value?: unknown}} token a census entry
 * @param {string} cssVarPrefix `conventions.cssVarPrefix`
 * @returns {string[]} candidates, parent first; empty when unmappable
 */
export function candidateVarNames(token, cssVarPrefix) {
  const parent = candidateVarName(token?.id, cssVarPrefix)
  if (parent === null) return []

  const { $type, value } = token || {}
  // An ARRAY value (a multi-layer shadow, a gradient's stops) has no
  // sub-property NAMES to derive — the hypothesis simply does not apply, and
  // indexing by position would be inventing names.
  const expandable =
    COMPOSITE_TYPES.has($type) &&
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value)
  if (!expandable) return [parent]

  return [
    parent,
    ...Object.keys(value).map(
      field =>
        `${parent}-${field.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase()}`,
    ),
  ]
}

// Every token id at a leaf of a (possibly nested) `partialAliasOf` structure
// — an object keyed by sub-property for `border`/`typography`, or an array of
// per-layer objects for `shadow`'s multi-layer form. Walked generically, on
// shape alone, rather than switched on `$type`: a partial alias is always
// either a string (the id itself) or a container of more of the same, so
// there is nothing composite-specific left to special-case here.
function collectAliasIds(node, into) {
  if (typeof node === "string") into.add(node)
  else if (Array.isArray(node))
    for (const item of node) collectAliasIds(item, into)
  else if (node && typeof node === "object")
    for (const value of Object.values(node)) collectAliasIds(value, into)
}

// ---------------------------------------------------------------------------
// Design-side value normalization (ADR-003 Phase 5.3) — see the module
// docblock's "THE DESIGN SIDE" section for why this is narrow on purpose.
// ---------------------------------------------------------------------------

const TRAILING_PX = /^(-?[\d.]+)px$/
// CSS's own hex shorthand (`#abc` === `#aabbcc`, `#abcd` === `#aabbccdd`,
// doubling each digit) — a spec-defined, lossless expansion, not a
// heuristic. Measured live: `resolveTokenCssValue`'s color transform
// minifies to shorthand whenever every byte's two hex digits repeat
// (`#111111` -> `#111`), so without this a design provider's un-minified
// hex never matches the code side's own resolved value for the exact same
// color. The alpha byte minifies the same way, which is why the 4-digit
// form is here too: a translucent `#00000033` comes back as `#0003`, and
// without the fourth digit every doubled-alpha color read as untracked
// while its odd-alpha neighbours matched (issue #446).
const HEX_SHORTHAND = /^#([0-9a-f]{3,4})$/
// A whole value that IS one CSS string — the quoting `resolveTokenCssValue`
// itself adds to a font family whose name contains a space. The inner class
// excludes the quote character, so a value that merely BEGINS and ENDS with
// one (a multi-family stack, `"instrument sans", sans-serif`) does not match
// and keeps every quote it has: stripping there would splice two families
// into one string (issue #346).
const WHOLLY_QUOTED = /^"([^"]*)"$|^'([^']*)'$/

// The digits of a 3- or 4-digit shorthand, doubled into their 6- or 8-digit
// form. Takes the digits without the leading `#`, and returns the same.
function expandHexShorthand(digits) {
  return [...digits].map(digit => digit + digit).join("")
}

// ---------------------------------------------------------------------------
// Design-name -> token-id candidates (ADR-003 Amendment 4, issue #280).
// ---------------------------------------------------------------------------

function foldSegment(segment) {
  return segment.replace(/[-_\s]/g, "").toLowerCase()
}

// A token id's segments, with a `set/mode` head collapsed to the set: the
// same fact `candidateVarName` documents — modes are alternate VALUES of one
// token, not different tokens.
function tokenIdSegments(id) {
  return collapseModeId(id).split(".").filter(Boolean).map(foldSegment)
}

// What a design value's SHAPE says the token's `$type` must be, when it says
// anything. Only shapes that are unmistakable narrow; everything else leaves
// the candidate set alone — narrowing is a way to drop wrong candidates,
// never a second guess at the right one.
function kindsForDesignValue(value) {
  const text = String(value).trim()
  if (/^Font\(/.test(text)) return new Set(["typography"])
  if (/^Effect\(/.test(text)) return new Set(["shadow"])
  if (/^(#[0-9a-f]{3,8}|rgba?\(|hsla?\()/i.test(text)) return new Set(["color"])
  return null
}

// A mode-scoped id folded to the one identity its modes share:
// `system/dark.color.fg` and `system/light.color.fg` are both `system.color.fg`.
function collapseModeId(id) {
  return String(id).replace(/^([^./]+)\/[^.]+/, "$1")
}

/**
 * The code token ids a design variable's NAME could denote — a candidate
 * set, never a verdict (ADR-003 Amendment 4). Exported for testing and for
 * the CLI's own reporting.
 *
 * The rule, measured on a real 171-variable corpus before it was written
 * (issue #280 — 124/171 unique with nothing but this, 131 once kind-narrowed):
 *   1. `design.options.tokenMap[name]`, when present, is the answer — one
 *      id, or `null` to declare the variable has no code token.
 *   2. Otherwise the name is split on `/` and `.`, each segment folded
 *      (case, `-`/`_`).
 *   3. Every code token whose trailing id segments equal those, mode-heads
 *      collapsed, is a candidate — except that a SINGLE-segment name matches
 *      only a token directly under a root (`none` → `system.none`, issue
 *      #637), never a nested one: `default` alone ends dozens of ids and
 *      would be a coin flip. A candidate under a
 *      `design.options.codeAuthoritativeGroups` prefix is dropped (a
 *      `system.print.*` token has no design counterpart by construction).
 *   4. When the design value's shape is unmistakable (`Font(…)` →
 *      typography, `Effect(…)` → shadow, a color literal → color), a
 *      candidate of another `$type` is dropped.
 * Whatever remains is returned — zero, one, or many. The caller decides
 * what each count means.
 *
 * @param {string} name the design variable's name
 * @param {string} value its resolved value (for kind narrowing)
 * @param {Array<{id: string, $type?: string}>} tokens the code token census
 * @param {{tokenMap?: object, codeAuthoritativeGroups?: string[]}} [options]
 * @returns {string[]} candidate token ids, sorted; mode-scoped ids collapsed
 *   to the set (`system/dark.color.fg` and `system/light.color.fg` are ONE
 *   candidate, `system.color.fg`, the same way `candidateVarName` folds them)
 */
export function candidateTokenIds(name, value, tokens, options = {}) {
  const mapped = options.tokenMap?.[name]
  if (mapped === null) return []
  if (typeof mapped === "string") return [mapped]
  // A per-mode entry (`{"sm": "acme.layout.sm.gutter", …}`): every mode's token
  // is the variable's, so a binding to it reaches each of them.
  if (isPlainObjectValue(mapped))
    return [...new Set(Object.values(mapped).flat())].sort(compareEntities)

  const segments = String(name).split(/[/.]/).map(foldSegment).filter(Boolean)
  if (segments.length === 0) return []

  const groups = (options.codeAuthoritativeGroups || []).map(
    prefix => `${prefix}.`,
  )
  const kinds = kindsForDesignValue(value)
  const found = new Set()
  for (const token of tokens) {
    const collapsed = collapseModeId(token.id)
    if (groups.some(prefix => collapsed.startsWith(prefix))) continue
    if (kinds && token.$type && !kinds.has(token.$type)) continue
    const ids = tokenIdSegments(token.id)
    if (ids.length < segments.length) continue
    if (segments.length === 1 && ids.length !== 2) continue
    const tail = ids.slice(ids.length - segments.length)
    if (tail.every((segment, index) => segment === segments[index]))
      found.add(collapsed)
  }
  return [...found].sort(compareEntities)
}

/**
 * The COMPARABLE form of a value for the per-token identity check, or `null`
 * when the value has no single comparable form — an `error` must be certain,
 * so a pair that cannot be compared is not "different", it is not compared.
 *
 * Kinds: `color` (hex, in any of the four CSS lengths — 3 and 4 digits are
 * expanded digit-doubled, 8 digits keep their alpha byte unless it is `ff`,
 * so every spelling of one color reduces to the same 6- or 8-digit form);
 * `length` (a bare number, `px`, or `rem` at
 * the CSS default 16px root — the ONE unit conversion here, since a design
 * tool reports pixels and a DTCG file commonly authors rem; rounded to 4
 * places, because a design tool's floats arrive as `0.30000001192092896`);
 * `duration` (milliseconds: a `150ms`/`0.15s` on either side — a provider
 * renders a variable it types as a duration with its unit — or a bare
 * number the project declared `ms`/`s`, issue #447; a bare number NOT so
 * declared stays a length, so it can never coincide with a duration
 * token); `text` (anything
 * else that is a plain string, compared after `normalizeValueForCompare`).
 * `em`/`%`/`Font(…)`/`Effect(…)` and other unit-bearing or composite forms
 * are `null`: an `em` needs a font size to mean anything, and a composite
 * has no one value to equal.
 *
 * ponytail: 16px root is the CSS initial value, not a project fact; a
 * project with a different root font-size would see false mismatches on
 * rem tokens. Add a `design.options.rootFontSize` when one exists.
 */
function comparableForm(value, { unit } = {}) {
  const text = String(value).trim().toLowerCase()
  if (text === "") return null
  const bare = /^-?\d*\.?\d+$/.test(text)
  // A bare number whose unit the PROJECT declared (`design.options.units`,
  // issue #380 part 3): a design tool's FLOAT variable carries none, so the
  // declaration is the only honest source. `%` is a fraction of the font
  // size, which is what `em` is — the one conversion that needs no font
  // size. `px` stays a length; `em`/`rem` are taken as written; `ms`/`s`
  // make it a duration (issue #447).
  if (unit && bare) {
    const n = Number(text)
    if (unit === "%") return { kind: "em", value: String(round4(n / 100)) }
    if (unit === "em") return { kind: "em", value: String(round4(n)) }
    if (unit === "rem") return { kind: "length", value: String(round4(n * 16)) }
    if (unit === "ms") return { kind: "duration", value: String(round4(n)) }
    if (unit === "s")
      return { kind: "duration", value: String(round4(n * 1000)) }
    return { kind: "length", value: String(round4(n)) }
  }
  const em = /^(-?\d*\.?\d+)em$/.exec(text)
  if (em) return { kind: "em", value: String(round4(Number(em[1]))) }
  const hex = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(text)
  if (hex) {
    let digits = hex[1].length <= 4 ? expandHexShorthand(hex[1]) : hex[1]
    // A fully opaque 8-digit form is the 6-digit color (issue #380 —
    // a design tool spells alpha out; a DTCG cssValue omits it at 1).
    if (digits.length === 8 && digits.endsWith("ff"))
      digits = digits.slice(0, 6)
    return { kind: "color", value: `#${digits}` }
  }
  const length = /^(-?\d*\.?\d+)(px|rem)?$/.exec(text)
  if (length) {
    const scale = length[2] === "rem" ? 16 : 1
    return {
      kind: "length",
      value: String(Math.round(Number(length[1]) * scale * 1e4) / 1e4),
    }
  }
  const duration = /^(-?\d*\.?\d+)(ms|s)$/.exec(text)
  if (duration) {
    const scale = duration[2] === "s" ? 1000 : 1
    return {
      kind: "duration",
      value: String(round4(Number(duration[1]) * scale)),
    }
  }
  if (/^(font|effect)\(/.test(text)) return null
  if (/^-?\d*\.?\d+(%|deg|vw|vh|ch|ex)$/.test(text)) return null
  return { kind: "text", value: normalizeValueForCompare(value) }
}

// The unit `design.options.units` declares for a design variable NAME: the
// longest declared prefix wins, so `letterSpacing` covers
// `letterSpacing/tight` and a more specific `letterSpacing/uppercase` entry
// can still override it. Deterministic; never inferred from the value.
function declaredUnit(name, units) {
  if (!units || typeof units !== "object") return undefined
  const prefixes = Object.keys(units)
    .filter(prefix => name === prefix || name.startsWith(`${prefix}/`))
    .sort((a, b) => b.length - a.length)
  return prefixes.length > 0 ? units[prefixes[0]] : undefined
}

// ---------------------------------------------------------------------------
// Canonical typography (issue #380, part 2). Both sides reduce to ONE form
// per field, each in the unit the field is naturally compared in:
//   fontFamily     the first family, folded (case, quotes)
//   fontWeight     a number (a design tool's style NAME mapped through the
//                  CSS weight table: SemiBold → 600)
//   fontSize       px
//   lineHeight     a ratio of the font size (a unitless code value IS that;
//                  px and PERCENT are divided through)
//   letterSpacing  em (px and PERCENT are divided through)
// A field either side cannot express (a design `lineHeight: AUTO`, a code
// value with no unit the table knows) is left out and NOT compared — never
// an assumed value. Fields are rounded to 4 places, since a design tool's
// floats arrive as `-1.600000023841858`.
// ---------------------------------------------------------------------------

const FONT_WEIGHTS = {
  thin: 100,
  hairline: 100,
  extralight: 200,
  ultralight: 200,
  light: 300,
  regular: 400,
  normal: 400,
  book: 400,
  medium: 500,
  semibold: 600,
  demibold: 600,
  bold: 700,
  extrabold: 800,
  ultrabold: 800,
  black: 900,
  heavy: 900,
}

function round4(value) {
  return Math.round(Number(value) * 1e4) / 1e4
}

function foldFamily(value) {
  const first = Array.isArray(value) ? value[0] : String(value).split(",")[0]
  return String(first ?? "")
    .replace(/["']/g, "")
    .trim()
    .toLowerCase()
}

function weightNumber(value) {
  if (typeof value === "number") return value
  const text = String(value ?? "")
    .toLowerCase()
    .replace(/\s|-|italic|oblique/g, "")
  if (/^\d+$/.test(text)) return Number(text)
  return FONT_WEIGHTS[text] ?? null
}

// A DTCG dimension `{value, unit}` (or a bare number / CSS string) → px.
function toPx(value, fontSizePx) {
  if (value && typeof value === "object" && "value" in value) {
    const unit = String(value.unit || "px").toLowerCase()
    if (unit === "px") return Number(value.value)
    if (unit === "rem") return Number(value.value) * 16
    if (unit === "em" && fontSizePx) return Number(value.value) * fontSizePx
    return null
  }
  if (typeof value === "number") return value
  const m = /^(-?\d*\.?\d+)(px|rem|em)?$/.exec(String(value).trim())
  if (!m) return null
  if (m[2] === "rem") return Number(m[1]) * 16
  if (m[2] === "em") return fontSizePx ? Number(m[1]) * fontSizePx : null
  return Number(m[1])
}

// Code side: a DTCG `typography` `$value`.
function canonicalTypographyFromToken(value) {
  if (!value || typeof value !== "object") return null
  const out = {}
  if (value.fontFamily !== undefined)
    out.fontFamily = foldFamily(value.fontFamily)
  const weight = weightNumber(value.fontWeight)
  if (weight !== null && value.fontWeight !== undefined) out.fontWeight = weight
  const size = toPx(value.fontSize)
  if (size !== null && value.fontSize !== undefined) out.fontSize = round4(size)
  if (value.lineHeight !== undefined) {
    const lh = value.lineHeight
    if (typeof lh === "number") out.lineHeight = round4(lh)
    else if (out.fontSize) {
      const px = toPx(lh, out.fontSize)
      if (px !== null) out.lineHeight = round4(px / out.fontSize)
    }
  }
  if (value.letterSpacing !== undefined) {
    const ls = value.letterSpacing
    if (ls && typeof ls === "object" && String(ls.unit).toLowerCase() === "em")
      out.letterSpacing = round4(ls.value)
    else if (out.fontSize) {
      const px = toPx(ls, out.fontSize)
      if (px !== null) out.letterSpacing = round4(px / out.fontSize)
    }
  }
  return out
}

// Design side: a text style's structured `style` (issue #380 part 1).
function canonicalTypographyFromStyle(style) {
  if (!style || typeof style !== "object") return null
  const out = {}
  if (style.fontFamily !== undefined)
    out.fontFamily = foldFamily(style.fontFamily)
  const weight = weightNumber(style.fontStyle)
  if (weight !== null) out.fontWeight = weight
  if (typeof style.fontSize === "number") out.fontSize = round4(style.fontSize)
  const measure = m => {
    if (!m || typeof m !== "object") return null
    const unit = String(m.unit).toUpperCase()
    if (unit === "PERCENT") return round4(m.value / 100)
    if (unit === "PIXELS" && out.fontSize) return round4(m.value / out.fontSize)
    return null // AUTO, or no font size to divide by
  }
  const lh = measure(style.lineHeight)
  if (lh !== null) out.lineHeight = lh
  const ls = measure(style.letterSpacing)
  if (ls !== null) out.letterSpacing = ls
  return out
}

// Compare two canonical typography forms on the fields BOTH carry; returns
// the differing fields, or `null` when nothing was comparable at all.
function diffTypography(design, code) {
  const fields = [
    "fontFamily",
    "fontWeight",
    "fontSize",
    "lineHeight",
    "letterSpacing",
  ]
  const comparable = fields.filter(
    f => design[f] !== undefined && code[f] !== undefined,
  )
  if (comparable.length === 0) return null
  return comparable
    .filter(f => design[f] !== code[f])
    .map(f => ({ field: f, design: design[f], code: code[f] }))
}

// ---------------------------------------------------------------------------
// Per-mode comparison (issue #404). See the module docblock's own section.
// ---------------------------------------------------------------------------

// The mode a code token's id carries in its set head — `acme/light.color.fg`
// -> "light", `acme.color.fg` -> null. Everywhere else in this module that
// head is FOLDED AWAY (`candidateVarName`, `tokenIdSegments`), because modes
// are alternate values of one token; this is the one place it is read as a
// mode name instead.
function tokenModeName(id) {
  const match = /^[^./]+\/([^.]+)/.exec(String(id))
  return match ? match[1] : null
}

// One mode's design value reduced to the string form `comparableForm` reads,
// or `null` when the mode carries nothing comparable: an unresolved `{alias}`
// object, or no value at all. Same discipline as `hasComparableValue` applies
// to the folded `value` (issue #347) — a mode the engine could not read a
// value for is not compared, rather than compared against nothing.
function designModeValue(raw) {
  if (raw === null || raw === undefined) return null
  if (typeof raw === "object") return null
  const text = String(raw)
  return text.trim() === "" ? null : text
}

/**
 * Compare one design variable's per-mode `values` against the code tokens its
 * identity resolved to, mode by mode (issue #404).
 *
 * Returns `null` — say nothing at all — unless the two sides SHARE at least
 * one mode name. That anchor is what makes this safe to raise findings from:
 *
 *   - A legacy census carries no `values` at all (measured on the consuming
 *     project's committed snapshot: 171 variables, zero with `values`), so
 *     the design side contributes no modes and this degrades to silence
 *     rather than reporting drift against data that was never gathered.
 *   - An unthemed code token contributes no mode either, so a two-mode design
 *     collection never reports both of its modes missing against every
 *     primitive in the project.
 *   - A design collection whose single mode is the tool's own placeholder
 *     (`Mode 1`) shares no name with `light`/`dark`, so the two vocabularies
 *     are judged unrelated instead of maximally disagreeing.
 *
 * Once a name IS shared, the vocabularies do line up, and a mode present on
 * only one side is a real gap worth reporting.
 *
 * @param {{values?: object}} entry a design token census entry
 * @param {Array<{id: string, cssValue?: string}>} matched the code tokens
 *   sharing the collapsed id the entry's identity resolved to
 * @param {{unit?: string}} options the declared unit for the entry's name
 * @returns {{compared: number, mismatches: object[], missingInDesign:
 *   object[], missingInCode: object[]}|null}
 */
function compareModes(entry, matched, { unit } = {}) {
  const designModes = new Map()
  if (isPlainObjectValue(entry.values))
    for (const [name, raw] of Object.entries(entry.values))
      designModes.set(foldSegment(name), { name, value: designModeValue(raw) })

  const codeModes = new Map()
  for (const token of matched) {
    // `mode` is set by a per-mode `tokenMap` entry, whose tokens carry no
    // mode in their ids.
    const mode = token.mode ?? tokenModeName(token.id)
    if (mode === null) continue
    const key = foldSegment(mode)
    // A per-mode `tokenMap` entry may give a mode several tokens (a tier and
    // the base token that aliases it), and each is compared. A set head
    // declares a mode once: first wins, since `matched` arrives in the
    // census's own sorted id order, so a project that (malformed) declares
    // one mode twice still folds deterministically.
    const known = codeModes.get(key)
    if (!known) codeModes.set(key, { name: mode, token, tokens: [token] })
    else if (token.mode !== undefined) known.tokens.push(token)
  }

  const shared = [...codeModes.keys()]
    .filter(key => designModes.has(key))
    .sort(compareEntities)
  if (shared.length === 0) return null

  const mismatches = []
  let compared = 0
  for (const key of shared) {
    const design = designModes.get(key)
    const code = codeModes.get(key)
    const designForm =
      design.value === null ? null : comparableForm(design.value, { unit })
    for (const token of code.tokens) {
      const codeForm =
        typeof token.cssValue === "string"
          ? comparableForm(token.cssValue)
          : null
      // Identity is known, but a VERDICT still needs both sides in one
      // comparable kind — the same rule the folded path applies, per mode.
      if (designForm === null || codeForm === null) continue
      if (designForm.kind !== codeForm.kind) continue
      compared++
      if (designForm.value !== codeForm.value)
        mismatches.push({
          mode: design.name,
          value: design.value,
          expected: token.cssValue,
          token: token.id,
        })
    }
  }

  // Sorted on the FOLDED key, so the order does not depend on JSON key order
  // in a gathered snapshot or on which side's spelling of a mode won.
  const missing = (from, against) =>
    [...from.entries()]
      .filter(([key]) => !against.has(key))
      .sort(([a], [b]) => compareEntities(a, b))
      .map(([, entry]) => entry)

  return {
    compared,
    mismatches,
    missingInDesign: missing(codeModes, designModes),
    missingInCode: missing(designModes, codeModes),
  }
}

// Does a design variable name match one of `design.options.ignoreVariables`?
// A pattern is a plain substring, or `/…/` for a regular expression.
function isIgnoredVariable(name, patterns) {
  return (patterns || []).some(pattern => {
    const re = /^\/(.+)\/([a-z]*)$/.exec(pattern)
    if (re) {
      try {
        return new RegExp(re[1], re[2]).test(name)
      } catch {
        return false
      }
    }
    return name.includes(pattern)
  })
}

function isPlainObjectValue(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function normalizeValueForCompare(value) {
  const lowered = String(value).trim().toLowerCase()
  // Quotes come off FIRST, so a quoted form of any value the two transforms
  // below handle still reaches them.
  const quoted = lowered.match(WHOLLY_QUOTED)
  const unquoted = quoted ? (quoted[1] ?? quoted[2]) : lowered
  const px = unquoted.match(TRAILING_PX)
  if (px) return px[1]
  const hex = unquoted.match(HEX_SHORTHAND)
  if (hex) return `#${expandHexShorthand(hex[1])}`
  return unquoted
}

// A design entry with no value at all — `""`, whitespace, or absent. Never
// compared: the engine could not read a value, so "does not match any code
// token" states the outcome of a comparison it never performed.
function hasComparableValue(value) {
  return typeof value === "string" && value.trim() !== ""
}

// ---------------------------------------------------------------------------
// Emitted-value comparison (issue #627) — see the module docblock.
// ---------------------------------------------------------------------------

// Every CSS color an emitter writes: hex, or a color function with no nested
// parentheses (a `var()` inside one is resolved before this runs).
const CSS_COLOR =
  /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\([^()]*\)/gi

// One color in the form `cssValue` itself uses (Terrazzo's `legacyHex`), so
// a token's value and an emitter's `rgb(…%)` for the same color meet. A
// color that does not parse is left as written.
function canonicalColor(text) {
  try {
    return transformCSSValue(
      { id: "_", $type: "color", $value: parseColor(text), mode: {} },
      { tokensSet: {}, color: { legacyHex: true } },
    )
  } catch {
    return text
  }
}

/**
 * One comparable form of a CSS value: every color canonicalized (see
 * `canonicalColor`), `rem` read as 16px (the CSS initial root size, the same
 * ceiling `comparableForm` documents), `0px` as `0`, lowercased, and
 * whitespace and comma spacing collapsed. Applied identically to both sides.
 *
 * @param {string} value
 * @returns {string}
 */
export function canonicalCssValue(value) {
  return String(value)
    .replace(CSS_COLOR, canonicalColor)
    .toLowerCase()
    .replace(
      /(-?\d*\.?\d+)rem\b/g,
      (_, n) => `${Math.round(Number(n) * 16 * 1e4) / 1e4}px`,
    )
    .replace(/(^|[^\d.])0px\b/g, "$10")
    .replace(/\s*,\s*/g, ", ")
    .replace(/\s+/g, " ")
    .trim()
}

const VAR_START = /var\(\s*(--[\w-]+)/i

// The first `var(--x…)` in `value`, its fallback included however deeply
// parenthesised (`var(--x, rgb(0 0 0))`, `var(--x, var(--y))`), or null.
function findVar(value) {
  const match = VAR_START.exec(value)
  if (!match) return null
  let depth = 1
  for (let i = match.index + match[0].length; i < value.length; i++) {
    if (value[i] === "(") depth++
    else if (value[i] === ")" && --depth === 0)
      return { index: match.index, length: i + 1 - match.index, name: match[1] }
  }
  return null // unbalanced: left in place, so the caller drops it
}

// Every value `value` can take once each `var(--x)` is replaced by one of
// `--x`'s emitted values. A var with no emitted declaration stays in place,
// which the caller reads as unresolvable.
// ponytail: depth 8 and 32 results; a theme with more alternates per chain
// than that is compared on the first 32. Raise the caps if one is measured.
function expandVars(value, declaredByName, seen = new Set()) {
  const match = findVar(value)
  if (!match || seen.size >= 8) return [value]
  const options = declaredByName.get(match.name)
  if (!options || seen.has(match.name)) return [value]
  const next = new Set(seen).add(match.name)
  const results = []
  for (const option of options) {
    const substituted =
      value.slice(0, match.index) +
      option +
      value.slice(match.index + match.length)
    results.push(...expandVars(substituted, declaredByName, next))
    if (results.length >= 32) break
  }
  return results.slice(0, 32)
}

// Every CSS value a token has: its default `cssValue`, then each
// `$extensions.mode` override's (issue #642).
function tokenCssValues(token) {
  return [token.cssValue, ...Object.values(token.modeCssValues || {})]
}

// The resolved, canonical forms of one value, minus any that still hold a
// `var()` — a reference the emitted CSS never declares cannot be compared.
function comparableForms(value, declaredByName) {
  return [
    ...new Set(
      expandVars(value, declaredByName)
        .filter(form => !/\bvar\(/i.test(form))
        .map(canonicalCssValue),
    ),
  ]
}

function fontFamilies(value) {
  return value
    .split(",")
    .map(family => family.trim().replace(/^["']|["']$/g, ""))
}

// ---------------------------------------------------------------------------
// The checker.
// ---------------------------------------------------------------------------

/**
 * Compare the DTCG token census against the emitted-CSS-var census, and
 * (when `designTokenCensus` is given) against the design-side value census,
 * and emit D5 findings. Pure — never reads fs/network, never mutates its
 * arguments.
 *
 * @param {{tokens: Array<{id: string}>, excluded?: string[], sources?: object}} tokenCensus
 *   `sources/code.mjs`'s `censusTokens(...)` result. Three fields are read:
 *   `.tokens`, the census itself; `.excluded`, the ids the parser was not
 *   given (an unresolvable alias), whose vars still count as accounted-for
 *   so `tokens/token-untracked` does not report them; and `.sources`, each
 *   token id's authoring file, matched against `ignoreSources` (#640).
 *   `.ok`/`.diagnostics` are the caller's concern: a caller should skip
 *   calling this entirely when `tokenCensus.ok` is false, the same "surface
 *   skips with a reason" convention as `modules/components.mjs`'s
 *   TypeScript-missing case, since an empty token list here would misreport
 *   every emitted var as untracked
 * @param {{vars: Array<{name: string, declarations: object[], usages: object[]}>, missingStyleRoots?: string[]}} cssVarCensus
 *   `sources/code.mjs`'s `censusCssVars(...)` result (only `.vars` and
 *   `.missingStyleRoots` are read; a non-empty `.missingStyleRoots` keeps
 *   `tokens/token-unemitted` silent)
 * @param {object} [config] the project's (unresolved) config — this module
 *   resolves `rules` and `conventions.cssVarPrefix` from it itself, exactly
 *   as every other layer does
 * @param {{entries: Array<{name: string, value: string}>}} [designTokenCensus]
 *   the active provider's normalized token census (ADR-003 Phase 5.3) —
 *   OMITTED entirely (not merely empty) means `tokens/design-value-
 *   untracked` is not evaluated at all, the same "surface skips, it doesn't
 *   fail the run" convention every other census-backed rule here follows
 * @param {object} [report] an out-parameter: when `designTokenCensus` is
 *   given, `report.tokenParity` is set to the design-side parity counts
 *   (`matched`, `mismatched`, `ambiguous`, `designOnly`, `codeOnly`) — the
 *   one thing this function writes outside its return value
 * @returns {object[]} findings, in `core/findings.mjs`'s deterministic order
 */
export function runTokensCheck(
  tokenCensus,
  cssVarCensus,
  config = {},
  designTokenCensus,
  report = {},
) {
  const {
    rules: rulesConfig,
    conventions: { cssVarPrefix },
    paths: { styleRoots },
  } = resolveConfig(config)
  const findings = []

  function emit(
    ruleId,
    {
      entity,
      filterEntity = entity,
      filterSources = [],
      message,
      data,
      side = "code",
      prefixRule = ruleId,
    },
  ) {
    const { severity, options } = resolveRuleConfig(
      ruleId,
      rulesConfig,
      registry,
    )
    if (severity === "off") return

    // Prefix scoping, for rules that DECLARE the option — gated on the
    // registry definition, not on whatever the resolved options happen to
    // carry. `resolveRuleConfig` merges config options over registry defaults
    // without rejecting unknown keys, so checking the resolved value alone let
    // ANY rule acquire this behaviour by being configured with it:
    // `"tokens/token-untracked": ["warn", {ignorePrefixes: [...]}]` silently
    // filtered CSS var names against a token-id option, which no doc describes.
    //
    // Matched against `filterEntity`, which for a declaring rule is always a
    // TOKEN id — so a project scopes by its own tier naming without this
    // module learning what a tier is. Kept SEPARATE from the displayed
    // `entity` because a mode-grouped finding (below) shows the shared var
    // name as `entity`, and matching `ignorePrefixes` against a var name
    // (`--system-...`) instead of the token id it was written against
    // (`system.*`) would silently stop filtering the exact grouped, primitive-
    // tier tokens a project most needs to scope out. This is the first rule in
    // the engine to declare `options` at all, so this gate is the pattern the
    // next one copies.
    //
    // `prefixRule` names the rule whose option applies when it is not this
    // one: `tokens/token-unemitted` is scoped by `tokens/token-unreferenced`'s
    // `ignorePrefixes`, one knob for both halves of the same claim (#562).
    const declaresPrefixes = Array.isArray(
      registry.get(prefixRule)?.options?.ignorePrefixes,
    )
    const prefixOptions =
      prefixRule === ruleId
        ? options
        : resolveRuleConfig(prefixRule, rulesConfig, registry).options
    const ignorePrefixes = declaresPrefixes
      ? prefixOptions?.ignorePrefixes
      : null
    if (
      Array.isArray(ignorePrefixes) &&
      ignorePrefixes.some(
        prefix =>
          typeof prefix === "string" && String(filterEntity).startsWith(prefix),
      )
    )
      return

    // Source scoping (#640), gated the same way. Dropped only when EVERY
    // token the finding names was authored in a matching file: a mode group
    // straddling a primitive and a semantic file is still a semantic fact. A
    // token with no known source (a single-file `tokensFile`) never matches.
    const ignoreSources = Array.isArray(
      registry.get(prefixRule)?.options?.ignoreSources,
    )
      ? prefixOptions?.ignoreSources
      : null
    if (
      Array.isArray(ignoreSources) &&
      filterSources.length > 0 &&
      filterSources.every(
        source =>
          typeof source === "string" &&
          ignoreSources.some(
            glob => typeof glob === "string" && matchesEntity(glob, source),
          ),
      )
    )
      return
    findings.push(
      makeFinding({
        ruleId,
        severity,
        surface: registry.get(ruleId).surface,
        side,
        entity,
        message,
        ...(data ? { data } : {}),
      }),
    )
  }

  const tokens = [...(tokenCensus?.tokens || [])].sort((a, b) =>
    compareEntities(a.id, b.id),
  )
  const vars = [...(cssVarCensus?.vars || [])].sort((a, b) =>
    compareEntities(a.name, b.name),
  )
  const varsByName = new Map(vars.map(v => [v.name, v]))

  // candidate var name -> the token id(s) that hypothesize it (a reverse
  // index, built once, that the var-centric rules below consult so a var
  // backed by SOME token — even one this module cannot see a declaration
  // for, see the docblock's build-scope note — is never reported as
  // untracked or unresolved).
  const tokenIdsByCandidate = new Map()
  for (const token of tokens) {
    // EVERY candidate, not just the token's own name — a composite's emitted
    // sub-property vars are backed by that token too, and omitting them
    // reported each one `token-untracked`.
    for (const candidate of candidateVarNames(token, cssVarPrefix)) {
      if (!tokenIdsByCandidate.has(candidate))
        tokenIdsByCandidate.set(candidate, [])
      tokenIdsByCandidate.get(candidate).push(token.id)
    }
  }

  // A token the census EXCLUDED (issue #123: it had an unresolvable alias, so
  // it was dropped to let the other 655 parse) still exists in the project.
  // Its var must therefore be treated as accounted-for, or the fix for one
  // silence would manufacture a lie: `--system-color-focus-ring-color` would
  // be reported `token-untracked` purely because the engine chose not to read
  // its token. The exclusion is already reported as a diagnostic; it must not
  // also be reported as a finding.
  for (const excludedId of tokenCensus?.excluded || []) {
    const candidate = candidateVarName(excludedId, cssVarPrefix)
    if (candidate === null) continue
    if (!tokenIdsByCandidate.has(candidate))
      tokenIdsByCandidate.set(candidate, [])
    tokenIdsByCandidate.get(candidate).push(excludedId)
  }

  // ---------------------------------------------------------------------
  // Token-centric rules: token-unreferenced, token-unemitted.
  //
  // "Nothing references this token" has two causes: the build never emitted
  // its var, or the var is emitted and unused. Telling them apart needs the
  // declaration source, and the census sees it only when `paths.styleRoots`
  // names the token stylesheets and every one of them exists (issue #562). A
  // missing root — a renamed token directory — would otherwise make every
  // unused token look unemitted, so then, as with no roots at all, both
  // causes stay under `tokens/token-unreferenced`.
  // ---------------------------------------------------------------------
  const canSeeEmission =
    (styleRoots || []).length > 0 &&
    (cssVarCensus?.missingStyleRoots || []).length === 0
  // A token consumed by ANOTHER TOKEN is referenced. In a tiered design system
  // primitives are meant to be aliased upward (`system.color.fg.default ->
  // {base.color.neutral.900}`) and never touched by a component directly, so
  // judging them only by component usage calls a correctly-consumed primitive
  // dead. Measured on a real design system: 147 of 277 `base.*` leaves are
  // alias-referenced, every one of which was being reported unreferenced.
  //
  // v1's `hygiene/dead-primitive` had this right — it asked whether a
  // primitive was referenced by an ALIAS, not by a component. That distinction
  // was lost in the rewrite; this restores it.
  const aliasTargets = new Set()
  for (const token of tokens) {
    if (token.aliasOf) aliasTargets.add(token.aliasOf)
    for (const link of token.aliasChain || []) aliasTargets.add(link)
    // A composite can alias only SOME `$value` members (D3's docblock note
    // above): `system.typography.body.md`'s `fontSize` pointing at
    // `{system.fontSize.body.md}` while `fontFamily` stays literal. Every
    // leaf of `partialAliasOf` is a token id one of this token's members
    // resolves to — `border`/`shadow`/`typography` alike, and a shadow's
    // array-of-layers shape as much as an object's — so this walks the whole
    // structure rather than assuming one shape. Measured against a real
    // design system: 28 `system.fontSize.*` primitives consumed only this
    // way, reported dead until this loop sees them too.
    collectAliasIds(token.partialAliasOf, aliasTargets)
    // A token consumed only as another token's opacity (issue #517) is
    // referenced too: the census records the reference the color leaf's
    // configured `$extensions` key holds, and nothing else in this module
    // would ever see it — `system.opacity.scrim` exists precisely so
    // `bg.scrim.default` can point at it.
    if (token.opacityOf) aliasTargets.add(token.opacityOf)
  }

  // candidate var -> the tokens that fold to it, so one variable yields one
  // finding however many modes declare it (issue #170). Insertion order is the
  // token order, which is already deterministic upstream.
  const unreferencedByVar = new Map()

  for (const token of tokens) {
    if (aliasTargets.has(token.id)) continue // consumed by another token

    const candidates = candidateVarNames(token, cssVarPrefix)
    if (candidates.length === 0) continue // unmappable — silent, see docblock
    const [candidate] = candidates

    // ANY of the token's vars being used means the token is referenced. For a
    // composite that is usually a SUB-PROPERTY var, never the parent
    // shorthand: measured on a real design system, all 45 composite tokens
    // were consumed as `var(--x-font-size)` and none as `var(--x)`, so judging
    // the parent name alone called every one of them dead.
    if (candidates.some(name => (varsByName.get(name)?.usages.length || 0) > 0))
      continue // referenced — fine

    const emitted = candidates.some(
      name => (varsByName.get(name)?.declarations.length || 0) > 0,
    )

    // Collected, not emitted yet — see the dedupe below.
    const group = unreferencedByVar.get(candidate)
    // `composite` is OR-ed across the group, never taken from whichever token
    // happened to be inserted first: if ANY token folding to this var expands
    // to sub-property vars, those vars WERE checked for usage above, so the
    // message must say so. Taking it from one token would make the wording
    // depend on input order for a group whose members disagree on `$type` —
    // malformed input, but reachable, and the one spot the rest of this
    // rule's determinism argument does not cover.
    if (group) {
      group.tokens.push(token.id)
      group.composite = group.composite || candidates.length > 1
      // Same OR: one declared member means the group's var is emitted.
      group.emitted = group.emitted || emitted
    } else
      unreferencedByVar.set(candidate, {
        tokens: [token.id],
        composite: candidates.length > 1,
        emitted,
      })
  }

  // ONE finding per variable, not per token (issue #170).
  //
  // A mode-scoped token set declares the same semantic token once per mode
  // (`system/light.color.bg.disabled`, `system/dark.color.bg.disabled`), and
  // both fold to ONE custom property. "Nothing references this variable" is
  // then one fact about one variable, and emitting it per declaring token
  // stated it twice: measured on a real design system, 268 findings covered
  // only 231 distinct variables.
  //
  // Both findings in such a pair were TRUE — this is redundancy, not a false
  // finding — but a consumer reading the count saw 14% more work than existed,
  // and would have fixed each pair once. Same "one fact, reported once" rule
  // `core/findings.mjs`'s `dedupeDiagnostics` applies to diagnostics.
  //
  // A SINGLE-token finding's entity is that token's own id — the common case,
  // and the "token-centric" framing this rule is meant to have. A GROUPED
  // finding's entity is the shared candidate VAR instead (matching the
  // var-centric rules below, which already use a var name as their entity):
  // whichever token id sorts first would otherwise become the permanent
  // public face of every group sharing that spot, and for any project whose
  // mode names alphabetize consistently (`dark` before `light`, `high` before
  // `low`) that is not a neutral tie-break — it silently makes one mode look
  // like the sole offender in any view that reads only `entity` (a report
  // table, a `--rule` filter, a quick grep) while the OTHER mode's finding
  // never appears under its own name at all. The underlying fact was always
  // correct (every declaring token is named in the message and listed in
  // `data.tokens`) — only the field meant to identify the finding at a glance
  // was misleading. `filterEntity` below keeps `ignorePrefixes` matching the
  // token id regardless, so scoping by tier is unaffected by what `entity`
  // displays.
  for (const [
    candidate,
    { tokens: ids, composite, emitted },
  ] of unreferencedByVar) {
    const sorted = [...ids].sort(compareEntities)
    // Reads as `"a" and "b"` for two and `"a", "b" and "c"` for three or more
    // — a mode set of light/dark/high-contrast is a real shape, and chaining
    // "and" between every pair reads as a list of separate facts.
    const quoted = sorted.map(id => `"${id}"`)
    const subject =
      quoted.length > 1 ? `tokens ${formatList(quoted)}` : `token ${quoted[0]}`
    const shared = {
      entity: sorted.length > 1 ? candidate : sorted[0],
      filterEntity: sorted[0],
      filterSources: sorted.map(id => tokenCensus?.sources?.[id]),
      data: { token: sorted[0], tokens: sorted, expectedVar: candidate },
    }
    if (canSeeEmission && !emitted) {
      emit("tokens/token-unemitted", {
        ...shared,
        prefixRule: "tokens/token-unreferenced",
        message: composite
          ? `nothing emits ${subject} — neither "${candidate}" nor any of its sub-properties is declared in the scanned code, no component uses them, and no other token aliases it`
          : `nothing emits ${subject} — "${candidate}" is declared nowhere in the scanned code, no component uses it, and no other token aliases it`,
      })
      continue
    }
    emit("tokens/token-unreferenced", {
      ...shared,
      message: composite
        ? `nothing references ${subject} — no component uses "${candidate}" or any of its sub-properties, and no other token aliases it`
        : `nothing references ${subject} — no component uses "${candidate}", and no other token aliases it`,
    })
  }

  // ---------------------------------------------------------------------
  // Var-centric rules: token-untracked, var-unresolved.
  // ---------------------------------------------------------------------
  for (const varEntry of vars) {
    if (tokenIdsByCandidate.has(varEntry.name)) continue // some token accounts for it

    if (varEntry.declarations.length > 0) {
      emit("tokens/token-untracked", {
        entity: varEntry.name,
        message: `"${varEntry.name}" is declared in code with no token in the contract mapping to it`,
        data: { var: varEntry.name },
      })
      continue // declared — not "unresolved" (that rule is about absence of a declaration)
    }

    if (varEntry.usages.length > 0) {
      emit("tokens/var-unresolved", {
        entity: varEntry.name,
        message: `"${varEntry.name}" is used by a component but never declared, and no token in the contract accounts for it`,
        data: { var: varEntry.name },
      })
    }
  }

  // ---------------------------------------------------------------------
  // Emitted-value rule: emitted-value-mismatch (issue #627). Same gate as
  // `tokens/token-unemitted` — with no style roots, or a missing one, the
  // census cannot see the build's output.
  // ---------------------------------------------------------------------
  if (canSeeEmission) {
    const emitted = cssVarCensus?.emitted || []
    const declaredByName = new Map()
    for (const { name, value } of emitted) {
      if (!declaredByName.has(name)) declaredByName.set(name, [])
      declaredByName.get(name).push(value)
    }
    const tokensByVar = new Map()
    for (const token of tokens) {
      if (typeof token.cssValue !== "string") continue // a multi-property composite
      const candidate = candidateVarName(token.id, cssVarPrefix)
      if (candidate === null) continue
      if (!tokensByVar.has(candidate)) tokensByVar.set(candidate, [])
      tokensByVar.get(candidate).push(token)
    }

    for (const { name, value, file, selector } of emitted) {
      const matched = tokensByVar.get(name)
      if (!matched) continue // no token maps to it: `token-untracked`'s case
      const actual = comparableForms(value, declaredByName)
      const expectedValues = [...new Set(matched.flatMap(tokenCssValues))]
      const expected = expectedValues.flatMap(css =>
        comparableForms(css, declaredByName),
      )
      if (actual.length === 0 || expected.length === 0) continue

      // A font stack is a fallback list: a build appending fallbacks after
      // the token's own families renders the same font.
      const agrees =
        matched[0].$type === "fontFamily"
          ? expected.some(stack => {
              const want = fontFamilies(stack)
              return actual.some(
                got =>
                  fontFamilies(got).slice(0, want.length).join() ===
                  want.join(),
              )
            })
          : actual.some(form => expected.includes(form))
      if (agrees) continue

      const ids = matched.map(token => token.id).sort(compareEntities)
      emit("tokens/emitted-value-mismatch", {
        entity: name,
        filterEntity: ids[0],
        message: `"${name}" is emitted as "${value}" in ${file} (${selector}), but ${ids.length > 1 ? `tokens ${formatList(ids.map(id => `"${id}"`))} say` : `token "${ids[0]}" says`} ${formatList(expectedValues.map(v => `"${v}"`))}`,
        data: {
          var: name,
          file,
          selector,
          emitted: value,
          expected: expectedValues,
          tokens: ids,
        },
      })
    }
  }

  // ---------------------------------------------------------------------
  // Design-side rule: design-value-untracked (ADR-003 Phase 5.3). See the
  // module docblock's "THE DESIGN SIDE" section — value-matched, never
  // name-matched, and one-directional (design -> code only).
  // ---------------------------------------------------------------------
  if (designTokenCensus) {
    const options = isPlainObjectValue(config?.design?.options)
      ? config.design.options
      : {}
    const codeValues = new Set(
      tokens
        .map(token => token.cssValue)
        .filter(value => typeof value === "string")
        .map(normalizeValueForCompare),
    )
    // Per-token identity (Amendment 4, issue #280) needs a token by its
    // COLLAPSED id — mode-scoped tokens share one design counterpart and
    // one CSS var, and every mode's `cssValue` is a value the design
    // variable may legitimately equal (the design side gathers whichever
    // mode the node was rendered in).
    const tokensByCollapsedId = new Map()
    for (const token of tokens) {
      const collapsed = collapseModeId(token.id)
      if (!tokensByCollapsedId.has(collapsed))
        tokensByCollapsedId.set(collapsed, [])
      tokensByCollapsedId.get(collapsed).push(token)
    }
    // The collapsed ids of every code token whose value equals `value`.
    const sameValueIds = value => {
      const normalized = normalizeValueForCompare(value)
      return [
        ...new Set(
          tokens
            .filter(
              token =>
                typeof token.cssValue === "string" &&
                normalizeValueForCompare(token.cssValue) === normalized,
            )
            .map(token => collapseModeId(token.id)),
        ),
      ].sort(compareEntities)
    }
    const designEntries = [...(designTokenCensus.entries || [])].sort((a, b) =>
      compareEntities(a.name, b.name),
    )
    // Token parity: every compared variable lands in exactly one outcome.
    // `disagreeing` holds variables a mismatch or missing-mode finding was
    // raised for; `claimed` the collapsed code ids a variable maps to (or,
    // when ambiguous, might map to) — the complement is code-only.
    const disagreeing = new Set()
    const claimed = new Set()
    const matchedRoots = new Set()
    const parity = { matched: 0, mismatched: 0, ambiguous: 0, designOnly: 0 }
    const emitDisagreement = (ruleId, payload) => {
      disagreeing.add(payload.entity)
      emit(ruleId, payload)
    }
    // `tokenMapping` (#569): a collection's code root and the project's fold
    // rules turn a design name into a code path before name matching runs.
    // `tokenMap` still wins — `candidateTokenIds` checks it first.
    const tokenMapping = resolveTokenMapping(config)
    const collectionMappings = Object.entries(tokenMapping.collections || {})
      .filter(([label]) => !label.startsWith("_"))
      .map(([, mapping]) => mapping)
    const pairCandidates = (entry, collection) => {
      if (options.tokenMap && entry.name in options.tokenMap)
        return candidateTokenIds(entry.name, entry.value, tokens, options)
      const folded = foldDesignName(entry.name, tokenMapping.aliasFoldingRules)
      if (typeof collection?.prefix === "string") {
        const path = folded ?? String(entry.name).split("/").join(".")
        const id = `${collection.prefix}.${path}`
        if (tokensByCollapsedId.has(id)) return [id]
      }
      return candidateTokenIds(
        folded ?? entry.name,
        entry.value,
        tokens,
        options,
      )
    }
    // The per-mode findings for one variable. `tokenOf(kind, item)` names
    // the code token each is about: the variable's one token, or, for a
    // per-mode `tokenMap` entry, that mode's token (`null` for a design mode
    // the entry maps nowhere).
    // `fromTokenMap`: the code side's modes are the per-mode entry's keys, so
    // a mode only code has is named as the entry's, not the token's (#659).
    const emitModeFindings = (entry, modes, tokenOf, fromTokenMap = false) => {
      for (const item of modes.missingInDesign) {
        const token = tokenOf("missingInDesign", item)
        emitDisagreement("tokens/design-mode-missing", {
          side: "design",
          entity: entry.name,
          message: fromTokenMap
            ? `design.options.tokenMap maps a "${item.name}" mode of design variable "${entry.name}" to code token "${token}", but the variable has no "${item.name}" mode`
            : `code token "${token}" declares a "${item.name}" mode that design variable "${entry.name}" has no counterpart for`,
          data: {
            name: entry.name,
            token,
            mode: item.name,
            missingOn: "design",
          },
        })
      }
      for (const item of modes.missingInCode) {
        const token = tokenOf("missingInCode", item)
        emitDisagreement("tokens/design-mode-missing", {
          side: "design",
          entity: entry.name,
          message: `design variable "${entry.name}" declares a "${item.name}" mode that ${token === null ? "its design.options.tokenMap entry maps to no code token" : `code token "${token}" has no counterpart for`}`,
          data: {
            name: entry.name,
            token,
            mode: item.name,
            missingOn: "code",
          },
        })
      }
      for (const item of modes.mismatches) {
        const token = tokenOf("mismatch", item)
        emitDisagreement("tokens/design-token-mismatch", {
          side: "design",
          entity: entry.name,
          message: `design variable "${entry.name}" maps to token "${token}", but in mode "${item.mode}" its value "${item.value}" does not match the token's value "${item.expected}"`,
          data: {
            name: entry.name,
            value: item.value,
            token,
            mode: item.mode,
            expected: [item.expected],
          },
        })
      }
    }
    // A `tokenMap` id the census lacks pairs nothing (#653): reported once
    // per id, and never the evidence a variable counts as matched on.
    // A mode-scoped id (`system/dark.color.fg`) whose collapsed form is a
    // token is named with that form: `tokenMap` takes the collapsed id
    // (#659). `sameValue`, for a single-id entry, keeps value coverage's
    // hint — the code tokens holding the variable's value.
    const isKnownId = id => tokensByCollapsedId.has(id)
    const emitUnknownIds = (entry, ids, mode, emitter, sameValue = []) => {
      for (const id of ids) {
        const collapsed = collapseModeId(id)
        const cause =
          collapsed !== id && isKnownId(collapsed)
            ? `, a mode-scoped id; design.options.tokenMap takes the collapsed id "${collapsed}"`
            : ", which is not a code token"
        const hint =
          sameValue.length > 0
            ? `; code carries its value "${entry.value}" as ${sameValue.map(other => `"${other}"`).join(", ")}`
            : ""
        emitter("tokens/design-token-map-unknown", {
          side: "design",
          entity: entry.name,
          message: `design variable "${entry.name}"${mode === undefined ? "" : ` in mode "${mode}"`} is mapped by design.options.tokenMap to "${id}"${cause}${hint}`,
          data: {
            name: entry.name,
            token: id,
            ...(mode === undefined ? {} : { mode }),
            ...(sameValue.length > 0 ? { sameValue } : {}),
          },
        })
      }
    }
    for (const entry of designEntries) {
      // An entry with no value carries no evidence either way, so comparing
      // it reports a comparison that never happened (issue #347). `ingest`
      // now drops such an entry with a stated skip reason; this guard is
      // what keeps an ALREADY-COMMITTED snapshot, written before that, from
      // producing the same unactionable finding.
      if (!hasComparableValue(entry.value)) continue
      if (isIgnoredVariable(entry.name, options.ignoreVariables)) continue
      // `tokenMap: null` declares the variable has no code token: neither
      // compared nor reported, and outside token parity altogether.
      if (options.tokenMap?.[entry.name] === null) continue
      // A collection mapped with `prefix: null` has no code counterpart by
      // construction (an icon library's local variables): outside parity.
      const collection = collectionMappings.find(
        mapping => mapping?.collection === entry.collection,
      )
      if (collection?.prefix === null) continue

      // A per-mode `tokenMap` entry: each mode of the variable is its own
      // code token (a breakpoint tier, `acme.layout.sm.gutter`), or several
      // (a tier and the base token that aliases it), so the pair is made and
      // compared mode by mode, and every mapped token is claimed.
      const modeMap = options.tokenMap?.[entry.name]
      if (isPlainObjectValue(modeMap)) {
        // Sorted on the folded mode, so findings do not follow JSON key order.
        const modeIds = Object.entries(modeMap)
          .map(([mode, ids]) => [mode, [ids].flat()])
          .sort(([a], [b]) => compareEntities(foldSegment(a), foldSegment(b)))
        const known = modeIds.flatMap(([, ids]) => ids.filter(isKnownId))
        // No id resolves: nothing was paired, so the variable is design-only.
        if (known.length === 0) {
          for (const [mode, ids] of modeIds)
            emitUnknownIds(entry, ids, mode, emit)
          parity.designOnly++
          continue
        }
        parity.matched++
        for (const [mode, ids] of modeIds)
          emitUnknownIds(
            entry,
            ids.filter(id => !isKnownId(id)),
            mode,
            emitDisagreement,
          )
        for (const id of known) {
          claimed.add(id)
          matchedRoots.add(id.split(".")[0])
        }
        const matched = modeIds.flatMap(([mode, ids]) =>
          ids.flatMap(id =>
            (tokensByCollapsedId.get(id) || []).map(token => ({
              ...token,
              mode,
            })),
          ),
        )
        const modes = compareModes(entry, matched, {
          unit: declaredUnit(entry.name, options.units),
        })
        if (modes) {
          // A mode whose every id is unknown was reported just above; it is
          // not also a mode "the entry maps to no code token".
          const unresolved = new Set(
            modeIds
              .filter(([, ids]) => !ids.some(isKnownId))
              .map(([mode]) => foldSegment(mode)),
          )
          modes.missingInCode = modes.missingInCode.filter(
            item => !unresolved.has(foldSegment(item.name)),
          )
          emitModeFindings(
            entry,
            modes,
            (kind, item) =>
              kind === "mismatch"
                ? item.token
                : kind === "missingInDesign"
                  ? item.token.id
                  : null,
            true,
          )
        }
        continue
      }

      // A single-id entry naming a token the census lacks pairs nothing.
      const mappedId = options.tokenMap?.[entry.name]
      if (typeof mappedId === "string" && !isKnownId(mappedId)) {
        emitUnknownIds(
          entry,
          [mappedId],
          undefined,
          emit,
          sameValueIds(entry.value),
        )
        parity.designOnly++
        continue
      }

      const candidates = pairCandidates(entry, collection)
      if (candidates.length === 1) {
        claimed.add(candidates[0])
        matchedRoots.add(candidates[0].split(".")[0])
        // Counted before the value checks below, several of which `continue`;
        // a mismatch recorded in `disagreeing` moves it after the loop.
        parity.matched++
        // One identity: compare THIS token's value(s), and say nothing more
        // — a matched token is not "untracked" whatever the rest of the
        // census holds, and a mismatched one is a specific defect, not a
        // coverage gap.
        const matched = tokensByCollapsedId.get(candidates[0]) || []

        // A text style against a typography token (issue #380 part 2):
        // compare field by field on the canonical form, and say WHICH field.
        // Every typography MODE of the matched token is a value the design
        // style may legitimately equal (a mode-scoped composite groups under
        // one collapsed id, exactly as the scalar path below treats every
        // mode's cssValue): agreement with ANY mode is silence; a mismatch
        // is reported against the first mode's fields only when no mode
        // agrees.
        const typographyTokens = matched.filter(
          token => token.$type === "typography",
        )
        if (entry.style && typographyTokens.length > 0) {
          const designForm = canonicalTypographyFromStyle(entry.style)
          const diffs = designForm
            ? typographyTokens
                .map(token => canonicalTypographyFromToken(token.value))
                .filter(Boolean)
                .map(codeForm => diffTypography(designForm, codeForm))
                .filter(diff => diff !== null)
            : []
          if (diffs.length > 0) {
            if (diffs.some(diff => diff.length === 0)) continue
            const differing = diffs[0]
            emitDisagreement("tokens/design-token-mismatch", {
              side: "design",
              entity: entry.name,
              message: `design text style "${entry.name}" maps to token "${candidates[0]}", but ${differing.map(d => `${d.field} is ${JSON.stringify(d.design)} in design and ${JSON.stringify(d.code)} in code`).join("; ")}${diffs.length > 1 ? ` (no mode of the token agrees)` : ""}`,
              data: {
                name: entry.name,
                token: candidates[0],
                fields: differing,
                modesCompared: diffs.length,
              },
            })
            continue
          }
          // Nothing comparable on either side — fall through to coverage.
        }

        // Per mode, when both sides are mode-scoped and speak the same mode
        // names (issue #404). This REPLACES the folded comparison below for
        // such a variable: folding takes agreement with ANY mode as silence,
        // which is exactly how a dark-mode value drifting alone stayed
        // invisible. `null` — no shared mode vocabulary — falls through
        // unchanged, and so does a shared vocabulary in which nothing turned
        // out to be comparable.
        const modes = compareModes(entry, matched, {
          unit: declaredUnit(entry.name, options.units),
        })
        if (modes) {
          emitModeFindings(entry, modes, () => candidates[0])
          if (modes.compared > 0) continue
        }

        const design = comparableForm(entry.value, {
          unit: declaredUnit(entry.name, options.units),
        })
        const forms = matched
          .map(token => token.cssValue)
          .filter(value => typeof value === "string")
          .map(comparableForm)
          .filter(form => form !== null && form.kind === design?.kind)
        // Identity is known; a VERDICT needs both sides in one comparable
        // kind. A composite (typography, a shadow), an `em` against a bare
        // number, a value with no form at all — none can confirm or
        // contradict, so the comparison falls through to value coverage
        // below, exactly as before Amendment 4, rather than manufacturing
        // an error out of a unit the engine cannot convert.
        if (design !== null && forms.length > 0) {
          if (forms.some(form => form.value === design.value)) continue
          emitDisagreement("tokens/design-token-mismatch", {
            side: "design",
            entity: entry.name,
            message: `design variable "${entry.name}" maps to token "${candidates[0]}", but its value "${entry.value}" does not match the token's ${matched.length > 1 ? "values " : "value "}${[...new Set(matched.map(token => token.cssValue))].map(v => `"${v}"`).join(", ")}`,
            data: {
              name: entry.name,
              value: entry.value,
              token: candidates[0],
              expected: [...new Set(matched.map(token => token.cssValue))],
            },
          })
          continue
        }
      } else if (candidates.length > 1) {
        for (const candidate of candidates) claimed.add(candidate)
        parity.ambiguous++
        emit("tokens/design-token-ambiguous", {
          side: "design",
          entity: entry.name,
          message: `design variable "${entry.name}" could be any of ${candidates.map(id => `"${id}"`).join(", ")} — no identity asserted; resolve it with design.options.tokenMap`,
          data: { name: entry.name, value: entry.value, candidates },
        })
        continue
      }

      const normalized = normalizeValueForCompare(entry.value)
      if (candidates.length === 0) {
        parity.designOnly++
        // Design-only: no code token by this name. When code carries the
        // value under another token, say which — that is the likely pair.
        const sameValue = sameValueIds(entry.value)
        if (sameValue.length > 0) {
          emit("tokens/design-token-unmatched", {
            side: "design",
            entity: entry.name,
            message: `design variable "${entry.name}" matches no code token by name; code carries its value "${entry.value}" as ${sameValue.map(id => `"${id}"`).join(", ")}`,
            data: { name: entry.name, value: entry.value, sameValue },
          })
          continue
        }
      }

      if (codeValues.has(normalized)) continue
      emit("tokens/design-value-untracked", {
        side: "design",
        entity: entry.name,
        message: `design variable "${entry.name}" has value "${entry.value}", which does not match any code token's value`,
        data: { name: entry.name, value: entry.value },
      })
    }

    // A matched variable that raised a disagreement is mismatched, not matched.
    const mismatched = [...disagreeing].length
    parity.matched -= mismatched
    parity.mismatched = mismatched

    // Code-only: a token no variable claims, under a top-level group the
    // design side demonstrably covers. A group no variable maps into at all
    // (a code-only tier, a whole collection design never gathered) says
    // nothing about parity, so it is not reported token by token.
    const skipGroups = [
      ...(options.codeOnlyGroups || []),
      ...(options.codeAuthoritativeGroups || []),
    ].map(prefix => `${prefix}.`)
    let codeOnly = 0
    for (const collapsed of [...tokensByCollapsedId.keys()].sort(
      compareEntities,
    )) {
      if (claimed.has(collapsed)) continue
      if (!matchedRoots.has(collapsed.split(".")[0])) continue
      if (skipGroups.some(prefix => `${collapsed}.`.startsWith(prefix)))
        continue
      codeOnly++
      emit("tokens/code-token-undesigned", {
        side: "code",
        entity: collapsed,
        message: `code token "${collapsed}" has no design variable mapped to it`,
        data: { token: collapsed },
      })
    }
    report.tokenParity = { ...parity, codeOnly }
  }

  return sortFindings(findings)
}
