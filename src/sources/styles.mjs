/**
 * styles.mjs — the CODE side of the style-parity check (ADR-001 D5, Phase 2b,
 * issue #103): census what a component's stylesheet actually declares — which
 * selectors exist, and for each, which CSS properties are set and whether
 * each value is a `var(--x)` token reference or a hardcoded literal.
 *
 * PLAIN-TEXT SCAN, not a real CSS/SCSS parse — the SAME tradeoff
 * `sources/code.mjs`'s `censusCssVars` documents, for the same reason: the
 * engine ships no CSS-parser dependency (`CLAUDE.md`'s "no new runtime
 * deps"), and a brace-depth walk over the raw text answers "which selector,
 * which property, token or literal" without a full parser whose AST this
 * module would use for almost nothing else. See "KNOWN LIMITS" below for
 * exactly what that costs.
 *
 * `sources/` may import `core/` + node builtins and NOTHING else internal
 * (`__tests__/layering.test.js` enforces this) — never `spec/`, `modules/`.
 * That is why this module censuses whatever FILES it is handed rather than
 * discovering them from a project's contracts itself: contract discovery is
 * `spec/`'s job, off-limits to `sources/`. The CALLER (today,
 * `cli/commands/audit.mjs`) collects every loaded contract's
 * `sources.code.styles` path and hands the list here — the same shape
 * `sources/react/extract.mjs`'s `extractComponents(files, …)` already establishes
 * for the components census, so this is a port of an established pattern,
 * not a new one.
 *
 * SELECTOR RESOLUTION — the "documented normalization" this file owns, and
 * its KNOWN LIMITS (read before trusting output):
 *
 *   - Comments are stripped first (`/* … *‍/` block comments and SCSS-style
 *     `//` line comments). A `//` inside a quoted string value is stripped
 *     too — this is text scanning, not a tokenizer, and a component rarely
 *     embeds `//` inside a CSS string, so the rare false strip is accepted
 *     rather than built around (`censusCssVars`'s own documented tradeoff).
 *   - A nested rule whose header starts with `&` is combined with its
 *     parent's OWN resolved selector: `&.large` nested under `.button`
 *     resolves to `.button.large`, `&[data-tone="danger"]` resolves to
 *     `.button[data-tone="danger"]`. A comma list of such items
 *     (`&.a, &.b { … }`) resolves to each in turn — one shared block, two
 *     selectors, the same declarations on both. This is the ONE SCSS
 *     nesting shape this module resolves, because it is the one
 *     `modules/styles.mjs` needs for locating a variant's modifier selector
 *     (see that module's docblock). `&` anywhere else in a header
 *     (`.foo & .bar`, `.foo&.bar`) is too combinatorial to resolve honestly
 *     — that block's selector resolves to nothing at all, and its
 *     declarations are invisible to every downstream rule (never guessed
 *     at; the same "when ambiguous, silence" standard `modules/tokens.mjs`
 *     sets).
 *   - An at-rule header (`@media …`, `@supports …`, …) does not introduce a
 *     new selector scope — a rule nested directly inside one resolves
 *     against whatever selector the at-rule itself is nested under, since an
 *     at-rule wraps a scope rather than naming an element. An at-rule at the
 *     file's own top level (no enclosing selector) has no scope to inherit,
 *     so anything nested directly inside it is invisible too (rare, and
 *     always recoverable by nesting the at-rule inside the selector instead,
 *     the far more common authoring order).
 *   - Any other header (a plain class/tag/attribute selector, comma-separated
 *     or not) is split on top-level commas and, when nested under exactly
 *     one resolved parent, recorded as the DESCENDANT selector it is
 *     (`.button { .icon { … } }` → `.button .icon`, parent `.button`). It
 *     used to be recorded as the bare `.icon`, which merged every
 *     `.sm .label` / `.lg .label` block into one entry (issue #378).
 *     `modules/styles.mjs` maps an element to either form.
 *   - A property declared more than once within the same selector's own
 *     block keeps only the LAST occurrence — an approximation of the
 *     cascade's "last declaration of equal specificity wins", not a real
 *     specificity engine (there is exactly one of these per selector here,
 *     never a competing rule elsewhere in the cascade). One exception: a
 *     declaration inside an at-rule (a breakpoint, a `@supports`) never
 *     displaces the same property declared unconditionally for that
 *     selector, wherever either appears in the file — the unconditional
 *     value is the one a contract describes; the conditional one is an
 *     override this census cannot evaluate, so it only ever fills a gap.
 *   - A selector's own `parent` is recorded as the single resolved selector
 *     of its immediately enclosing block, when that block resolved to
 *     EXACTLY one selector — `null` otherwise (a top-level rule, or a
 *     comma-selector parent, has no single "one" parent to name). An
 *     at-rule is transparent here too: a selector re-emitted through one
 *     keeps the parent it would have had without it, never itself.
 *   - SCSS `#{…}` interpolation inside a value is skipped as text, never
 *     read as a block. Interpolation in a HEADER (`.#{$name}`) is not
 *     resolved — the header keeps its literal text and matches nothing.
 *
 * Determinism (the working-method gate, ADR-001): a file's selectors are
 * sorted by selector text; a selector's declarations are sorted by property
 * name. No wall clock, no randomness.
 */

