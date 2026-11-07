/**
 * init-detect.mjs — best-effort detection for `design-delta init` (ADR-001
 * D8, Phase 4). Pure heuristics over a filesystem: given a project root,
 * suggest values for the fields `init` needs, so the wizard has real defaults
 * to prompt with rather than the engine's own generic ones.
 *
 * Nothing here detects a design tool — `init`'s design-provider prompt
 * (Phase 5) has no filesystem heuristic of its own to offer; it falls back to
 * an existing config's value, or "none" otherwise. Every field this module
 * DOES detect is a code-side one this release's contract↔code path reads.
 *
 * A CLI-SHELL CONCERN, NOT `core/` OR `sources/`: this reads the filesystem
 * directly (`core/` never does, ADR-001 D4) and is not React/token-specific
 * enough to belong in `sources/` (ADR-001 D16) — it is cross-cutting setup
 * logic for exactly one subcommand, the same reasoning that puts `flags.mjs`
 * here rather than in `core/`.
 *
 * EVERY DETECTION DEGRADES TO "NO SUGGESTION", NEVER A GUESS ASSERTED AS
 * FACT: a candidate is offered only when the filesystem gives real evidence
 * for it (a file that exists, a directory that contains matching files). The
 * wizard always lets the answer be typed over, and `resolveConfig`'s existing
 * defaults (`core/config.mjs`) are the fallback when detection finds nothing
 * — this module invents no new default of its own.
 *
 * fs is injectable (default real `node:fs`) — the same convention every
 * fs-touching module here follows, so tests drive it against an in-memory
 * fake rather than real temp directories where that is cheaper.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs"
import { isAbsolute, join } from "node:path"

import { collectFilesSorted } from "../core/paths.mjs"

const defaultFs = { existsSync, readFileSync, readdirSync }

// ---------------------------------------------------------------------------
// tokensFile
// ---------------------------------------------------------------------------

// Common paths a DTCG tokens file lives at, most-specific first. Generic
// filenames from the DTCG ecosystem itself — Style Dictionary, Tokens Studio,
// and Terrazzo's own docs all use one of these — never one project's choice.
const TOKENS_FILE_CANDIDATES = [
  "tokens.json",
  "tokens/tokens.json",
  "tokens/json/tokens.json",
  "design-tokens.json",
  "src/tokens.json",
  "src/tokens/tokens.json",
]

// A DTCG token leaf carries its own `$value` key. Checking that ANY node in
// the parsed document has one is a cheap, generic shape test — not a full
// parse, and not `@terrazzo/parser` (this only needs to decide "does this
// look like a tokens file", not resolve it).
function looksLikeDtcg(doc, depth = 0) {
  if (depth > 6 || doc === null || typeof doc !== "object") return false
  if (Array.isArray(doc)) return false
  if (Object.prototype.hasOwnProperty.call(doc, "$value")) return true
  return Object.entries(doc).some(
    ([key, value]) => !key.startsWith("$") && looksLikeDtcg(value, depth + 1),
  )
}

// `paths.tokensFile` may also name a DIRECTORY of DTCG files (one file per
// group, read and merged by the engine). Tried only after every single-file
// candidate misses, so a project with both keeps proposing its one file.
const TOKENS_DIR_CANDIDATES = ["tokens/json", "tokens", "src/tokens"]

function readsAsDtcg(abs, fs) {
  try {
    return looksLikeDtcg(JSON.parse(fs.readFileSync(abs, "utf8")))
  } catch {
    return false // unreadable or not JSON at all — not a match
  }
}

/**
 * @param {string} root project root
 * @param {{existsSync: Function, readFileSync: Function, readdirSync: Function}} [fs]
 * @returns {string|null} a root-relative path (a file, or a directory holding
 *   DTCG `*.json` files), or null when nothing matched
 */
export function detectTokensFile(root, fs = defaultFs) {
  for (const candidate of TOKENS_FILE_CANDIDATES) {
    const abs = join(root, candidate)
    if (fs.existsSync(abs) && readsAsDtcg(abs, fs)) return candidate
  }
  for (const candidate of TOKENS_DIR_CANDIDATES) {
    let files
    try {
      files = collectFilesSorted(join(root, candidate), [".json"], fs)
    } catch {
      continue // not a directory
    }
    if (files.some(abs => readsAsDtcg(abs, fs))) return candidate
  }
  return null
}

// ---------------------------------------------------------------------------
// componentsDir
// ---------------------------------------------------------------------------

const COMPONENT_DIR_CANDIDATES = [
  "components",
  "src/components",
  "ui",
  "src/ui",
]

