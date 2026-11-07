/**
 * scaffold.mjs — `design-delta scaffold <Component>` (roadmap item, split
 * from #217/2026-08-12): draft a `*.contract.json` from a component's props
 * census, rather than requiring hand-authoring from scratch.
 *
 *   design-delta scaffold <Component> [--json] [--config <path>]
 *   design-delta scaffold --uncontracted [--json] [--config <path>]
 *
 * `--uncontracted` (issue #263) drafts a contract for EVERY code component
 * with no contract, instead of hand-driving one invocation per component.
 * The worklist is derived from the same census `coverage/uncontracted-
 * component` uses (`modules/components.mjs`): every confirmed component plus
 * every confirmed-but-unreadable-props file, minus whatever `sources.code.
 * path` an already-loaded contract claims. A per-component refusal (props
 * unreadable, a contract already at the target path) skips only that
 * component — reason on stderr — and never aborts the pass; the run still
 * exits `0` once it completes, including when nothing was uncontracted.
 * `<Component>` and `--uncontracted` are mutually exclusive — the flag
 * derives its own worklist, so a positional name alongside it is a flag
 * error, not a filter.
 *
 * Scope is `id`, `title`, `sources.code.path`, `props`, (#235) `anatomy`, and
 * (#236) `styles`. `sources.design` and `codegen` are omitted entirely, not
 * placeholdered: the active design provider's own model-builder already
 * substitutes a placeholder when `sources.design` is absent, so scaffold
 * doesn't need to guess at it too.
 *
 * Refuses (clear error, no partial file) rather than silently emitting an
 * empty shell whenever the props census could not actually read the
 * component — no TypeScript install, no matching file, an ambiguous name
 * match, or a confirmed component whose props extraction failed.
 *
 * `anatomy` (issue #235) drafts from the SAME file's structural census
 * (`sources/react/jsx.mjs`) once props extraction has already confirmed the
 * component is readable. Unlike props, anatomy is never a refusal reason —
 * a component whose render shape the adapter declines (a `.map()`, a
 * conditional root, …) still gets a props-only contract, exactly like
 * before this issue; scaffold only omits `anatomy` for it, matching how
 * `sources.design`/`codegen` are already omitted rather than guessed. The one
 * decline that still drafts is `divergent-roots` (issue #431): it CARRIES the
 * trees it renders (ADR-002 D5), so `spec/scaffold.mjs`'s
 * `buildScaffoldAnatomyVariants` drafts them as a base anatomy plus
 * `$variants` — omitting there would discard a census, not refuse a guess.
 *
 * `styles` (issue #236) drafts once `anatomy` exists — `styles` keys must
 * name a declared `anatomy` element (schema-enforced), so with no anatomy
 * there is nothing to key a `styles` block off. It reads the component's
 * style file at `<component-basename><conventions.stylesSuffix>` (the same
 * co-location convention this repo's own fixtures use), maps each anatomy
 * element to a selector via `modules/styles.mjs`'s OWN
 * `locateElementSelector`/`locateVariantSelector` — the same mapping rule
 * `styles/element-unmapped` enforces, reused rather than reimplemented so a
 * scaffolded contract can never disagree with its own check about what
 * "mapped" means — and drafts each mapped element's `base`/`variants` via
 * `spec/scaffold.mjs`'s pure `draftStyleProps`. Absent `conventions.
 * stylesSuffix`, no style file on disk, or no anatomy element mapping to a
 * selector all mean `styles` is simply omitted — never a refusal reason.
 *
 * A `var(--x)` declaration (issue #261) resolves to a token binding
 * (`{token: "<id>"}`) when its name matches exactly one token in the
 * project's own `tokens.json` census — built once per run via `sources/
 * code.mjs`'s `censusTokens` and `modules/tokens.mjs`'s own
 * `candidateVarNames` (the same hypothesis `tokens/token-untracked` already
 * runs, reused rather than reimplemented for the same "never disagree with
 * the check" reason as the element→selector mapping above). `spec/` may not
 * import `modules/` (`__tests__/layering.test.js`), so this module builds the
 * var-name→token-id(s) lookup and passes it down, the way `resolveDef`
 * already is. No `tokens.json`, a census that fails to parse, or a var
 * matching zero/2+ tokens all still surface as a `_scaffold: {todo: "…"}`
 * note — never a guess, never a refusal reason.
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"

import {
  resolveConventions,
  resolvePaths,
  resolveRunConfig,
} from "../../core/config.mjs"
import { compareEntities } from "../../core/findings.mjs"
import { kebabCase } from "../../core/text.mjs"
import {
  buildFileIndex,
  locateElementSelector,
  locateVariantSelector,
  PROPERTY_DEFS,
  resolveCssFinest,
} from "../../modules/styles.mjs"
import { candidateVarNames } from "../../modules/tokens.mjs"
import {
  ANATOMY_VARIANTS_KEY,
  anatomyNodes,
  loadContracts,
} from "../../spec/contracts.mjs"
import {
  buildScaffoldAnatomy,
  buildScaffoldAnatomyVariants,
  buildScaffoldContract,
  draftStyleProps,
} from "../../spec/scaffold.mjs"
import { resolveFramework } from "../../sources/frameworks.mjs"
import { censusTokens } from "../../sources/code.mjs"
import { censusStyles } from "../../sources/styles.mjs"
import { parseFlags } from "../flags.mjs"
import { toPosixRelative } from "../../core/paths.mjs"

const FLAG_SPEC = {
  boolean: ["--json", "--uncontracted"],
  value: [],
  positional: true,
}

// Exported: `impact.mjs` (#237) reuses both the PascalCase check and the
// file-matching convention below rather than re-deriving them, so `impact
// <Component>` and `scaffold <Component>` can never silently disagree about
// what counts as a valid/matching component name.
export const TITLE_PATTERN = /^[A-Z][A-Za-z0-9]*$/

/**
 * Every component file whose basename (kebab-cased) matches the given
 * PascalCase title — `SampleButton` matches `sample-button.tsx`, the
 * convention this repo's own contract fixtures already use. Returns every
 * match rather than the first, so the caller can refuse an ambiguous name
 * instead of silently picking one.
 *
 * @param {string[]} files absolute paths from `findComponentFiles`
 * @param {string} title PascalCase component name
 * @returns {string[]}
 */