import { existsSync, readFileSync } from "node:fs"
import { isAbsolute, join } from "node:path"
import { toPosixRelative } from "../core/paths.mjs"
import { compareStrings } from "../core/text.mjs"

// The real filesystem, used unless a caller injects one.
const defaultFs = { existsSync, readFileSync }

// ---------------------------------------------------------------------------
// 1. Comment stripping.
// ---------------------------------------------------------------------------

function stripComments(text) {
  const noBlockComments = text.replace(/\/\*[\s\S]*?\*\//g, "")
  return noBlockComments.replace(/\/\/.*$/gm, "")
}

// ---------------------------------------------------------------------------
// 2. Declaration-value classification: a `var(--x)` reference vs a literal.
// ---------------------------------------------------------------------------

const VAR_RE = /^var\(\s*(--[A-Za-z0-9-]+)\s*(?:,[\s\S]*)?\)$/i
const EMBEDDED_VAR_RE = /var\(\s*(--[A-Za-z0-9-]+)/gi

/**
 * Classify one declaration's value text. Exported for direct unit testing —
 * this is the one place "is this a token reference or a literal" is decided.
 *
 * THREE kinds, not two. A value can reference a token WITHOUT being solely a
 * `var()`: `border: 1px solid var(--c)`, `padding: var(--a) var(--b)`,
 * `width: calc(100% - var(--m) * 2)`. Measured against a real design system,
 * 73 of 507 var-using declarations (14%) are shaped like that.
 *
 * Calling those "literal" is what makes a style check lie: the contract
 * declares a token for `border.color`, the stylesheet plainly binds one, and
 * the check reports it missing. Calling them "var" is equally wrong — which
 * of `border`'s sub-properties does the var satisfy? Position alone does not
 * say, and guessing is how a check earns distrust.
 *
 * So a value that CONTAINS token references without being one is `compound`:
 * the census states what it saw (including every var name), and the module
 * decides it cannot adjudicate that property and stays silent. Honest
 * indeterminacy beats a confident wrong answer in either direction.
 *
 * @param {string} value already trimmed, semicolon/`!important` stripped
 * @returns {{kind: "var", varName: string, raw: string}
 *   |{kind: "compound", varNames: string[], raw: string}
 *   |{kind: "literal", value: string}}
 */
export function classifyDeclarationValue(value) {
  // A multi-line value (`linear-gradient(\n  to right,\n  …)`) is one value;
  // its line breaks are authoring, not content. Collapsed here so a finding
  // reads as CSS and a report cell has no whitespace run for a markdown
  // formatter to fold (issue #369).
  const cleaned = value
    .replace(/\s*!important\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim()
  const match = VAR_RE.exec(cleaned)
  if (match) return { kind: "var", varName: match[1], raw: cleaned }

  const embedded = [...cleaned.matchAll(EMBEDDED_VAR_RE)].map(m => m[1])
  if (embedded.length > 0)
    return {
      kind: "compound",
      varNames: [...new Set(embedded)].sort(),
      raw: cleaned,
    }

  return { kind: "literal", value: cleaned }
}

// ---------------------------------------------------------------------------
// 3. Selector-header resolution — see the module docblock.
// ---------------------------------------------------------------------------

function normalizeWhitespace(text) {
  return text.replace(/\s+/g, " ").trim()
}

// Splits a selector list on TOP-LEVEL commas only — a comma inside `()` or
// `[]` (an `:is(.a, .b)` argument list, an attribute-selector value) never
// splits the selector it belongs to.
function splitTopLevelCommas(selectorText) {
  const parts = []
  let depth = 0
  let current = ""
  for (const ch of selectorText) {
    if (ch === "(" || ch === "[") depth++
    else if (ch === ")" || ch === "]") depth--
    if (ch === "," && depth === 0) {
      parts.push(current)
      current = ""
    } else {
      current += ch
    }
  }
  parts.push(current)
  return parts.map(part => part.trim()).filter(part => part.length > 0)
}

/**
 * Resolve one block header's selector(s) against its (already-resolved)
 * enclosing scope. `parentSelector` is `undefined` at the file's top level,
 * `null` when the enclosing block itself resolved to more than one selector
 * (or none), or the single enclosing selector string otherwise.
 *
 * @param {string} headerRaw the raw text between the previous boundary and `{`
 * @param {string|null|undefined} parentSelector
 * @returns {string[]} zero or more resolved selectors this header names
 */
export function resolveHeaderSelectors(headerRaw, parentSelector) {
  const header = normalizeWhitespace(headerRaw)
  if (header === "") return []

  if (header.startsWith("@")) {
    // An at-rule wraps its enclosing scope rather than naming a new one.
    if (parentSelector === undefined || parentSelector === null) return []
    return [parentSelector]
  }

  if (header.includes("&")) {
    if (parentSelector === null || parentSelector === undefined) return []
    // A comma list of leading-`&` items (`&.a,\n&.b { … }`) is the SCSS way
    // to share one block between modifiers; each item resolves on its own.
    // Bailing on the second `&` hid every such block — measured: a real
    // component's shared `padding-top` under two variants read as MISSING
    // under both. Anything else (`&` not leading, `.x & .y`) is still too
    // combinatorial to resolve honestly and still resolves to nothing.
    const items = splitTopLevelCommas(header)
    const simple = items.every(
      item => item.startsWith("&") && !item.slice(1).includes("&"),
    )
    if (!simple) return []
    return items.map(item => `${parentSelector}${item.slice(1)}`)
  }

  // A plain header nested under exactly one resolved parent is a DESCENDANT
  // rule and is recorded as one (`.sm .label`), never as the bare child
  // (issue #378). Recording `.label` alone merged every `.sm .label`, `.lg
  // .label`, `.outline .label` block into ONE entry, last declaration
  // winning — a base compare against a bag of three variants' values. At
  // the top level, or under a comma/absent parent, the header is its own
  // literal selector, as before.
  const items = splitTopLevelCommas(header)
  if (parentSelector === undefined || parentSelector === null) return items
  return items.map(item => `${parentSelector} ${item}`)
}

// ---------------------------------------------------------------------------
// 4. The brace-depth walk.
// ---------------------------------------------------------------------------

function flushDeclaration(frame, text) {
  const trimmed = text.trim()
  if (trimmed === "") return
  const colonIndex = trimmed.indexOf(":")
  if (colonIndex === -1) return // stray text, not a declaration — ignore
  const property = trimmed.slice(0, colonIndex).trim().toLowerCase()
  const value = trimmed
    .slice(colonIndex + 1)
    .trim()
    .replace(/;$/, "")
    .trim()
  if (property === "" || value === "") return
  frame.declarations.set(property, classifyDeclarationValue(value))
}

/**
 * Parse one stylesheet's text into a flat selector census. Pure — no fs, no
 * network; the plain-text brace walk the module docblock documents.
 *
 * @param {string} rawText the stylesheet's raw content
 * @returns {Array<{selector: string, parent: string|null, declarations: Array<{property: string, kind: "var"|"literal", varName?: string, value?: string}>}>}
 *   sorted by `selector`; each entry's `declarations` sorted by `property`
 */
export function censusStylesheetText(rawText) {
  const text = stripComments(rawText)
  const results = new Map() // selector -> {selector, parent, declarations: Map}
  const stack = []
  let buffer = ""

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]

    if (ch === "{") {
      // SCSS `#{…}` interpolation is a value, not a block: `transform 1s
      // #{$easing}` must not open a frame whose "header" is the half-read
      // declaration (issue #363 — measured: four phantom selectors under one
      // real component root). Skip to its closing brace and keep buffering.
      if (text[i - 1] === "#") {
        const close = text.indexOf("}", i)
        if (close === -1) break
        buffer += text.slice(i, close + 1)
        i = close
        continue
      }

      const headerRaw = buffer
      buffer = ""
      const enclosing = stack.length > 0 ? stack[stack.length - 1] : null
      const parentSelector =
        enclosing === null
          ? undefined
          : enclosing.resolvedSelectors.length === 1
            ? enclosing.resolvedSelectors[0]
            : null
      const resolved = resolveHeaderSelectors(headerRaw, parentSelector)
      // An at-rule wraps its enclosing selector rather than naming a new one,
      // so the selector it re-emits keeps the enclosing block's OWN parent.
      // Naming the enclosing selector as its parent instead recorded
      // `.button.sm` as the parent of `.button.sm` — and since the nested
      // frame closes first, that self-parent won (issue #363; it hid every
      // `&.sm { @include mq.md { … } }` variant from the modifier lookup).
      const isAtRule = normalizeWhitespace(headerRaw).startsWith("@")
      stack.push({
        resolvedSelectors: resolved,
        singleParent: isAtRule
          ? (enclosing?.singleParent ?? null)
          : parentSelector === undefined
            ? null
            : parentSelector,
        // Inside ANY at-rule, however deep: these declarations apply only
        // when the at-rule's condition holds, which this census cannot
        // evaluate — so they never displace an unconditional one (below).
        conditional: isAtRule || Boolean(enclosing?.conditional),
        declarations: new Map(),
      })
      continue
    }

    if (ch === ";") {
      const frame = stack[stack.length - 1]
      if (frame) flushDeclaration(frame, buffer)
      buffer = ""
      continue
    }

    if (ch === "}") {
      const frame = stack.pop()
      if (frame) {
        if (buffer.trim() !== "") flushDeclaration(frame, buffer)
        for (const selector of frame.resolvedSelectors) {
          if (!results.has(selector)) {
            results.set(selector, {
              selector,
              parent: frame.singleParent,
              declarations: new Map(),
              unconditional: new Set(),
            })
          }
          const entry = results.get(selector)
          for (const [property, decl] of frame.declarations) {
            // "Last wins" only among equals. A responsive re-opening
            // (`@include mq.sm { &.big { margin: var(--lg) } }`) after the
            // plain `&.big { margin: var(--md) }` used to REPLACE the base
            // value with the breakpoint's, and the style check then reported
            // a token mismatch against a contract that was right (issue
            // #363). The unconditional declaration is the one a contract
            // describes; a conditional one only fills a property nothing
            // unconditional has set.
            if (frame.conditional && entry.unconditional.has(property)) continue
            entry.declarations.set(property, decl)
            if (!frame.conditional) entry.unconditional.add(property)
          }
        }
      }
      buffer = ""
      continue
    }

    buffer += ch
  }

  return [...results.values()]
    .map(entry => ({
      selector: entry.selector,
      parent: entry.parent,
      declarations: [...entry.declarations.entries()]
        .map(([property, decl]) => ({ property, ...decl }))
        .sort((a, b) => compareStrings(a.property, b.property)),
    }))
    .sort((a, b) => compareStrings(a.selector, b.selector))
}

// ---------------------------------------------------------------------------
// 5. Filesystem layer — census a list of style files.
// ---------------------------------------------------------------------------

/**
 * Census ONE style file off disk. Never throws: a missing or unreadable file
 * degrades to `{ok: false, file: null, diagnostics}`, the same honest-
 * degradation rule every other `sources/` module follows.
 *
 * @param {string} filePath absolute (or `options.root`-relative) path
 * @param {object} [options]
 * @param {{existsSync: Function, readFileSync: Function}} [options.fs]
 *   injectable fs (default real `node:fs`)
 * @param {string} [options.label] what to call this file in the returned
 *   census/diagnostics — defaults to `filePath`
 * @returns {{ok: boolean, file: {file: string, selectors: object[]}|null, diagnostics: object[]}}
 */
export function censusStyleFile(filePath, { fs = defaultFs, label } = {}) {
  const file = label || filePath

  if (!fs.existsSync(filePath)) {
    return {
      ok: false,
      file: null,
      diagnostics: [
        {
          code: "missing-style-file",
          file,
          message: `no style file at ${file}`,
        },
      ],
    }
  }

  let raw
  try {
    raw = fs.readFileSync(filePath, "utf8")
  } catch (err) {
    return {
      ok: false,
      file: null,
      diagnostics: [
        {
          code: "read-error",
          file,
          message: `could not read ${file}: ${err.message}`,
        },
      ],
    }
  }

  return {
    ok: true,
    file: { file, selectors: censusStylesheetText(raw) },
    diagnostics: [],
  }
}

/**
 * Census every style file in `filePaths`. A single bad file NEVER aborts the
 * set (the same rule `spec/contracts.mjs`'s `loadContracts` and
 * `sources/react/extract.mjs`'s `extractComponents` both follow): it contributes
 * diagnostics and every other file still censuses.
 *
 * @param {string[]} filePaths repo-relative (or absolute) paths — typically
 *   every loaded contract's `sources.code.styles`, deduplicated by the caller
 * @param {object} [options]
 * @param {string} [options.root] project root a relative path resolves
 *   against, and the base every returned `file` label is made relative to
 *   (default `process.cwd()`)
 * @param {{existsSync: Function, readFileSync: Function}} [options.fs]
 * @param {{start?: Function, update?: Function, done?: Function, skip?: Function}} [options.onProgress]
 *   a `core/progress.mjs`-shaped bus, called if given — this module never
 *   imports a renderer itself (ADR-001 D8)
 * @returns {{ok: boolean, files: Array<{file: string, selectors: object[]}>, diagnostics: object[]}}
 *   `files` holds only the ones that censused cleanly, sorted by `file`
 */
export function censusStyles(
  filePaths,
  { root = process.cwd(), fs = defaultFs, onProgress } = {},
) {
  const sorted = [...new Set(filePaths || [])].sort(compareStrings)
  onProgress?.start?.("styles", `scanning ${sorted.length} style file(s)`)

  const files = []
  const diagnostics = []

  for (const entry of sorted) {
    const fileAbs = isAbsolute(entry) ? entry : join(root, entry)
    const label = toPosixRelative(root, fileAbs)
    onProgress?.update?.("styles", label)
    const result = censusStyleFile(fileAbs, { fs, label })
    diagnostics.push(...result.diagnostics)
    if (result.ok) files.push(result.file)
  }

  files.sort((a, b) => compareStrings(a.file, b.file))

  if (diagnostics.length > 0)
    onProgress?.skip?.("styles", `${diagnostics.length} diagnostic(s)`)
  else onProgress?.done?.("styles", `${files.length} style file(s)`)

  return { ok: diagnostics.length === 0, files, diagnostics }
}