// Extensions common across UI-component-authoring ecosystems generally — not
// a claim that any one of them is supported today (only `sources/react/`
// exists, ADR-001 D16). Detection may notice a Vue/Svelte project's directory
// shape without this engine being able to read it yet; the census that
// actually runs is the honest answer to whether it works, not this heuristic.
const COMPONENT_FILE_EXTENSIONS = [".tsx", ".jsx", ".vue", ".svelte"]

function containsComponentFiles(dirAbs, fs) {
  let entries
  try {
    entries = fs.readdirSync(dirAbs, { withFileTypes: true })
  } catch {
    return false
  }
  for (const entry of entries) {
    if (
      entry.isFile &&
      entry.isFile() &&
      COMPONENT_FILE_EXTENSIONS.some(ext => entry.name.endsWith(ext))
    )
      return true
    if (entry.isDirectory && entry.isDirectory()) {
      if (containsComponentFiles(join(dirAbs, entry.name), fs)) return true
    }
  }
  return false
}

/**
 * @param {string} root project root
 * @param {{existsSync: Function, readdirSync: Function}} [fs]
 * @returns {string|null}
 */
export function detectComponentsDir(root, fs = defaultFs) {
  for (const candidate of COMPONENT_DIR_CANDIDATES) {
    const abs = join(root, candidate)
    if (!fs.existsSync(abs)) continue
    if (containsComponentFiles(abs, fs)) return candidate
  }
  return null
}

// ---------------------------------------------------------------------------
// contractsDir
// ---------------------------------------------------------------------------

/**
 * Whether `componentsDir` already holds `*.contract.json` files — the
 * colocated-contracts convention this repo's own config uses. When true,
 * `contractsDir` should equal `componentsDir` rather than the engine's
 * separate-directory default ("contracts").
 *
 * @param {string} root project root
 * @param {string} componentsDirRel root-relative componentsDir
 * @param {string} contractSuffix from `conventions.contractSuffix`
 * @param {{existsSync: Function, readdirSync: Function}} [fs]
 * @returns {boolean}
 */
export function componentsDirHasContracts(
  root,
  componentsDirRel,
  contractSuffix,
  fs = defaultFs,
) {
  const abs = join(root, componentsDirRel)
  return hasSuffixedFile(abs, contractSuffix, fs)
}

function hasSuffixedFile(dirAbs, suffix, fs) {
  let entries
  try {
    entries = fs.readdirSync(dirAbs, { withFileTypes: true })
  } catch {
    return false
  }
  for (const entry of entries) {
    if (entry.isFile && entry.isFile() && entry.name.endsWith(suffix))
      return true
    if (entry.isDirectory && entry.isDirectory()) {
      if (hasSuffixedFile(join(dirAbs, entry.name), suffix, fs)) return true
    }
  }
  return false
}

// ---------------------------------------------------------------------------
// cssVarPrefix
// ---------------------------------------------------------------------------

const STYLE_FILE_EXTENSIONS = [".css", ".scss"]
// A custom property's OWN NAME at a declaration site: `--foo-bar: value;`.
// Usage sites (`var(--foo-bar)`) are deliberately not sampled — a component
// commonly USES a var it does not itself declare (a token from elsewhere),
// which would bias the sample toward whatever that project's token vars
// happen to be named, not toward what THIS project declares.
const CSS_VAR_DECL_RE = /(--[a-zA-Z][a-zA-Z0-9-]*)\s*:/g

function collectCssFiles(dirAbs, fs, out) {
  let entries
  try {
    entries = fs.readdirSync(dirAbs, { withFileTypes: true })
  } catch {
    return out
  }
  for (const entry of entries) {
    const abs = join(dirAbs, entry.name)
    if (entry.isDirectory && entry.isDirectory()) {
      collectCssFiles(abs, fs, out)
      continue
    }
    if (
      entry.isFile &&
      entry.isFile() &&
      STYLE_FILE_EXTENSIONS.some(ext => entry.name.endsWith(ext))
    )
      out.push(abs)
  }
  return out
}

// Common places a project's GENERATED token stylesheet lives, distinct from
// componentsDir — the same gap `paths.styleRoots` exists to cover (measured
// on a real design system in issue #123: 49 false `var-unresolved` errors
// because the census scanned only componentsDir, and every declaration sat in
// "tokens/css/*" instead). A var prefix detector that only sampled
// componentsDir would suffer the identical blind spot: on that same real
// project, 632 of the actual `--system-*` declarations live under
// "tokens/css/", zero under "components/".
const STYLE_ROOT_CANDIDATES = ["tokens/css", "styles", "src/styles", "css"]