export function matchComponentFiles(files, title) {
  const target = kebabCase(title)
  return files.filter(file => {
    const base = file.slice(file.lastIndexOf("/") + 1).replace(/\.tsx$/, "")
    return base.toLowerCase() === target
  })
}

// One selector's `styles` properties (`base`, or one variant's own
// overrides) — `modules/styles.mjs`'s `PROPERTY_DEFS`/`resolveCssFinest` do
// the actual CSS-to-slot resolution; `spec/scaffold.mjs`'s `draftStyleProps`
// classifies each resolved slot into a schema value, a token binding
// (issue #261), or a `_scaffold` todo.
function draftElementStyleProps(declarations, resolveTokenBinding) {
  return draftStyleProps(
    PROPERTY_DEFS,
    def =>
      resolveCssFinest(
        declarations,
        def.finestSlots,
        def.fallbacks,
        def.cssNames,
        def.shorthands,
      ),
    resolveTokenBinding,
  )
}

// The var-name→token-id(s) lookup `spec/scaffold.mjs` needs but may not build
// itself (`spec/` may not import `modules/tokens.mjs` —
// `__tests__/layering.test.js`). Built once per run from the SAME hypothesis
// `tokens/token-untracked` already runs (`candidateVarNames`), so a
// scaffolded binding can never disagree with that check about what
// "accounted for" means. A var can legitimately fold from more than one
// token (#191) — every match is kept, not just the first, so the caller can
// tell "no match" apart from "ambiguous" instead of silently guessing.
//
// @param {{tokens: object[]}} tokenCensus `sources/code.mjs`'s
//   `censusTokens` result — `tokens: []` (whether from a missing/invalid
//   `tokens.json` or a genuinely empty one) means every var resolves to zero
//   matches, the same "still a todo, never a refusal" behavior as before
//   this issue.
// @param {string} cssVarPrefix `conventions.cssVarPrefix`
// @returns {(varName: string) => string[]}
function buildTokenBindingResolver(tokenCensus, cssVarPrefix) {
  const tokenIdsByVarName = new Map()
  for (const token of tokenCensus?.tokens || []) {
    for (const candidate of candidateVarNames(token, cssVarPrefix)) {
      if (!tokenIdsByVarName.has(candidate))
        tokenIdsByVarName.set(candidate, [])
      tokenIdsByVarName.get(candidate).push(token.id)
    }
  }
  return varName => tokenIdsByVarName.get(varName) || []
}

