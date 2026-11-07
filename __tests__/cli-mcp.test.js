/**
 * cli-mcp.test.js — `design-delta mcp` (issue #367): the pure server
 * (`createMcpServer`) against a synthetic project, and the stdio transport
 * through `run`.
 */

import { Readable } from "node:stream"
import { readFileSync, rmSync, writeFileSync } from "node:fs"

import { run } from "../src/cli/main.mjs"
import { runMap } from "../src/cli/commands/map.mjs"
import {
  buildCodeConnectModel,
  renderCodeConnect,
} from "../src/providers/figma/codegen.mjs"
import { contractApiView } from "../src/spec/contracts.mjs"
import { buildFullRuleRegistry } from "../src/cli/rule-registry.mjs"
import { createMcpServer, TOOLS, words } from "../src/cli/mcp-server.mjs"
import { CONTRACT_SCHEMA_VERSION } from "../src/spec/contracts.mjs"
import { createSyntheticProject } from "./helpers/synthetic-project.mjs"

const PACKAGE_VERSION = JSON.parse(readFileSync("package.json", "utf8")).version

async function withSyntheticProject(fn, overrides) {
  const project = createSyntheticProject(overrides)
  const originalCwd = process.cwd()
  process.chdir(project.root)
  try {
    return await fn(project)
  } finally {
    process.chdir(originalCwd)
    project.cleanup()
  }
}

function server(project) {
  return createMcpServer({
    config: project.config,
    root: project.root,
    packageVersion: PACKAGE_VERSION,
    globalOpts: { config: project.configPath },
  })
}

async function call(srv, name, args = {}, id = 1) {
  const response = await srv.handle({
    jsonrpc: "2.0",
    id,
    method: "tools/call",
    params: { name, arguments: args },
  })
  if (response.error) return { error: response.error }
  return {
    ...JSON.parse(response.result.content[0].text),
    isError: response.result.isError,
  }
}

describe("words — the search tokenizer", () => {
  it("splits camelCase BEFORE lowercasing, drops stopwords and short words", () => {
    expect([...words("system.typography.bodyMono.lgRegular")]).toEqual([
      "system",
      "typography",
      "body",
      "mono",
      "regular",
    ])
    expect([...words("a call to action button that links somewhere")]).toEqual([
      "call",
      "action",
      "button",
      "links",
      "somewhere",
    ])
  })
})

