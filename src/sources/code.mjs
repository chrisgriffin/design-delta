/**
 * code.mjs — the CODE side of the tokens module (ADR-001 D3/D10, Phase 1
 * slice 1a): a normalized, deterministic census of what the codebase itself
 * says about tokens. Two censuses, both read-only:
 *
 *   1. `censusTokens` — the project's W3C-DTCG `tokens.json` IS the token
 *      contract (D3); this loads it via `@terrazzo/parser` (D10) into a flat,
 *      sorted list of `{id, $type, value, cssValue, aliasOf, aliasChain,
 *      partialAliasOf, modes}`. `value` is the raw DTCG `$value` (structured
 *      for a composite type); `cssValue` (issue #255), when present, is that
 *      same value flattened to the CSS string it would actually render as —
 *      see `normalizeToken` below for which types get one; `modeCssValues`
 *      (issue #642) holds the same for each `$extensions.mode` override.
 *   2. `censusCssVars` — every CSS custom-property declaration (`--x: …`)
 *      and usage (`var(--x)`) actually emitted under the configured
 *      component root, config-driven by `conventions.cssVarPrefix` (a port
 *      of v1 `drift-lint.mjs`'s grep-style scan, generalized off the
 *      hardcoded `--system-`/`components|styles|app` triple).
 *
 * Deliberately design-tool-free (slice 1a — see ADR-001 Phase 1 / issue #94):
 * no gather, no diff, no findings. Emitting a finding here would mean guessing
 * at drift with only one side loaded; that is slices 1b–1d's job.
 *
 * `sources/` may import `core/` + node builtins + `@terrazzo/parser` and
 * NOTHING else internal (the layering guard, `__tests__/layering.test.js`,
 * enforces this at CI time) — never `spec/`, `modules/`, or `src/lib/` (v1).
 *
 * CRITICAL — the alias pre-scan (see `findUnresolvableAliases` below):
 * a real design system's `tokens.json` can carry aliases that point at a
 * logical namespace with no physical top-level group, and `@terrazzo/parser`
 * THROWS on the very first one it hits, aborting the whole parse (the
 * behavior the adoption spike measured — `docs/spikes/terrazzo-fit.md`).
 * Handing the raw file straight to Terrazzo would surface only the first bad
 * alias, forcing a fix-one-rerun-repeat loop. So this module walks the raw
 * JSON itself,
 * BEFORE Terrazzo ever sees it, resolves every alias against the document,
 * and reports every unresolvable one at once. A tokens file that fails this
 * pre-scan — or is missing, unreadable, not JSON, or not a JSON object —
 * never throws: it degrades to `{ ok: false, tokens: [], diagnostics }`,
 * mirroring v1's proven rule (`docs/design-delta-engine.md`): a surface that
 * cannot be read skips with a stated reason and is never, alone, a failed
 * run. The CALLER decides what a failed tokens census means for the run.
 *
 * Determinism (the working-method gate, ADR-001): every list here is sorted
 * explicitly — token census by id (natural, `core/findings.mjs`'s
 * `compareEntities`), CSS-var census by name then occurrence — and every
 * directory walk sorts its entries before recursing, so filesystem iteration
 * order, which Node does not guarantee, never reaches the output. No wall
 * clock, no randomness anywhere in this module.
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs"
import { dirname, isAbsolute, join, resolve, sep } from "node:path"
import { pathToFileURL } from "node:url"

import { Logger, defineConfig, lintRunner, parse } from "@terrazzo/parser"
import { transformCSSValue } from "@terrazzo/token-tools/css"

import { compareEntities } from "../core/findings.mjs"
import { resolveConventions, resolvePaths } from "../core/config.mjs"
import { formatList, compareStrings } from "../core/text.mjs"
import { toPosixRelative, collectFilesSorted } from "../core/paths.mjs"
import { censusStylesheetText } from "./styles.mjs"

// The real filesystem, used unless a caller injects one (tests pass a fake
// `{existsSync, readFileSync}` for the single-file tokens loader's
// missing/unreadable cases; the CSS-var scan's directory walk uses real temp trees, same as
// `__tests__/helpers/synthetic-project.mjs` — faking `readdirSync`'s
// Dirent shape buys little over just writing files to a real tmp dir).
const defaultFs = { existsSync, readFileSync, readdirSync, statSync }

// ---------------------------------------------------------------------------
// 1. Alias pre-scan — see the module docblock's CRITICAL note.
// ---------------------------------------------------------------------------

// A DTCG alias `$value` is a string that is ENTIRELY `{dot.separated.path}` —
// never a partial/embedded reference (the spec only allows whole-value
// aliasing). Matching the full string (not searching within it) is what
// keeps this from false-flagging a literal string that merely contains `{`.
const ALIAS_RE = /^\{(.+)\}$/

// A DTCG token leaf vs. a group: a node with an own `$value` key IS the
// token (ported from v1's legacy token-map module's `isLeaf` — same test,
// same reasoning: nothing else in the DTCG shape reliably marks "this is a
// leaf").
function isTokenNode(node) {
  return (
    node !== null &&
    typeof node === "object" &&
    !Array.isArray(node) &&
    Object.prototype.hasOwnProperty.call(node, "$value")
  )
}

// Walk a token's value (which may be a plain scalar, a composite object like
// `border`/`typography`/`shadow`, or an array of composites) collecting every
// embedded alias string. A composite token can alias SOME fields and hold
// literals in others (`{color: "{base.color.x}", width: {value:1,unit:"px"}}`),
// so this recurses into objects/arrays rather than only checking the token's
// top-level `$value`.
function collectAliasStrings(value, out) {
  if (typeof value === "string") {
    const m = ALIAS_RE.exec(value)
    if (m) out.push(m[1])
    return
  }
  if (Array.isArray(value)) {
    for (const item of value) collectAliasStrings(item, out)
    return
  }
  if (value !== null && typeof value === "object") {
    for (const v of Object.values(value)) collectAliasStrings(v, out)
  }
}

// Every value Terrazzo will actually try to resolve for this token: the
// default `$value`, plus any per-mode override under the DTCG
// `$extensions.mode` escape hatch (Terrazzo's own multi-mode mechanism —
// `resolveAliases` iterates `Object.keys(token.mode)` the same way). Labeled
// "." for the default, the mode name otherwise, so a bad alias hidden inside
// a mode override is named precisely in diagnostics rather than silently
// missed by only checking the default value.
function collectAliasSources(node) {
  const sources = [{ mode: ".", value: node.$value }]
  const modeExt = node.$extensions && node.$extensions.mode
  if (modeExt !== null && typeof modeExt === "object") {
    for (const [modeName, modeNode] of Object.entries(modeExt)) {
      if (isTokenNode(modeNode))
        sources.push({ mode: modeName, value: modeNode.$value })
    }
  }
  return sources
}

// Does `{aliasBody}` resolve to a real token in `doc`? Dot-separated path
// segments walk nested object keys directly, which also handles the common
// shape where a TOP-LEVEL key itself contains a `/` (mode-qualified groups
// such as `"theme/light"`): splitting on "." alone leaves that key intact as
// one segment, so a well-formed alias like `{theme/light.border.primary}`
// resolves in one hop, exactly as `@terrazzo/parser` would resolve it — no
// special-casing needed.
function resolvesInDocument(doc, aliasBody) {
  const segments = aliasBody.split(".")
  let node = doc
  for (const segment of segments) {
    if (node === null || typeof node !== "object" || Array.isArray(node))
      return false
    node = node[segment]
  }
  return isTokenNode(node)
}

// A cheap suggestion for the bug class the adoption spike found: an alias's
// first segment names a LOGICAL group with no token at the rest of the path,
// because the real groups are slash-qualified variants of it (a bare "theme"
// alongside "theme/light" and "theme/dark"). The bare group commonly EXISTS
// too — it holds the mode-independent tokens — so this cannot be decided by
// testing whether the head segment is absent. It swaps in every slash-
// qualified sibling and keeps only the swaps that actually resolve.
// Nothing is hardcoded: the candidates come from the document's own keys, and
// a candidate is only ever offered once proven to resolve.
//
// It used to lead with a candidate in the referencing token's OWN group
// (issue #171): a `system/dark` token whose alias "lost its mode" almost
// always meant `system/dark`, so offering the alphabetically-first group
// pointed at the other mode. Issue #564 settled that the alias had not lost
// anything — it is the folded path, and the engine now resolves it (§ 1a), so
// a suggestion in the token's own group is exactly the case that no longer
// reaches here. The tie-break could not reorder anything any more and went
// with the behaviour it was compensating for.
function suggestAliasTargets(doc, aliasBody) {
  const [head, ...rest] = aliasBody.split(".")
  return Object.keys(doc)
    .filter(key => key !== head && key.startsWith(`${head}/`))
    .map(key => [key, ...rest].join("."))
    .filter(candidate => resolvesInDocument(doc, candidate))
    .sort()
}

function compareDiagnostics(a, b) {
  return (
    compareEntities(a.tokenId, b.tokenId) ||
    (a.target < b.target ? -1 : a.target > b.target ? 1 : 0)
  )
}

// ---------------------------------------------------------------------------
// 1a. Sibling mode sets, read as modes of their head (issue #564).
//
// A source may keep each mode as its OWN top-level set — `system/dark` beside
// `system/light` — instead of as `$extensions.mode` overrides on one tree. A
// token in such a set refers to a token of the SAME mode by the path the sets
// have once they are read as modes of `system`: `system/dark.color.focusRing
// .color` aliases `{system.color.border.primary}`, never the mode-qualified
// form. `@terrazzo/parser` reads `system/dark` as a group whose name happens
// to contain a slash (`docs/spikes/terrazzo-fit.md` § 2 — the mode model is
// this engine's layer, not the parser's), so that alias resolves nowhere: it
// was reported `unresolvable-alias`, the "did you mean" advice pointed at the
// mode-qualified path that BREAKS such a project's own token build, and the
// aliasing token was dropped from the census. `paths.resolvedTokensFile` was
// the only way out and it asks the consumer for a pre-folded build artifact.
//
// So the engine infers the fold, from structure only — never from a name, and
// never from a config list of mode names, which would be consumer-specific.
// All three must hold:
//
//   1. two or more top-level sets share the head (`x/a` AND `x/b`). One set is
//      a group whose name contains a slash; a mode split needs siblings, and
//      inferring one from a lone group would pre-empt the very prep steps
//      `resolvedTokensFile` exists for;
//   2. the alias resolves NOWHERE in the document as authored — an alias that
//      already resolves is not this engine's business;
//   3. the same path under the referencing token's OWN set resolves.
//
// (3) is the line the whole inference rests on: a path that resolves only in a
// SIBLING set is left alone, diagnostic and suggestions intact, so one mode's
// value is never silently substituted for another's.
//
// A bare `x` group commonly exists too, holding the mode-independent tokens
// (`tokens-mode-set-alias.json` has one), so none of this can be decided by
// asking whether the head segment is absent — the same reason
// `suggestAliasTargets` resolves each candidate instead.
// ---------------------------------------------------------------------------

// Every top-level head with two or more `<head>/<...>` sets under it.
function siblingModeSetHeads(doc) {
  const counts = new Map()
  for (const key of Object.keys(doc)) {
    if (key.startsWith("$")) continue
    const slash = key.indexOf("/")
    if (slash < 1) continue
    const head = key.slice(0, slash)
    counts.set(head, (counts.get(head) ?? 0) + 1)
  }
  return new Set([...counts].filter(([, n]) => n > 1).map(([head]) => head))
}

// The folded target for one alias on one token, or `null` when the fold does
// not apply. `doc` is the whole (merged) document: a mode's tokens may live in
// a different file from the token referencing them.
function foldedAliasTarget(doc, heads, aliasBody, tokenId) {
  const set = tokenId.split(".")[0]
  const slash = set.indexOf("/")
  if (slash < 1) return null
  const head = set.slice(0, slash)
  if (!heads.has(head)) return null

  const segments = aliasBody.split(".")
  if (segments[0] !== head) return null
  if (resolvesInDocument(doc, aliasBody)) return null

  const candidate = [set, ...segments.slice(1)].join(".")
  return resolvesInDocument(doc, candidate) ? candidate : null
}

// `collectAliasStrings`' mirror: rewrite every alias string in a token's value,
// recursing into composites and arrays the same way. `rewrite` returns the new
// alias body or `null` to leave it alone. Returns the SAME object when nothing
// changed, which is what lets a caller tell an untouched document from a
// rewritten one.
function mapAliasStrings(value, rewrite) {
  if (typeof value === "string") {
    const match = ALIAS_RE.exec(value)
    if (!match) return value
    const next = rewrite(match[1])
    return next === null ? value : `{${next}}`
  }
  if (Array.isArray(value)) {
    let changed = false
    const out = value.map(item => {
      const mapped = mapAliasStrings(item, rewrite)
      if (mapped !== item) changed = true
      return mapped
    })
    return changed ? out : value
  }
  if (value !== null && typeof value === "object") {
    let changed = false
    const out = {}
    for (const [key, item] of Object.entries(value)) {
      out[key] = mapAliasStrings(item, rewrite)
      if (out[key] !== item) changed = true
    }
    return changed ? out : value
  }
  return value
}

/**
 * A deep copy of `tree` with every foldable sibling-mode-set alias re-pointed
 * at the referencing token's own set (issue #564).
 *
 * READ-ONLY BY CONSTRUCTION, exactly as `omitTokenLeaves` is: the rewrite lands
 * on the copy this engine hands `@terrazzo/parser`, never on the consumer's
 * file, and the census still reports the authored token ids. The SAME object
 * comes back when nothing was rewritten, so an untouched file is still handed
 * to the parser as its own text and its line numbers stay real.
 *
 * @param {object} tree the document (or one file's subtree) to rewrite
 * @param {object} [resolutionDoc] what resolvability is judged against —
 *   the whole merged document, which is not `tree` when `tree` is one file's
 *   contribution to a directory
 */
