import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  CONFIG_SCHEMA_FILE,
  DEFAULT_CONVENTIONS,
  DEFAULT_PATHS,
  DEFAULT_REPORT,
  loadConfig,
  resolveConfig,
  resolveConventions,
  resolvePaths,
  resolveReport,
  resolveRunConfig,
  validateConfig,
} from "../src/core/config.mjs"

describe("core/config — CONFIG_SCHEMA_FILE", () => {
  it("resolves to an absolute, on-disk path (package-root anchored, not cwd-anchored)", async () => {
    const { existsSync } = await import("node:fs")
    const { isAbsolute } = await import("node:path")
    expect(isAbsolute(CONFIG_SCHEMA_FILE)).toBe(true)
    expect(existsSync(CONFIG_SCHEMA_FILE)).toBe(true)
  })
})

describe("core/config — validateConfig", () => {
  it("validates the empty config", () => {
    expect(validateConfig({})).toEqual({ valid: true, errors: [] })
  })

  it("validates a fully-populated config across every block", () => {
    const full = {
      $schema: "./node_modules/design-delta/schema/config.schema.json",
      design: { provider: "acme-design-tool", options: { workspace: "abc" } },
      paths: {
        snapshotDir: "snaps",
        stateFile: "state.json",
        tokensFile: "tokens.json",
        componentsDir: "components",
        contractsDir: "contracts",
        reportDir: "reports",
      },
      conventions: {
        stylesSuffix: ".module.css",
        codeConnectSuffix: ".figma.tsx",
        contractSuffix: ".contract.json",
        cssVarPrefix: "--ds-",
        groupedDirs: ["compounds"],
        nonComponentFileSuffixes: [".stories.tsx", ".test.tsx"],
        iconFilePrefix: "icon-",
        designVarNamespaces: { fg: "color" },
      },
      tokenMapping: {
        collections: {
          global: { collection: "Global", modes: { default: "Mode 1" } },
        },
        codeAuthoritativeGroups: ["breakpoint"],
        unitlessGroups: ["zIndex", "opacity"],
        aliasFoldingRules: {
          groups: {
            color: [
              {
                when: { index: 1, equals: "vivid" },
                template: "vivid{0^}.{2+}",
                description: "example fold rule",
              },
            ],
          },
        },
      },
      rules: {
        _comment: "rule ids below",
        "tokens/value-mismatch": "error",
        "components/prop-missing": ["warn", { strict: true }],
      },
      exemptions: {
        _comment: "exemption ids below",
        "tokens/value-mismatch": [
          "color.legacy.brand",
          { entity: "components/OldButton", reason: "scheduled for removal" },
        ],
      },
      report: {
        timeZone: "America/Los_Angeles",
        actions: { design: "design-side fix", code: "code-side fix" },
      },
    }
    expect(validateConfig(full)).toEqual({ valid: true, errors: [] })
  })

  it("rejects a non-object config", () => {
    const { valid, errors } = validateConfig("nope")
    expect(valid).toBe(false)
    expect(errors).toEqual(["config must be a JSON object"])
  })

  it("rejects an unknown top-level key, naming the key and the allowed keys", () => {
    const { valid, errors } = validateConfig({ mockupRouteMap: [] })
    expect(valid).toBe(false)
    expect(errors).toHaveLength(1)
    expect(errors[0]).toMatch(/unknown key 'mockupRouteMap' in config/)
    expect(errors[0]).toMatch(/allowed:/)
    expect(errors[0]).toMatch(/paths/)
    expect(errors[0]).toMatch(/conventions/)
  })

  it("rejects an unknown key inside a closed nested block (paths)", () => {
    const { valid, errors } = validateConfig({ paths: { iconsDir: "x" } })
    expect(valid).toBe(false)
    expect(errors[0]).toMatch(/unknown key 'iconsDir' in paths/)
    expect(errors[0]).toMatch(/allowed:/)
  })

  describe("_-prefixed comment keys", () => {
    it("are accepted at the top level", () => {
      expect(validateConfig({ _comment: "top level note" })).toEqual({
        valid: true,
        errors: [],
      })
    })

    it("are accepted inside every closed block", () => {
      const config = {
        paths: { _comment: "note" },
        conventions: { _comment: "note" },
        tokenMapping: { _comment: "note" },
        report: { _comment: "note" },
      }
      expect(validateConfig(config)).toEqual({ valid: true, errors: [] })
    })

    it("are accepted inside `rules` without being treated as a rule id (regression, v1 issue #68)", () => {
      const config = {
        rules: {
          _comment: "this is not a rule id and must not be validated as one",
          "tokens/value-mismatch": "error",
        },
      }
      expect(validateConfig(config)).toEqual({ valid: true, errors: [] })
    })

    it("are accepted inside `exemptions` without being treated as a rule id", () => {
      const config = {
        exemptions: {
          _comment: "this is not a rule id either",
          "tokens/value-mismatch": ["color.legacy"],
        },
      }
      expect(validateConfig(config)).toEqual({ valid: true, errors: [] })
    })
  })

  describe("rules entries", () => {
    it("validates a bare-severity entry", () => {
      expect(validateConfig({ rules: { "lint/camel-case": "warn" } })).toEqual({
        valid: true,
        errors: [],
      })
    })

    it("validates a [severity, options] tuple entry", () => {
      expect(
        validateConfig({
          rules: { "component/line-budget": ["error", { maxLines: 200 }] },
        }),
      ).toEqual({ valid: true, errors: [] })
    })

    it("rejects a malformed rule entry (invalid severity)", () => {
      const { valid, errors } = validateConfig({
        rules: { "lint/camel-case": "critical" },
      })
      expect(valid).toBe(false)
      expect(errors.length).toBeGreaterThan(0)
    })

    it("rejects a rule entry that is neither a severity nor a tuple", () => {
      const { valid } = validateConfig({
        rules: { "lint/camel-case": { off: true } },
      })
      expect(valid).toBe(false)
    })
  })
})

