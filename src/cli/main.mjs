#!/usr/bin/env node
/**
 * main.mjs — the single `design-delta` entry point (ADR-001 D4/D8).
 *
 * v1 shipped eleven sibling bins plus an umbrella that `spawnSync`'d them,
 * three flag parsers, and several hand-rolled `isMain` variants. this collapses
 * all of that to ONE bin with in-process subcommands sharing ONE flag parser
 * (`./flags.mjs`) — no child process is ever spawned here.
 *
 * Usage:
 *   design-delta <subcommand> [flags]
 *   design-delta --help | -h | (no args)   # grouped subcommand listing
 *   design-delta --version | -V            # the installed package version
 *
 * Every subcommand landed for real as of ADR-003 Phase 5.1 (`gather`/
 * `ingest` were the last two — Phase 0 wired them as STUBs that printed a
 * "not implemented yet" notice to stderr and exited 2, deliberately distinct
 * from 1 ("ran and found errors") so a stub could never be mistaken for a
 * real failing check by a script gating on exit code).
 *
 * Global flags (`--quiet`, `--config <path>`, `--help`/`-h`, `--version`/`-V`)
 * are pulled out of argv by this module BEFORE dispatch, wherever they
 * appear; everything else — including a subcommand's own flags, which this
 * module knows nothing about — is forwarded to the subcommand untouched.
 * That is deliberately NOT done with `parseFlags` (`./flags.mjs`): that
 * parser's whole point is to reject a flag it doesn't recognize, which is
 * correct for a subcommand parsing its OWN spec but wrong here, where an
 * unrecognized flag simply belongs to a different spec down the line.
 * `parseFlags` is exported from `./flags.mjs` for subcommands to use once
 * they parse their own flags, starting in Phase 1.
 *
 * `run(argv, io)` does the real work and returns a numeric exit code rather
 * than calling `process.exit` — so tests can drive it in-process without
 * spawning a child or killing the test runner. Only `main()` (guarded by
 * `isMain`) turns that return value into an actual `process.exit`.
 */

import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import {
  attachRenderer,
  createProgress,
  pickRenderer,
} from "../core/progress.mjs"
import { runAudit } from "./commands/audit.mjs"
import { runContracts } from "./commands/contracts.mjs"
import { runDock } from "./commands/dock.mjs"
import { runImpact } from "./commands/impact.mjs"
import { runMap } from "./commands/map.mjs"
import { runMovers } from "./commands/movers.mjs"
import { runQuery } from "./commands/query.mjs"
import { runScaffold } from "./commands/scaffold.mjs"
import { runSnapshot } from "./commands/snapshot.mjs"
import { runInit } from "./commands/init.mjs"
import { runReport } from "./commands/report.mjs"
import { runLint } from "./commands/lint.mjs"
import { runVerify } from "./commands/verify.mjs"
import { runGather } from "./commands/gather.mjs"
import { runIngest } from "./commands/ingest.mjs"
import { runMcp } from "./commands/mcp.mjs"
import { isMain } from "./flags.mjs"
import { levenshtein } from "../core/rules.mjs"

// Resolved from THIS module's own real location, never from the cwd of
// whatever project is being audited — same convention as
// `core/config.mjs`'s `PACKAGE_ROOT`.
const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..")
const PACKAGE_JSON_FILE = join(PACKAGE_ROOT, "package.json")

function readPackageVersion() {
  const pkg = JSON.parse(readFileSync(PACKAGE_JSON_FILE, "utf8"))
  return pkg.version
}

// ---------------------------------------------------------------------------
// The subcommand table (ADR-001 D8). `phase` is the ADR phase that landed
// each one for real.
// ---------------------------------------------------------------------------

