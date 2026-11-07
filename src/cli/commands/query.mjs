/**
 * query.mjs — `design-delta query <subject>` (issue #493): read-only
 * inventory questions about the project, answered as a listing rather than
 * as drift.
 *
 *   design-delta query raw-values [--json]
 *
 * WHY THIS IS A QUERY AND NOT A RULE. `styles/raw-value-uncontracted` asked
 * the same question as a CHECK and was removed in 8c9a14e (issue #490): an
 * uncontracted literal is an inventory fact about a stylesheet, not a
 * disagreement between a contract and one of its sides, so it is not drift
 * and had no business producing a finding. The scan itself was the only way
 * to ask "what literals are in this project's styles, and which of them match
 * a token's value?", so it comes back here — with no rule id, no severity, no
 * exemptions, and no findings array. Nothing gates on it.
 *
 * EXIT CODE. Always 0 for an answer, however many literals that answer
 * contains — an inventory has no "failing" size. A non-zero code is reserved
 * for not being able to answer at all (an unreadable config, a token census
 * that failed): reporting every literal as unmatched because the token census
 * never loaded would be exactly the dishonest output this engine's own
 * standards forbid, so the command says so and exits 1 instead.
 *
 * A single style file the census could not read is the middle case, and is
 * neither of those: the answer still stands for every other file, so it is
 * reported as a diagnostic alongside the listing rather than swallowed (it is
 * already missing from `censusStyles`'s `files`, so staying silent would put
 * an undercount forward as a complete answer) or escalated to an exit code
 * (which would make an inventory a gate).
 *
 * SUBJECTS. Deliberately one, per the issue: `query` is already the namespace
 * a second subject would land in, but the general framing is not built ahead
 * of a second real caller.
 *
 * Never writes anything — read-only, like `impact` and `movers`.
 */

import { resolveRunConfig } from "../../core/config.mjs"
import { toPosixRelative } from "../../core/paths.mjs"
import { censusTokens, findStyleFiles } from "../../sources/code.mjs"
import { censusStyles } from "../../sources/styles.mjs"
import { parseFlags } from "../flags.mjs"

const FLAG_SPEC = { boolean: ["--json"], value: [], positional: true }

/** The subjects `query` knows how to answer, in help order. */
const SUBJECTS = ["raw-values"]

/**
 * Every literal CSS declaration in the scanned stylesheets, paired with
 * whether the token census carries a token whose CSS-OUTPUT value is exactly
 * that string.
 *
 * Exact-value matching only, never fuzzy/nearest-token distance — the same
 * deliberate descope the removed sweep carried. `cssValue` rather than the
 * authored `$value` (issue #255): a composite type keeps `$value` structured
 * forever, so comparing THAT against a single raw CSS declaration could never
 * match. A composite that expands to MULTIPLE CSS properties (`typography`,
 * occasionally `shadow`/`border`) has no `cssValue` at all and so is
 * unrepresentable here — there is no single value in it a raw declaration
 * could equal.
 *
 * @param {{files: Array<{file: string, selectors: object[]}>}} styleCensus
 * @param {Set<string>} tokenValues every token's `cssValue`, as a string
 * @returns {Array<{file: string, selector: string, property: string, value: string, matchesToken: boolean}>}
 */
function listRawValues(styleCensus, tokenValues) {
  const literals = []
  for (const { file, selectors } of styleCensus?.files || []) {
    for (const { selector, declarations } of selectors) {
      for (const decl of declarations) {
        if (decl.kind !== "literal") continue // var() reference — not a literal
        if (typeof decl.value !== "string") continue
        literals.push({
          file,
          selector,
          property: decl.property,
          value: decl.value,
          matchesToken: tokenValues.has(decl.value),
        })
      }
    }
  }
  return literals
}

