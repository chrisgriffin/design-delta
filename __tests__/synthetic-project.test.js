/**
 * synthetic-project.test.js — Phase 0 exit criterion: "port the
 * synthetic-project fixture harness to a contract test entry" (ADR-001, Phase 0,
 * item 4). This suite proves two things about
 * `__tests__/helpers/synthetic-project.mjs`:
 *
 *   1. The harness itself works — it materializes a real project on disk,
 *      every promised file exists, its config is schema-valid, and cleanup
 *      leaves no trace.
 *   2. Config resolution is genuinely convention-agnostic — `loadConfig` +
 *      `resolvePaths`/`resolveConventions`/`resolveReport` return the
 *      SYNTHETIC values baked into the fixture, not the engine's neutral
 *      defaults, and the synthetic values themselves are asserted to differ
 *      from those defaults on every axis this harness parameterizes. That
 *      second assertion is the one that matters most: without it, a future
 *      regression that silently fell back to an engine default instead of
 *      reading the resolved config could pass this suite by coincidence.
 */
import { existsSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  DEFAULT_CONFIG_PATH,
  DEFAULT_CONVENTIONS,
  DEFAULT_PATHS,
  DEFAULT_REPORT,
  loadConfig,
  resolveConfig,
  resolveConventions,
  resolvePaths,
  resolveReport,
  validateConfig,
} from "../src/core/config.mjs"
import {
  createSyntheticProject,
  SYNTHETIC_DEFAULTS,
} from "./helpers/synthetic-project.mjs"
import {
  validateDesignComponents,
  validateDesignTokens,
} from "../src/providers/figma/normalize.mjs"