describe("core/config — loadConfig", () => {
  function fakeFs(files) {
    return {
      existsSync: p => Object.prototype.hasOwnProperty.call(files, p),
      readFileSync: p => {
        if (!Object.prototype.hasOwnProperty.call(files, p))
          throw new Error(`ENOENT: ${p}`)
        return files[p]
      },
    }
  }

  it("throws a clear error when the file is missing", () => {
    const fs = fakeFs({})
    expect(() => loadConfig("/nowhere/config.json", { fs })).toThrow(
      /no config at \/nowhere\/config\.json/,
    )
  })

  it("throws on malformed JSON", () => {
    const fs = fakeFs({ "/proj/config.json": "{ not json" })
    expect(() => loadConfig("/proj/config.json", { fs })).toThrow(
      /invalid JSON in \/proj\/config\.json/,
    )
  })

  it("throws a humanized (not raw ajv) message on a schema violation", () => {
    const fs = fakeFs({
      "/proj/config.json": JSON.stringify({ mockupRouteMap: [] }),
    })
    let thrown
    try {
      loadConfig("/proj/config.json", { fs })
    } catch (err) {
      thrown = err
    }
    expect(thrown).toBeDefined()
    expect(thrown.message).toMatch(/invalid \/proj\/config\.json/)
    expect(thrown.message).toMatch(/unknown key 'mockupRouteMap'/)
    // Not raw ajv wording.
    expect(thrown.message).not.toMatch(/must NOT have additional properties/)
  })

  it("returns the parsed config on success", () => {
    const parsed = { paths: { tokensFile: "t.json" } }
    const fs = fakeFs({ "/proj/config.json": JSON.stringify(parsed) })
    expect(loadConfig("/proj/config.json", { fs })).toEqual(parsed)
  })
})

describe("core/config — resolve* merge behavior", () => {
  it("resolvePaths merges a partial override onto DEFAULT_PATHS", () => {
    const resolved = resolvePaths({ paths: { tokensFile: "custom.json" } })
    expect(resolved).toEqual({ ...DEFAULT_PATHS, tokensFile: "custom.json" })
  })

  it("resolvePaths returns DEFAULT_PATHS untouched when no config is given", () => {
    expect(resolvePaths({})).toEqual(DEFAULT_PATHS)
    expect(resolvePaths(undefined)).toEqual(DEFAULT_PATHS)
  })

  it("resolveConventions replaces a list key wholesale, not by splicing", () => {
    const resolved = resolveConventions({
      conventions: { groupedDirs: ["only-this-one"] },
    })
    expect(resolved.groupedDirs).toEqual(["only-this-one"])
    // Since issue #117 the engine ships no default here — the framework
    // adapter supplies it (sources/react/adapter.mjs), so `undefined` is the
    // correct resolved value when a project sets none.
    expect(resolved.nonComponentFileSuffixes).toBeUndefined()
    expect(DEFAULT_CONVENTIONS.nonComponentFileSuffixes).toBeUndefined()
  })

  it("resolveReport merges timeZone and actions independently", () => {
    const resolved = resolveReport({
      report: { timeZone: "America/New_York" },
    })
    expect(resolved).toEqual({
      timeZone: "America/New_York",
      actions: DEFAULT_REPORT.actions,
    })
  })

  it("resolveConfig returns every block, defaulted, in one call", () => {
    const resolved = resolveConfig({})
    expect(resolved).toEqual({
      paths: DEFAULT_PATHS,
      conventions: DEFAULT_CONVENTIONS,
      report: DEFAULT_REPORT,
      tokenMapping: expect.objectContaining({
        collections: {},
        codeAuthoritativeGroups: [],
      }),
      rules: {},
      // EMPTY, not defaulted: every field in the lint block is a project's own
      // vocabulary, so an absent one must leave the rule reading it silent
      // rather than supplying a starter set of names (issue #121).
      lint: {},
      exemptions: {},
    })
  })

  it("resolveConfig strips _-prefixed comment keys out of rules and exemptions", () => {
    const resolved = resolveConfig({
      rules: { _comment: "note", "lint/camel-case": "warn" },
      exemptions: { _comment: "note", "lint/camel-case": ["a.b.c"] },
    })
    expect(resolved.rules).toEqual({ "lint/camel-case": "warn" })
    expect(resolved.exemptions).toEqual({ "lint/camel-case": ["a.b.c"] })
  })
})