function foldSiblingModeAliases(tree, resolutionDoc = tree) {
  const heads = siblingModeSetHeads(resolutionDoc)
  if (heads.size === 0) return tree

  function foldToken(node, tokenId) {
    const rewrite = aliasBody =>
      foldedAliasTarget(resolutionDoc, heads, aliasBody, tokenId)

    let out = node
    const value = mapAliasStrings(node.$value, rewrite)
    if (value !== node.$value) out = { ...out, $value: value }

    // A per-mode override under the DTCG `$extensions.mode` escape hatch is a
    // value the parser resolves too, so it folds on the same terms as the
    // default one — `collectAliasSources` already scans both.
    const modeExt = node.$extensions && node.$extensions.mode
    if (modeExt !== null && typeof modeExt === "object") {
      let modes = modeExt
      for (const [modeName, modeNode] of Object.entries(modeExt)) {
        if (!isTokenNode(modeNode)) continue
        const modeValue = mapAliasStrings(modeNode.$value, rewrite)
        if (modeValue === modeNode.$value) continue
        modes = { ...modes, [modeName]: { ...modeNode, $value: modeValue } }
      }
      if (modes !== modeExt)
        out = { ...out, $extensions: { ...out.$extensions, mode: modes } }
    }
    return out
  }

  function walk(node, idParts) {
    if (node === null || typeof node !== "object" || Array.isArray(node))
      return node
    if (isTokenNode(node)) return foldToken(node, idParts.join("."))
    let changed = false
    const out = {}
    for (const [key, child] of Object.entries(node)) {
      if (key.startsWith("$")) {
        out[key] = child
        continue
      }
      out[key] = walk(child, [...idParts, key])
      if (out[key] !== child) changed = true
    }
    return changed ? out : node
  }

  return walk(tree, [])
}

/**
 * Walk the raw parsed JSON document (BEFORE Terrazzo ever sees it), collect
 * every alias `$value` (including per-mode overrides), and report every one
 * that does not resolve to a real token in the same document. Never throws;
 * returns `[]` when every alias resolves. Sorted for determinism.
 *
 * @param {object} doc parsed tokens.json
 * @returns {Array<{code: string, tokenId: string, target: string, mode?: string, message: string, suggestions?: string[]}>}
 */
export function findUnresolvableAliases(doc) {
  const diagnostics = []

  function walk(node, idParts) {
    if (node === null || typeof node !== "object" || Array.isArray(node)) return
    if (isTokenNode(node)) {
      const tokenId = idParts.join(".")
      for (const { mode, value } of collectAliasSources(node)) {
        const aliasBodies = []
        collectAliasStrings(value, aliasBodies)
        for (const target of aliasBodies) {
          if (resolvesInDocument(doc, target)) continue
          const suggestions = suggestAliasTargets(doc, target)
          const modeNote = mode === "." ? "" : ` (mode "${mode}")`
          // The suggestions were already computed and were already right —
          // they just never reached the human-readable message, which stated
          // the problem accurately and gave no way to act on it (issue #171).
          // Diagnosing a real instance by hand reproduced exactly what this
          // array already held.
          const didYouMean = suggestions.length
            ? ` — did you mean ${formatList(
                suggestions.map(c => `"{${c}}"`),
                "or",
              )}?`
            : ""
          diagnostics.push({
            code: "unresolvable-alias",
            tokenId,
            target,
            ...(mode === "." ? {} : { mode }),
            message: `token "${tokenId}"${modeNote} has an alias "{${target}}" that does not resolve to any token in this file${didYouMean}`,
            ...(suggestions.length ? { suggestions } : {}),
          })
        }
      }
      return
    }
    for (const [key, child] of Object.entries(node)) {
      if (key.startsWith("$")) continue
      walk(child, [...idParts, key])
    }
  }

  for (const [key, child] of Object.entries(doc)) {
    if (key.startsWith("$")) continue
    walk(child, [key])
  }

  return diagnostics.sort(compareDiagnostics)
}

// ---------------------------------------------------------------------------
// 2. DTCG token census, via @terrazzo/parser.
// ---------------------------------------------------------------------------

// The CSS-output form of a token's `$value` (issue #255) — reuses
// @terrazzo/parser's own sibling package (already installed transitively,
// promoted to a direct dependency below) rather than hand-rolling DTCG-to-CSS
// serialization. Without this, a composite type's `$value` stays in its raw
// DTCG shape (`{value, unit}` for `dimension`, `{colorSpace, components,
// alpha}` for `color`, …) forever, and nothing structured can ever equal a
// single hardcoded CSS declaration or a design tool's flat value — 91% of a
// real project's tokens (100% of its dimension/color ones) were unmatchable
// before this.
//
// `transformAlias` is overridden to recurse into the ALIASED token's own
// resolved value, not Terrazzo's default (`var(--the-alias)`): this answers
// "what value does this token represent", not "what would this token's own
// generated declaration reference" — a hardcoded literal that equals an
// ALIASED token's value is the same match regardless of whether some other
// token happens to reference it via `var()`. Most tokens in a real system
// alias a primitive, so without this override almost every composite token
// would flatten to a `var()` string and still never match a literal.
//
// Colors compare via `legacyHex` — closer to how a human hand-types a
// hardcoded color (`#ff00ff`) than Terrazzo's modern `rgb(N% N% N%)` default,
// which virtually nobody authors by hand.
// ponytail: CSS's 3-digit hex shorthand ("#fff" == "#ffffff") is not
// normalized, so a token that happens to compact to shorthand still won't
// match a 6-digit literal spelling of the same color. Widen this (emit both
// forms into the caller's match set) if that turns out to matter on a real
// project — exact-match-only is this rule's own documented design, so this
// is a narrowing of the SAME gap, not a new one.
function resolveTokenCssValue(token, tokensSet) {
  const options = {
    tokensSet,
    color: { legacyHex: true },
    transformAlias: aliasTarget => resolveTokenCssValue(aliasTarget, tokensSet),
  }
  try {
    return transformCSSValue(token, options)
  } catch {
    return undefined // malformed/unconvertible value — never a matchable string
  }
}

