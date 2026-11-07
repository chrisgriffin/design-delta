/**
 * map.mjs — `design-delta map` (issue #259): a system-wide ownership
 * overview across the whole scanned tree: owned vs. unmanaged surface.
 *
 *   design-delta map [--json]
 *
 * design-delta's framing is contract-driven, not convention-based: "owned" is
 * contract-driven (D1), not inferred — a component IS owned iff it has a
 * contract, `coverage/uncontracted-component`'s condition inverted.
 *
 * A pure query, same shape `movers`/`impact` already are — no new census, no
 * new rule. Reuses `audit`'s own components/tokens surfaces WHOLESALE, via
 * the same stdout-sink pattern `verify`/`report` already use (see their own
 * docblocks): a second assembly of "who's uncontracted" would drift from
 * `audit`'s the moment a rule changes, and then `map` and `audit` would
 * disagree about what counts. `--styles`/`--anatomy` are left out of the
 * inner `audit` call — this command's three counts never read either
 * surface, and running them would cost real time for output nothing here
 * uses.
 *
 * "contracted" is never counted directly — it is every loaded contract minus
 * the ones `coverage/contract-only` already found homeless and the ones with
 * no `sources.code.path` at all (draft contracts — see the `draft` bucket
 * below), so it can never disagree with `coverage/contract-only` about who
 * counts as contract-only. "unreferenced" tokens is the
 * set union of every `tokens/token-unreferenced` and `tokens/token-unemitted`
 * finding's `data.tokens` — both rules group multiple token ids under one finding when they
 * share a candidate CSS var (see `modules/tokens.mjs`), so summing finding
 * COUNTS would undercount; summing distinct token ids does not.
 *
 * NEITHER COUNT IS A CONFIRMED FACT, and this command does not pretend
 * otherwise: `components`/`tokens` are `null` (not confidently-wrong
 * counts) when `audit` itself skipped that surface (no `typescript`, an
 * unparseable `tokens.json`) — the same "a skipped surface is not
 * everything" rule `core/report.mjs` already applies. And `exempted`
 * (`audit`'s own `counts.exempted`) is surfaced at the top level because
 * an exempted `coverage/contract-only`/`tokens/token-unreferenced` finding
 * is invisible to this command entirely (`applyExemptions` drops it before
 * `audit`'s `--json` output exists) — `contracted`/`referenced` can
 * silently include an exempted entity, and there is no per-rule exempted
 * breakdown to attribute it more precisely without re-deriving
 * `applyExemptions` here, which this file avoids for the same reason it
 * reuses `audit` wholesale rather than re-composing its checks. The same
 * hazard applies if a project turns `coverage/contract-only` (or
 * `tokens/token-unreferenced`/`tokens/token-unemitted`) `"off"` entirely in `rules` — the finding
 * never exists to begin with, and `contracted`/`referenced` read exactly
 * like a genuinely clean project.
 */

import { resolveRunConfig } from "../../core/config.mjs"
import { compareEntities } from "../../core/findings.mjs"
import { loadContracts } from "../../spec/contracts.mjs"
import { parseFlags } from "../flags.mjs"
import { runAudit } from "./audit.mjs"
import { sink } from "../gather-health-score.mjs"

const FLAG_SPEC = { boolean: ["--json"], value: [] }

// The two halves of "nothing references this token" (issue #562): emitted
// and unused, or never emitted. Both make a token unreferenced here.
const UNREFERENCED_RULE_IDS = new Set([
  "tokens/token-unreferenced",
  "tokens/token-unemitted",
])

function entitiesFor(findings, ruleId) {
  return findings
    .filter(f => f.ruleId === ruleId)
    .map(f => f.entity)
    .sort(compareEntities)
}

function renderHuman(result) {
  const { components, tokens, exempted, skipped } = result
  const lines = []

  if (components) {
    lines.push(
      `${components.contracted} contracted component(s), ${components.uncontracted.length} uncontracted, ${components.contractOnly.length} contract-only, ${components.draft.length} draft`,
    )
    for (const file of components.uncontracted)
      lines.push(`  uncontracted: ${file}`)
    for (const id of components.contractOnly)
      lines.push(`  contract-only: ${id}`)
    for (const id of components.draft) lines.push(`  draft: ${id}`)
  } else {
    lines.push(`components: skipped — ${skipped.components}`)
  }

  if (tokens) {
    lines.push(
      `${tokens.total} token(s) censused — ${tokens.referenced} not flagged unreferenced, ${tokens.unreferenced} unreferenced`,
    )
  } else {
    lines.push(`tokens: skipped — ${skipped.tokens}`)
  }

  if (exempted > 0) {
    lines.push(
      `  (${exempted} finding(s) hidden by \`exemptions\` — some "contracted"/"not flagged unreferenced" entities above may be exempted rather than confirmed clean)`,
    )
  }

  return lines.join("\n") + "\n"
}

/**
 * Compute `map`'s result without rendering it — the seam `mcp`'s
 * `get_coverage` (issue #512) reads, so the two can never disagree about who
 * counts as contracted. Returns the result plus the inner `audit`'s own
 * findings, skipped reasons and design provenance, or `{error}` when `audit` could not answer
 * (its stderr goes to `stderr`, as it always has).
 *
 * @param {{globalOpts?: object, bus?: object, stderr: {write: Function}}} ctx
 * @returns {Promise<{result: object, findings: object[], skipped: object, provenance?: object, contracts: object[]} | {error: string}>}
 */
