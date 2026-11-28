/**
 * decide.mjs — put every open decision in front of its owner (issue #62).
 *
 * Most findings are not code's to clear, and before this command nothing
 * delivered them to the person who could. `decide` runs the same checks
 * `report` does, groups every finding outside the code pile into decisions
 * (`core/decisions.mjs`), and gives the owner a page to answer them on. The
 * answers are written back where the engine and the resolve skill read them:
 * exemptions in the config, and change requests in the decisions file.
 *
 *   design-delta decide              serve the page on 127.0.0.1, write on save
 *   design-delta decide --no-serve   write the page as one file, and exit
 *   design-delta decide --apply <f>  write an answers file the page saved
 *   design-delta decide --json       print the decisions, write nothing
 *
 * NOT THE AUDIT PATH. `audit`, `lint`, `report` and `verify` stay read-only.
 * This command writes, and only two things: the config's `exemptions` block
 * and `paths.decisionsFile`. It never edits a contract, a token, a component
 * or a design file, and never touches a rule's severity.
 *
 * DONE ENTRIES are pruned from the decisions file on every run that is not
 * `--json`, served or not and whether or not a decision is left: an entry is
 * done only when its rule actually ran (`audit --json`'s and `lint --json`'s
 * `evaluatedRules`, plus a read design snapshot for a design-pile rule), so a
 * skipped surface never reads as a change carried out.
 *
 * A SAVE re-reads the config and the decisions file and refuses when either
 * changed on disk since the run started: the answers were made against what
 * it read, and writing over an edit made while the page was open would lose
 * it silently.
 *
 * THE SERVER binds 127.0.0.1 only, answers one page and one post, and
 * accepts the post only with the token embedded in the page it served and a
 * Host header naming the loopback address, so another site open in the
 * browser cannot write to the project. A refused save keeps it running so the
 * owner can correct the answer; a written one stops it.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { createServer } from "node:http"
import { randomBytes } from "node:crypto"
import { dirname, isAbsolute, join } from "node:path"

import {
  DEFAULT_CONFIG_PATH,
  resolvePaths,
  resolveRunConfig,
  validateConfig,
} from "../../core/config.mjs"
import {
  EMPTY_DECISIONS_FILE,
  applyAnswers,
  buildDecisions,
  validateDecisionsFile,
} from "../../core/decisions.mjs"
import { renderDecisionsPage } from "../../core/decisions-page.mjs"
import { loadContracts } from "../../spec/contracts.mjs"
import { parseFlags } from "../flags.mjs"
import { sink } from "../gather-health-score.mjs"
import { runAudit } from "./audit.mjs"
import { runLint } from "./lint.mjs"

export const FLAG_SPEC = {
  boolean: ["--json", "--no-serve", "--no-timestamp"],
  value: ["--port", "--out", "--apply"],
}

const PAGE_FILE = "decisions.html"
const MAX_BODY = 1024 * 1024

async function capture(run, argv, ctx) {
  const captured = sink()
  await run(argv, {
    io: { stdout: captured.stream, stderr: ctx.io.stderr },
    globalOpts: ctx.globalOpts,
    bus: ctx.bus,
  })
  try {
    return JSON.parse(captured.writes.join(""))
  } catch {
    return null
  }
}

function gatheredDates(audit) {
  const provenance = audit?.provenance || {}
  return [provenance.designComponents, provenance.designTokens]
    .map(entry => entry?.gatheredAt)
    .filter(date => typeof date === "string")
    .filter((date, i, all) => all.indexOf(date) === i)
}

/** A file's text as it is on disk now, or `null` when there is none. */
function readText(path) {
  try {
    return existsSync(path) ? readFileSync(path, "utf8") : null
  } catch {
    return undefined
  }
}

function readDecisionsFile(path) {
  if (!existsSync(path)) return { file: EMPTY_DECISIONS_FILE, text: null }
  let text
  let doc
  try {
    text = readFileSync(path, "utf8")
    doc = JSON.parse(text)
  } catch (err) {
    return { error: `could not read ${path}: ${err.message}` }
  }
  const errors = validateDecisionsFile(doc)
  if (errors.length > 0)
    return { error: `invalid ${path}:\n  - ${errors.join("\n  - ")}` }
  return { file: doc, text }
}