// A color token's opacity extension (issue #517) resolved to a multiplier in
// 0–1, or a stated reason it could not be. DTCG cannot alias a color and
// change its alpha, so a project that needs translucency carries the opacity
// as a reference on the color leaf under its own `$extensions` key — the same
// pairing a design tool stores as `{color, opacity}`. Reading it is entirely
// config-driven (`conventions.opacityExtension` / `opacityScale`): with no
// key configured this never runs, and no key name is assumed.
//
// The reference may be an alias (`"{system.opacity.scrim}"`) or a literal
// number. Anything else — an unresolvable alias, a non-number target, a
// scaled value outside 0–1 — applies NOTHING and says why: a color silently
// censused at the wrong alpha would be compared against the design side as if
// it were the authored value.
function resolveOpacityExtension(token, tokensSet, { key, scale }) {
  const raw = token.$extensions?.[key]
  if (raw === undefined) return null

  let ref
  let value = raw
  if (typeof raw === "string") {
    const match = ALIAS_RE.exec(raw.trim())
    if (!match) return { error: `is not a number or a "{token.id}" alias`, raw }
    ref = match[1]
    const target = tokensSet[ref]
    if (!target) return { error: `points at no token in this document`, raw }
    value = target.$value
  }

  if (typeof value !== "number" || !Number.isFinite(value))
    return { error: `resolves to ${JSON.stringify(value)}, not a number`, raw }

  const alpha = value / scale
  if (alpha < 0 || alpha > 1)
    return {
      error: `resolves to ${value}, which is outside the configured 0–${scale} opacity scale`,
      raw,
    }
  return { alpha, ref }
}

