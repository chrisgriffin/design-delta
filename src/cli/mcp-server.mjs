/**
 * mcp-server.mjs — the read-only MCP surface over a project's contracts,
 * tokens, coverage and findings (issues #367, #512, #513).
 * `createMcpServer({config, root, packageVersion, globalOpts})` returns a
 * `handle(message)` that turns one JSON-RPC request into one response object
 * (or `null` for a notification). No streams, no clock — `commands/mcp.mjs`
 * owns stdio. Every tool re-reads the project from disk on each call (Chris,
 * 2026-08-29: in-package, live read, local/development only), so there is no
 * snapshot to go stale: the contract and token tools through the loaders
 * `audit` uses, and `get_coverage`, `get_findings`, `get_impact`,
 * `get_movers` and `query_raw_values` by running the matching command
 * in-process with `--json` — so they read the working directory the way
 * every command does, and cannot disagree with what that command prints.
 *
 * Read-only by CONSTRUCTION: no tool writes, and the module imports nothing
 * that can. The audit path's "never edits, never files, never triages"
 * posture extends here without an exception to enforce.
 *
 * Protocol: MCP over JSON-RPC 2.0 (`initialize`, `tools/list`,
 * `tools/call`, `ping`). Implemented directly — three methods and a
 * handshake do not justify a runtime dependency (CLAUDE.md: few runtime
 * deps), and a hand-rolled server has no hidden write path.
 *
 * ONE VERSION, STATED (issue #367 item 4): every tool result carries
 * `version` — the package version and the contract-schema version it
 * reflects. A call that names a different `version` fails and says so,
 * rather than quietly answering from what the server has.
 *
 * "SAY WHEN NOTHING FITS" (item 3): the two search tools return
 * `matches: []` with `nothingFits: true` and a reason, never the closest
 * thing. Matching is deterministic word overlap on folded text — a stable
 * ranking, not relevance magic; two people asking the same question get the
 * same answer.
 */

import { resolveConfig, resolveConventions } from "../core/config.mjs"
import { compareEntities, SEVERITIES, SURFACES } from "../core/findings.mjs"
import { resolveRuleConfig } from "../core/rules.mjs"
import { CONTRACT_SCHEMA_VERSION, loadContracts } from "../spec/contracts.mjs"
import { censusTokens } from "../sources/code.mjs"
import { loadProvider } from "../providers/index.mjs"
import { runAudit } from "./commands/audit.mjs"
import { runImpact } from "./commands/impact.mjs"
import { runLint } from "./commands/lint.mjs"
import { computeMap } from "./commands/map.mjs"
import { runMovers } from "./commands/movers.mjs"
import { runQuery } from "./commands/query.mjs"
import { sink } from "./gather-health-score.mjs"
import { buildFullRuleRegistry } from "./rule-registry.mjs"

const PROTOCOL_VERSION = "2024-11-05"

// JSON-RPC error codes this server uses.
const METHOD_NOT_FOUND = -32601
const INVALID_PARAMS = -32602

const STOPWORDS = new Set(
  "a an and are as at be by for from how i in is it my of on or that the this to use used using want what when which with".split(
    " ",
  ),
)

// Exported for testing: the camelCase split has to run BEFORE lowercasing
// (`bodyMono` → `body mono`), or it can never fire.
export function words(text) {
  return new Set(
    String(text || "")
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(word => word.length >= 3 && !STOPWORDS.has(word)),
  )
}

// Deterministic overlap score: how many of the query's words appear in the
// candidate's text. Ties break on entity order, never on insertion order.
function rank(query, candidates) {
  const wanted = words(query)
  if (wanted.size === 0) return { wanted, ranked: [] }
  const scored = candidates
    .map(candidate => {
      const have = words(candidate.text)
      const hits = [...wanted].filter(word => have.has(word))
      return { ...candidate, score: hits.length, hits }
    })
    .filter(candidate => candidate.score > 0)
    .sort((a, b) => b.score - a.score || compareEntities(a.entity, b.entity))
  return { wanted, ranked: scored }
}

const COVERAGE_GAPS = ["contract", "binding-file", "design-source"]