export const SUBCOMMANDS = {
  init: {
    summary:
      "interactive setup wizard: writes design-delta.json and suggested npm scripts",
    phase: 4,
    run: runInit,
  },
  audit: {
    summary: "read-only census and diff across configured surfaces",
    phase: 1,
    run: runAudit,
  },
  lint: {
    summary: "static best-practice rules over the token system",
    phase: 3,
    run: runLint,
  },
  report: {
    summary: "export the findings as artifacts (markdown, terminal)",
    phase: 3,
    run: runReport,
  },
  verify: {
    summary: "composed CI gate — the design side is optional",
    phase: 2,
    run: runVerify,
  },
  gather: {
    summary: "print the plan an agent needs to census the design side",
    phase: 5,
    run: runGather,
  },
  ingest: {
    summary: "normalize a provider's raw payloads into on-disk snapshots",
    phase: 5,
    run: runIngest,
  },
  mcp: {
    summary:
      "serve contracts and tokens to a coding agent over MCP on stdio (read-only)",
    phase: 7,
    run: runMcp,
  },
  contracts: {
    summary: "schema- and semantically-validate every contract",
    phase: 1,
    run: runContracts,
  },
  scaffold: {
    summary: "draft a *.contract.json from a component's props census",
    phase: 6,
    run: runScaffold,
  },
  movers: {
    summary: "list entities whose code/spec hash changed since the last run",
    phase: 6,
    run: runMovers,
  },
  impact: {
    summary:
      "blast-radius query: every file that references a component or token",
    phase: 6,
    run: runImpact,
  },
  map: {
    summary:
      "system-wide ownership overview: contracted/uncontracted/contract-only, token coverage",
    phase: 6,
    run: runMap,
  },
  query: {
    summary:
      "read-only inventory questions: raw-values lists literal CSS declarations",
    phase: 6,
    run: runQuery,
  },
  snapshot: {
    summary: "write state.json with per-entity code/spec hashes",
    phase: 6,
    run: runSnapshot,
  },
  dock: {
    summary:
      "scaffold a generic Claude Code hook + skill wrapping verify/lint --json",
    phase: 6,
    run: runDock,
  },
}

const GLOBAL_FLAGS_HELP = [
  ["--quiet", "silence progress output"],
  [
    "--config <path>",
    "path to the project config (default: design-delta.json)",
  ],
  ["--help, -h", "show this help text"],
  ["--version, -V", "print the installed package version"],
]

/**
 * Build the full `--help` text: a grouped subcommand listing (grouped by the
 * ADR phase that implements each one, ascending, each row carrying its own
 * `(Phase n)` marker too) plus the global flags. Pure and deterministic —
 * driven only by `SUBCOMMANDS`' own (stable, insertion-ordered) keys.
 *
 * @returns {string}
 */
export function buildHelp() {
  const lines = []
  lines.push("Usage: design-delta <subcommand> [flags]")
  lines.push("")
  lines.push("Subcommands:")

  const phases = [
    ...new Set(Object.values(SUBCOMMANDS).map(entry => entry.phase)),
  ].sort((a, b) => a - b)
  const nameWidth = Math.max(...Object.keys(SUBCOMMANDS).map(n => n.length))

  for (const phase of phases) {
    lines.push(`  Phase ${phase}:`)
    for (const [name, entry] of Object.entries(SUBCOMMANDS)) {
      if (entry.phase !== phase) continue
      lines.push(
        `    ${name.padEnd(nameWidth)}  ${entry.summary} (Phase ${entry.phase})`,
      )
    }
  }

  lines.push("")
  lines.push("Global flags:")
  const flagWidth = Math.max(...GLOBAL_FLAGS_HELP.map(([flag]) => flag.length))
  for (const [flag, description] of GLOBAL_FLAGS_HELP) {
    lines.push(`  ${flag.padEnd(flagWidth)}  ${description}`)
  }
  lines.push("")

  return lines.join("\n") + "\n"
}

// ---------------------------------------------------------------------------
// "Did you mean" — the unknown-subcommand hint, on the same `levenshtein`
// `core/rules.mjs` uses for its own unknown-rule-id hint.
// ---------------------------------------------------------------------------

function closestSubcommand(name) {
  let best = null
  let bestDistance = Infinity
  for (const candidate of Object.keys(SUBCOMMANDS)) {
    const distance = levenshtein(name, candidate)
    if (distance < bestDistance) {
      bestDistance = distance
      best = candidate
    }
  }
  // Close enough to plausibly be a typo, not a wholesale-wrong name.
  return bestDistance <= 2 ? best : null
}

// ---------------------------------------------------------------------------
// Global flag extraction — see the module docblock for why this is not
// `parseFlags`.
// ---------------------------------------------------------------------------