/**
 * The components whose contract failed validation, by contract id and file,
 * for `core/piles.mjs`: their code-side findings are the contract owner's.
 * A file that failed to load is read back for its `id`; one that is not
 * even JSON is named by its file alone.
 */
function invalidContractsOf(config, root) {
  const loaded = loadContracts(config, { root })
  const failedFiles = new Set(
    loaded.diagnostics
      .map(diagnostic => diagnostic.file)
      .filter(file => typeof file === "string"),
  )
  const ids = new Set()
  for (const diagnostic of loaded.diagnostics)
    if (typeof diagnostic.contractId === "string")
      ids.add(diagnostic.contractId)
  for (const entry of loaded.contracts)
    if (failedFiles.has(entry.file)) ids.add(entry.id)
  for (const file of failedFiles) {
    try {
      const id = JSON.parse(readFileSync(join(root, file), "utf8"))?.id
      if (typeof id === "string") ids.add(id)
    } catch {
      // not JSON: matched by its file alone
    }
  }
  return { ids: [...ids].sort(), files: [...failedFiles].sort() }
}

/**
 * Whether the run evaluated the rule a decisions-file entry is about. A rule
 * neither `audit` nor `lint` evaluated reported nothing because it never ran.
 * A design-pile rule of the audit's also needs the design snapshot it reads:
 * the audit counts the components surface as run even when
 * `design-components.json` is missing or invalid, and the design-side rules
 * then report nothing.
 */
function evaluatedCheck(audit, lint) {
  const rules = new Set([
    ...(audit.evaluatedRules || []),
    ...(lint.evaluatedRules || []),
  ])
  const provenance = audit.provenance || {}
  const read = snapshot =>
    !provenance.unavailable &&
    !provenance.notConsulted &&
    provenance[snapshot] !== null &&
    provenance[snapshot] !== undefined
  return entry => {
    if (!rules.has(entry.ruleId)) return false
    if (entry.pile !== "design" || entry.ruleId.startsWith("lint/")) return true
    return read(
      entry.ruleId.startsWith("tokens/") ? "designTokens" : "designComponents",
    )
  }
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}

/**
 * Apply answers and write the results. Nothing is written unless every
 * answer is valid AND the resulting config passes the config schema.
 *
 * Exported for its tests: no real answer can produce an invalid config,
 * since `applyAnswers` only appends valid exemption entries, so the schema
 * guard below is a backstop a test drives with an invalid state directly.
 *
 * @returns {{written: object[], done: object[]} | {errors: string[]}}
 */
export function saveAnswers(state, answers) {
  const changed = [
    [state.configPath, state.configText, state.configLabel],
    [state.decisionsPath, state.decisionsText, state.decisionsLabel],
  ]
    .filter(([path, text]) => readText(path) !== text)
    .map(([, , label]) => label)
  if (changed.length > 0)
    return {
      errors: [
        `${changed.join(" and ")} changed on disk since decide started, so nothing was written: run decide again to answer against what is there now`,
      ],
    }

  let result
  try {
    result = applyAnswers({
      config: state.config,
      decisionsFile: state.decisionsFile,
      decisions: state.decisions,
      answers,
      done: state.done,
    })
  } catch (err) {
    return { errors: err.errors || [err.message] }
  }

  const { valid, errors } = validateConfig(result.config)
  if (!valid)
    return {
      errors: [
        "the answers would leave the config invalid, so nothing was written:",
        ...errors,
      ],
    }

  const configChanged =
    JSON.stringify(result.config) !== JSON.stringify(state.config)
  const fileChanged =
    JSON.stringify(result.decisionsFile) !== JSON.stringify(state.decisionsFile)
  try {
    if (configChanged) writeJson(state.configPath, result.config)
    if (fileChanged) writeJson(state.decisionsPath, result.decisionsFile)
  } catch (err) {
    return { errors: [`could not write: ${err.message}`] }
  }
  return { written: result.written, done: state.done }
}