export const TOOLS = [
  {
    name: "list_components",
    description:
      "Every contracted component, with enough to choose between them: id, title, description, status, and intent (when authored). Read live from the project's contracts.",
    inputSchema: { type: "object", properties: {}, additionalProperties: true },
  },
  {
    name: "get_contract",
    description:
      "One component's full contract by id — props, anatomy, token bindings, intent. Fails plainly when no contract has that id.",
    inputSchema: {
      type: "object",
      required: ["id"],
      properties: { id: { type: "string" } },
      additionalProperties: true,
    },
  },
  {
    name: "find_component",
    description:
      "Find components from a plain description of what you are building. Deterministic word overlap over id, title, description and intent; says clearly when nothing fits rather than returning the closest thing.",
    inputSchema: {
      type: "object",
      required: ["description"],
      properties: { description: { type: "string" } },
      additionalProperties: true,
    },
  },
  {
    name: "list_tokens",
    description:
      "The project's design tokens (DTCG), optionally under an id prefix such as `system.color`: id, $type, resolved CSS value, alias target.",
    inputSchema: {
      type: "object",
      properties: { prefix: { type: "string" } },
      additionalProperties: true,
    },
  },
  {
    name: "find_token",
    description:
      "Which token applies to a use, from a plain description (`background of a primary button`, `spacing between list items`). Deterministic word overlap over token ids; says clearly when nothing fits.",
    inputSchema: {
      type: "object",
      required: ["use"],
      properties: { use: { type: "string" } },
      additionalProperties: true,
    },
  },
  {
    name: "get_coverage",
    description:
      "Coverage counts and one row per component: whether it has a contract, is a draft, declares a design source, and whether its design-to-code binding file is present, missing, stale or not applicable. Read from the same audit `map` runs; a count is null when the check behind it did not run, never 0. `missing` narrows the rows to one gap.",
    inputSchema: {
      type: "object",
      properties: {
        missing: {
          type: "string",
          enum: COVERAGE_GAPS,
        },
      },
      additionalProperties: true,
    },
  },
  {
    name: "get_findings",
    description:
      "The drift findings `audit` and `lint` report, filtered by exact `entity`, `ruleId`, `severity` or `surface`. An unknown rule id, severity or surface is an error naming the valid ones, never an empty list. Exempted findings matching the same filter come back under `decided`, each with its `decision` (kind, reason, issue); they are not counted in `count`.",
    inputSchema: {
      type: "object",
      properties: {
        entity: { type: "string" },
        ruleId: { type: "string" },
        severity: { type: "string", enum: SEVERITIES },
        surface: { type: "string", enum: SURFACES },
      },
      additionalProperties: true,
    },
  },
  {
    name: "get_impact",
    description:
      "Blast radius before a change, as `design-delta impact` reports it: every file and line that references a component (PascalCase name) or a token (dotted id).",
    inputSchema: {
      type: "object",
      required: ["entity"],
      properties: { entity: { type: "string" } },
      additionalProperties: true,
    },
  },
  {
    name: "get_movers",
    description:
      "Contracted components whose code, contract or design hash changed since the last `snapshot`, as `design-delta movers` reports them — where new drift is most likely.",
    inputSchema: { type: "object", properties: {}, additionalProperties: true },
  },
  {
    name: "query_raw_values",
    description:
      "Every literal CSS declaration in the scanned stylesheets, and whether a token carries that exact value, as `design-delta query raw-values` reports it — the candidates to replace with a token.",
    inputSchema: { type: "object", properties: {}, additionalProperties: true },
  },
  {
    name: "list_rules",
    description:
      "Every rule the engine can report, optionally under one `surface`: id, surface, description, default severity, and the severity this project's config resolves it to.",
    inputSchema: {
      type: "object",
      properties: { surface: { type: "string", enum: SURFACES } },
      additionalProperties: true,
    },
  },
]

/**
 * @param {object} options
 * @param {object} options.config the project's (raw) config
 * @param {string} options.root the project root every path resolves against
 * @param {string} options.packageVersion this package's version
 * @param {object} [options.globalOpts] the run's global flags — `--config`
 *   reaches the `audit` that `get_coverage` runs
 * @returns {{handle: (message: object) => Promise<object|null>, version: object}}
 */