describe("synthetic-project harness — materialization", () => {
  let project

  beforeAll(() => {
    project = createSyntheticProject()
  })

  afterAll(() => {
    project.cleanup()
  })

  it("creates the project under a fresh mkdtemp dir", () => {
    expect(project.root).toContain(tmpdir())
    expect(project.root).toMatch(/design-delta-fixture-/)
    expect(existsSync(project.root)).toBe(true)
  })

  it("writes the config at the default path a real project uses", () => {
    // Pinned to the exported constant rather than a literal: the whole point
    // of `DEFAULT_CONFIG_PATH` living in `core/config.mjs` is that the four
    // subcommands and this fixture cannot drift apart on where a config lives.
    expect(project.configPath).toBe(join(project.root, DEFAULT_CONFIG_PATH))
    expect(existsSync(project.configPath)).toBe(true)
  })

  it("the default config path is a root-level file, not a nested dot-directory", () => {
    // A consuming project keeps this next to `tsconfig.json`, not buried in a
    // tooling directory (a consumer's review). Asserted
    // structurally so a well-meaning move back under `.agents/` fails here.
    expect(DEFAULT_CONFIG_PATH).toBe("design-delta.json")
    expect(DEFAULT_CONFIG_PATH).not.toMatch(/[\\/]/)
  })

  it("writes the DTCG tokens file at the synthetic tokensFile path", () => {
    expect(existsSync(project.paths.tokensFile)).toBe(true)
    const tokens = JSON.parse(readFileSync(project.paths.tokensFile, "utf8"))
    expect(tokens.acme.color.fg.$type).toBe("color")
  })

  it("writes both component dirs with a .tsx, style file, and Code Connect sidecar", () => {
    for (const name of ["field", "badge"]) {
      const paths = project.paths.components[name]
      expect(existsSync(paths.dir)).toBe(true)
      expect(existsSync(paths.tsx)).toBe(true)
      expect(existsSync(paths.styles)).toBe(true)
      expect(existsSync(paths.codeConnect)).toBe(true)
      expect(paths.tsx.endsWith(`${name}.tsx`)).toBe(true)
      expect(paths.styles.endsWith(`${name}.styles.scss`)).toBe(true)
      expect(paths.codeConnect.endsWith(`${name}.cc.tsx`)).toBe(true)
    }
  })

  it("writes each component's contract under the synthetic contractsDir, flat", () => {
    for (const name of ["field", "badge"]) {
      const contractPath = project.paths.components[name].contract
      expect(contractPath).toBe(
        join(project.paths.contractsDir, `${name}.spec.json`),
      )
      expect(existsSync(contractPath)).toBe(true)
      const text = readFileSync(contractPath, "utf8")
      expect(JSON.parse(text).id).toBe(name)
    }
  })

  it("emits contracts that actually validate against schema/contract.schema.json", async () => {
    // The harness is the fixture every Phase 2 checker drives off. A contract
    // it emits that the real loader rejects would make those checkers
    // untestable — and the failure would surface as a confusing checker bug
    // rather than a fixture one. Pin it here, where the cause is obvious.
    const { loadContract } = await import("../src/spec/contracts.mjs")
    for (const name of ["field", "badge"]) {
      const file = join(project.paths.contractsDir, `${name}.spec.json`)
      const result = loadContract(file)
      expect(result.diagnostics).toEqual([])
      expect(result.ok).toBe(true)
    }
  })

  it("writes the design-tokens.json / design-components.json snapshot pair under snapshotDir (D7)", () => {
    expect(project.paths.designTokensFile).toBe(
      join(project.paths.snapshotDir, "design-tokens.json"),
    )
    expect(project.paths.designComponentsFile).toBe(
      join(project.paths.snapshotDir, "design-components.json"),
    )
    expect(existsSync(project.paths.designTokensFile)).toBe(true)
    expect(existsSync(project.paths.designComponentsFile)).toBe(true)

    const designTokens = JSON.parse(
      readFileSync(project.paths.designTokensFile, "utf8"),
    )
    expect(designTokens.tokens).toHaveLength(2)
    // Proves the fixture stays honest against the real schema (ADR-003
    // Phase 5.3), not just the shape this test happens to assert on.
    expect(validateDesignTokens(designTokens)).toEqual({
      valid: true,
      errors: [],
    })

    const designComponents = JSON.parse(
      readFileSync(project.paths.designComponentsFile, "utf8"),
    )
    expect(designComponents.components.map(c => c.name).sort()).toEqual([
      "Badge",
      "Field",
    ])
    // Proves the fixture stays honest against the real schema (ADR-003
    // Phase 5.1), not just the shape this test happens to assert on.
    expect(validateDesignComponents(designComponents)).toEqual({
      valid: true,
      errors: [],
    })
  })

  it("creates an empty reportDir (an output location, not a promised file)", () => {
    expect(existsSync(project.paths.reportDir)).toBe(true)
  })

  it("does NOT pre-write stateFile (a fresh project has no prior run)", () => {
    expect(existsSync(project.paths.stateFile)).toBe(false)
  })

  it("config.json passes validateConfig", () => {
    const onDisk = JSON.parse(readFileSync(project.configPath, "utf8"))
    expect(onDisk).toEqual(project.config)
    expect(validateConfig(onDisk)).toEqual({ valid: true, errors: [] })
  })
})

