/**
 * cli-mcp-errors.test.js — the MCP server's error paths that no real project
 * can reach (issue #599): a token census that fails with no diagnostic, a
 * delegated command that exits non-zero silently or prints what cannot be
 * read, a map run that skipped components, and a handler that throws
 * something other than an Error. The dependencies are stubbed per case, so
 * each `{ error }` shape an agent can receive is pinned; everything else runs
 * the real modules. The real-project cases live in `cli-mcp.test.js`.
 */

import { readFileSync, writeFileSync } from "node:fs"

import { jest } from "@jest/globals"

import {
  buildCodeConnectModel,
  renderCodeConnect,
} from "../src/providers/figma/codegen.mjs"
import { contractApiView } from "../src/spec/contracts.mjs"
import { createSyntheticProject } from "./helpers/synthetic-project.mjs"

const real = {
  code: await import("../src/sources/code.mjs"),
  audit: await import("../src/cli/commands/audit.mjs"),
  lint: await import("../src/cli/commands/lint.mjs"),
  impact: await import("../src/cli/commands/impact.mjs"),
  movers: await import("../src/cli/commands/movers.mjs"),
  query: await import("../src/cli/commands/query.mjs"),
  map: await import("../src/cli/commands/map.mjs"),
  registry: await import("../src/cli/rule-registry.mjs"),
  typescript: await import("../src/providers/figma/typescript.mjs"),
}

// The one stub each case sets; `afterEach` clears them so the real module
// answers again.
const stub = {}
const through =
  (name, fallback) =>
  (...args) =>
    (stub[name] ?? fallback)(...args)

jest.resetModules()
jest.unstable_mockModule("../src/sources/code.mjs", () => ({
  ...real.code,
  censusTokens: through("censusTokens", real.code.censusTokens),
}))
jest.unstable_mockModule("../src/cli/commands/audit.mjs", () => ({
  ...real.audit,
  runAudit: through("runAudit", real.audit.runAudit),
}))
jest.unstable_mockModule("../src/cli/commands/lint.mjs", () => ({
  ...real.lint,
  runLint: through("runLint", real.lint.runLint),
}))
jest.unstable_mockModule("../src/cli/commands/impact.mjs", () => ({
  ...real.impact,
  runImpact: through("runImpact", real.impact.runImpact),
}))
jest.unstable_mockModule("../src/cli/commands/movers.mjs", () => ({
  ...real.movers,
  runMovers: through("runMovers", real.movers.runMovers),
}))
jest.unstable_mockModule("../src/cli/commands/query.mjs", () => ({
  ...real.query,
  runQuery: through("runQuery", real.query.runQuery),
}))
jest.unstable_mockModule("../src/cli/commands/map.mjs", () => ({
  ...real.map,
  computeMap: through("computeMap", real.map.computeMap),
}))
jest.unstable_mockModule("../src/cli/rule-registry.mjs", () => ({
  ...real.registry,
  buildFullRuleRegistry: through(
    "buildFullRuleRegistry",
    real.registry.buildFullRuleRegistry,
  ),
}))

jest.unstable_mockModule("../src/providers/figma/typescript.mjs", () => ({
  loadTypeScript: through("loadTypeScript", real.typescript.loadTypeScript),
}))

const { createMcpServer } = await import("../src/cli/mcp-server.mjs")

afterEach(() => {
  for (const name of Object.keys(stub)) delete stub[name]
})

const srv = createMcpServer({
  config: {},
  root: process.cwd(),
  packageVersion: "0.0.0-test",
})

async function call(name, args = {}) {
  const response = await srv.handle({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name, arguments: args },
  })
  return {
    ...JSON.parse(response.result.content[0].text),
    isError: response.result.isError,
  }
}

// A command stand-in: writes what it is given, exits with `code`.
function command({ code = 0, stdout = "", stderr = "" }) {
  return async (_argv, { io }) => {
    if (stdout) io.stdout.write(stdout)
    if (stderr) io.stderr.write(stderr)
    return code
  }
}

describe("the token census fallback", () => {
  it("a failed census with no diagnostic says `no tokens`, on both token tools", async () => {
    stub.censusTokens = async () => ({ ok: false, tokens: [], diagnostics: [] })
    for (const [name, args] of [
      ["list_tokens", {}],
      ["find_token", { use: "primary background" }],
    ]) {
      expect(await call(name, args)).toEqual(
        expect.objectContaining({ error: "no tokens", isError: true }),
      )
    }
  })
})