/**
 * Remove the done entries from the decisions file, on disk and in `state`,
 * and say which. Run once, before any mode that is not `--json`, so a run
 * with no decisions left still clears what was carried out.
 */
function pruneDone(io, state) {
  if (state.done.length === 0) return null
  const doneIds = new Set(state.done.map(entry => JSON.stringify(entry)))
  const next = {
    version: 1,
    entries: state.decisionsFile.entries.filter(
      entry => !doneIds.has(JSON.stringify(entry)),
    ),
  }
  if (readText(state.decisionsPath) !== state.decisionsText)
    return `${state.decisionsLabel} changed on disk since decide started; run decide again`
  try {
    writeJson(state.decisionsPath, next)
  } catch (err) {
    return `could not write ${state.decisionsLabel}: ${err.message}`
  }
  for (const entry of state.done)
    io.stderr.write(
      `design-delta decide: done, removed from ${state.decisionsLabel}: ${entry.answer} ${entry.ruleId} (${entry.entities.join(", ")})\n`,
    )
  state.decisionsFile = next
  state.decisionsText = readText(state.decisionsPath)
  state.done = []
  return null
}

function reportSaved(io, saved, state) {
  for (const entry of saved.written)
    io.stderr.write(
      `design-delta decide: ${entry.answer} ${entry.ruleId} (${entry.entities.length} entit${entry.entities.length === 1 ? "y" : "ies"}) → ${entry.to === "config" ? state.configLabel : state.decisionsLabel}\n`,
    )
  for (const entry of saved.done)
    io.stderr.write(
      `design-delta decide: done, removed from ${state.decisionsLabel}: ${entry.answer} ${entry.ruleId} (${entry.entities.join(", ")})\n`,
    )
}

/**
 * The request handler, separate from the socket so it can be read and tested
 * on its own. Returns the response, and `close: true` once answers are
 * written.
 */
export function handleDecideRequest(
  { method, url, headers, body },
  { page, token, port, onAnswers },
) {
  const json = (status, value, close = false) => ({
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify(value),
    close,
  })
  const host = String(headers.host || "")
  if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`)
    return json(421, { errors: ["unexpected Host header"] })

  if (method === "GET" && (url === "/" || url === "/index.html"))
    return {
      status: 200,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
      },
      body: page,
    }

  if (method === "POST" && url === "/answers") {
    if (headers["x-design-delta-token"] !== token)
      return json(403, {
        errors: ["missing or wrong token: save from the page decide served"],
      })
    if (!String(headers["content-type"] || "").startsWith("application/json"))
      return json(415, { errors: ["expected application/json"] })
    let answers
    try {
      answers = JSON.parse(body)
    } catch {
      return json(400, { errors: ["the body is not JSON"] })
    }
    const saved = onAnswers(answers)
    if (saved.errors) return json(400, { errors: saved.errors })
    return json(200, saved, true)
  }

  return json(404, { errors: ["not found"] })
}

function serve({ io, page, port, state }) {
  const token = randomBytes(16).toString("hex")
  return new Promise(resolve => {
    let finish
    const server = createServer((req, res) => {
      const chunks = []
      let size = 0
      req.on("data", chunk => {
        size += chunk.length
        if (size > MAX_BODY) req.destroy()
        else chunks.push(chunk)
      })
      req.on("end", () => {
        const response = handleDecideRequest(
          {
            method: req.method,
            url: req.url,
            headers: req.headers,
            body: Buffer.concat(chunks).toString("utf8"),
          },
          {
            page: page(token),
            token,
            port: server.address().port,
            onAnswers: answers => {
              const saved = saveAnswers(state, answers)
              if (!saved.errors) reportSaved(io, saved, state)
              return saved
            },
          },
        )
        res.writeHead(response.status, response.headers)
        res.end(response.body)
        if (response.close) finish(0)
      })
    })
    const onSigint = () => finish(130)
    finish = code => {
      process.removeListener("SIGINT", onSigint)
      server.close()
      server.closeAllConnections?.()
      if (code === 130)
        io.stderr.write("design-delta decide: stopped, no answers written\n")
      resolve(code)
    }
    process.once("SIGINT", onSigint)
    server.on("error", err => {
      io.stderr.write(`design-delta decide: could not serve: ${err.message}\n`)
      process.removeListener("SIGINT", onSigint)
      resolve(1)
    })
    server.listen(port, "127.0.0.1", () => {
      io.stdout.write(
        `design-delta decide: answer at http://127.0.0.1:${server.address().port}/ (Ctrl-C stops without saving)\n`,
      )
    })
  })
}