function extractGlobalFlags(argv) {
  const globalOpts = {
    quiet: false,
    help: false,
    version: false,
    config: undefined,
  }
  const rest = []
  const errors = []

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === "--quiet") {
      globalOpts.quiet = true
      continue
    }
    if (arg === "--help" || arg === "-h") {
      globalOpts.help = true
      continue
    }
    if (arg === "--version" || arg === "-V") {
      globalOpts.version = true
      continue
    }
    if (arg === "--config") {
      const value = argv[i + 1]
      if (value === undefined) {
        errors.push('"--config" requires a value.')
      } else {
        globalOpts.config = value
        i++
      }
      continue
    }
    rest.push(arg)
  }

  return { globalOpts, rest, errors }
}

/**
 * Run the CLI against a raw argv (no leading `node`/script path — i.e.
 * `process.argv.slice(2)`). Never calls `process.exit`; returns the exit
 * code the caller should use. `io` is injectable so tests can capture output
 * without touching the real process streams.
 *
 * @param {string[]} argv
 * @param {{stdout?: {write: Function}, stderr?: {write: Function}, stdin?: NodeJS.ReadableStream}} [io]
 * @returns {number} the process exit code
 */
export function run(argv, io = {}) {
  const stdout = io.stdout || process.stdout
  const stderr = io.stderr || process.stderr

  const { globalOpts, rest, errors } = extractGlobalFlags(argv)

  if (errors.length) {
    for (const error of errors) stderr.write(`design-delta: ${error}\n`)
    return 1
  }

  if (globalOpts.version) {
    stdout.write(`${readPackageVersion()}\n`)
    return 0
  }

  const [name, ...cmdArgv] = rest

  if (globalOpts.help || !name) {
    stdout.write(buildHelp())
    return 0
  }

  const entry = SUBCOMMANDS[name]
  if (!entry) {
    stderr.write(`design-delta: unknown subcommand "${name}"\n`)
    stderr.write(`Valid subcommands: ${Object.keys(SUBCOMMANDS).join(", ")}\n`)
    const suggestion = closestSubcommand(name)
    if (suggestion) stderr.write(`Did you mean "${suggestion}"?\n`)
    return 1
  }

  // Progress plumbing (ADR-001 D8): wired end-to-end even though no Phase 0
  // stub emits an event. `--quiet` silences it; otherwise the renderer picks
  // TTY vs. plain-line rendering from stderr itself. Progress must never
  // touch stdout — stdout stays byte-deterministic for report/JSON output.
  const bus = createProgress()
  const renderer = pickRenderer({ stream: stderr, quiet: globalOpts.quiet })
  const detach = attachRenderer(bus, renderer)

  // A handler may return a number or a Promise of one: Phase 1's commands are
  // synchronous, but a provider gather (Phase 5) will not be. Detach the
  // progress renderer only once the handler has actually finished — a plain
  // `finally` would tear it down while async work was still emitting.
  let result
  try {
    // `stdin` passes through untouched (undefined for every command but
    // `mcp`, which reads its transport from it and falls back to the real
    // process stream) — a test can inject all three streams.
    result = entry.run(cmdArgv, {
      globalOpts,
      io: { stdout, stderr, stdin: io.stdin },
      bus,
    })
  } catch (error) {
    detach()
    throw error
  }
  if (result && typeof result.then === "function") return result.finally(detach)
  detach()
  return result
}

/**
 * The real process entry point: turns `run`'s return value into the exit code.
 * `run` stays sync-returning for sync commands (so tests can call it without
 * awaiting), so normalize through Promise.resolve rather than making it async.
 *
 * Sets `process.exitCode` rather than calling `process.exit` (issue #353):
 * when stdout is a pipe, Node's writes to it are async and buffered, so
 * `process.exit` — which terminates immediately — discards whatever a
 * `--json` payload hadn't drained to the OS pipe yet, silently truncating it
 * while still reporting exit 0. Leaving `process.exitCode` set and letting
 * the event loop drain naturally means the process only exits once every
 * write has actually flushed.
 */
export function main() {
  Promise.resolve(run(process.argv.slice(2))).then(
    code => {
      process.exitCode = code
    },
    error => {
      process.stderr.write(`design-delta: ${error?.stack || error}\n`)
      process.exitCode = 1
    },
  )
}

if (isMain(import.meta.url)) main()