describe("a delegated command that cannot answer", () => {
  const TOOLS = [
    ["get_impact", { entity: "Badge" }, "runImpact"],
    ["get_movers", {}, "runMovers"],
    ["query_raw_values", {}, "runQuery"],
  ]

  it.each(TOOLS)(
    "%s: a non-zero exit with nothing on stderr names the exit code",
    async (name, args, runner) => {
      stub[runner] = command({ code: 2 })
      expect(await call(name, args)).toEqual(
        expect.objectContaining({ error: "exited 2", isError: true }),
      )
    },
  )

  it.each(TOOLS)(
    "%s: output that is not JSON is an error, never a half-read answer",
    async (name, args, runner) => {
      stub[runner] = command({ stdout: "not json" })
      expect(await call(name, args)).toEqual(
        expect.objectContaining({
          error: "the command's output could not be read",
          isError: true,
        }),
      )
      stub[runner] = command({ stdout: "not json", stderr: "half-written\n" })
      expect((await call(name, args)).error).toBe("half-written")
    },
  )

  it.each(TOOLS)(
    "%s: stderr from a run that did answer is passed on as `notes`",
    async (name, args, runner) => {
      stub[runner] = command({
        stdout: JSON.stringify({ command: "x", subject: "y", answer: 1 }),
        stderr: "a caveat\n",
      })
      const result = await call(name, args)
      expect(result).toEqual(
        expect.objectContaining({
          answer: 1,
          notes: "a caveat",
          isError: false,
        }),
      )
      expect(result.command).toBeUndefined()
    },
  )
})

describe("get_findings", () => {
  it("propagates an upstream `error` from lint after audit answered", async () => {
    stub.runAudit = command({ stdout: JSON.stringify({ findings: [] }) })
    stub.runLint = command({ code: 1, stderr: "lint could not run\n" })
    expect(await call("get_findings")).toEqual(
      expect.objectContaining({ error: "lint could not run", isError: true }),
    )
  })

  it("propagates an upstream `error` from audit without running lint", async () => {
    stub.runAudit = command({ code: 1, stderr: "audit could not run\n" })
    stub.runLint = () => {
      throw new Error("lint must not run")
    }
    expect((await call("get_findings")).error).toBe("audit could not run")
  })

  it("reads a sparse result as empty, and carries skipped surfaces and both runs' notes", async () => {
    stub.runAudit = command({
      stdout: JSON.stringify({ skipped: { components: "no typescript" } }),
      stderr: "audit caveat\n",
    })
    stub.runLint = command({ stdout: "{}", stderr: "lint caveat\n" })
    expect(await call("get_findings")).toEqual(
      expect.objectContaining({
        findings: [],
        count: 0,
        decided: [],
        exempted: 0,
        skipped: { components: "no typescript" },
        notes: "audit caveat\nlint caveat",
        isError: false,
      }),
    )
  })
})

describe("get_coverage", () => {
  it("with no component census, the counts and rows are null — never an empty, clean answer", async () => {
    stub.computeMap = async () => ({
      result: { components: null, exempted: 0 },
      findings: [],
      skipped: { components: "no typescript" },
      contracts: [],
    })
    const coverage = await call("get_coverage")
    expect(coverage).toEqual(
      expect.objectContaining({
        counts: null,
        components: null,
        exempted: 0,
        skipped: { components: "no typescript" },
        isError: false,
      }),
    )
    expect(coverage.provenance).toBeUndefined()
  })
})

describe("get_coverage — a binding the provider could not compare (issues #599, #609)", () => {
  it("is compare-unreliable, never counted as stale", async () => {
    // A consumer without the optional `typescript` peer: the provider can only
    // tell that the file differs from the render as text.
    stub.loadTypeScript = () => null
    const project = createSyntheticProject({ design: { provider: "figma" } })
    const originalCwd = process.cwd()
    process.chdir(project.root)
    try {
      // What the contract renders, reformatted only by a trailing comment:
      // with a parser this is a match (the control below), without one the
      // provider can tell only that the text differs.
      const contract = JSON.parse(
        readFileSync(project.paths.components.field.contract, "utf8"),
      )
      writeFileSync(
        project.paths.components.field.codeConnect,
        `${renderCodeConnect(
          buildCodeConnectModel(
            contract,
            project.config,
            contractApiView(contract),
            {
              namedExport: true,
            },
          ),
        )}// formatted\n`,
      )
      const response = await createMcpServer({
        config: project.config,
        root: project.root,
        packageVersion: "0.0.0-test",
        globalOpts: { config: project.configPath },
      }).handle({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "get_coverage", arguments: {} },
      })
      const coverage = JSON.parse(response.result.content[0].text)
      expect(response.result.isError).toBe(false)
      const field = coverage.components.find(row => row.id === "field")
      expect(field.bindingFile).toBe("compare-unreliable")
      const stale = coverage.components
        .filter(row => row.bindingFile === "stale")
        .map(row => row.id)
      expect(stale).not.toContain("field")
      expect(coverage.counts.bindingFileStale).toBe(stale.length)
    } finally {
      process.chdir(originalCwd)
      project.cleanup()
    }
  })
})

describe("list_rules", () => {
  it("a thrown value that is not an Error is stringified into `{ error }`", async () => {
    stub.buildFullRuleRegistry = () => ({
      ids() {
        throw "registry unreadable"
      },
    })
    expect(await call("list_rules")).toEqual(
      expect.objectContaining({ error: "registry unreadable", isError: true }),
    )
  })
})
