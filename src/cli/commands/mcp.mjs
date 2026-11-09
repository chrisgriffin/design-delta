/**
 * mcp.mjs — `design-delta mcp` (issue #367): serve the project's contracts
 * and tokens to a coding agent over MCP on stdio. A SUBCOMMAND, not a second
 * bin, because D8 collapsed eleven bins into one entry point on purpose and
 * this is one more in-process command with the same config, root, and
 * loaders as every other.
 *
 *   design-delta mcp [--config <path>]
 *
 * Reads newline-delimited JSON-RPC from stdin, writes one response line per
 * request to stdout, and exits 0 when stdin closes. Nothing else ever goes to
 * stdout (D8 stream invariant — a stray line would corrupt the transport);
 * progress and errors go to stderr. Everything the server can answer is
 * decided in `../mcp-server.mjs`, which is pure and tested without a
 * process; this file is the transport.
 *
 * Local/development only: no auth, no network, no hosting story — by
 * decision (decided 2026-08-29). A coding agent's MCP config points at
 * `npx design-delta mcp` in the project root.
 */

import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { createInterface } from "node:readline"

import { resolveRunConfig } from "../../core/config.mjs"
import { createMcpServer } from "../mcp-server.mjs"
import { parseFlags } from "../flags.mjs"

const PACKAGE_ROOT = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
)
const FLAG_SPEC = { boolean: [], value: [] }

function packageVersion() {
  return JSON.parse(readFileSync(join(PACKAGE_ROOT, "package.json"), "utf8"))
    .version
}

/**
 * @param {string[]} cmdArgv
 * @param {{io: {stdout: {write: Function}, stderr: {write: Function}, stdin?: NodeJS.ReadableStream}, globalOpts?: object}} ctx
 * @returns {Promise<number>}
 */
export function runMcp(cmdArgv, ctx) {
  const { io, globalOpts = {} } = ctx
  const { errors } = parseFlags(cmdArgv, FLAG_SPEC)
  if (errors.length > 0) {
    for (const error of errors) io.stderr.write(`design-delta mcp: ${error}\n`)
    return 1
  }

  const { config, error } = resolveRunConfig(globalOpts.config)
  if (error) {
    io.stderr.write(`design-delta mcp: ${error}\n`)
    return 1
  }

  const server = createMcpServer({
    config,
    root: process.cwd(),
    packageVersion: packageVersion(),
    globalOpts,
  })
  const input = io.stdin || process.stdin

  return new Promise(resolve => {
    const lines = createInterface({ input, crlfDelay: Infinity })
    // Requests are answered in arrival order — one at a time, so two calls
    // that both re-read the project never interleave their responses.
    let chain = Promise.resolve()
    let transportBroken = false
    lines.on("line", line => {
      const text = line.trim()
      if (text === "") return
      chain = chain.then(async () => {
        let message
        try {
          message = JSON.parse(text)
        } catch {
          io.stdout.write(
            `${JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } })}\n`,
          )
          return
        }
        try {
          const response = await server.handle(message)
          if (response) io.stdout.write(`${JSON.stringify(response)}\n`)
        } catch (err) {
          io.stderr.write(`design-delta mcp: ${err?.stack || err}\n`)
          if (message?.id !== undefined && message?.id !== null)
            io.stdout.write(
              `${JSON.stringify({ jsonrpc: "2.0", id: message.id, error: { code: -32603, message: String(err?.message || err) } })}\n`,
            )
        }
      })
      // A write that throws (a closed pipe) must not leave `run` unsettled:
      // the failure is noted on stderr, the chain stays resolvable, and the
      // exit code says the transport broke.
      chain = chain.catch(err => {
        transportBroken = true
        io.stderr.write(
          `design-delta mcp: stdout write failed: ${err?.message || err}\n`,
        )
      })
    })
    lines.on("close", () => {
      chain.then(() => resolve(transportBroken ? 1 : 0))
    })
  })
}