describe("createMcpServer — protocol", () => {
  it("answers initialize with tools capability and this package's version", async () => {
    await withSyntheticProject(async project => {
      const response = await server(project).handle({
        jsonrpc: "2.0",
        id: 0,
        method: "initialize",
        params: {},
      })
      expect(response.result.capabilities).toEqual({ tools: {} })
      expect(response.result.serverInfo).toEqual({
        name: "design-delta",
        version: PACKAGE_VERSION,
      })
    })
  })

  it("lists exactly the eleven read-only tools", async () => {
    await withSyntheticProject(async project => {
      const response = await server(project).handle({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/list",
      })
      expect(response.result.tools.map(t => t.name)).toEqual([
        "list_components",
        "get_contract",
        "find_component",
        "list_tokens",
        "find_token",
        "get_coverage",
        "get_findings",
        "get_impact",
        "get_movers",
        "query_raw_values",
        "list_rules",
      ])
      expect(
        TOOLS.every(t => !/write|update|delete|create/i.test(t.name)),
      ).toBe(true)
    })
  })

  it("a notification gets no response; an unknown method is -32601; an unknown tool names the known ones", async () => {
    await withSyntheticProject(async project => {
      const srv = server(project)
      expect(
        await srv.handle({
          jsonrpc: "2.0",
          method: "notifications/initialized",
        }),
      ).toBeNull()
      const unknown = await srv.handle({
        jsonrpc: "2.0",
        id: 2,
        method: "resources/list",
      })
      expect(unknown.error.code).toBe(-32601)
      const badTool = await call(srv, "write_contract", {})
      expect(badTool.error.message).toMatch(
        /unknown tool "write_contract" \(known: list_components/,
      )
    })
  })
})

describe("createMcpServer — the JSON-RPC envelope (issue #599)", () => {
  it("a request with no string method fails with INVALID_PARAMS; the same as a notification gets nothing back", async () => {
    await withSyntheticProject(async project => {
      const srv = server(project)
      for (const method of [undefined, 42]) {
        const response = await srv.handle({ jsonrpc: "2.0", id: 7, method })
        expect(response).toEqual({
          jsonrpc: "2.0",
          id: 7,
          error: { code: -32602, message: "no method" },
        })
      }
      expect(await srv.handle({ jsonrpc: "2.0" })).toBeNull()
      expect(await srv.handle({ jsonrpc: "2.0", id: null })).toBeNull()
      expect(await srv.handle(null)).toBeNull()
    })
  })

  it("a notification for an unknown method returns null, never a reply", async () => {
    await withSyntheticProject(async project => {
      const srv = server(project)
      expect(
        await srv.handle({ jsonrpc: "2.0", method: "resources/list" }),
      ).toBeNull()
      expect(
        await srv.handle({
          jsonrpc: "2.0",
          id: null,
          method: "resources/list",
        }),
      ).toBeNull()
    })
  })

  it("answers ping, and a tools/call with no params names the known tools", async () => {
    await withSyntheticProject(async project => {
      const srv = server(project)
      expect(
        await srv.handle({ jsonrpc: "2.0", id: 3, method: "ping" }),
      ).toEqual({ jsonrpc: "2.0", id: 3, result: {} })
      const response = await srv.handle({
        jsonrpc: "2.0",
        id: 4,
        method: "tools/call",
      })
      expect(response.error.code).toBe(-32602)
      expect(response.error.message).toMatch(
        /^unknown tool "undefined" \(known: list_components/,
      )
      const noArguments = await srv.handle({
        jsonrpc: "2.0",
        id: 5,
        method: "tools/call",
        params: { name: "list_components" },
      })
      expect(noArguments.result.isError).toBe(false)
    })
  })
})

describe("createMcpServer — one version, stated", () => {
  it("every result carries the package and contract-schema version", async () => {
    await withSyntheticProject(async project => {
      const result = await call(server(project), "list_components")
      expect(result.version).toEqual({
        package: PACKAGE_VERSION,
        contractSchema: CONTRACT_SCHEMA_VERSION,
      })
    })
  })

  it("a request for another version fails and says which version this server reflects", async () => {
    await withSyntheticProject(async project => {
      const srv = server(project)
      const wrong = await call(srv, "list_components", {
        version: { package: "0.0.1" },
      })
      expect(wrong.error.code).toBe(-32602)
      expect(wrong.error.message).toContain(
        `reflects package ${PACKAGE_VERSION}`,
      )
      const right = await call(srv, "list_components", {
        version: { package: PACKAGE_VERSION },
      })
      expect(right.error).toBeUndefined()
      expect(right.components.length).toBeGreaterThan(0)
    })
  })
})

describe("createMcpServer — the tools, read live", () => {
  it("list_components and get_contract read the project's contracts", async () => {
    await withSyntheticProject(async project => {
      const srv = server(project)
      const listed = await call(srv, "list_components")
      const ids = listed.components.map(c => c.id)
      expect(ids).toEqual([...ids].sort())
      expect(ids).toContain("badge")
      const one = await call(srv, "get_contract", { id: "badge" })
      expect(one.contract.id).toBe("badge")
      expect(one.contract.props).toBeDefined()
    })
  })

  it("get_contract for an unknown id says nothing fits and lists the known ids — never a near match", async () => {
    await withSyntheticProject(async project => {
      const miss = await call(server(project), "get_contract", { id: "badg" })
      expect(miss.nothingFits).toBe(true)
      expect(miss.isError).toBe(true)
      expect(miss.knownIds).toContain("badge")
      expect(miss.contract).toBeUndefined()
    })
  })

  it("find_component ranks by deterministic word overlap, and says when nothing fits", async () => {
    await withSyntheticProject(async project => {
      const srv = server(project)
      const hit = await call(srv, "find_component", {
        description: "a small badge label",
      })
      expect(hit.nothingFits).toBeUndefined()
      expect(hit.matches[0].id).toBe("badge")
      expect(hit.matches[0].matched).toContain("badge")
      const miss = await call(srv, "find_component", {
        description: "a carousel of zebras",
      })
      expect(miss).toEqual(
        expect.objectContaining({
          matches: [],
          nothingFits: true,
          reason: expect.stringContaining("carousel"),
        }),
      )
      const empty = await call(srv, "find_component", {
        description: "a of the",
      })
      expect(empty.reason).toMatch(/no searchable words/)
    })
  })

  it("list_tokens filters by prefix; find_token ranks token ids and says when nothing fits", async () => {
    await withSyntheticProject(async project => {
      const srv = server(project)
      const all = await call(srv, "list_tokens")
      expect(all.count).toBeGreaterThan(0)
      const prefix = all.tokens[0].id.split(".")[0]
      const some = await call(srv, "list_tokens", { prefix })
      expect(some.tokens.every(t => t.id.startsWith(prefix))).toBe(true)
      const first = all.tokens[0].id.split(".").slice(-2)
      const hit = await call(srv, "find_token", { use: first.join(" ") })
      expect(hit.matches[0].id).toBe(all.tokens[0].id)
      const miss = await call(srv, "find_token", { use: "zebra stripes" })
      expect(miss.nothingFits).toBe(true)
    })
  })

  it("reads live: a contract added after the server started is served on the next call", async () => {
    await withSyntheticProject(async project => {
      const srv = server(project)
      const before = (await call(srv, "list_components")).components.map(
        c => c.id,
      )
      const { writeFileSync, mkdirSync } = await import("node:fs")
      const { join } = await import("node:path")
      const dir = join(project.root, project.config.paths.contractsDir)
      mkdirSync(dir, { recursive: true })
      writeFileSync(
        join(dir, `zzz-late${project.config.conventions.contractSuffix}`),
        JSON.stringify({ id: "zzz-late", title: "Late", props: {} }),
      )
      const after = (await call(srv, "list_components")).components.map(
        c => c.id,
      )
      expect(before).not.toContain("zzz-late")
      expect(after).toContain("zzz-late")
    })
  })
})

describe("createMcpServer — argument guards and failed reads (issue #599)", () => {
  it("a non-string or empty entity id is an error result, never a throw", async () => {
    await withSyntheticProject(async project => {
      const srv = server(project)
      const cases = [
        ["get_contract", {}, /get_contract needs a non-empty string `id`/],
        ["get_contract", { id: 7 }, /get_contract needs a non-empty string/],
        ["get_contract", { id: "" }, /get_contract needs a non-empty string/],
        ["find_component", { description: 3 }, /needs a string `description`/],
        ["find_token", {}, /find_token needs a string `use`/],
        ["get_impact", { entity: "" }, /get_impact needs a non-empty string/],
        ["get_impact", { entity: ["Badge"] }, /get_impact needs a non-empty/],
      ]
      for (const [name, args, message] of cases) {
        const result = await call(srv, name, args)
        expect(result.isError).toBe(true)
        expect(result.error).toMatch(message)
      }
    })
  })

  it("list_rules rejects an unknown surface by naming the valid ones", async () => {
    await withSyntheticProject(async project => {
      const result = await call(server(project), "list_rules", {
        surface: "nope",
      })
      expect(result.isError).toBe(true)
      expect(result.error).toMatch(/^surface must be one of: .*coverage/)
      expect(result.rules).toBeUndefined()
    })
  })

  it("list_rules turns a rule entry the engine cannot read into a stringified error", async () => {
    await withSyntheticProject(async project => {
      const result = await call(
        createMcpServer({
          config: {
            ...project.config,
            rules: { "coverage/contract-only": "fatal" },
          },
          root: project.root,
          packageVersion: PACKAGE_VERSION,
        }),
        "list_rules",
      )
      expect(result.isError).toBe(true)
      expect(result.error).toMatch(/got "fatal"$/)
      expect(result.rules).toBeUndefined()
    })
  })

  it("list_tokens and find_token pass on the census's own diagnostic when it cannot read the tokens", async () => {
    await withSyntheticProject(async project => {
      rmSync(project.paths.tokensFile)
      const srv = server(project)
      for (const [name, args] of [
        ["list_tokens", {}],
        ["find_token", { use: "primary background" }],
      ]) {
        const result = await call(srv, name, args)
        expect(result.isError).toBe(true)
        expect(result.error).toMatch(/^no tokens file at /)
        expect(result.tokens).toBeUndefined()
        expect(result.matches).toBeUndefined()
      }
    })
  })

  it("a delegated command that exits non-zero comes back as an error carrying its stderr", async () => {
    await withSyntheticProject(async project => {
      const srv = createMcpServer({
        config: project.config,
        root: project.root,
        packageVersion: PACKAGE_VERSION,
        globalOpts: { config: `${project.root}/no-such-config.json` },
      })
      for (const [name, args] of [
        ["get_impact", { entity: "Badge" }],
        ["get_movers", {}],
        ["query_raw_values", {}],
      ]) {
        const result = await call(srv, name, args)
        expect(result.isError).toBe(true)
        expect(result.error).toMatch(/no-such-config\.json/)
      }
    })
  })
})

describe("createMcpServer — get_coverage (issue #512)", () => {
  const UNCONTRACTED = {
    name: "toolbar",
    tsx: `export function Toolbar() {
  return null
}
`,
  }

  async function mapJson(project) {
    const writes = []
    const code = await runMap(["--json"], {
      globalOpts: { config: project.configPath },
      io: { stdout: { write: c => writes.push(c) }, stderr: { write() {} } },
    })
    expect(code).toBe(0)
    return JSON.parse(writes.join(""))
  }

  it("counts agree with `map --json`, and uncontracted/contract-only components get rows", async () => {
    await withSyntheticProject(async project => {
      writeFileSync(
        `${project.paths.componentsDir}/toolbar.tsx`,
        UNCONTRACTED.tsx,
      )
      rmSync(project.paths.components.badge.tsx)
      const coverage = await call(server(project), "get_coverage")
      const map = await mapJson(project)

      expect(coverage.isError).toBe(false)
      expect(coverage.counts).toEqual(
        expect.objectContaining({
          contracted: map.components.contracted,
          uncontracted: map.components.uncontracted.length,
          contractOnly: map.components.contractOnly.length,
          draft: map.components.draft.length,
          componentsInCode:
            map.components.contracted + map.components.uncontracted.length,
        }),
      )
      expect(coverage.counts.uncontracted).toBe(1)
      expect(coverage.counts.contractOnly).toBe(1)
      const toolbar = coverage.components.find(row => row.id === null)
      expect(toolbar).toEqual(
        expect.objectContaining({ contract: false, inCode: true }),
      )
      const badge = coverage.components.find(row => row.id === "badge")
      expect(badge).toEqual(
        expect.objectContaining({ contract: true, inCode: false }),
      )
    })
  })

  it("with no design provider, the binding-file and design counts are null — never 0", async () => {
    await withSyntheticProject(async project => {
      const coverage = await call(server(project), "get_coverage")
      expect(coverage.counts).toEqual(
        expect.objectContaining({
          bindingFileMissing: null,
          bindingFileStale: null,
          designMissing: null,
          designOnly: null,
        }),
      )
      expect(coverage.components.every(row => row.bindingFile === null)).toBe(
        true,
      )
    })
  })

  it("reports present, missing and stale binding files from audit's own findings", async () => {
    await withSyntheticProject(
      async project => {
        // field: what the contract renders — present. badge: deleted —
        // missing. Nothing hand-built stands in for the renderer.
        const field = JSON.parse(
          readFileSync(project.paths.components.field.contract, "utf8"),
        )
        writeFileSync(
          project.paths.components.field.codeConnect,
          renderCodeConnect(
            buildCodeConnectModel(
              field,
              project.config,
              contractApiView(field),
              { namedExport: true },
            ),
          ),
        )
        rmSync(project.paths.components.badge.codeConnect)

        const srv = server(project)
        const coverage = await call(srv, "get_coverage")
        const status = Object.fromEntries(
          coverage.components.map(row => [row.id, row.bindingFile]),
        )
        expect(status).toEqual({ badge: "missing", field: "present" })
        expect(coverage.counts.bindingFileMissing).toBe(1)
        expect(coverage.counts.bindingFileStale).toBe(0)
        expect(coverage.counts.designMissing).toBe(0)

        writeFileSync(project.paths.components.field.codeConnect, "// edited\n")
        const again = await call(srv, "get_coverage", {
          missing: "binding-file",
        })
        expect(again.components.map(row => [row.id, row.bindingFile])).toEqual([
          ["badge", "missing"],
          ["field", "stale"],
        ])
      },
      { design: { provider: "figma" } },
    )
  })

  // The `compare-unreliable` half of #599 needs a project with no
  // `typescript` to parse with (issue #609), which no real project here can
  // be — it lives in `cli-mcp-errors.test.js`, which stubs the loader.
  it("an uncontracted component is not-applicable (issue #599)", async () => {
    await withSyntheticProject(
      async project => {
        writeFileSync(
          `${project.paths.componentsDir}/toolbar.tsx`,
          UNCONTRACTED.tsx,
        )

        const coverage = await call(server(project), "get_coverage")
        expect(coverage.isError).toBe(false)
        const toolbar = coverage.components.find(row => row.id === null)
        expect(toolbar).toEqual(
          expect.objectContaining({
            contract: false,
            bindingFile: "not-applicable",
          }),
        )
      },
      { design: { provider: "figma" } },
    )
  })

  it("with a provider but no binding-file convention, the binding-file counts are null — the check never ran", async () => {
    await withSyntheticProject(
      async project => {
        const config = JSON.parse(readFileSync(project.configPath, "utf8"))
        delete config.conventions.codeConnectSuffix
        writeFileSync(project.configPath, JSON.stringify(config))
        const coverage = await call(
          createMcpServer({
            config,
            root: project.root,
            packageVersion: PACKAGE_VERSION,
            globalOpts: { config: project.configPath },
          }),
          "get_coverage",
        )
        expect(coverage.isError).toBe(false)
        expect(coverage.counts.bindingFileMissing).toBeNull()
        expect(coverage.counts.bindingFileStale).toBeNull()
        expect(coverage.counts.designOnly).not.toBeNull()
        expect(coverage.components.every(row => row.bindingFile === null)).toBe(
          true,
        )
      },
      { design: { provider: "figma" } },
    )
  })

  it("a contract with no design source is not-applicable for a binding file, not missing", async () => {
    await withSyntheticProject(
      async project => {
        const path = project.paths.components.badge.contract
        const badge = JSON.parse(readFileSync(path, "utf8"))
        delete badge.sources.design
        writeFileSync(path, JSON.stringify(badge))
        rmSync(project.paths.components.badge.codeConnect)

        const coverage = await call(server(project), "get_coverage", {
          missing: "design-source",
        })
        expect(coverage.components).toEqual([
          expect.objectContaining({
            id: "badge",
            designSource: false,
            bindingFile: "not-applicable",
          }),
        ])
      },
      { design: { provider: "figma" } },
    )
  })

  it("a missing design snapshot nulls the design counts but not the binding-file ones", async () => {
    await withSyntheticProject(
      async project => {
        rmSync(project.paths.designComponentsFile)
        const coverage = await call(server(project), "get_coverage")
        expect(coverage.counts.designMissing).toBeNull()
        expect(coverage.counts.designOnly).toBeNull()
        expect(coverage.counts.bindingFileStale).not.toBeNull()
        expect(coverage.provenance.designComponents).toBeNull()
      },
      { design: { provider: "figma" } },
    )
  })

  it("filters by missing contract, and rejects an unknown gap", async () => {
    await withSyntheticProject(async project => {
      writeFileSync(
        `${project.paths.componentsDir}/toolbar.tsx`,
        UNCONTRACTED.tsx,
      )
      const srv = server(project)
      const uncontracted = await call(srv, "get_coverage", {
        missing: "contract",
      })
      expect(uncontracted.components.map(row => row.file)).toEqual([
        expect.stringMatching(/toolbar\.tsx$/),
      ])
      const bad = await call(srv, "get_coverage", { missing: "tests" })
      expect(bad.isError).toBe(true)
      expect(bad.error).toMatch(/contract, binding-file, design-source/)
    })
  })

  it("a config audit refuses is an error that says why, never an empty answer", async () => {
    await withSyntheticProject(
      async project => {
        const coverage = await call(server(project), "get_coverage")
        expect(coverage.isError).toBe(true)
        expect(coverage.error).toMatch(/unknown rule id 'nope\/nope'/)
        expect(coverage.counts).toBeUndefined()
      },
      { rules: { "nope/nope": "off" } },
    )
  })
})

describe("createMcpServer — the existing read-only commands as tools (issue #513)", () => {
  // What the command itself prints with --json, for the same project — the
  // tool must return exactly that, never a second assembly of it.
  async function commandJson(project, argv) {
    const out = []
    const code = await run(
      [...argv, "--json", "--config", project.configPath],
      {
        stdout: { write: chunk => out.push(String(chunk)) },
        stderr: { write() {} },
      },
    )
    expect(code).toBe(0)
    return JSON.parse(out.join(""))
  }

  it("get_findings returns audit's and lint's findings, and filters them exactly", async () => {
    await withSyntheticProject(async project => {
      const srv = server(project)
      const audit = await commandJson(project, ["audit"])
      const lint = await commandJson(project, ["lint"])
      const all = await call(srv, "get_findings")
      expect(all.isError).toBe(false)
      expect(all.findings).toEqual([...audit.findings, ...lint.findings])
      expect(all.count).toBeGreaterThan(0)

      const first = all.findings[0]
      const byRule = await call(srv, "get_findings", { ruleId: first.ruleId })
      expect(byRule.findings).toEqual(
        all.findings.filter(f => f.ruleId === first.ruleId),
      )
      const byEntity = await call(srv, "get_findings", {
        entity: first.entity,
        severity: first.severity,
      })
      expect(byEntity.findings).toEqual(
        all.findings.filter(
          f => f.entity === first.entity && f.severity === first.severity,
        ),
      )
      const surface = buildFullRuleRegistry().get(first.ruleId).surface
      const bySurface = await call(srv, "get_findings", { surface })
      expect(bySurface.findings.length).toBeGreaterThan(0)
      expect(
        bySurface.findings.every(f => f.ruleId.startsWith(`${surface}/`)),
      ).toBe(true)
    })
  })

  it("get_findings rejects an unknown rule id, severity or surface instead of answering empty", async () => {
    await withSyntheticProject(async project => {
      const srv = server(project)
      const rule = await call(srv, "get_findings", { ruleId: "nope/nope" })
      expect(rule.isError).toBe(true)
      expect(rule.knownRuleIds).toContain("coverage/contract-only")
      const severity = await call(srv, "get_findings", { severity: "fatal" })
      expect(severity.error).toMatch(/error, warn, review/)
      const surface = await call(srv, "get_findings", { surface: "nope" })
      expect(surface.isError).toBe(true)
    })
  })

  it("a command that cannot answer is an error naming why", async () => {
    await withSyntheticProject(
      async project => {
        const findings = await call(server(project), "get_findings")
        expect(findings.isError).toBe(true)
        expect(findings.error).toMatch(/unknown rule id 'nope\/nope'/)
      },
      { rules: { "nope/nope": "off" } },
    )
  })

  it("get_impact returns what `impact --json` does, and errors on an entity it cannot read", async () => {
    await withSyntheticProject(async project => {
      const srv = server(project)
      const { command, ...expected } = await commandJson(project, [
        "impact",
        "Badge",
      ])
      const impact = await call(srv, "get_impact", { entity: "Badge" })
      expect(impact).toEqual(
        expect.objectContaining({ ...expected, isError: false }),
      )
      const token = await call(srv, "get_impact", { entity: "acme.color.fg" })
      expect(token.kind).toBe("token")
      const bad = await call(srv, "get_impact", { entity: "not a thing" })
      expect(bad.isError).toBe(true)
      expect(bad.error).toMatch(/neither a PascalCase component name/)
    })
  })

  it("get_movers and query_raw_values return what their commands do", async () => {
    await withSyntheticProject(async project => {
      const srv = server(project)
      const { command: m, ...movers } = await commandJson(project, ["movers"])
      expect(await call(srv, "get_movers")).toEqual(
        expect.objectContaining({ ...movers, isError: false }),
      )
      const {
        command: q,
        subject,
        ...raw
      } = await commandJson(project, ["query", "raw-values"])
      expect(await call(srv, "query_raw_values")).toEqual(
        expect.objectContaining({ ...raw, isError: false }),
      )
    })
  })

  it("list_rules lists every rule with the severity this project's config resolves", async () => {
    await withSyntheticProject(
      async project => {
        const srv = server(project)
        const registry = buildFullRuleRegistry()
        const all = await call(srv, "list_rules")
        expect(all.rules.map(rule => rule.id)).toEqual(registry.ids())
        const contractOnly = all.rules.find(
          rule => rule.id === "coverage/contract-only",
        )
        expect(contractOnly).toEqual({
          id: "coverage/contract-only",
          surface: "coverage",
          description: registry.get("coverage/contract-only").description,
          defaultSeverity: "warn",
          severity: "off",
        })
        const coverage = await call(srv, "list_rules", { surface: "coverage" })
        expect(coverage.rules.every(rule => rule.surface === "coverage")).toBe(
          true,
        )
        expect(coverage.count).toBe(registry.bySurface("coverage").length)
      },
      { rules: { "coverage/contract-only": "off" } },
    )
  })
})

describe("design-delta mcp — the stdio transport", () => {
  function fakeStream() {
    const writes = []
    return { stream: { write: chunk => writes.push(String(chunk)) }, writes }
  }

  it("answers one JSON-RPC line per request, in order, only on stdout, and exits 0 when stdin closes", async () => {
    await withSyntheticProject(async project => {
      const { stream: stdout, writes: out } = fakeStream()
      const { stream: stderr, writes: err } = fakeStream()
      const stdin = Readable.from([
        '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}\n',
        '{"jsonrpc":"2.0","method":"notifications/initialized"}\n',
        "not json\n",
        '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"list_components","arguments":{}}}\n',
      ])
      const code = await run(["mcp", "--config", project.configPath], {
        stdin,
        stdout,
        stderr,
      })
      expect(code).toBe(0)
      const lines = out
        .join("")
        .trim()
        .split("\n")
        .map(line => JSON.parse(line))
      expect(lines.map(l => l.id)).toEqual([1, null, 2])
      expect(lines[1].error.code).toBe(-32700)
      expect(
        JSON.parse(lines[2].result.content[0].text).components,
      ).toBeDefined()
      expect(err.join("")).toBe("")
    })
  })

  it("settles with exit 1 when stdout cannot be written, instead of hanging", async () => {
    await withSyntheticProject(async project => {
      const stdout = {
        write: () => {
          throw new Error("EPIPE")
        },
      }
      const { stream: stderr, writes: err } = fakeStream()
      const code = await run(["mcp", "--config", project.configPath], {
        stdin: Readable.from(['{"jsonrpc":"2.0","id":1,"method":"ping"}\n']),
        stdout,
        stderr,
      })
      expect(code).toBe(1)
      expect(err.join("")).toMatch(/stdout write failed: EPIPE/)
    })
  })

  it("rejects an unknown flag with exit 1 and nothing on stdout", async () => {
    await withSyntheticProject(async project => {
      const { stream: stdout, writes: out } = fakeStream()
      const { stream: stderr } = fakeStream()
      const code = await run(
        ["mcp", "--nope", "--config", project.configPath],
        {
          stdin: Readable.from([]),
          stdout,
          stderr,
        },
      )
      expect(code).toBe(1)
      expect(out.join("")).toBe("")
    })
  })
})