describe("synthetic-project harness — config resolution is convention-agnostic", () => {
  let project

  beforeAll(() => {
    project = createSyntheticProject()
  })

  afterAll(() => {
    project.cleanup()
  })

  it("loadConfig + resolvePaths returns the harness's synthetic paths, not DEFAULT_PATHS", () => {
    const loaded = loadConfig(project.configPath)
    const paths = resolvePaths(loaded)
    for (const key of Object.keys(SYNTHETIC_DEFAULTS.paths)) {
      // `toEqual`, not `toBe`, for the same reason the conventions case below
      // documents: `paths.styleRoots` is array-valued (issue #123) and is
      // rebuilt by `resolvePaths`'s merge, so it is never the SAME instance
      // even when its contents match exactly.
      expect(paths[key]).toEqual(SYNTHETIC_DEFAULTS.paths[key])
      expect(paths[key]).not.toEqual(DEFAULT_PATHS[key])
    }
  })

  it("loadConfig + resolveConventions returns the harness's synthetic conventions, not DEFAULT_CONVENTIONS", () => {
    const loaded = loadConfig(project.configPath)
    const conventions = resolveConventions(loaded)
    for (const key of Object.keys(SYNTHETIC_DEFAULTS.conventions)) {
      // `toEqual` (value equality) rather than `toBe` (reference equality):
      // an array-valued convention (`nonComponentFileSuffixes`, added Phase 1
      // issue #98) is rebuilt by `resolveConventions`'s merge, so it is never
      // the SAME array instance even when its contents match exactly.
      expect(conventions[key]).toEqual(SYNTHETIC_DEFAULTS.conventions[key])
      expect(conventions[key]).not.toEqual(DEFAULT_CONVENTIONS[key])
    }
  })

  it("loadConfig + resolveReport returns the harness's synthetic timeZone, not DEFAULT_REPORT", () => {
    const loaded = loadConfig(project.configPath)
    const report = resolveReport(loaded)
    expect(report.timeZone).toBe(SYNTHETIC_DEFAULTS.report.timeZone)
    expect(report.timeZone).not.toBe(DEFAULT_REPORT.timeZone)
  })

  it("resolveConfig resolves every block in one call to the synthetic values", () => {
    const loaded = loadConfig(project.configPath)
    const resolved = resolveConfig(loaded)
    expect(resolved.paths).toEqual(SYNTHETIC_DEFAULTS.paths)
    expect(resolved.conventions).toEqual({
      ...DEFAULT_CONVENTIONS,
      ...SYNTHETIC_DEFAULTS.conventions,
    })
    expect(resolved.report).toEqual({
      ...DEFAULT_REPORT,
      ...SYNTHETIC_DEFAULTS.report,
    })
  })
})