export function createMcpServer({
  config,
  root,
  packageVersion,
  globalOpts = {},
}) {
  const version = {
    package: packageVersion,
    contractSchema: CONTRACT_SCHEMA_VERSION,
  }

  function versionMismatch(args) {
    const asked = args?.version
    if (asked === undefined) return null
    const same =
      asked &&
      typeof asked === "object" &&
      (asked.package === undefined || asked.package === version.package) &&
      (asked.contractSchema === undefined ||
        asked.contractSchema === version.contractSchema)
    if (same || asked === version.package) return null
    return `this server reflects package ${version.package} / contract schema v${version.contractSchema}; a request for ${JSON.stringify(asked)} cannot be answered from it`
  }

  function contractsNow() {
    const { contracts, diagnostics } = loadContracts(config, { root })
    return {
      contracts: [...contracts].sort((a, b) => compareEntities(a.id, b.id)),
      diagnostics,
    }
  }

  async function tokensNow() {
    const census = await censusTokens(config, { root })
    return census
  }

  // One existing command, run in-process with `--json` (issue #513): the
  // tool returns what the command prints, so the two cannot disagree. A
  // command that cannot answer exits non-zero and its stderr is the error;
  // stderr from a run that DID answer is a caveat worth passing on.
  async function commandJson(runCommand, argv) {
    const stdout = sink()
    const stderr = sink()
    const code = await runCommand(argv, {
      io: { stdout: stdout.stream, stderr: stderr.stream },
      globalOpts,
    })
    const said = stderr.writes.join("").trim()
    if (code !== 0) return { error: said || `exited ${code}` }
    try {
      return {
        json: JSON.parse(stdout.writes.join("")),
        ...(said ? { notes: said } : {}),
      }
    } catch {
      return { error: said || "the command's output could not be read" }
    }
  }

  const tools = {
    async list_components() {
      const { contracts, diagnostics } = contractsNow()
      return {
        components: contracts.map(({ id, contract }) => ({
          id,
          title: contract.title,
          status: contract.status || "published",
          description: contract.description,
          intent: contract.intent,
          props: Object.keys(contract.props || {}).sort(compareEntities),
        })),
        invalidContracts: diagnostics.length,
      }
    },
    async get_contract({ id }) {
      if (typeof id !== "string" || id.length === 0)
        return { error: "get_contract needs a non-empty string `id`" }
      const { contracts } = contractsNow()
      const entry = contracts.find(candidate => candidate.id === id)
      if (!entry)
        return {
          error: `no contract with id "${id}"`,
          nothingFits: true,
          knownIds: contracts.map(candidate => candidate.id),
        }
      return { id, file: entry.file, contract: entry.contract }
    },
    async find_component({ description }) {
      if (typeof description !== "string")
        return { error: "find_component needs a string `description`" }
      const { contracts } = contractsNow()
      const { wanted, ranked } = rank(
        description,
        contracts.map(({ id, contract }) => ({
          entity: id,
          text: [
            id,
            contract.title,
            contract.description,
            contract.intent?.usedFor,
            contract.intent?.misusedAs,
            contract.intent?.useInstead,
          ].join(" "),
          contract,
        })),
      )
      if (ranked.length === 0)
        return {
          matches: [],
          nothingFits: true,
          reason:
            wanted.size === 0
              ? "the description has no searchable words"
              : `no contract mentions any of: ${[...wanted].join(", ")}`,
        }
      return {
        matches: ranked.map(({ entity, contract, score, hits }) => ({
          id: entity,
          title: contract.title,
          description: contract.description,
          intent: contract.intent,
          score,
          matched: hits,
        })),
      }
    },
    async list_tokens({ prefix } = {}) {
      const census = await tokensNow()
      if (!census.ok)
        return { error: census.diagnostics[0]?.message || "no tokens" }
      const tokens = census.tokens
        .filter(token => !prefix || String(token.id).startsWith(prefix))
        .map(token => ({
          id: token.id,
          $type: token.$type,
          cssValue: token.cssValue,
          aliasOf: token.aliasChain?.[0],
        }))
      return { tokens, count: tokens.length }
    },
    async find_token({ use }) {
      if (typeof use !== "string")
        return { error: "find_token needs a string `use`" }
      const census = await tokensNow()
      if (!census.ok)
        return { error: census.diagnostics[0]?.message || "no tokens" }
      const { wanted, ranked } = rank(
        use,
        census.tokens.map(token => ({
          entity: token.id,
          text: String(token.id).replace(/[./]/g, " "),
          token,
        })),
      )
      if (ranked.length === 0)
        return {
          matches: [],
          nothingFits: true,
          reason:
            wanted.size === 0
              ? "the description has no searchable words"
              : `no token id contains any of: ${[...wanted].join(", ")}`,
        }
      return {
        matches: ranked.map(({ entity, token, score, hits }) => ({
          id: entity,
          $type: token.$type,
          cssValue: token.cssValue,
          score,
          matched: hits,
        })),
      }
    },
    async get_coverage({ missing } = {}) {
      if (missing !== undefined && !COVERAGE_GAPS.includes(missing))
        return {
          error: `get_coverage \`missing\` must be one of: ${COVERAGE_GAPS.join(", ")}`,
        }
      // `map`'s own computation, not a second one (issue #512): audit's
      // stderr is captured so a run that cannot answer says why.
      const stderr = sink()
      const computed = await computeMap({ globalOpts, stderr: stderr.stream })
      if (computed.error)
        return {
          error: [computed.error, ...stderr.writes].join(" ").trim(),
        }
      const { result, findings, skipped, provenance, contracts } = computed
      if (!result.components)
        return {
          counts: null,
          components: null,
          exempted: result.exempted,
          ...(provenance ? { provenance } : {}),
          skipped,
        }

      // The binding-file check runs whenever audit loaded a provider that
      // knows binding files and the project names a binding-file convention
      // (no suffix, no file to expect — and no finding, which must not read
      // as 0), snapshot or not; the design-coverage rules also
      // need the component snapshot, which audit's provenance states as
      // `null` when it was absent or invalid. Each count is null, not clean,
      // when its check did not run.
      const providerRan = provenance?.designComponents !== undefined
      const loaded = providerRan ? await loadProvider(config) : { ok: false }
      const bindingChecked =
        loaded.ok &&
        typeof loaded.provider.bindingPath === "function" &&
        Boolean(resolveConventions(config).codeConnectSuffix)
      const designChecked = providerRan && provenance.designComponents !== null

      const byRule = ruleId =>
        new Set(findings.filter(f => f.ruleId === ruleId).map(f => f.entity))
      const bindingMissing = byRule("components/binding-file-missing")
      const bindingStale = byRule("components/binding-file-stale")
      const bindingUnreliable = byRule(
        "components/binding-file-compare-unreliable",
      )
      const contractOnly = new Set(result.components.contractOnly)

      const rows = [
        ...contracts.map(({ id, contract }) => {
          const designSource = contract?.sources?.design != null
          let bindingFile = null
          if (bindingChecked) {
            // Applicability is the provider's (`bindingPath`) plus the
            // design-source gate its `bindingStatus` applies (issue #448).
            if (bindingMissing.has(id)) bindingFile = "missing"
            else if (bindingStale.has(id)) bindingFile = "stale"
            // The compare hit its declared ceiling (issue #588): reporting
            // this row as `present` would hide the very doubt the finding
            // exists to raise.
            else if (bindingUnreliable.has(id))
              bindingFile = "compare-unreliable"
            else if (
              !designSource ||
              !loaded.provider.bindingPath(contract, config)
            )
              bindingFile = "not-applicable"
            else bindingFile = "present"
          }
          return {
            id,
            file: contract?.sources?.code?.path ?? null,
            contract: true,
            draft: !contract?.sources?.code?.path,
            inCode:
              Boolean(contract?.sources?.code?.path) && !contractOnly.has(id),
            designSource,
            bindingFile,
          }
        }),
        ...result.components.uncontracted.map(file => ({
          id: null,
          file,
          contract: false,
          draft: false,
          inCode: true,
          designSource: false,
          bindingFile: bindingChecked ? "not-applicable" : null,
        })),
      ].sort((a, b) =>
        compareEntities(a.id ?? a.file ?? "", b.id ?? b.file ?? ""),
      )

      const counts = {
        componentsInCode: rows.filter(row => row.inCode).length,
        contracted: result.components.contracted,
        uncontracted: result.components.uncontracted.length,
        contractOnly: result.components.contractOnly.length,
        draft: result.components.draft.length,
        bindingFileMissing: bindingChecked ? bindingMissing.size : null,
        bindingFileStale: bindingChecked ? bindingStale.size : null,
        designMissing: designChecked
          ? byRule("coverage/design-missing").size
          : null,
        designOnly: designChecked ? byRule("coverage/design-only").size : null,
      }

      const keep = {
        contract: row => !row.contract,
        "binding-file": row =>
          row.bindingFile === "missing" || row.bindingFile === "stale",
        "design-source": row => row.contract && !row.designSource,
      }[missing]

      return {
        counts,
        components: keep ? rows.filter(keep) : rows,
        exempted: result.exempted,
        ...(provenance ? { provenance } : {}),
        ...(Object.keys(skipped).length > 0 ? { skipped } : {}),
      }
    },
    async get_findings({ entity, ruleId, severity, surface } = {}) {
      const registry = buildFullRuleRegistry()
      if (ruleId !== undefined && !registry.get(ruleId))
        return {
          error: `unknown rule id "${ruleId}"`,
          knownRuleIds: registry.ids(),
        }
      if (severity !== undefined && !SEVERITIES.includes(severity))
        return {
          error: `severity must be one of: ${SEVERITIES.join(", ")}`,
        }
      if (surface !== undefined && !SURFACES.includes(surface))
        return { error: `surface must be one of: ${SURFACES.join(", ")}` }

      // `verify` gates on both, and prints neither's findings — so both are
      // read the way `gatherHealthScore` reads them.
      const audit = await commandJson(runAudit, ["--json"])
      if (audit.error) return { error: audit.error }
      const lint = await commandJson(runLint, ["--json"])
      if (lint.error) return { error: lint.error }

      const matches = finding =>
        (entity === undefined || finding.entity === entity) &&
        (ruleId === undefined || finding.ruleId === ruleId) &&
        (severity === undefined || finding.severity === severity) &&
        (surface === undefined ||
          registry.get(finding.ruleId)?.surface === surface)
      const findings = [
        ...(audit.json.findings || []),
        ...(lint.json.findings || []),
      ].filter(matches)
      // Exempted findings with the decision that covers them — visible, never
      // counted in `count`.
      const decided = [
        ...(audit.json.decided || []),
        ...(lint.json.decided || []),
      ].filter(matches)
      const notes = [audit.notes, lint.notes].filter(Boolean).join("\n")
      return {
        findings,
        count: findings.length,
        decided,
        exempted:
          (audit.json.counts?.exempted ?? 0) +
          (lint.json.counts?.exempted ?? 0),
        ...(audit.json.skipped ? { skipped: audit.json.skipped } : {}),
        ...(notes ? { notes } : {}),
      }
    },
    async get_impact({ entity }) {
      if (typeof entity !== "string" || entity.length === 0)
        return { error: "get_impact needs a non-empty string `entity`" }
      const impact = await commandJson(runImpact, [entity, "--json"])
      if (impact.error) return { error: impact.error }
      const { command, ...result } = impact.json
      return { ...result, ...(impact.notes ? { notes: impact.notes } : {}) }
    },
    async get_movers() {
      const movers = await commandJson(runMovers, ["--json"])
      if (movers.error) return { error: movers.error }
      const { command, ...result } = movers.json
      return { ...result, ...(movers.notes ? { notes: movers.notes } : {}) }
    },
    async query_raw_values() {
      const query = await commandJson(runQuery, ["raw-values", "--json"])
      if (query.error) return { error: query.error }
      const { command, subject, ...result } = query.json
      return { ...result, ...(query.notes ? { notes: query.notes } : {}) }
    },
    async list_rules({ surface } = {}) {
      if (surface !== undefined && !SURFACES.includes(surface))
        return { error: `surface must be one of: ${SURFACES.join(", ")}` }
      const registry = buildFullRuleRegistry()
      const { rules: rulesConfig } = resolveConfig(config)
      try {
        const rules = (surface ? registry.bySurface(surface) : registry.ids())
          .map(rule => (typeof rule === "string" ? registry.get(rule) : rule))
          .map(rule => ({
            id: rule.id,
            surface: rule.surface,
            description: rule.description,
            defaultSeverity: rule.defaultSeverity,
            severity: resolveRuleConfig(rule.id, rulesConfig, registry)
              .severity,
          }))
        return { rules, count: rules.length }
      } catch (err) {
        return { error: String(err?.message || err) }
      }
    },
  }

  function reply(id, result) {
    return { jsonrpc: "2.0", id, result }
  }
  function fail(id, code, message) {
    return { jsonrpc: "2.0", id, error: { code, message } }
  }

  async function handle(message) {
    const { id, method, params } = message || {}
    const isNotification = id === undefined || id === null
    if (typeof method !== "string")
      return isNotification ? null : fail(id, INVALID_PARAMS, "no method")
    if (method.startsWith("notifications/")) return null

    switch (method) {
      case "initialize":
        return reply(id, {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: { name: "design-delta", version: version.package },
        })
      case "ping":
        return reply(id, {})
      case "tools/list":
        return reply(id, { tools: TOOLS })
      case "tools/call": {
        const name = params?.name
        const tool = Object.hasOwn(tools, name) ? tools[name] : undefined
        if (!tool)
          return fail(
            id,
            INVALID_PARAMS,
            `unknown tool "${name}" (known: ${TOOLS.map(t => t.name).join(", ")})`,
          )
        const args = params?.arguments || {}
        const mismatch = versionMismatch(args)
        if (mismatch) return fail(id, INVALID_PARAMS, mismatch)
        const result = await tool(args)
        const payload = { version, ...result }
        return reply(id, {
          content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
          isError: Boolean(result.error),
        })
      }
      default:
        return isNotification
          ? null
          : fail(id, METHOD_NOT_FOUND, `unknown method "${method}"`)
    }
  }

  return { handle, version }
}
