/**
 * impact.mjs — `design-delta impact <entity>` (issue #237, the query half
 * split from #223, unblocked once #223's detection half — `censusComponentUsage`
 * plus `components/unused-component` — shipped in PR #247): blast-radius
 * before a change, read-only.
 *
 *   design-delta impact <Component>   — every file that imports/uses it,
 *                                        via `sources/code.mjs`'s
 *                                        `censusComponentUsage` (#223)
 *   design-delta impact <token.id>    — every place that references it, via
 *                                        the same token census + candidate-
 *                                        var-name hypothesis
 *                                        `modules/tokens.mjs`'s
 *                                        `tokens/token-unreferenced` rule
 *                                        already computes
 *
 * Nothing here is recomputed: both branches reuse an existing census/module
 * rather than re-deriving "what references this" a second way (the same
 * "recompute the live state, never trust a second copy" principle `movers`
 * follows for hashes). Never writes anything — a query, not a check.
 *
 * ENTITY KIND IS DECIDED BY SHAPE, not a flag: a dotted id
 * ("color.bg.primary") is a token; a bare PascalCase name ("SampleButton")
 * is a component — `scaffold`'s own `<Component>` convention
 * (`TITLE_PATTERN`/`matchComponentFiles`, imported from `scaffold.mjs` rather
 * than reimplemented, so the two commands can never disagree about what
 * "matches a component" means).
 */

import { resolveConventions, resolveRunConfig } from "../../core/config.mjs"
import { compareEntities } from "../../core/findings.mjs"
import { candidateVarNames } from "../../modules/tokens.mjs"
import {
  censusCssVars,
  censusComponentUsage,
  censusTokens,
} from "../../sources/code.mjs"
import { resolveFramework } from "../../sources/frameworks.mjs"
import { parseFlags } from "../flags.mjs"
import { matchComponentFiles, TITLE_PATTERN } from "./scaffold.mjs"
import { toPosixRelative } from "../../core/paths.mjs"

const FLAG_SPEC = { boolean: ["--json"], value: [], positional: true }

function componentImpact(entity, config, root, bus) {
  const { files } = resolveFramework(config).findComponentFiles(config, {
    root,
  })
  const matches = matchComponentFiles(files, entity)

  if (matches.length === 0) {
    return {
      error: `no component file matches "${entity}" under the configured componentsDir`,
    }
  }
  if (matches.length > 1) {
    return {
      error: `"${entity}" matches more than one file, refusing to guess:\n${matches
        .map(m => `  ${m}`)
        .join("\n")}`,
    }
  }

  const usageCensus = censusComponentUsage(config, { root, onProgress: bus })
  const fileRel = toPosixRelative(root, matches[0])
  const entry = usageCensus.usages.find(u => u.file === fileRel)

  return { kind: "component", file: fileRel, usedBy: entry ? entry.usedBy : [] }
}

async function tokenImpact(entity, config, root, bus) {
  const tokenCensus = await censusTokens(config, { root, onProgress: bus })
  if (!tokenCensus.ok) {
    return {
      error: tokenCensus.diagnostics[0]?.message || "the tokens census failed",
    }
  }

  const token = tokenCensus.tokens.find(t => t.id === entity)
  if (!token) {
    return { error: `no token with id "${entity}" in the tokens census` }
  }

  const { cssVarPrefix } = resolveConventions(config)
  const cssVarCensus = censusCssVars(config, { root, onProgress: bus })
  const varsByName = new Map(cssVarCensus.vars.map(v => [v.name, v]))

  // Same hypothesis `modules/tokens.mjs`'s `tokens/token-unreferenced` rule
  // checks — every candidate custom-property name this token could emit as,
  // narrowed to the ones the CSS-var census actually observed being used.
  // `varsByName.has(name)` alone is not enough: `censusCssVars` records a
  // name for a DECLARATION too (`record(name, "declarations", …)`), so a
  // token stylesheet under `styleRoots` that declares but never uses a var
  // would otherwise report it as referenced.
  const vars = candidateVarNames(token, cssVarPrefix).filter(
    name => (varsByName.get(name)?.usages.length ?? 0) > 0,
  )
  const usedBy = vars
    .flatMap(name => varsByName.get(name).usages)
    .sort((a, b) => compareEntities(a.file, b.file) || a.line - b.line)

  return { kind: "token", vars, usedBy }
}

/**
 * Run the `impact` subcommand. Returns the exit code (or a Promise of one,
 * since the token branch needs `censusTokens`'s async parse) — never calls
 * `process.exit` (matches every other subcommand — see `main.mjs`).
 *
 * @param {string[]} cmdArgv this subcommand's own argv (globals already removed)
 * @param {{globalOpts: object, io: {stdout: object, stderr: object}, bus: object}} ctx
 * @returns {number|Promise<number>}
 */
export async function runImpact(cmdArgv, ctx) {
  const { io, globalOpts = {}, bus } = ctx
  const { opts, errors } = parseFlags(cmdArgv, FLAG_SPEC)

  if (errors.length > 0) {
    for (const error of errors)
      io.stderr.write(`design-delta impact: ${error}\n`)
    return 1
  }

  if (opts.positional.length !== 1) {
    io.stderr.write(
      `design-delta impact: expected exactly one <entity> argument, got ${opts.positional.length}\n`,
    )
    return 1
  }

  const entity = opts.positional[0]
  const kind = entity.includes(".")
    ? "token"
    : TITLE_PATTERN.test(entity)
      ? "component"
      : null

  if (kind === null) {
    io.stderr.write(
      `design-delta impact: "${entity}" is neither a PascalCase component name (e.g. "SampleButton") nor a dotted token id (e.g. "color.bg.primary")\n`,
    )
    return 1
  }

  const { config, error } = resolveRunConfig(globalOpts.config)
  if (error) {
    io.stderr.write(`design-delta impact: ${error}\n`)
    return 1
  }

  const root = process.cwd()
  const result =
    kind === "component"
      ? componentImpact(entity, config, root, bus)
      : await tokenImpact(entity, config, root, bus)

  if (result.error) {
    io.stderr.write(`design-delta impact: ${result.error}\n`)
    return 1
  }

  if (opts.json) {
    io.stdout.write(
      `${JSON.stringify(
        {
          command: "impact",
          entity,
          kind: result.kind,
          ...(result.file !== undefined ? { file: result.file } : {}),
          ...(result.vars !== undefined ? { vars: result.vars } : {}),
          usedBy: result.usedBy,
        },
        null,
        2,
      )}\n`,
    )
  } else if (result.usedBy.length === 0) {
    io.stdout.write(`nothing under the scanned tree references "${entity}"\n`)
  } else {
    io.stdout.write(`${result.usedBy.length} reference(s) to "${entity}":\n`)
    for (const ref of result.usedBy)
      io.stdout.write(`  ${ref.file}:${ref.line}\n`)
  }

  return 0
}