async function queryRawValues(config, root, bus) {
  const tokenCensus = await censusTokens(config, { root, onProgress: bus })
  if (!tokenCensus.ok) {
    return {
      error: tokenCensus.diagnostics[0]?.message || "the tokens census failed",
    }
  }

  const stylePaths = findStyleFiles(config, { root }).map(abs =>
    toPosixRelative(root, abs),
  )
  const styleCensus = censusStyles(stylePaths, { root, onProgress: bus })
  const tokenValues = new Set(
    tokenCensus.tokens.map(t => t.cssValue).filter(v => typeof v === "string"),
  )

  return {
    files: styleCensus.files.length,
    literals: listRawValues(styleCensus, tokenValues),
    // A file the scan found but the census could not read is already absent
    // from `files` — so reporting only the count would present an undercount
    // as a complete answer. Carried through and surfaced instead: the listing
    // stays an answer (exit 0), it just says what it could not read.
    diagnostics: styleCensus.diagnostics,
  }
}

function renderText(result) {
  const lines = []
  if (result.literals.length === 0) {
    lines.push(
      `no literal declarations in the ${result.files} style file(s) scanned`,
    )
  } else {
    lines.push(
      `${result.literals.length} literal declaration(s) in ${result.files} style file(s):`,
    )
    for (const literal of result.literals) {
      lines.push(
        `  ${literal.file}:${literal.selector}  ${literal.property}: ${literal.value}  ${
          literal.matchesToken ? "(matches a token)" : "(no token)"
        }`,
      )
    }
  }

  if (result.diagnostics.length > 0) {
    lines.push("")
    lines.push(`${result.diagnostics.length} diagnostic(s):`)
    for (const diagnostic of result.diagnostics)
      lines.push(`  ${diagnostic.message}`)
  }

  return `${lines.join("\n")}\n`
}

/**
 * Run the `query` subcommand. Returns the exit code (a Promise of one — the
 * token census parses asynchronously) — never calls `process.exit`, matching
 * every other subcommand (see `main.mjs`).
 *
 * @param {string[]} cmdArgv this subcommand's own argv (globals already removed)
 * @param {{globalOpts: object, io: {stdout: object, stderr: object}, bus: object}} ctx
 * @returns {Promise<number>}
 */
export async function runQuery(cmdArgv, ctx) {
  const { io, globalOpts = {}, bus } = ctx
  const { opts, errors } = parseFlags(cmdArgv, FLAG_SPEC)

  if (errors.length > 0) {
    for (const error of errors)
      io.stderr.write(`design-delta query: ${error}\n`)
    return 1
  }

  if (opts.positional.length !== 1) {
    io.stderr.write(
      `design-delta query: expected exactly one <subject> argument (${SUBJECTS.join(
        ", ",
      )}), got ${opts.positional.length}\n`,
    )
    return 1
  }

  const subject = opts.positional[0]
  if (!SUBJECTS.includes(subject)) {
    io.stderr.write(
      `design-delta query: unknown subject "${subject}". Valid subjects: ${SUBJECTS.join(
        ", ",
      )}\n`,
    )
    return 1
  }

  const { config, error } = resolveRunConfig(globalOpts.config)
  if (error) {
    io.stderr.write(`design-delta query: ${error}\n`)
    return 1
  }

  const result = await queryRawValues(config, process.cwd(), bus)
  if (result.error) {
    io.stderr.write(`design-delta query: ${result.error}\n`)
    return 1
  }

  if (opts.json) {
    io.stdout.write(
      `${JSON.stringify(
        {
          command: "query",
          subject,
          files: result.files,
          literals: result.literals,
          // Omitted rather than empty, like every other payload in this CLI:
          // an always-present `[]` reads as an assertion that the command
          // looked, on runs where nothing could go wrong.
          ...(result.diagnostics.length > 0
            ? { diagnostics: result.diagnostics }
            : {}),
        },
        null,
        2,
      )}\n`,
    )
  } else {
    io.stdout.write(renderText(result))
  }

  // Always 0 — see the module docblock. An inventory is never a gate.
  return 0
}