describe("synthetic-project harness — the anti-hardcoding guard", () => {
  // Without this test, the two describes above could pass by coincidence if
  // a future edit made a synthetic value equal an engine default again — the
  // resolution would still "match the fixture," it just wouldn't be proving
  // anything. This asserts the fixture itself never regresses to that state,
  // for every axis it parameterizes.
  it("every synthetic path axis differs from DEFAULT_PATHS", () => {
    for (const key of Object.keys(SYNTHETIC_DEFAULTS.paths)) {
      expect(SYNTHETIC_DEFAULTS.paths[key]).not.toBe(DEFAULT_PATHS[key])
    }
  })

  it("every synthetic convention axis differs from DEFAULT_CONVENTIONS", () => {
    for (const key of Object.keys(SYNTHETIC_DEFAULTS.conventions)) {
      expect(SYNTHETIC_DEFAULTS.conventions[key]).not.toBe(
        DEFAULT_CONVENTIONS[key],
      )
    }
  })

  it("the synthetic timeZone differs from DEFAULT_REPORT.timeZone", () => {
    expect(SYNTHETIC_DEFAULTS.report.timeZone).not.toBe(DEFAULT_REPORT.timeZone)
  })

  it("never reuses a real design system's conventions (components/, --system-, .module.scss, .figma.tsx, app/(site))", () => {
    const serialized = JSON.stringify(SYNTHETIC_DEFAULTS)
    expect(serialized).not.toMatch(/"components\//)
    expect(serialized).not.toMatch(/--system-/)
    expect(serialized).not.toMatch(/\.module\.scss/)
    expect(serialized).not.toMatch(/\.figma\.tsx/)
    expect(serialized).not.toMatch(/app\/\(site\)/)
  })
})

describe("synthetic-project harness — overrides deep-merge", () => {
  it("a partial paths override merges onto the synthetic defaults, leaving siblings untouched", () => {
    const project = createSyntheticProject({
      paths: { componentsDir: "packages/ui" },
    })
    try {
      expect(project.config.paths.componentsDir).toBe("packages/ui")
      expect(project.config.paths.reportDir).toBe(
        SYNTHETIC_DEFAULTS.paths.reportDir,
      )
      expect(project.config.paths.snapshotDir).toBe(
        SYNTHETIC_DEFAULTS.paths.snapshotDir,
      )
      expect(existsSync(join(project.root, "packages/ui/field"))).toBe(true)
    } finally {
      project.cleanup()
    }
  })

  it("a conventions override (cssVarPrefix) flows into the generated component content", () => {
    const project = createSyntheticProject({
      conventions: { cssVarPrefix: "--widget-" },
    })
    try {
      expect(project.config.conventions.cssVarPrefix).toBe("--widget-")
      // stylesSuffix/codeConnectSuffix/contractSuffix are untouched siblings.
      expect(project.config.conventions.stylesSuffix).toBe(
        SYNTHETIC_DEFAULTS.conventions.stylesSuffix,
      )
      const styles = readFileSync(project.paths.components.field.styles, "utf8")
      expect(styles).toMatch(/--widget-color-fg/)
      expect(styles).not.toMatch(/--acme-/)
    } finally {
      project.cleanup()
    }
  })

  it("a report override merges timeZone independently of other report keys", () => {
    const project = createSyntheticProject({
      report: { timeZone: "Pacific/Auckland" },
    })
    try {
      expect(project.config.report).toEqual({ timeZone: "Pacific/Auckland" })
    } finally {
      project.cleanup()
    }
  })

  it("a fully custom `components` array replaces the default two components wholesale", () => {
    const project = createSyntheticProject({
      components: [
        {
          name: "callout",
          tsx: "export function Callout() { return null }\n",
          styles: ".acmeCallout { color: var(--acme-color-fg); }\n",
        },
      ],
    })
    try {
      expect(Object.keys(project.paths.components)).toEqual(["callout"])
      expect(existsSync(project.paths.components.callout.tsx)).toBe(true)
      // No Code Connect sidecar was supplied for this override, so none is
      // written — the writer does not invent content the override omitted.
      expect(project.paths.components.callout.codeConnect).toBeNull()
    } finally {
      project.cleanup()
    }
  })

  it("throws (and cleans up) when an override assembles an invalid config", () => {
    expect(() =>
      createSyntheticProject({ paths: { notARealKey: "x" } }),
    ).toThrow(/invalid config/)
  })
})

describe("synthetic-project harness — cleanup", () => {
  it("removes the temp dir entirely", () => {
    const project = createSyntheticProject()
    expect(existsSync(project.root)).toBe(true)
    project.cleanup()
    expect(existsSync(project.root)).toBe(false)
  })

  it("is safe to call twice", () => {
    const project = createSyntheticProject()
    project.cleanup()
    expect(() => project.cleanup()).not.toThrow()
  })
})

describe("synthetic-project harness — determinism", () => {
  it("two separate builds produce byte-identical fixture content (mkdtemp suffix aside)", () => {
    const a = createSyntheticProject()
    const b = createSyntheticProject()
    try {
      expect(readFileSync(a.configPath, "utf8")).toBe(
        readFileSync(b.configPath, "utf8"),
      )
      expect(readFileSync(a.paths.tokensFile, "utf8")).toBe(
        readFileSync(b.paths.tokensFile, "utf8"),
      )
      for (const name of ["field", "badge"]) {
        expect(readFileSync(a.paths.components[name].tsx, "utf8")).toBe(
          readFileSync(b.paths.components[name].tsx, "utf8"),
        )
        expect(readFileSync(a.paths.components[name].contract, "utf8")).toBe(
          readFileSync(b.paths.components[name].contract, "utf8"),
        )
      }
      expect(readFileSync(a.paths.designTokensFile, "utf8")).toBe(
        readFileSync(b.paths.designTokensFile, "utf8"),
      )
      expect(readFileSync(a.paths.designComponentsFile, "utf8")).toBe(
        readFileSync(b.paths.designComponentsFile, "utf8"),
      )
    } finally {
      a.cleanup()
      b.cleanup()
    }
  })
})