/**
 * Draft `styles` (issue #236) from an already-built anatomy plus the
 * component's own censused style file — see this file's docblock for why
 * the element/variant mapping is `modules/styles.mjs`'s, not reimplemented
 * here.
 *
 * @param {object} anatomy a `buildScaffoldAnatomy` result
 * @param {object} fileIndex `modules/styles.mjs`'s `buildFileIndex` result
 *   for the component's style file
 * @param {object[]} props the component's own prop census — only `enum`
 *   props (`{name, values}`) are tried as variants, the one shape
 *   `locateVariantSelector`'s own convention covers
 * @param {(varName: string) => string[]} resolveTokenBinding see
 *   `buildTokenBindingResolver`
 * @returns {{styles: object|null, unmappedCount: number, tokenBindingCount: number}}
 *   `styles` is `null` when no anatomy element drafted any content — omit,
 *   don't guess; `tokenBindingCount` sums every resolved token binding
 *   across every element and variant (issue #261's `--json` count)
 */
function draftStyles(anatomy, fileIndex, props, resolveTokenBinding) {
  const enumProps = props.filter(
    prop => prop.type === "enum" && Array.isArray(prop.values),
  )
  const styles = {}
  let unmappedCount = 0
  let tokenBindingCount = 0

  // Root first, as `runStylesCheck` does — a child's descendant form and a
  // child's variant under the root's modifier both resolve through it.
  const rootSelector =
    anatomy.root &&
    typeof anatomy.root === "object" &&
    !Array.isArray(anatomy.root)
      ? locateElementSelector(anatomy.root, "root", fileIndex)
      : null

  for (const elementName of Object.keys(anatomy).sort()) {
    const node = anatomy[elementName]
    if (!node || typeof node !== "object" || node.type === "instance") continue // delegated elsewhere — same skip `runStylesCheck` applies

    const elementSelector = locateElementSelector(
      node,
      elementName,
      fileIndex,
      { rootSelector },
    )
    if (elementSelector === null) {
      unmappedCount++
      continue
    }

    const {
      props: base,
      todos,
      tokenBindingCount: baseTokenBindingCount,
    } = draftElementStyleProps(
      fileIndex.bySelector.get(elementSelector).declarations,
      resolveTokenBinding,
    )
    tokenBindingCount += baseTokenBindingCount

    const variants = []
    for (const prop of enumProps) {
      for (const value of prop.values) {
        const variantSelector = locateVariantSelector(
          elementSelector,
          { [prop.name]: value },
          fileIndex,
          { isRoot: elementName === "root", rootSelector },
        )
        if (variantSelector === null) continue
        const variantEntry = fileIndex.bySelector.get(variantSelector)
        if (!variantEntry) continue

        const {
          props: variantProps,
          todos: variantTodos,
          tokenBindingCount: variantTokenBindingCount,
        } = draftElementStyleProps(
          variantEntry.declarations,
          resolveTokenBinding,
        )
        if (Object.keys(variantProps).length === 0 && variantTodos.length === 0)
          continue
        tokenBindingCount += variantTokenBindingCount
        variants.push({
          when: { [prop.name]: value },
          ...variantProps,
          ...(variantTodos.length > 0
            ? { _scaffold: { todo: variantTodos.join("; ") } }
            : {}),
        })
      }
    }

    const entry = {}
    if (Object.keys(base).length > 0) entry.base = base
    if (variants.length > 0) entry.variants = variants
    if (todos.length > 0) entry._scaffold = { todo: todos.join("; ") }
    if (Object.keys(entry).length > 0) styles[elementName] = entry
  }

  return {
    styles: Object.keys(styles).length > 0 ? styles : null,
    unmappedCount,
    tokenBindingCount,
  }
}