export async function computeMap({ globalOpts = {}, bus, stderr }) {
  const { config, error } = resolveRunConfig(globalOpts.config)
  if (error) return { error }
  const root = process.cwd()

  const captured = sink()
  await runAudit(["--json", "--components", "--tokens"], {
    io: { stdout: captured.stream, stderr },
    globalOpts,
    bus,
  })

  let audit
  try {
    audit = JSON.parse(captured.writes.join(""))
  } catch {
    return {
      error: "could not read the audit result — treating the run as failed.",
    }
  }

  const findings = audit.findings || []
  const skipped = audit.skipped || {}
  // A skipped surface (no `typescript` for components, an unparseable
  // `tokens.json`) ran NOTHING — `audit` itself never gates on this
  // (`core/report.mjs`'s "a skipped surface means it is not [everything]"),
  // and `map` must not either: reporting confident counts from zero census
  // would read as "100% owned" from a run that checked nothing at all.
  let components = null
  let contracts = []
  if (!skipped.components) {
    const uncontracted = entitiesFor(
      findings,
      "coverage/uncontracted-component",
    )
    const contractOnly = entitiesFor(findings, "coverage/contract-only")

    // A contract declaring no `sources.code.path` at all (an aspirational/
    // draft contract, per `modules/components.mjs`'s own comment) produces
    // NEITHER `coverage/uncontracted-component` NOR `coverage/contract-
    // only` — it's silently skipped there, on purpose, since there's
    // nothing yet to compare against. `audit`'s findings/counts carry no
    // signal for it either way, so this command loads contracts directly
    // (`loadContracts`, the same low-level parser `audit` itself calls —
    // not a re-derivation of `audit`'s decision logic, just its shared file
    // reader) to give a draft contract its own bucket rather than let it
    // silently count as `contracted`.
    // No `onProgress` here — `verify.mjs`'s own secondary contracts load
    // sets this precedent: `audit`'s inner call above already narrated
    // "contracts" once, and passing `bus` again would narrate it a second
    // time on stderr for a non-`--json` run (stdout stays deterministic
    // either way).
    const contractsResult = loadContracts(config, { root })
    contracts = contractsResult.contracts
    const draft = contractsResult.contracts
      .filter(({ contract }) => !contract?.sources?.code?.path)
      .map(({ id }) => id)
      .sort(compareEntities)

    // `exempted` (below) can hide a `coverage/contract-only`/
    // `tokens/token-unreferenced` finding entirely — `applyExemptions`
    // drops it before this command ever sees it, so `contracted`/
    // `referenced` can silently include an exempted entity. There is no
    // per-rule exempted breakdown in `audit`'s own `--json` output today
    // (only the aggregate `counts.exempted`), so this command surfaces
    // that aggregate as a caveat count rather than re-deriving
    // `applyExemptions`'s per-rule attribution itself — the same
    // "report the count, don't re-derive" precedent `audit`'s own human
    // renderer already sets for `counts.exempted`.
    const contracted =
      (audit.counts?.contracts ?? 0) - contractOnly.length - draft.length
    components = { contracted, uncontracted, contractOnly, draft }
  }

  let tokens = null
  if (!skipped.tokens) {
    // `unreferenced` only counts tokens `tokens/token-unreferenced` or
    // `tokens/token-unemitted` actually flagged — a token matched by that
    // rule's `ignorePrefixes` or `ignoreSources` scoping (or turned `"off"`)
    // is never evaluated at all, and there is no signal in
    // `audit`'s output distinguishing "confirmed referenced" from "never
    // evaluated" (that would mean re-deriving `modules/tokens.mjs`'s own
    // prefix-matching here, the exact re-derivation this file's own
    // docblock says to avoid). `referenced` therefore means "not flagged
    // unreferenced," not "confirmed referenced" — documented here and in
    // the human renderer's label; a config that scopes tokens out or
    // exempts them can move a token into this bucket without this command
    // being able to tell.
    const unreferencedIds = new Set()
    for (const finding of findings) {
      if (!UNREFERENCED_RULE_IDS.has(finding.ruleId)) continue
      for (const id of finding.data?.tokens || []) unreferencedIds.add(id)
    }
    const total = audit.counts?.tokens ?? 0
    const unreferenced = unreferencedIds.size
    const referenced = total - unreferenced
    tokens = { total, referenced, unreferenced }
  }

  const result = {
    command: "map",
    components,
    tokens,
    exempted: audit.counts?.exempted ?? 0,
    ...(Object.keys(skipped).length > 0 ? { skipped } : {}),
  }

  return {
    result,
    findings,
    skipped,
    provenance: audit.provenance,
    contracts,
  }
}

/**
 * Run the `map` subcommand. Returns the exit code (or a Promise of one, since
 * the inner `audit` call is async) — never calls `process.exit` (matches
 * every other subcommand — see `main.mjs`).
 *
 * @param {string[]} cmdArgv this subcommand's own argv (globals already removed)
 * @param {{globalOpts: object, io: {stdout: object, stderr: object}, bus: object}} ctx
 * @returns {Promise<number>}
 */
export async function runMap(cmdArgv, ctx) {
  const { io, globalOpts = {}, bus } = ctx
  const { opts, errors } = parseFlags(cmdArgv, FLAG_SPEC)

  if (errors.length > 0) {
    for (const error of errors) io.stderr.write(`design-delta map: ${error}\n`)
    return 1
  }

  const computed = await computeMap({ globalOpts, bus, stderr: io.stderr })
  if (computed.error) {
    io.stderr.write(`design-delta map: ${computed.error}\n`)
    return 1
  }
  const { result } = computed

  io.stdout.write(
    opts.json ? `${JSON.stringify(result, null, 2)}\n` : renderHuman(result),
  )

  return 0
}