export async function runDecide(cmdArgv, ctx) {
  const { io, globalOpts = {} } = ctx
  const { opts, errors } = parseFlags(cmdArgv, FLAG_SPEC)
  const fail = message => {
    io.stderr.write(`design-delta decide: ${message}\n`)
    return 1
  }
  if (errors.length > 0) {
    for (const error of errors) fail(error)
    return 1
  }

  const port = opts.port === undefined ? 0 : Number(opts.port)
  if (!Number.isInteger(port) || port < 0 || port > 65535)
    return fail(`--port must be a port number, got "${opts.port}"`)

  const { config, error } = resolveRunConfig(globalOpts.config)
  if (error) return fail(error)

  const audit = await capture(runAudit, ["--json"], ctx)
  if (!audit) return fail("the audit produced no readable result")
  const lint = await capture(runLint, ["--json"], ctx)
  if (!lint) return fail("lint produced no readable result")

  const root = process.cwd()
  const resolve = path => (isAbsolute(path) ? path : join(root, path))
  const { decisionsFile: decisionsLabel, reportDir } = resolvePaths(config)
  const configLabel = globalOpts.config ?? DEFAULT_CONFIG_PATH
  const decisionsPath = resolve(decisionsLabel)
  const read = readDecisionsFile(decisionsPath)
  if (read.error) return fail(read.error)

  const configPath = resolve(configLabel)
  const { decisions, code, codeCount, done } = buildDecisions({
    findings: [...(audit.findings || []), ...(lint.findings || [])],
    previous: read.file,
    invalidContracts: invalidContractsOf(config, root),
    wasEvaluated: evaluatedCheck(audit, lint),
  })
  const snapshots = gatheredDates(audit)
  const state = {
    config,
    configPath,
    configLabel,
    configText: readText(configPath),
    decisionsFile: read.file,
    decisionsText: read.text,
    decisionsPath,
    decisionsLabel,
    decisions,
    done,
  }

  if (opts.json) {
    io.stdout.write(
      `${JSON.stringify({ decisions, code, codeCount, done, snapshots }, null, 2)}\n`,
    )
    return 0
  }

  const pruneError = pruneDone(io, state)
  if (pruneError) return fail(pruneError)

  if (opts.apply !== undefined) {
    let answers
    try {
      answers = JSON.parse(readFileSync(resolve(String(opts.apply)), "utf8"))
    } catch (err) {
      return fail(`could not read ${opts.apply}: ${err.message}`)
    }
    const saved = saveAnswers(state, answers)
    if (saved.errors) {
      for (const message of saved.errors) fail(message)
      return 1
    }
    reportSaved(io, saved, state)
    return 0
  }

  const generatedAt = opts.noTimestamp ? undefined : new Date().toISOString()
  const page = (mode, token) =>
    renderDecisionsPage({
      decisions,
      codeCount,
      done,
      snapshots,
      mode,
      token,
      generatedAt,
    })

  if (opts.noServe) {
    const target = opts.out ? String(opts.out) : join(reportDir, PAGE_FILE)
    try {
      mkdirSync(dirname(resolve(target)), { recursive: true })
      writeFileSync(resolve(target), page("static"))
    } catch (err) {
      return fail(`could not write ${target}: ${err.message}`)
    }
    io.stderr.write(
      `wrote ${target}: ${decisions.length} decision(s); open it, answer, then run design-delta decide --apply <saved answers file>\n`,
    )
    return 0
  }

  if (decisions.length === 0) {
    io.stdout.write(
      `design-delta decide: nothing is waiting on you${codeCount > 0 ? `; ${codeCount} finding(s) can be fixed in code without a decision` : ""}\n`,
    )
    return 0
  }

  return serve({ io, page: token => page("serve", token), port, state })
}