// Reverses `kebabCase`'s convention well enough to round-trip: capitalizes
// each hyphen-delimited segment of a file's basename. The FALLBACK when the
// census could not resolve the component's real exported name (issue #321) —
// a best-effort inference, not a claim about the component's "real" exported
// name (an acronym like `APIButton` round-trips as `Apibutton`, same
// ambiguity `kebabCase` itself documents).
function titleFromFile(file) {
  const base = file.slice(file.lastIndexOf("/") + 1).replace(/\.tsx$/, "")
  return base
    .split("-")
    .filter(Boolean)
    .map(seg => seg[0].toUpperCase() + seg.slice(1))
    .join("")
}

/**
 * Draft and write one component's contract — the part of `scaffold` shared
 * between the single-`<Component>` path and `--uncontracted`'s per-component
 * pass. Never overwrites; returns a refusal reason instead of throwing so
 * `--uncontracted` can skip one component without aborting the rest.
 *
 * @param {object} args
 * @param {string} args.title PascalCase component name (author-given or, for
 *   `--uncontracted`, the census's own `component.name`, falling back to
 *   `titleFromFile` when the census could not resolve one)
 * @param {string} args.absFile absolute path to the component's `.tsx` file
 * @param {{file: string, props: object[], name?: string}} args.component the
 *   confirmed props census entry for this file
 * @param {object} args.config the project's (unresolved) config
 * @param {string} args.root project root
 * @param {(varName: string) => string[]} args.resolveTokenBinding see
 *   `buildTokenBindingResolver`
 * @returns {{ok: true, record: object, textLine: string}|{ok: false, reason: string}}
 */
function draftContractForComponent({
  title,
  absFile,
  component,
  config,
  root,
  resolveTokenBinding,
}) {
  const id = kebabCase(title)
  const { contractsDir } = resolvePaths(config)
  const { contractSuffix } = resolveConventions(config)
  const { extractJsxComponent } = resolveFramework(config)
  const outputRel = join(contractsDir, `${id}${contractSuffix}`)
  const outputAbs = join(root, outputRel)

  if (existsSync(outputAbs)) {
    return {
      ok: false,
      reason: `${outputRel} already exists — remove it first, scaffold never overwrites`,
    }
  }

  // Anatomy is never a refusal reason (see the module docblock) — a declined
  // or unreadable structural census just means `anatomy` is omitted, exactly
  // like `sources.design`/`codegen` already are. The ONE decline that still
  // drafts is a component carrying its candidate trees (`divergent-roots`,
  // ADR-002 D5): those are a variant-keyed anatomy, so omitting would discard
  // what the census read rather than refuse to guess (issue #431).
  const jsxResult = extractJsxComponent(absFile, { label: component.file })
  const jsxComponent = jsxResult.ok ? jsxResult.component : null
  const propNames = new Set(component.props.map(prop => prop.name))
  const anatomy =
    jsxComponent?.resolvable === true
      ? buildScaffoldAnatomy(jsxComponent.root, propNames)
      : buildScaffoldAnatomyVariants(jsxComponent?.branches, propNames)
  const anatomyPartial = jsxComponent?.partial === true
  // `$variants` sits in the same map as the nodes but is NOT one (ADR-002 D2),
  // so everything reading the map as a list of elements — the styles pass, the
  // reported node count — reads it through the loader's own stripping rule
  // rather than a second definition of "which keys are nodes".
  const anatomyNodeMap = anatomy ? anatomyNodes(anatomy) : null
  const anatomyVariants = anatomy?.[ANATOMY_VARIANTS_KEY]

  // Styles (issue #236) — see the module docblock. Never a refusal reason,
  // same as anatomy: no configured suffix, no style file on disk, or no
  // anatomy to key off all just mean `styles` is omitted.
  const { stylesSuffix } = resolveConventions(config)
  let stylesPath
  let styles = null
  let styleUnmappedCount = 0
  let styleTokenBindingCount = 0
  if (stylesSuffix) {
    const styleFileAbs = absFile.replace(/\.tsx$/, "") + stylesSuffix
    const styleCensus = censusStyles([styleFileAbs], { root })
    if (styleCensus.files.length === 1) {
      const fileCensus = styleCensus.files[0]
      stylesPath = fileCensus.file
      if (anatomyNodeMap) {
        const drafted = draftStyles(
          anatomyNodeMap,
          buildFileIndex(fileCensus),
          component.props,
          resolveTokenBinding,
        )
        styles = drafted.styles
        styleUnmappedCount = drafted.unmappedCount
        styleTokenBindingCount = drafted.tokenBindingCount
      }
    }
  }

  const contract = buildScaffoldContract({
    title,
    id,
    codePath: component.file,
    props: component.props,
    anatomy,
    stylesPath,
    styles,
  })

  mkdirSync(dirname(outputAbs), { recursive: true })
  writeFileSync(outputAbs, `${JSON.stringify(contract, null, 2)}\n`)
  const anatomyNodeCount = anatomyNodeMap
    ? Object.keys(anatomyNodeMap).length
    : 0
  // A `_scaffold` note sits alongside the variants (it names the branches that
  // could not be drafted), so it is stripped out of the count the same way the
  // loader strips it out of the contract.
  const anatomyVariantCount = anatomyVariants
    ? Object.keys(anatomyVariants).filter(name => !name.startsWith("_")).length
    : 0
  const styleElementCount = styles ? Object.keys(styles).length : 0

  const anatomySuffix = anatomy
    ? `, ${anatomyNodeCount} anatomy node(s)${anatomyVariantCount > 0 ? ` + ${anatomyVariantCount} variant(s)` : ""}${anatomyPartial ? " (partial — some positions marked _scaffold for review)" : ""}`
    : ""
  const stylesSuffixMsg = stylesPath
    ? `, ${styleElementCount} style element(s)${styleUnmappedCount > 0 ? ` (${styleUnmappedCount} unmapped)` : ""} from ${stylesPath}`
    : ""

  return {
    ok: true,
    record: {
      command: "scaffold",
      id,
      title,
      file: component.file,
      output: outputRel,
      propCount: component.props.length,
      anatomyNodeCount,
      anatomyVariantCount,
      anatomyPartial,
      stylesFile: stylesPath,
      styleElementCount,
      styleUnmappedCount,
      styleTokenBindingCount,
    },
    textLine: `wrote ${outputRel} (${component.props.length} prop(s)${anatomySuffix}${stylesSuffixMsg} from ${component.file})`,
  }
}