// The leading segment of one declared custom property, e.g.
// `--acme-color-bg` -> `--acme-`. A single-segment name (`--gap`) has no
// namespace to extract.
function prefixOf(name) {
  const segments = name.split("-").filter(Boolean)
  return segments.length > 1 ? `--${segments[0]}-` : null
}

// The MAJORITY prefix among every declared custom property, not a unanimous
// one — measured against a real design system and corrected because of what
// that measurement found: a component tree legitimately mixes design-token
// vars (hundreds of `--system-*` declarations) with component-LOCAL
// computation vars (`--hero-icon-size`, `--marquee-gap`, an unrelated
// `--cg-*` grid-utility namespace from a third-party layout system) — an
// entirely normal pattern, and requiring every declaration to agree returned
// null on that project despite an overwhelming, obvious dominant prefix.
//
// Suggested only when the top prefix accounts for a clear majority (more
// than half) of every sampled declaration — conservative enough that a
// genuinely mixed-vocabulary project (no dominant namespace) still offers
// nothing rather than guess.
export function detectCssVarPrefix(root, componentsDirRel, fs = defaultFs) {
  const roots = [
    ...(componentsDirRel ? [componentsDirRel] : []),
    ...STYLE_ROOT_CANDIDATES.filter(candidate =>
      fs.existsSync(join(root, candidate)),
    ),
  ]
  if (roots.length === 0) return null

  const files = roots.flatMap(dir => collectCssFiles(join(root, dir), fs, []))
  const names = []
  for (const file of files) {
    let content
    try {
      content = fs.readFileSync(file, "utf8")
    } catch {
      continue
    }
    for (const m of content.matchAll(CSS_VAR_DECL_RE)) names.push(m[1])
  }
  if (names.length === 0) return null

  const counts = new Map()
  for (const name of names) {
    const prefix = prefixOf(name)
    if (prefix === null) continue
    counts.set(prefix, (counts.get(prefix) || 0) + 1)
  }
  if (counts.size === 0) return null

  const [topPrefix, topCount] = [...counts.entries()].sort(
    (a, b) => b[1] - a[1],
  )[0]
  return topCount > names.length / 2 ? topPrefix : null
}

// ---------------------------------------------------------------------------
// styleRoots
// ---------------------------------------------------------------------------

/**
 * Which of the style-root candidates actually exist — `paths.styleRoots`
 * extra roots the CSS-var census scans BESIDES `componentsDir` (empty by
 * engine default; see `core/config.mjs`'s `DEFAULT_PATHS`).
 *
 * Detecting this is not optional polish: `detectCssVarPrefix` samples these
 * same directories, so a config that took its suggested `cssVarPrefix` but
 * never wrote `styleRoots` would scan componentsDir alone at runtime and miss
 * every declaration the prefix suggestion was itself evidence of — measured
 * directly, this produced `tokens/var-unresolved` ERRORS on a real project's
 * responsive-layout vars, whose only declarations live outside componentsDir.
 * The two suggestions have to travel together.
 *
 * @param {string} root project root
 * @param {{existsSync: Function}} [fs]
 * @returns {string[]} existing candidates, sorted; empty when none exist
 */
export function detectStyleRoots(root, fs = defaultFs) {
  return STYLE_ROOT_CANDIDATES.filter(candidate =>
    fs.existsSync(join(root, candidate)),
  ).sort()
}

// ---------------------------------------------------------------------------
// The whole suggestion set, one call.
// ---------------------------------------------------------------------------

/**
 * @param {string} root project root (must be absolute — every detector below
 *   joins root-relative candidates against it)
 * @param {{contractSuffix?: string}} [conventions] only `contractSuffix` is
 *   read, defaulting to `.contract.json` (`core/config.mjs`'s own default) —
 *   not resolving the whole config here keeps this callable before a config
 *   exists at all, which is `init`'s first-run case by definition
 * @param {object} [fs] injectable fs, see individual detectors
 * @returns {{tokensFile: string|null, componentsDir: string|null, contractsDir: string|null, cssVarPrefix: string|null, styleRoots: string[]}}
 */
export function detectProject(
  root,
  { contractSuffix = ".contract.json" } = {},
  fs = defaultFs,
) {
  if (!isAbsolute(root))
    throw new TypeError("detectProject: root must be an absolute path")

  const tokensFile = detectTokensFile(root, fs)
  const componentsDir = detectComponentsDir(root, fs)
  const contractsDir =
    componentsDir &&
    componentsDirHasContracts(root, componentsDir, contractSuffix, fs)
      ? componentsDir
      : null
  const cssVarPrefix = detectCssVarPrefix(root, componentsDir, fs)
  const styleRoots = detectStyleRoots(root, fs)

  return { tokensFile, componentsDir, contractsDir, cssVarPrefix, styleRoots }
}
