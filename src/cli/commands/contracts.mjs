/**
 * contracts.mjs — the `design-delta contracts` subcommand (ADR-001 Phase 1,
 * D2/D13): schema- and semantically-validate every contract in the project and
 * report. The contract is the fixed point every other check compares against
 * (D1), so this is the command a consumer runs first and wires into CI ahead
 * of everything else — a contract that does not validate makes every finding
 * downstream of it meaningless.
 *
 * It does exactly one thing: read and report. It never writes a contract, and
 * it never reaches a design tool or the network.
 *
 *   design-delta contracts [--json] [--dir <path>]
 *
 * `--dir` overrides the config's `paths.contractsDir` for this run — the
 * escape hatch for validating a directory the config doesn't point at yet
 * (a migration's output, a scratch authoring dir).
 *
 * Exit codes: 0 when every contract is valid (including the vacuous case of
 * none authored yet — "no contracts" is a legitimate state, not a failure),
 * 1 when anything produced a diagnostic. Never 2: that code is reserved for
 * "this subcommand isn't implemented yet".
 *
 * Two stream invariants, both load-bearing (D8):
 *   - PROGRESS goes to stderr, via the injected bus, never to stdout.
 *   - `--json` writes ONE JSON document to stdout and nothing else, so it can
 *     be piped straight into `jq` regardless of how noisy the run was.
 */

import { resolvePaths, resolveRunConfig } from "../../core/config.mjs"
import { loadContracts } from "../../spec/contracts.mjs"
import { parseFlags } from "../flags.mjs"

const FLAG_SPEC = {
  boolean: ["--json"],
  value: ["--dir"],
}

// One diagnostic, rendered for a human: the in-document location, the stable
// code, then the sentence. Indented under its file so a file with several
// problems reads as one block.
function renderDiagnostic(diagnostic) {
  const where = diagnostic.path ? `${diagnostic.path}: ` : ""
  return `        ${where}[${diagnostic.code}] ${diagnostic.message}`
}

function renderHuman(result, { dirLabel }) {
  const lines = []
  const byFile = new Map()
  for (const diagnostic of result.diagnostics) {
    if (!byFile.has(diagnostic.file)) byFile.set(diagnostic.file, [])
    byFile.get(diagnostic.file).push(diagnostic)
  }

  if (result.files.length === 0) {
    lines.push(
      `design-delta contracts: no contract files found under ${dirLabel}`,
    )
    return lines.join("\n") + "\n"
  }

  const idByFile = new Map(
    result.contracts.map(entry => [entry.file, entry.id]),
  )
  const invalid = result.files.filter(file => byFile.has(file))

  lines.push(
    `design-delta contracts: ${result.files.length} file(s) under ${dirLabel}`,
  )
  lines.push("")

  for (const file of result.files) {
    const problems = byFile.get(file)
    if (!problems) {
      lines.push(`  OK    ${file} (${idByFile.get(file)})`)
      continue
    }
    lines.push(`  FAIL  ${file}`)
    for (const diagnostic of problems) lines.push(renderDiagnostic(diagnostic))
  }

  lines.push("")
  lines.push(
    invalid.length === 0
      ? `All ${result.files.length} contract(s) valid.`
      : `${invalid.length} of ${result.files.length} contract(s) invalid; ${result.diagnostics.length} diagnostic(s).`,
  )

  return lines.join("\n") + "\n"
}

// The machine-readable summary. Every list is already sorted by
// `spec/contracts.mjs`; nothing here reorders or re-derives, so the document
// is byte-identical run over run for the same inputs.
function renderJson(result, { dirLabel }) {
  const invalidFiles = new Set(result.diagnostics.map(d => d.file))
  return (
    JSON.stringify(
      {
        command: "contracts",
        ok: result.ok,
        contractsDir: dirLabel,
        counts: {
          files: result.files.length,
          valid: result.files.length - invalidFiles.size,
          invalid: invalidFiles.size,
          diagnostics: result.diagnostics.length,
        },
        contracts: result.contracts.map(entry => ({
          id: entry.id,
          file: entry.file,
          valid: !invalidFiles.has(entry.file),
        })),
        diagnostics: result.diagnostics,
      },
      null,
      2,
    ) + "\n"
  )
}

/**
 * Run the subcommand. Returns the exit code; never calls `process.exit`, so
 * tests drive it in-process exactly as they drive `main.mjs`'s `run`.
 *
 * @param {string[]} cmdArgv this subcommand's own argv (globals already removed)
 * @param {{globalOpts: object, io: {stdout: object, stderr: object}, bus: object}} ctx
 * @returns {number}
 */
export function runContracts(cmdArgv, ctx) {
  const { io, globalOpts = {}, bus } = ctx
  const { opts, errors } = parseFlags(cmdArgv, FLAG_SPEC)

  if (errors.length > 0) {
    for (const error of errors)
      io.stderr.write(`design-delta contracts: ${error}\n`)
    return 1
  }

  const { config, error } = resolveRunConfig(globalOpts.config)
  if (error) {
    io.stderr.write(`design-delta contracts: ${error}\n`)
    return 1
  }

  // `--dir` overrides only `paths.contractsDir`, leaving every other path and
  // convention (notably `conventions.contractSuffix`, which decides what a
  // contract file is even called) exactly as the config declares it.
  const runConfig = opts.dir
    ? { ...config, paths: { ...(config.paths || {}), contractsDir: opts.dir } }
    : config

  const result = loadContracts(runConfig, { onProgress: bus })
  // The CONFIGURED directory, not the absolute one `loadContracts` resolved —
  // an absolute path would make the output machine-specific.
  const dirLabel = resolvePaths(runConfig).contractsDir

  io.stdout.write(
    opts.json
      ? renderJson(result, { dirLabel })
      : renderHuman(result, { dirLabel }),
  )

  return result.diagnostics.length > 0 ? 1 : 0
}