/**
 * `scaffold --uncontracted` — draft a contract for every code component with
 * no contract, deriving the worklist from the same census `coverage/
 * uncontracted-component` uses (issue #263, module docblock).
 *
 * @param {{opts: object, config: object, root: string, io: object, bus: object, resolveTokenBinding: (varName: string) => string[]}} args
 * @returns {Promise<number>}
 */
async function runScaffoldUncontracted({
  opts,
  config,
  root,
  io,
  bus,
  resolveTokenBinding,
}) {
  const { findComponentFiles, extractComponents } = resolveFramework(config)
  const { files } = findComponentFiles(config, { root })
  const census = extractComponents(files, { root, onProgress: bus })
  if (census.skipped) {
    io.stderr.write(
      `design-delta scaffold: ${census.diagnostics[0]?.message || "components census skipped"}\n`,
    )
    return 1
  }

  const { contracts } = loadContracts(config, { root })
  const matchedCodePaths = new Set(
    contracts.map(entry => entry.contract?.sources?.code?.path).filter(Boolean),
  )

  const componentsByFile = new Map(
    census.components.map(component => [component.file, component]),
  )
  const diagnosticsByFile = new Map(
    census.diagnostics.filter(diag => diag.file).map(diag => [diag.file, diag]),
  )
  const fileByLabel = new Map(
    files.map(file => [toPosixRelative(root, file), file]),
  )

  const uncontractedFiles = [
    ...census.components.map(component => component.file),
    ...census.unreadableProps,
  ]
    .filter(file => !matchedCodePaths.has(file))
    .sort(compareEntities)

  const records = []
  for (const file of uncontractedFiles) {
    const component = componentsByFile.get(file)
    if (!component) {
      const diag = diagnosticsByFile.get(file)
      io.stderr.write(
        `design-delta scaffold: skipping "${file}" — its props could not be read (${diag?.message || "extraction failed"})\n`,
      )
      continue
    }

    const title = component.name || titleFromFile(file)
    const result = draftContractForComponent({
      title,
      absFile: fileByLabel.get(file),
      component,
      config,
      root,
      resolveTokenBinding,
    })
    if (!result.ok) {
      io.stderr.write(
        `design-delta scaffold: skipping "${title}" — ${result.reason}\n`,
      )
      continue
    }
    records.push(result.record)
    if (!opts.json) io.stdout.write(`${result.textLine}\n`)
  }

  // Keyed on the worklist, not on what was written: a pass where every
  // uncontracted component was skipped still has uncontracted components, and
  // claiming otherwise on stdout would be the absent-signal failure
  // `coverage/uncontracted-component` exists to prevent. The skips are on
  // stderr; stdout stays silent about them.
  if (opts.json) io.stdout.write(`${JSON.stringify(records, null, 2)}\n`)
  else if (uncontractedFiles.length === 0)
    io.stdout.write("no uncontracted components found\n")

  return 0
}