describe("core/config — defaults are neutral (no consumer identity)", () => {
  // ADR-001's explicit call-out: v1 leaked one consuming project's own layout into
  // engine defaults. Every default string value, anywhere in the module,
  // must not match any of these fingerprints.
  const CONSUMER_FINGERPRINT = /heroes|print|system-|chrisgriffin|app\/\(/i

  function collectStrings(value, out = []) {
    if (typeof value === "string") {
      out.push(value)
    } else if (Array.isArray(value)) {
      for (const item of value) collectStrings(item, out)
    } else if (value && typeof value === "object") {
      for (const v of Object.values(value)) collectStrings(v, out)
    }
    return out
  }

  it("DEFAULT_PATHS carries no consumer-specific value", () => {
    for (const s of collectStrings(DEFAULT_PATHS))
      expect(s).not.toMatch(CONSUMER_FINGERPRINT)
  })

  it("DEFAULT_CONVENTIONS carries no consumer-specific value", () => {
    for (const s of collectStrings(DEFAULT_CONVENTIONS))
      expect(s).not.toMatch(CONSUMER_FINGERPRINT)
  })

  it("DEFAULT_REPORT carries no consumer-specific value", () => {
    for (const s of collectStrings(DEFAULT_REPORT))
      expect(s).not.toMatch(CONSUMER_FINGERPRINT)
    // The v1-specific regression: no hardcoded America/Los_Angeles default.
    expect(DEFAULT_REPORT.timeZone).toBe("UTC")
  })

  it("DEFAULT_PATHS has no mockup/print/site directory (mockups killed, ADR-001 D9)", () => {
    const keys = Object.keys(DEFAULT_PATHS)
    expect(keys).not.toContain("siteDir")
    expect(keys).not.toContain("printDir")
    expect(keys).not.toContain("iconsDir")
    expect(keys).not.toContain("baselineFile")
    expect(keys).toContain("stateFile")
  })
})

describe("core/config — resolveRunConfig (the CLI's shared config step)", () => {
  it("a missing DEFAULT config is simply no config", () => {
    const dir = mkdtempSync(join(tmpdir(), "design-delta-rrc-"))
    const cwd = process.cwd()
    process.chdir(dir)
    try {
      expect(resolveRunConfig(undefined)).toEqual({ config: {} })
    } finally {
      process.chdir(cwd)
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it("an explicit --config that does not exist is an error", () => {
    expect(resolveRunConfig("/nowhere/design-delta.json")).toEqual({
      error: "no config at /nowhere/design-delta.json",
    })
  })

  // `--config ""` is reachable (the global-flag parser accepts an empty
  // value). Every command treats it the same way: the user NAMED a file, so
  // it is an error rather than a silent fall-through to the default.
  it("an explicit empty --config is an error, not the default", () => {
    expect(resolveRunConfig("")).toEqual({ error: "no config at " })
  })
})

describe("validateConfig — exemption decisions (#565)", () => {
  const rule = "components/binding-file-stale"
  const check = entries => validateConfig({ exemptions: { [rule]: entries } })

  it("accepts every decision kind and a bare string", () => {
    expect(
      check([
        "flex",
        { entity: "a", decision: "waived" },
        { entity: "b", decision: "tracked", issue: "o/r#1" },
        { entity: "c", decision: "accepted", reason: "by design" },
      ]),
    ).toEqual({ valid: true, errors: [] })
  })

  it("rejects a tracked decision with no issue, naming the rule and entity", () => {
    expect(check([{ entity: "header/nav", decision: "tracked" }])).toEqual({
      valid: false,
      errors: [
        `exemptions.${rule}[0] (entity "header/nav") is missing required property 'issue'`,
      ],
    })
  })

  it("rejects an unknown decision kind with the allowed list", () => {
    expect(check([{ entity: "x", decision: "maybe" }]).errors).toEqual([
      `exemptions.${rule}[0].decision must be one of: waived, tracked, accepted`,
    ])
  })
})