// The same token with its extension's opacity multiplied into the color's
// own alpha — a new object, never a mutation of Terrazzo's own token.
function withOpacity(token, alpha) {
  const value = token.$value
  if (!isPlainObject(value) || !Array.isArray(value.components)) return null
  return {
    ...token,
    $value: { ...value, alpha: (value.alpha ?? 1) * alpha },
    // `cssValue` resolves through `transformAlias` when a token aliases
    // another, which would hand back the TARGET's value and lose the alpha
    // applied here — this token's value is its own now, so the alias links
    // are dropped for that one call (the census entry keeps them).
    aliasOf: undefined,
    aliasChain: undefined,
  }
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

// Strip a Terrazzo `TokenNormalized` down to the census's own stable shape —
// never re-export Terrazzo's object verbatim, since its extra fields
// (`source.node`, the momoa AST, etc.) are neither JSON-stable nor this
// module's contract. `value` is JSON-round-tripped to guarantee a plain,
// serializable value regardless of what Terrazzo's internals hand back.
//
// @param {object} token a Terrazzo `TokenNormalized`
// @param {object} tokensSet the FULL `TokenNormalized` map (`parsed.tokens`,
//   keyed by id) — needed only to resolve `cssValue` through an alias chain;
//   not retained on the returned entry.
// @param {object} [opacity] `conventions.opacityExtension`/`opacityScale` as
//   `opacityOptions` resolves them, or null when the project configures none.
function normalizeToken(token, tokensSet, opacity) {
  const entry = {
    id: token.id,
    $type: token.$type,
    value: JSON.parse(JSON.stringify(token.$value)),
    modes: Object.keys(token.mode).sort(),
  }
  if (token.aliasOf) entry.aliasOf = token.aliasOf
  if (token.aliasChain && token.aliasChain.length)
    entry.aliasChain = [...token.aliasChain]
  // A DTCG COMPOSITE (`typography`, `border`, `shadow`, …) can alias only
  // SOME of its `$value` members — `system.typography.body.md`'s `fontSize`
  // pointing at `{system.fontSize.body.md}` while `fontFamily` stays literal.
  // Terrazzo tracks this per sub-property (never resolved past the immediate
  // target, unlike `aliasOf`/`aliasChain` — see its own comment: resolving
  // further would misattribute an intermediate cascade). `modules/tokens.mjs`
  // needs every such target to know a primitive consumed only through a
  // composite's member is not dead.
  if (
    token.partialAliasOf &&
    (Array.isArray(token.partialAliasOf)
      ? token.partialAliasOf.length
      : Object.keys(token.partialAliasOf).length)
  )
    entry.partialAliasOf = JSON.parse(JSON.stringify(token.partialAliasOf))
  if (token.$description) entry.description = token.$description
  // Only ever a STRING (issue #255): a composite that expands to MULTIPLE CSS
  // properties (`typography` always; `shadow`/`border` in the rare wide-gamut
  // case) comes back as an object from `resolveTokenCssValue`, and is left out
  // here rather than smuggled in as a shape callers would need to special-case
  // — a single hardcoded CSS declaration only ever has one property's one
  // value, so a multi-property composite has nothing in it that could equal
  // one. That is a structural mismatch, not a missing feature; see the issue
  // for why full multi-property matching is out of scope.
  // Applied BEFORE `cssValue` is resolved, so the census carries one value
  // and one CSS string that agree (issue #517).
  let cssSource = token
  // The alpha the extension resolved to, applied to every mode below as well
  // as to the default value: one extension, one alpha (issue #649).
  let alpha
  if (opacity) {
    const resolved = resolveOpacityExtension(token, tokensSet, opacity)
    if (resolved?.error) {
      entry.opacityDiagnostic = {
        code: "opacity-extension-unresolved",
        tokenId: token.id,
        message: `"${token.id}"'s "${opacity.key}" extension ${resolved.error} — its value is censused with no opacity applied`,
      }
    } else if (resolved) {
      const applied = withOpacity(token, resolved.alpha)
      if (applied) {
        cssSource = applied
        alpha = resolved.alpha
        entry.value = JSON.parse(JSON.stringify(applied.$value))
        // The opacity token is REFERENCED by this one, the same way an alias
        // target is — `tokens/token-unreferenced` reads this so a token
        // consumed only through the extension is not called dead.
        if (resolved.ref) entry.opacityOf = resolved.ref
      } else {
        entry.opacityDiagnostic = {
          code: "opacity-extension-unresolved",
          tokenId: token.id,
          message: `"${token.id}" carries a "${opacity.key}" extension but its own value is not a color — no opacity applied`,
        }
      }
    }
  }

  const cssValue = resolveTokenCssValue(cssSource, tokensSet)
  if (typeof cssValue === "string") entry.cssValue = cssValue

  // Each `$extensions.mode` override as the CSS string it renders as (issue
  // #642), beside `cssValue` and never replacing it: `cssValue` stays the
  // default mode's, which every other reader expects. Resolved through
  // `tokensSet` the same way, so an aliased mode value lands as its target's
  // color rather than a reference. The opacity extension's alpha, when the
  // default value took one, is applied to each mode's value the same way.
  const modeCssValues = {}
  for (const name of entry.modes) {
    if (name === ".") continue
    const mode = token.mode[name]
    const modeToken = {
      ...token,
      $value: mode.$value,
      aliasOf: mode.aliasOf,
      aliasChain: mode.aliasChain,
      partialAliasOf: mode.partialAliasOf,
    }
    const css = resolveTokenCssValue(
      (alpha !== undefined && withOpacity(modeToken, alpha)) || modeToken,
      tokensSet,
    )
    if (typeof css === "string") modeCssValues[name] = css
  }
  if (Object.keys(modeCssValues).length) entry.modeCssValues = modeCssValues
  return entry
}

/**
 * `conventions.opacityExtension`/`opacityScale` as the census reads them, or
 * `null` when the project configures no extension key at all.
 */
function opacityOptions(config) {
  const { opacityExtension, opacityScale } = resolveConventions(config)
  if (typeof opacityExtension !== "string" || opacityExtension === "")
    return null
  return { key: opacityExtension, scale: opacityScale }
}

/**
 * The same alias diagnostics with their SUGGESTION removed (issue #176).
 *
 * A suggestion is confident advice about how to fix an alias, and it is only
 * trustworthy when the engine judged the alias against the document the parser
 * actually resolves. When `resolvedTokensFile` is declared but unusable, the
 * engine knows it could NOT perform that check — and the suggestion it would
 * otherwise print is the exact "point each at its mode-qualified target"
 * advice `docs/spikes/terrazzo-fit.md` retracts as build-breaking.
 *
 * This is not a corner case: the missing-file message itself says the document
 * is "usually a build artifact; run the token build first", so any CI job that
 * audits before building tokens lands here. The diagnostic still fires — the
 * alias genuinely may be broken — but it stops telling anyone what to do about
 * it on evidence it does not have.
 */
function withoutSuggestions(aliasDiagnostics) {
  return aliasDiagnostics.map(diagnostic => {
    if (!diagnostic.suggestions) return diagnostic
    const { suggestions, ...rest } = diagnostic
    return {
      ...rest,
      message: diagnostic.message.replace(/ — did you mean .*$/, ""),
    }
  })
}

/**
 * Re-judge alias diagnostics against the document the PARSER actually resolves
 * (issue #176), when `paths.resolvedTokensFile` names one.
 *
 * The pre-scan this refines does TWO jobs, and conflating them caused a false
 * positive on a real consumer. It reports unresolvable aliases, AND it drops
 * those leaves so the rest of the document still parses — the second is
 * load-bearing, so the scan can never simply be skipped.
 *
 * What CAN be wrong is the claim. A project may run its own prep step before
 * the parser sees the file — folding mode-scoped groups, renaming tiers — and
 * then a reference that is unresolvable in the AUTHORED document is the only
 * one that resolves in the PARSED one. Reporting that as broken, with a
 * suggestion to "fix" it, is worse than saying nothing: applying the
 * suggestion broke that consumer's token build outright.
 *
 * SHARED BY BOTH CALLERS deliberately. `censusTokens` and `censusTokenLint`
 * run the same pre-scan, and fixing only one left `lint` handing out the exact
 * advice `docs/spikes/terrazzo-fit.md` retracts as build-breaking. One helper
 * means a third caller cannot inherit the old behaviour by omission.
 *
 * @returns {object[]} the diagnostics, with resolvable-after-prep entries
 *   reclassified and any file-level problem appended
 */
function judgeAliasesAgainstResolved(
  aliasDiagnostics,
  { resolvedTokensFile, tokensFile, root, fs = defaultFs },
) {
  if (!resolvedTokensFile) return aliasDiagnostics

  const resolvedAbs = isAbsolute(resolvedTokensFile)
    ? resolvedTokensFile
    : join(root, resolvedTokensFile)

  // Not gated on there BEING unresolvable aliases: a declared path that does
  // not resolve means the check the user configured is not the one running,
  // and staying quiet about that until an alias happens to break is how a
  // typo survives for months.
  if (!fs.existsSync(resolvedAbs)) {
    return [
      ...withoutSuggestions(aliasDiagnostics),
      {
        code: "resolved-tokens-file-missing",
        message: `paths.resolvedTokensFile points at ${resolvedTokensFile}, which does not exist — alias targets were judged against ${tokensFile} instead (it is usually a build artifact; run the token build first)`,
      },
    ]
  }

  // Read and parse are reported SEPARATELY: "could not read" sends someone to
  // check permissions and paths when the real problem is malformed JSON.
  let contents
  try {
    contents = fs.readFileSync(resolvedAbs, "utf8")
  } catch (err) {
    return [
      ...withoutSuggestions(aliasDiagnostics),
      {
        code: "resolved-tokens-file-unreadable",
        message: `could not read ${resolvedTokensFile}: ${err.message} — alias targets were judged against ${tokensFile} instead`,
      },
    ]
  }

  let resolvedDoc
  try {
    resolvedDoc = JSON.parse(contents)
  } catch (err) {
    return [
      ...withoutSuggestions(aliasDiagnostics),
      {
        code: "resolved-tokens-file-invalid",
        message: `invalid JSON in ${resolvedTokensFile}: ${err.message} — alias targets were judged against ${tokensFile} instead`,
      },
    ]
  }

  return aliasDiagnostics.map(diagnostic => {
    if (diagnostic.target && resolvesInDocument(resolvedDoc, diagnostic.target))
      return {
        code: "alias-resolved-after-preprocessing",
        tokenId: diagnostic.tokenId,
        target: diagnostic.target,
        ...(diagnostic.mode ? { mode: diagnostic.mode } : {}),
        message: `token "${diagnostic.tokenId}" has an alias "{${diagnostic.target}}" that resolves in ${resolvedTokensFile} but not in ${tokensFile} — correct as authored, and excluded from this census because the parser reads ${tokensFile}`,
      }

    // An alias broken in BOTH documents still keeps its diagnostic — but its
    // suggestions were computed against the AUTHORED file, and
    // `suggestAliasTargets` can only ever produce mode-qualified siblings
    // (`head/<mode>.…`). On exactly the project shape this field describes — a
    // prep step folding `head/<mode>` into `head` — every such candidate is
    // the build-breaking advice `docs/spikes/terrazzo-fit.md` retracts.
    //
    // So candidates are re-validated against the document the parser actually
    // reads, and a suggestion that survives nowhere is dropped. Without this
    // the healthy branch would be LESS careful than the three degraded ones,
    // while the schema text implies the opposite.
    if (!diagnostic.suggestions) return diagnostic
    const usable = diagnostic.suggestions.filter(candidate =>
      resolvesInDocument(resolvedDoc, candidate),
    )
    if (usable.length === diagnostic.suggestions.length) return diagnostic
    if (usable.length === 0) return withoutSuggestions([diagnostic])[0]
    return {
      ...diagnostic,
      suggestions: usable,
      message: diagnostic.message.replace(
        / — did you mean .*$/,
        ` — did you mean ${formatList(
          usable.map(c => `"{${c}}"`),
          "or",
        )}?`,
      ),
    }
  })
}

// Return a deep copy of `doc` with the named token leaves removed.
//
// READ-ONLY BY CONSTRUCTION: this builds a new object and never touches the
// consumer's file. The engine must not quietly edit anyone's tokens — the
// pruned copy exists only so the REST of the document can be parsed.
//
// Why this is needed at all: Terrazzo's `parse()` refuses an entire file over
// a single unresolvable alias. Measured on a real design system, TWO bad
// leaves blinded the other 655 and the tokens surface silently produced
// nothing at all (issue #123).
function omitTokenLeaves(doc, ids) {
  const drop = new Set(ids)
  if (drop.size === 0) return doc
  let removed = 0

  function prune(node, idParts) {
    if (node === null || typeof node !== "object" || Array.isArray(node))
      return node
    if (isTokenNode(node)) {
      if (!drop.has(idParts.join("."))) return node
      removed++
      return undefined
    }
    const out = {}
    for (const [key, child] of Object.entries(node)) {
      if (key.startsWith("$")) {
        out[key] = child
        continue
      }
      const pruned = prune(child, [...idParts, key])
      if (pruned !== undefined) out[key] = pruned
    }
    return out
  }

  const pruned = prune(doc, []) ?? {}
  // Same object back when nothing matched, so a caller can tell an untouched
  // document (whose original text is still exact) from a pruned one.
  return removed === 0 ? doc : pruned
}

// ---------------------------------------------------------------------------
// 1b. The token document loader — the ONE place `paths.tokensFile` is read.
//
// `tokensFile` names either a single DTCG JSON file or a DIRECTORY of them
// (a project that authors one file per group). A directory is read as every
// `*.json` under it, recursively, in sorted path order, and folded into one
// document — so both censuses below see the same tree they would see from a
// merged single file, and no project needs a build step that writes one just
// for this engine to read.
//
// Each file ALSO travels on its own (`sources`), carrying only what it
// contributed after conflicts were dropped: the parser is handed one input per
// file and merges them itself, so a lint violation's line is a line in the
// file a human actually edits, and `fileOf(tokenId)` can name that file.
// ---------------------------------------------------------------------------

// An injected fs without `statSync` (the tests' in-memory fakes) reads as a
// single file — the only shape those fakes model.
function isDirectory(absPath, fs) {
  try {
    return Boolean(fs.statSync?.(absPath).isDirectory())
  } catch {
    return false
  }
}

// Read + parse one tokens file. `{doc, raw}` or `{diagnostic}`; never throws.
function readTokenFile(absPath, label, fs, extra = {}) {
  let raw
  try {
    raw = fs.readFileSync(absPath, "utf8")
  } catch (err) {
    return {
      diagnostic: {
        code: "read-error",
        message: `could not read ${label}: ${err.message}`,
        ...extra,
      },
    }
  }
  let doc
  try {
    doc = JSON.parse(raw)
  } catch (err) {
    return {
      diagnostic: {
        code: "invalid-json",
        message: `invalid JSON in ${label}: ${err.message}`,
        ...extra,
      },
    }
  }
  if (!isPlainObject(doc)) {
    return {
      diagnostic: {
        code: "invalid-tokens-shape",
        message: `${label} must be a JSON object (got ${Array.isArray(doc) ? "array" : typeof doc})`,
        ...extra,
      },
    }
  }
  return { doc, raw }
}

const isGroup = node => isPlainObject(node) && !isTokenNode(node)

/**
 * Fold `src` (the document from `file`) into `target`, in place. The first
 * file to define a node owns it (`owners`, keyed by dot path; a group's
 * `$`-key by `<path>#<key>`): a later token leaf at a path already taken, or
 * a leaf/group collision, is a `duplicate-token`; a later group `$`-key with a
 * DIFFERENT value is a `group-key-conflict`. Either way the later definition
 * is dropped, never silently overwritten. An equal `$`-key is kept.
 *
 * @returns {object} what `src` contributed — `src` minus every dropped node
 */
function mergeTokenTree(target, src, file, path, owners, diagnostics) {
  const kept = {}
  for (const [key, child] of Object.entries(src)) {
    if (key.startsWith("$")) {
      const ownerKey = `${path.join(".")}#${key}`
      if (!Object.prototype.hasOwnProperty.call(target, key)) {
        target[key] = child
        owners.set(ownerKey, file)
        kept[key] = child
      } else if (JSON.stringify(target[key]) === JSON.stringify(child)) {
        // ponytail: equality is JSON text, so two `$extensions` objects with
        // the same keys in a different order read as a conflict. Harmless
        // (the first value is kept and it is reported) — compare structurally
        // if that ever turns up on a real project.
        kept[key] = child
      } else {
        const first = owners.get(ownerKey)
        const group = path.length ? `group "${path.join(".")}"` : "the root"
        diagnostics.push({
          code: "group-key-conflict",
          file,
          message: `${group} sets ${key} differently in ${first} and ${file} — the value in ${first} is used`,
        })
      }
      continue
    }

    const id = [...path, key].join(".")
    const existing = target[key]
    if (existing === undefined) {
      owners.set(id, file)
      if (isGroup(child)) {
        target[key] = {}
        kept[key] = mergeTokenTree(
          target[key],
          child,
          file,
          [...path, key],
          owners,
          diagnostics,
        )
      } else {
        target[key] = child
        kept[key] = child
      }
      continue
    }
    if (isGroup(existing) && isGroup(child)) {
      kept[key] = mergeTokenTree(
        existing,
        child,
        file,
        [...path, key],
        owners,
        diagnostics,
      )
      continue
    }
    const first = owners.get(id)
    const shape = node => (isTokenNode(node) ? "a token" : "a group")
    diagnostics.push({
      code: "duplicate-token",
      file,
      message:
        isTokenNode(existing) && isTokenNode(child)
          ? `token "${id}" is defined in both ${first} and ${file} — the definition in ${first} is used`
          : `"${id}" is ${shape(existing)} in ${first} and ${shape(child)} in ${file} — the definition in ${first} is used`,
    })
  }
  return kept
}

/**
 * Load `paths.tokensFile` — a file or a directory — for both token censuses.
 * Never throws: `{ok: false, diagnostic}` for a missing path, an empty
 * directory, or any file that cannot be read, is not JSON, or is not a JSON
 * object (naming that file); otherwise
 * `{ok: true, doc, sources, diagnostics, fileOf}`.
 *
 * - `doc` — the whole (merged) document, for the alias pre-scan.
 * - `sources` — `[{abs, file, raw, doc}]`, one per file, for the parser;
 *   `raw` is `null` for a file that lost a node to a merge conflict.
 * - `diagnostics` — merge conflicts (a directory only; never fatal).
 * - `fileOf(tokenId)` — the config-relative file a token came from.
 * - `isDirectory` — `true` for a directory, absent for a single file.
 *
 * A single file comes back exactly as it was read, so the single-file path
 * hands the parser the same text it always did.
 */
function loadTokenDocument(tokensFile, { root, fs }) {
  const absPath = isAbsolute(tokensFile) ? tokensFile : join(root, tokensFile)

  if (!fs.existsSync(absPath)) {
    return {
      ok: false,
      diagnostic: {
        code: "missing-tokens-file",
        message: `no tokens file at ${tokensFile}`,
      },
    }
  }

  if (!isDirectory(absPath, fs)) {
    const read = readTokenFile(absPath, tokensFile, fs)
    if (read.diagnostic) return { ok: false, diagnostic: read.diagnostic }
    // `raw: null` for a rewritten file, same rule as a merge conflict below:
    // its own text no longer matches what the parser must see.
    const doc = foldSiblingModeAliases(read.doc)
    return {
      ok: true,
      doc,
      sources: [
        {
          abs: absPath,
          file: tokensFile,
          raw: doc === read.doc ? read.raw : null,
          doc,
        },
      ],
      diagnostics: [],
      fileOf: () => tokensFile,
    }
  }

  const files = collectFilesSorted(absPath, [".json"], fs)
  if (files.length === 0) {
    return {
      ok: false,
      diagnostic: {
        code: "empty-tokens-dir",
        message: `no *.json files under ${tokensFile}`,
      },
    }
  }

  const base = tokensFile.replace(/[\\/]+$/, "")
  const doc = {}
  const owners = new Map()
  const diagnostics = []
  const sources = []
  for (const abs of files) {
    const file = `${base}/${toPosixRelative(absPath, abs)}`
    const read = readTokenFile(abs, file, fs, { file })
    if (read.diagnostic) return { ok: false, diagnostic: read.diagnostic }
    const before = diagnostics.length
    const kept = mergeTokenTree(doc, read.doc, file, [], owners, diagnostics)
    // `raw: null` marks a file that lost a node to a conflict: its own text
    // no longer matches what the parser must see, so it is re-serialised.
    const raw = diagnostics.length === before ? read.raw : null
    sources.push({ abs, file, raw, doc: kept })
  }
  // Folded against the MERGED document — each mode commonly lives in its own
  // file, so a file on its own cannot tell whether its head has siblings.
  const folded = foldSiblingModeAliases(doc)
  return {
    ok: true,
    doc: folded,
    sources: sources.map(source => {
      const foldedSource = foldSiblingModeAliases(source.doc, doc)
      return foldedSource === source.doc
        ? source
        : { ...source, raw: null, doc: foldedSource }
    }),
    diagnostics,
    fileOf: id => owners.get(id) ?? tokensFile,
    isDirectory: true,
  }
}

// The `$`-prefixed keys DTCG 2025.10 defines on a token or group. `$root` is a
// group's own token, walked like any other child; `$schema` is allowed at a
// document root only, where JSON tooling puts it.
const RESERVED_DOLLAR_KEYS = new Set([
  "$value",
  "$type",
  "$description",
  "$extensions",
  "$deprecated",
  "$extends",
  "$root",
])

// Every unreserved `$` key on a token or group, as `{path, key, file}` (#639).
// The parser drops such a key silently, so the raw document is the only place
// it is still visible. Never enters `$value` or `$extensions`: a composite's
// members and a vendor namespace are not token structure.
function collectDollarFields(node, file, path = [], out = []) {
  for (const [key, child] of Object.entries(node)) {
    if (key.startsWith("$")) {
      const allowed =
        RESERVED_DOLLAR_KEYS.has(key) || (key === "$schema" && !path.length)
      if (!allowed) out.push({ path: path.join("."), key, file })
      if (key !== "$root" || !isPlainObject(child)) continue
      // `$root` is the group's own token, so its keys belong to the group's id.
      collectDollarFields(child, file, path, out)
    } else if (isPlainObject(child)) {
      collectDollarFields(child, file, [...path, key], out)
    }
  }
  return out
}

// The parser's inputs: one per loaded source, each with the unresolvable-alias
// leaves removed. A source that lost nothing is handed over as its own text;
// one that lost a node (an excluded alias, a merge conflict) is re-serialised,
// and named in `relined` — line numbers the parser reports against it are
// lines in the re-serialised text, not in the file, so no caller may report
// them as a location.
function parserInputs(sources, excluded) {
  const relined = new Set()
  const inputs = sources.map(({ abs, file, raw, doc }) => {
    const pruned = omitTokenLeaves(doc, excluded)
    const exact = pruned === doc && raw !== null
    if (!exact) relined.add(file)
    return {
      filename: pathToFileURL(abs),
      src: exact ? raw : JSON.stringify(pruned),
    }
  })
  return { inputs, relined }
}

/**
 * Load + census the project's DTCG `tokens.json` (ADR-001 D3 — this file IS
 * the token contract), or every `*.json` under `paths.tokensFile` when it
 * names a directory (`loadTokenDocument`). Never throws: a missing path, an
 * empty directory, an unreadable file, malformed JSON, a non-object document,
 * or any unexpected `@terrazzo/parser` error all degrade to
 * `{ ok: false, tokens: [], diagnostics }` — see the module docblock. An
 * unresolvable alias or a directory's merge conflict is a diagnostic on an
 * otherwise-`ok` census.
 *
 * @param {object} config the project's (unresolved) config
 * @param {object} [options]
 * @param {string} [options.root] project root `paths.tokensFile` resolves
 *   against when it is relative (default `process.cwd()`)
 * @param {{existsSync: Function, readFileSync: Function, statSync?: Function, readdirSync?: Function}} [options.fs]
 *   injectable fs for the load step (default real `node:fs`); one without
 *   `statSync` can only model a single file
 * @param {{start?: Function, update?: Function, done?: Function, skip?: Function}} [options.onProgress]
 *   a `core/progress.mjs`-shaped bus, called if given — this module never
 *   imports a renderer itself (ADR-001 D8)
 * @returns {Promise<{ok: boolean, tokens: object[], diagnostics: object[], dollarFields?: Array<{path: string, key: string, file: string}>}>}
 *   `dollarFields` — every `$` key DTCG does not reserve, for
 *   `lint/unknown-dollar-field` (#639)
 */
export async function censusTokens(
  config,
  { root = process.cwd(), fs = defaultFs, onProgress } = {},
) {
  const { tokensFile, resolvedTokensFile } = resolvePaths(config)

  onProgress?.start?.("tokens", `loading ${tokensFile}`)

  const fail = diagnostic => {
    onProgress?.skip?.("tokens", diagnostic.message)
    return { ok: false, tokens: [], diagnostics: [diagnostic] }
  }

  const loaded = loadTokenDocument(tokensFile, { root, fs })
  if (!loaded.ok) return fail(loaded.diagnostic)
  const { doc } = loaded

  // PARTIAL, NOT ALL-OR-NOTHING (issue #123). Report the unresolvable aliases
  // as diagnostics, drop ONLY those leaves, and check everything else. The
  // previous behavior returned `{ok: false, tokens: []}` for the whole file,
  // so two bad leaves out of 657 meant this surface produced ZERO findings on
  // a real design system — and said so only as a diagnostic, which reads like
  // "we noticed something" rather than "your token rules did not run".
  // Judged against the document the PARSER resolves when one is declared —
  // see `judgeAliasesAgainstResolved`, shared with `censusTokenLint` so a
  // second caller cannot inherit the old behaviour by omission (issue #176).
  const aliasDiagnostics = judgeAliasesAgainstResolved(
    findUnresolvableAliases(doc),
    { resolvedTokensFile, tokensFile, root, fs },
  )

  // Only alias diagnostics name a token; the resolved-file ones the helper can
  // append are about the FILE, so they must not contribute an `undefined` leaf
  // to exclude.
  const excluded = [
    ...new Set(aliasDiagnostics.map(d => d.tokenId).filter(Boolean)),
  ].sort()
  if (excluded.length > 0) {
    onProgress?.skip?.(
      "tokens",
      `${excluded.length} token(s) excluded — unresolvable alias`,
    )
  }

  let parsed
  try {
    // cwd anchors Terrazzo's own path resolution (external $refs, if any);
    // it needs a directory-shaped URL (trailing slash), unlike the file URL
    // `filename` below, which names the document itself.
    const cwd = pathToFileURL(root.endsWith(sep) ? root : root + sep)
    const terrazzoConfig = defineConfig({}, { cwd })
    parsed = await parse(parserInputs(loaded.sources, excluded).inputs, {
      config: terrazzoConfig,
      skipLint: true, // lint delegation is Phase 3 (ADR-001 D10); this slice is census-only.
      // Silent: this module's own onProgress bus (D8) is the feedback
      // channel, not Terrazzo's console logger — a library call should
      // never write directly to the console out from under its caller.
      logger: new Logger({ level: "silent" }),
    })
  } catch (err) {
    // Belt-and-suspenders: the pre-scan above is the primary defense, but
    // any OTHER Terrazzo error (a malformed composite value, a circular
    // alias, etc.) must degrade the same honest way, never throw past here.
    return fail({
      code: "parse-error",
      message: `@terrazzo/parser could not parse ${tokensFile}: ${err.message}`,
    })
  }

  const opacity = opacityOptions(config)
  const tokens = Object.values(parsed.tokens)
    .map(token => normalizeToken(token, parsed.tokens, opacity))
    .sort((a, b) => compareEntities(a.id, b.id))
  // An extension the census could not read is reported, never silent — the
  // token is still censused, at its own alpha, and the diagnostic says so.
  const opacityDiagnostics = []
  for (const entry of tokens) {
    if (!entry.opacityDiagnostic) continue
    opacityDiagnostics.push({
      ...entry.opacityDiagnostic,
      file: loaded.fileOf(entry.id),
    })
    delete entry.opacityDiagnostic
  }

  onProgress?.done?.(
    "tokens",
    excluded.length > 0
      ? `${tokens.length} token(s), ${excluded.length} excluded`
      : `${tokens.length} token(s)`,
  )
  // `excluded` travels with the census because a dropped token must not become
  // a FALSE finding downstream: its CSS var would otherwise look like it had
  // no token behind it and be reported `token-untracked`. Trading one silence
  // for a lie would be worse than the bug this fixes.
  // `sources` names the file each token was authored in, for a DIRECTORY only
  // (#640): it is how `ignoreSources` scopes a project whose tiers are folders
  // rather than id roots. A single file would map every token to itself, so it
  // gets none. Kept off the `tokens` entries so a directory still censuses
  // exactly as its merged single file does.
  // `dollarFields` (#639) is walked per SOURCE, so each key names the file it
  // was authored in, and is sorted so file order never reaches the output.
  const dollarFields = loaded.sources
    .flatMap(source => collectDollarFields(source.doc, source.file))
    .sort(
      (a, b) =>
        compareEntities(a.path, b.path) ||
        compareStrings(a.key, b.key) ||
        compareStrings(a.file, b.file),
    )
  return {
    ok: true,
    tokens,
    diagnostics: [
      ...loaded.diagnostics,
      ...aliasDiagnostics,
      ...opacityDiagnostics,
    ],
    excluded,
    dollarFields,
    ...(loaded.isDirectory
      ? {
          // `fileOf` falls back to `tokensFile` itself on a miss; that is not
          // a source, and a broad glob must not match it.
          sources: Object.fromEntries(
            tokens
              .map(token => [token.id, loaded.fileOf(token.id)])
              .filter(([, file]) => file !== tokensFile),
          ),
        }
      : {}),
  }
}

// ---------------------------------------------------------------------------
// 2b. Delegated token lint (ADR-001 D10 / Phase 3, issue #120).
//
// `docs/spikes/lint-rule-mapping.md` is the decision record: Terrazzo ships 17
// real `core/*` rules, and its 16 `core/valid-*` rules found ZERO findings on a
// real 657-leaf token file — free on a healthy design system, and they catch
// genuinely malformed tokens without this engine reimplementing DTCG spec
// knowledge that Terrazzo already tracks.
//
// WHY THE VENDOR CALL LIVES HERE AND NOT IN `modules/lint.mjs`. `lintRunner`
// wants Terrazzo's own token map and source records — a VENDOR data structure.
// Handing that to a module would drag the vendor into the pure layer, the
// mirror of the mistake D12/D16 exist to prevent. So the vendor stops at
// `sources/`, exactly as it already does for `censusTokens`, and the module
// receives normalized `{ruleId, level, message, entity}` violations it can be
// tested against with plain injected fixtures.
// ---------------------------------------------------------------------------

// Terrazzo reports a violation by calling `logger.error(...)`/`.warn(...)` with
// a structured `{group, label, message, filename, node}` — `label` IS the rule
// id. Capturing those calls is why this subclass exists; the alternative is
// scraping rule ids out of a thrown exception's message, which would break the
// first time upstream rewords a string.
//
// It also SWALLOWS them. `Logger.error` throws by default, which would let one
// malformed token abort the whole surface — and the hard requirement for this
// slice is that lint can never fail a run that `audit` survives.
class CollectingLogger extends Logger {
  constructor(options) {
    super(options)
    this.collected = []
  }

  error(entry) {
    this.collected.push({ level: "error", entry })
  }

  warn(entry) {
    this.collected.push({ level: "warn", entry })
  }
}

function normalizeViolation({ level, entry, file, tokenId }) {
  return {
    // `core/valid-color` etc. The prefix is kept deliberately: a consumer
    // reading a report can tell a DELEGATED rule from one this engine ports
    // without consulting docs.
    ruleId: typeof entry?.label === "string" ? entry.label : "core/unknown",
    level,
    message: String(entry?.message ?? "").trim(),
    // The token id is NOT on the entry: Terrazzo hands the lint callback a
    // raw AST node (`{type, value, loc, range}`) with no id on it. The
    // per-token loop in `censusTokenLint` resolves it instead (#636), and only
    // when the node provably sits inside that one token's own source node —
    // a wrong id in a report is worse than none, so an untraced violation
    // carries no id and `entity` falls back to the rule id upstream.
    //
    // The offending value and its line travel either way, so a reader can
    // still find it.
    //
    // `file` travels WITH the line, from the caller rather than the node: the
    // line is a position in the tokens file being linted, and a position with
    // no file to read it against is not a location. Anything that renders a
    // line (a SARIF region, an editor jump) needs both or neither.
    entity: tokenId,
    value: entry?.node?.value,
    line: entry?.node?.loc?.start?.line,
    file,
  }
}

// True only when a lint entry's node is the token's own source node or one of
// its children, in the same file: source ranges nest, so containment is exact
// rather than a guess by nearby line. Anything missing a range is untraced.
function isWithinTokenSource(entry, token) {
  const inner = entry?.node?.range
  const outer = token?.source?.node?.range
  if (!Array.isArray(inner) || !Array.isArray(outer)) return false
  if (
    entry.filename &&
    token.source.filename &&
    String(entry.filename) !== String(token.source.filename)
  )
    return false
  return inner[0] >= outer[0] && inner[1] <= outer[1]
}

/**
 * Run Terrazzo's lint rules over the project's tokens and return NORMALIZED
 * violations. Never throws, and never fails the caller over an input the
 * token census itself would have merely reported on.
 *
 * `ok` and `delegated` answer DIFFERENT questions, and a caller reasoning
 * about "did this rule get a chance to report?" wants the second. `ok` means
 * the census did not fail; `delegated` means Terrazzo's rules actually ran. The
 * no-rules-configured path below is `ok: true, delegated: false` — a silent
 * success in which nothing could possibly have been found.
 *
 * @returns {Promise<{ok: boolean, delegated: boolean, violations: Array<{ruleId: string, level: string, message: string, entity?: string}>, diagnostics: Array<object>, skipped?: boolean}>}
 */
export async function censusTokenLint(
  config,
  { root = process.cwd(), onProgress, rules } = {},
) {
  const { tokensFile, resolvedTokensFile } = resolvePaths(config)

  const fail = diagnostic => {
    onProgress?.skip?.("lint", diagnostic.message)
    return {
      ok: false,
      violations: [],
      diagnostics: [diagnostic],
      skipped: true,
      delegated: false,
    }
  }

  // No configured rules means nothing to delegate. Silent, not an error — a
  // project that has enabled no lint rules must get zero findings, never a
  // faceful of some other design system's opinions (issue #121's invariant,
  // asserted here too because this is the surface that could break it first).
  const ruleConfig = rules && Object.keys(rules).length > 0 ? rules : null
  if (!ruleConfig) {
    onProgress?.done?.("lint", "no lint rules configured")
    // `ok` but NOT `delegated`: nothing ran, so nothing could have reported.
    // A caller that reads `ok` alone cannot tell this apart from a clean run
    // over a configured rule set, and the two mean opposite things when the
    // question is "did this rule have a chance to say something?".
    return { ok: true, violations: [], diagnostics: [], delegated: false }
  }

  const loaded = loadTokenDocument(tokensFile, { root, fs: defaultFs })
  if (!loaded.ok) return fail(loaded.diagnostic)
  const { doc } = loaded

  // The same pre-scan `censusTokens` runs, and for the same reason: Terrazzo's
  // `parse()` REFUSES A WHOLE FILE over one unresolvable alias. A real token
  // file had two, which the token census reports as ordinary diagnostics — so
  // without this, two bad aliases would take down a surface that has nothing
  // to do with them.
  // Same partial treatment as `censusTokens` (issue #123): drop only the
  // unresolvable leaves so the rest of the file can still be linted, rather
  // than letting two bad aliases silence every rule.
  // Judged against the PARSED document too, not only in `censusTokens`
  // (issue #176). Fixing one caller left `lint` emitting the exact suggestion
  // `docs/spikes/terrazzo-fit.md` retracts as build-breaking, on any project
  // that configures lint rules and runs a token prep step.
  const aliasDiagnostics = judgeAliasesAgainstResolved(
    findUnresolvableAliases(doc),
    // No `fs` — this census has no injected seam of its own, so the helper's
    // default applies rather than inventing a half-honoured one here.
    { resolvedTokensFile, tokensFile, root },
  )
  const excluded = [
    ...new Set(aliasDiagnostics.map(d => d.tokenId).filter(Boolean)),
  ].sort()
  if (excluded.length > 0) {
    onProgress?.skip?.(
      "lint",
      `${excluded.length} token(s) excluded — unresolvable alias`,
    )
  }

  const logger = new CollectingLogger({ level: "silent" })
  const input = parserInputs(loaded.sources, excluded)
  try {
    const cwd = pathToFileURL(root.endsWith(sep) ? root : root + sep)
    const terrazzoConfig = defineConfig(
      { lint: { rules: ruleConfig } },
      { cwd },
    )
    const parsed = await parse(input.inputs, {
      config: terrazzoConfig,
      skipLint: true, // run it explicitly below, so violations land in the collector
      logger,
    })
    // Anything the PARSE phase logged is not a lint finding.
    logger.collected.length = 0

    // ONE `lintRunner` CALL PER TOKEN, not one call over the whole set
    // (issue #138). Measured directly against `@terrazzo/parser`: three
    // malformed tokens of the same type, linted together, yield exactly ONE
    // violation — the runner stops after the first. Looping means each
    // token gets its own chance to report, restoring the "every offender at
    // once" guarantee this module already gives the alias pre-scan above.
    //
    // Costs N calls instead of one, but each is in-memory rule execution
    // against a single-entry token map, not a re-parse: measured at ~14ms for
    // 655 calls on a real 655-token file — cheaper than the single call it
    // replaces (parse dominates the cost either way). No new vendor
    // knowledge: this still delegates $type/$value validation to Terrazzo,
    // it just asks it 655 narrower questions instead of one broad one.
    //
    // ASSUMES EVERY DELEGATED RULE IS PER-TOKEN — true of the whole
    // `core/valid-*` family this module delegates today (each checks one
    // token's own `$type`/`$value`, nothing else). A future delegated rule
    // that compares ACROSS tokens (Terrazzo's own `core/consistent-naming`,
    // if ever turned on here, or anything like it) would see only one token
    // per call and could never fire — this loop is not the right shape for
    // that kind of rule, and adding one should revisit this.
    //
    // The per-token loop is also what names each violation's FILE: whatever
    // this call collected belongs to this token, and the loader knows which
    // file the token came from (the logger entries do not carry it).
    //
    // And its TOKEN (#636) — but only on proof, not on the loop's say-so:
    // the violation's node must lie inside this token's own source node.
    for (const [id, token] of Object.entries(parsed.tokens)) {
      const from = logger.collected.length
      await lintRunner({
        tokens: { [id]: token },
        sources: parsed.sources,
        config: terrazzoConfig,
        logger,
      })
      for (const collected of logger.collected.slice(from)) {
        collected.file = loaded.fileOf(id)
        if (isWithinTokenSource(collected.entry, token)) collected.tokenId = id
      }
    }
  } catch (err) {
    return fail({
      code: "lint-error",
      message: `@terrazzo/parser could not lint ${tokensFile}: ${err.message}`,
    })
  }

  const violations = logger.collected
    // `file` (config-relative — `tokensFile` itself for a single file) is the
    // file each violation's line belongs to, tagged in the loop above. A file
    // the parser only saw re-serialised has no real line to give: the line is
    // dropped rather than reported wrong (every violation would read line 1).
    .map(collected => {
      const violation = normalizeViolation(collected)
      if (input.relined.has(collected.file)) violation.line = undefined
      return violation
    })
    .sort(
      (a, b) =>
        compareEntities(a.ruleId, b.ruleId) ||
        compareEntities(a.entity || "", b.entity || "") ||
        compareEntities(a.message, b.message),
    )

  onProgress?.done?.("lint", `${violations.length} violation(s)`)
  return {
    ok: true,
    violations,
    diagnostics: [...loaded.diagnostics, ...aliasDiagnostics],
    excluded,
    delegated: true,
  }
}

// ---------------------------------------------------------------------------
// 3. Emitted-CSS-var census — port of v1 drift-lint.mjs's grep-style scan
//    (`computeCssVarUsageCounts`/`collectDefinedSystemVars`), generalized off
//    the hardcoded `--system-` prefix and `components|styles|app` dir triple
//    onto `conventions.cssVarPrefix` and `paths.componentsDir` (the only
//    code root the config schema exposes today — see D4/D9; a future schema
//    revision adding more roots only needs to grow `scanRoots` below).
// ---------------------------------------------------------------------------

// SCSS/CSS for declarations; TS/TSX/JS/JSX too, since a handful of
// components compute a CSS custom-property reference in JS/inline style
// rather than pure stylesheet (v1's documented case). This is CSS-ecosystem
// knowledge, not consumer-specific naming (ADR-001's leak concern) — every
// project using CSS custom properties uses some subset of these.
const DEFAULT_SCAN_EXTENSIONS = [".css", ".scss", ".ts", ".tsx", ".js", ".jsx"]
const STYLE_EXTENSIONS = [".css", ".scss"]

// True when the character(s) at `index` begin a template interpolation — `${`
// (JS/TS template literal) or `#{` (SCSS). Used to tell "this reference is
// composed at runtime" from "this reference is wrong".
function isInterpolatedAt(content, index) {
  const next = content.slice(index, index + 2)
  return next === "${" || next === "#{"
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function lineOf(content, index) {
  return content.slice(0, index).split("\n").length
}

function sortOccurrences(list) {
  return [...list].sort(
    (a, b) => compareStrings(a.file, b.file) || a.line - b.line,
  )
}

/**
 * Census every CSS custom-property declaration (`--prefix-foo: …`) and
 * usage (`var(--prefix-foo)`) under the configured component root, filtered
 * to `conventions.cssVarPrefix`. Plain-text scan (a grep, not a real CSS/JS
 * parse — the same tradeoff v1's linter made), config-driven, never
 * hardcoded to any project's namespace or directory layout.
 *
 * @param {object} config the project's (unresolved) config
 * @param {object} [options]
 * @param {string} [options.root] project root `paths.componentsDir` resolves
 *   against when it is relative (default `process.cwd()`)
 * @param {{existsSync: Function, readFileSync: Function, readdirSync: Function}} [options.fs]
 *   injectable fs (default real `node:fs`)
 * @param {object} [options.onProgress] see `censusTokens`
 * @param {(absPath: string) => boolean} [options.include] narrows the scan to
 *   the files this predicate accepts, by ABSOLUTE path. Absent, every
 *   discovered file is scanned. The caller decides what "in scope" means —
 *   this module only ever applies the answer (`cli/commands/audit.mjs` passes
 *   the `--staged` scope, issue #220).
 * @returns {{ok: boolean, vars: object[], emitted: object[], missingStyleRoots: string[], diagnostics: object[]}}
 *   `vars` is sorted by name; each entry's `declarations`/`usages` are
 *   sorted by file then line. `emitted` is every custom-property declaration
 *   in a stylesheet under `paths.styleRoots` ONLY, as `{name, value, file,
 *   selector}` sorted by file, selector, then name — the build's output,
 *   which `tokens/emitted-value-mismatch` compares against the tokens (issue
 *   #627). Each is a selector's UNCONDITIONAL value where it has one
 *   (`censusStylesheetText`'s rule: an `@media` override never displaces
 *   it), and every `--*` name is kept, not only prefixed ones, so a
 *   `var()` reference into another namespace can still be followed.
 *   `missingStyleRoots` lists each configured `paths.styleRoots` entry not
 *   on disk, as configured.
 */
export function censusCssVars(
  config,
  { root = process.cwd(), fs = defaultFs, onProgress, include } = {},
) {
  const { componentsDir, styleRoots } = resolvePaths(config)
  const { cssVarPrefix } = resolveConventions(config)
  // Config-driven roots. `componentsDir` is where vars are USED; `styleRoots`
  // is where a project emits its generated token stylesheets, which normally
  // sit outside the component tree.
  //
  // Without the second, every var declared in `tokens/css/*` looks used-but-
  // never-declared and `tokens/var-unresolved` fires at ERROR severity —
  // measured at 49 false errors on a real design system, enough to fail
  // `verify` on a perfectly healthy project. Empty by default: the engine
  // assumes nothing about where a project puts them.
  const scanRoots = [componentsDir, ...(styleRoots || [])]
  // A configured style root that is not on disk (a renamed token directory)
  // means the census cannot see the stylesheet it was pointed at.
  // `tokens/token-unemitted` reads this and stays silent rather than calling
  // every unused token unemitted (issue #562).
  const missingStyleRoots = (styleRoots || []).filter(
    styleRoot =>
      !fs.existsSync(isAbsolute(styleRoot) ? styleRoot : join(root, styleRoot)),
  )

  onProgress?.start?.(
    "css-vars",
    `scanning for "${cssVarPrefix}*" custom properties`,
  )

  const escapedPrefix = escapeRegExp(cssVarPrefix)
  const declRe = new RegExp(`(${escapedPrefix}[a-zA-Z0-9-]+)\\s*:`, "g")
  const usageRe = new RegExp(`var\\(\\s*(${escapedPrefix}[a-zA-Z0-9-]+)`, "g")

  const byName = new Map()
  function record(name, kind, file, line) {
    if (!byName.has(name))
      byName.set(name, { name, declarations: [], usages: [] })
    byName.get(name)[kind].push({ file, line })
  }

  for (const scanRoot of scanRoots) {
    const dirAbs = isAbsolute(scanRoot) ? scanRoot : join(root, scanRoot)
    for (const fileAbs of collectFilesSorted(
      dirAbs,
      DEFAULT_SCAN_EXTENSIONS,
      fs,
    )) {
      if (include && !include(fileAbs)) continue
      const content = fs.readFileSync(fileAbs, "utf8")
      const fileRel = toPosixRelative(root, fileAbs)
      for (const m of content.matchAll(declRe))
        record(m[1], "declarations", fileRel, lineOf(content, m.index))
      for (const m of content.matchAll(usageRe)) {
        // A DYNAMICALLY COMPOSED name is not a var reference this scanner can
        // resolve, and recording the truncated prefix asserts a var nobody
        // wrote. `var(--system-color-fg-${slot}-default)` matches as far as
        // the `$` and yields `--system-color-fg-`, which nothing declares
        // because nothing could — one false `tokens/var-unresolved` at ERROR
        // severity, enough on its own to fail `verify` on a healthy project
        // (issue #127). v1's linter skipped these too; the rewrite lost it.
        //
        // Matched on the INTERPOLATION SYNTAX (`${…}` in JS/TS, `#{…}` in
        // SCSS), never on "the name ends in a dash" — a genuinely malformed
        // literal in a stylesheet must still be caught.
        if (isInterpolatedAt(content, m.index + m[0].length)) continue
        record(m[1], "usages", fileRel, lineOf(content, m.index))
      }
    }
  }

  // The build's output, read as values rather than names: style files under
  // `styleRoots` only. A `componentsDir` declaration is a component's own
  // override, not an emission, and is never compared.
  const emitted = []
  for (const styleRoot of styleRoots || []) {
    const dirAbs = isAbsolute(styleRoot) ? styleRoot : join(root, styleRoot)
    for (const fileAbs of collectFilesSorted(dirAbs, STYLE_EXTENSIONS, fs)) {
      if (include && !include(fileAbs)) continue
      const file = toPosixRelative(root, fileAbs)
      for (const { selector, declarations } of censusStylesheetText(
        fs.readFileSync(fileAbs, "utf8"),
      ))
        for (const decl of declarations)
          if (decl.property.startsWith("--"))
            emitted.push({
              name: decl.property,
              value: decl.raw ?? decl.value,
              file,
              selector,
            })
    }
  }
  emitted.sort(
    (a, b) =>
      compareStrings(a.file, b.file) ||
      compareStrings(a.selector, b.selector) ||
      compareStrings(a.name, b.name),
  )

  const vars = [...byName.values()]
    .map(entry => ({
      name: entry.name,
      declarations: sortOccurrences(entry.declarations),
      usages: sortOccurrences(entry.usages),
    }))
    .sort((a, b) => compareStrings(a.name, b.name))

  onProgress?.done?.("css-vars", `${vars.length} var(s)`)
  return { ok: true, vars, emitted, missingStyleRoots, diagnostics: [] }
}

/**
 * Every style file under the configured `componentsDir`/`styleRoots` whose
 * name ends in `conventions.stylesSuffix` — absolute, sorted. Config-driven,
 * same two roots `censusCssVars` scans (a project's generated token
 * stylesheets normally sit outside the component tree). Empty when
 * `stylesSuffix` isn't configured — nothing to match, not an error.
 *
 * Its first caller was the `styles/raw-value-uncontracted` sweep, removed
 * with that rule in 8c9a14e; it came back with `query raw-values` (issue
 * #493), which asks the same "what is in this project's stylesheets"
 * question as an inventory rather than as drift.
 *
 * @param {object} config the project's (unresolved) config
 * @param {object} [options]
 * @param {string} [options.root] project root a relative root resolves
 *   against (default `process.cwd()`)
 * @param {{existsSync: Function, readdirSync: Function}} [options.fs]
 * @returns {string[]} absolute paths, sorted
 */
export function findStyleFiles(
  config,
  { root = process.cwd(), fs = defaultFs } = {},
) {
  const { componentsDir, styleRoots } = resolvePaths(config)
  const { stylesSuffix } = resolveConventions(config)
  if (!stylesSuffix) return []

  const scanRoots = [componentsDir, ...(styleRoots || [])]
  const files = []
  for (const scanRoot of scanRoots) {
    const dirAbs = isAbsolute(scanRoot) ? scanRoot : join(root, scanRoot)
    files.push(...collectFilesSorted(dirAbs, [stylesSuffix], fs))
  }
  return [...new Set(files)].sort(compareStrings)
}

// ---------------------------------------------------------------------------
// 4. Component-usage census (issue #223) — every relative import/re-export,
//    plus every dynamic `import(...)` call (issue #254 — see
//    `DYNAMIC_IMPORT_RE` below), under `paths.componentsDir`, resolved to the
//    file it points at. Same plain-text-scan tradeoff as `censusCssVars`: a
//    real module resolver would need the TypeScript program
//    `sources/react/extract.mjs` already builds, and this census has no
//    reason to depend on a framework adapter (D16 — `sources/` core stays
//    framework-agnostic; only `sources/<framework>/` may know about
//    JSX/React).
//
//    Scoped to `componentsDir` only, the one code root the config schema
//    exposes (D4/D9, same scope `censusCssVars` and `findStyleFiles` use) —
//    NOT the whole project. So this census can only ever say "no OTHER
//    component in the tree imports this one"; a consuming app importing it
//    from outside `componentsDir` is invisible to it. That is exactly why
//    `components/unused-component` (`modules/components.mjs`) is `review`
//    severity, never `error`/`warn`: an absence observed in one root is not
//    an absence from the project.
//
//    `import type { X } from "./x"` is deliberately excluded — it references
//    the file's TYPES, not the component itself, and counting it as usage
//    would hide a component that is truly never rendered anywhere.
// ---------------------------------------------------------------------------

// Anchored at the start of an `import`/`export` line so a lazy scan across a
// multi-line named-import list (no trailing `;` in a semicolon-free project)
// still lands on the `from "…"` clause that belongs to THIS statement, not a
// later one — `\bfrom\b` (not `from`) so it never fires inside an identifier
// like `fromDate`.
const RELATIVE_IMPORT_RE =
  /^\s*(?:export|import)\s+(?!type\s)[\s\S]*?\bfrom\b\s*["'](\.[^"']+)["']/gm

// A dynamic `import(...)` CALL EXPRESSION — `import("./x")`, `import("./x").then(...)`,
// or wrapped in `dynamic(() => import("./x"))`/`React.lazy(() => import("./x"))` — has
// no `from` clause at all, so it is invisible to `RELATIVE_IMPORT_RE` above even though
// it is a real usage (issue #254: a component only ever reached this way false-
// positived as unused). Unlike a static import, this is a valid expression anywhere on
// a line, not just at statement position, so it is matched wherever it appears rather
// than anchored to line-start — the same lack of comment/string stripping the static
// regex and `censusCssVars`'s `declRe`/`usageRe` already have (a plain-text scan, not a
// parse; see the module docblock). Quoted-literal specifier only (`["']`): a template-
// literal specifier (`import(\`./${x}\`)`) is a dynamically composed path this scan
// cannot resolve to a real file, so it is left unmatched rather than guessed at — the
// same "decline to guess" call `censusCssVars`'s `usageRe` makes for an interpolated
// var name.
//
// ponytail: `typeof import("./x")` — TypeScript's type-only dynamic import — is
// indistinguishable here from the value-position form and will count as usage, the same
// gap `RELATIVE_IMPORT_RE` closes explicitly for static `import type`. Add a
// `(?<!typeof\s)` lookbehind if this proves noisy in practice; not implemented since
// issue #254 doesn't report it and it's a narrower case than the bug being fixed.
const DYNAMIC_IMPORT_RE = /\bimport\s*\(\s*["'](\.[^"']+)["']\s*\)/g

// Tried in this order — extensionless first (`./Icon.tsx` written in full),
// then each extension, then each as a directory's `index`. First existing
// candidate wins, so resolution is deterministic even when both `./Icon.tsx`
// and `./Icon/index.tsx` happen to exist.
const RESOLVE_SUFFIXES = [
  "",
  ".tsx",
  ".ts",
  ".jsx",
  ".js",
  "/index.tsx",
  "/index.ts",
  "/index.jsx",
  "/index.js",
]

function resolveRelativeImport(fromFileAbs, specifier, fs) {
  const base = resolve(dirname(fromFileAbs), specifier)
  for (const suffix of RESOLVE_SUFFIXES) {
    const candidate = base + suffix
    // `existsSync` alone is true for a directory too — `./icon` resolving to
    // the `icon/` directory itself would win over `icon/index.tsx` and the
    // census would then record a usage for a path nothing ever emits as a
    // component file (issue #223's own test caught this).
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile())
      return candidate
  }
  return null
}

/**
 * Census every file under `paths.componentsDir` that at least one OTHER file
 * in that same tree imports — via a static, relative `import`/`export …
 * from`, OR a dynamic `import(...)` call (issue #254, e.g. `next/dynamic`,
 * `React.lazy`) — the code-side half of `components/unused-component`
 * (`modules/components.mjs`). Plain-text scan, config-driven, never hardcoded
 * to any project's namespace (see the section docblock above for the scope
 * caveat this census carries).
 *
 * @param {object} config the project's (unresolved) config
 * @param {object} [options]
 * @param {string} [options.root] project root `paths.componentsDir` resolves
 *   against when it is relative (default `process.cwd()`)
 * @param {{existsSync: Function, readFileSync: Function, readdirSync: Function, statSync: Function}} [options.fs]
 *   injectable fs (default real `node:fs`)
 * @param {object} [options.onProgress] see `censusTokens`
 * @returns {{ok: boolean, usages: object[], diagnostics: object[]}} `usages`
 *   is sorted by (imported) file; each entry's `usedBy` is sorted by
 *   (importing) file then line.
 */
export function censusComponentUsage(
  config,
  { root = process.cwd(), fs = defaultFs, onProgress } = {},
) {
  const { componentsDir } = resolvePaths(config)
  const dirAbs = isAbsolute(componentsDir)
    ? componentsDir
    : join(root, componentsDir)

  onProgress?.start?.(
    "component-usage",
    `scanning ${componentsDir} for component imports`,
  )

  const usedByFile = new Map()
  // Shared by both the static and dynamic branches below so a target resolved
  // from either import form feeds the exact same map, deterministically.
  function recordUsage(fileAbs, fileRel, content, specifier, matchIndex) {
    const targetAbs = resolveRelativeImport(fileAbs, specifier, fs)
    if (!targetAbs || targetAbs === fileAbs) return
    const targetRel = toPosixRelative(root, targetAbs)
    if (!usedByFile.has(targetRel)) usedByFile.set(targetRel, [])
    usedByFile
      .get(targetRel)
      .push({ file: fileRel, line: lineOf(content, matchIndex) })
  }

  for (const fileAbs of collectFilesSorted(
    dirAbs,
    DEFAULT_SCAN_EXTENSIONS,
    fs,
  )) {
    const content = fs.readFileSync(fileAbs, "utf8")
    const fileRel = toPosixRelative(root, fileAbs)
    for (const m of content.matchAll(RELATIVE_IMPORT_RE))
      recordUsage(fileAbs, fileRel, content, m[1], m.index)
    for (const m of content.matchAll(DYNAMIC_IMPORT_RE))
      recordUsage(fileAbs, fileRel, content, m[1], m.index)
  }

  const usages = [...usedByFile.entries()]
    .map(([file, usedBy]) => ({ file, usedBy: sortOccurrences(usedBy) }))
    .sort((a, b) => compareStrings(a.file, b.file))

  onProgress?.done?.("component-usage", `${usages.length} file(s) referenced`)
  return { ok: true, usages, diagnostics: [] }
}