/**
 * Run the `scaffold` subcommand. Returns the exit code; never calls
 * `process.exit` (matches every other subcommand — see `main.mjs`).
 *
 * @param {string[]} cmdArgv this subcommand's own argv (globals already removed)
 * @param {{globalOpts: object, io: {stdout: object, stderr: object}, bus: object}} ctx
 * @returns {Promise<number>}
 */
export async function runScaffold(cmdArgv, ctx) {
  const { io, globalOpts = {}, bus } = ctx
  const { opts, errors } = parseFlags(cmdArgv, FLAG_SPEC)

  if (errors.length > 0) {
    for (const error of errors)
      io.stderr.write(`design-delta scaffold: ${error}\n`)
    return 1
  }

  if (opts.uncontracted) {
    if (opts.positional.length !== 0) {
      io.stderr.write(
        `design-delta scaffold: --uncontracted takes no <Component> argument\n`,
      )
      return 1
    }
  } else if (opts.positional.length !== 1) {
    io.stderr.write(
      `design-delta scaffold: expected exactly one <Component> argument, got ${opts.positional.length}\n`,
    )
    return 1
  }

  const { config, error } = resolveRunConfig(globalOpts.config)
  if (error) {
    io.stderr.write(`design-delta scaffold: ${error}\n`)
    return 1
  }

  const root = process.cwd()

  // Built once per run (issue #261) — see `buildTokenBindingResolver`. A
  // missing/invalid `tokens.json` degrades to zero matches for every var,
  // never a refusal.
  const tokenCensus = await censusTokens(config, { root })
  const { cssVarPrefix } = resolveConventions(config)
  const resolveTokenBinding = buildTokenBindingResolver(
    tokenCensus,
    cssVarPrefix,
  )

  if (opts.uncontracted)
    return await runScaffoldUncontracted({
      opts,
      config,
      root,
      io,
      bus,
      resolveTokenBinding,
    })

  const title = opts.positional[0]
  if (!TITLE_PATTERN.test(title)) {
    io.stderr.write(
      `design-delta scaffold: "${title}" is not PascalCase (expected e.g. "SampleButton")\n`,
    )
    return 1
  }

  const { findComponentFiles, extractComponents } = resolveFramework(config)
  const { files } = findComponentFiles(config, { root })
  const matches = matchComponentFiles(files, title)

  if (matches.length === 0) {
    io.stderr.write(
      `design-delta scaffold: no component file matches "${title}" under the configured componentsDir\n`,
    )
    return 1
  }
  if (matches.length > 1) {
    io.stderr.write(
      `design-delta scaffold: "${title}" matches more than one file, refusing to guess:\n`,
    )
    for (const match of matches) io.stderr.write(`  ${match}\n`)
    return 1
  }

  const census = extractComponents(matches, { root, onProgress: bus })
  if (census.skipped) {
    io.stderr.write(
      `design-delta scaffold: ${census.diagnostics[0]?.message || "components census skipped"}\n`,
    )
    return 1
  }
  if (census.components.length === 0) {
    io.stderr.write(
      `design-delta scaffold: "${title}"'s props could not be read (${census.diagnostics[0]?.message || "extraction failed"}) — refusing to write a partial contract\n`,
    )
    return 1
  }

  const result = draftContractForComponent({
    title,
    absFile: matches[0],
    component: census.components[0],
    config,
    root,
    resolveTokenBinding,
  })
  if (!result.ok) {
    io.stderr.write(`design-delta scaffold: ${result.reason}\n`)
    return 1
  }

  if (opts.json) io.stdout.write(`${JSON.stringify(result.record, null, 2)}\n`)
  else io.stdout.write(`${result.textLine}\n`)

  return 0
}
