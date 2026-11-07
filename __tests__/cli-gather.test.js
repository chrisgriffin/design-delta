/**
 * cli-gather.test.js — the `design-delta gather` subcommand
 * (`src/cli/commands/gather.mjs`, ADR-003 Phase 5.1), driven through
 * `main.mjs`'s `run` (matching `cli-audit.test.js`'s reasoning: the whole
 * path a consumer actually takes is under test). `gather` never touches the
 * network — every case here asserts on the PLAN it prints, never on a real
 * MCP call.
 */

import { run } from "../src/cli/main.mjs"
import {
  createSyntheticProject,
  SYNTHETIC_FILE_KEYS,
} from "./helpers/synthetic-project.mjs"

function fakeStream() {
  const writes = []
  return { stream: { write: chunk => writes.push(chunk) }, writes }
}

async function runCapture(argv) {
  const { stream: stdout, writes: stdoutWrites } = fakeStream()
  const { stream: stderr, writes: stderrWrites } = fakeStream()
  const code = await run(argv, { stdout, stderr })
  return { code, stdout: stdoutWrites.join(""), stderr: stderrWrites.join("") }
}

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

describe("design-delta gather", () => {
  it("fails with a stated reason when design.provider is unconfigured", async () => {
    await withSyntheticProject(async () => {
      const { code, stderr, stdout } = await runCapture(["gather"])
      expect(code).toBe(1)
      expect(stdout).toBe("")
      expect(stderr).toContain("no design.provider configured")
    })
  })

  it("fails with a stated reason for an unknown provider key", async () => {
    await withSyntheticProject(
      async () => {
        const { code, stderr } = await runCapture(["gather"])
        expect(code).toBe(1)
        expect(stderr).toMatch(/not a known provider/)
      },
      { design: { provider: "acme-design-tool" } },
    )
  })

  it("prints a plan naming exactly the file key(s) the loaded contracts declare", async () => {
    // The synthetic project's field/badge contracts both address
    // `fileKeys.components` (see synthetic-project.mjs) — one file key,
    // even with two contracts declaring it, since scope is the UNION.
    await withSyntheticProject(
      async () => {
        // Progress from loading contracts DOES go to stderr (D8) — the
        // invariant under test is stdout carrying ONLY the JSON plan.
        const { code, stdout } = await runCapture(["gather"])
        expect(code).toBe(0)
        const plan = JSON.parse(stdout)
        expect(plan.provider).toBe("figma")
        expect(plan.tool).toBe("list_file_components_for_code_connect")
        expect(plan.targets.map(t => t.fileKey)).toEqual([
          SYNTHETIC_FILE_KEYS.components,
        ])
      },
      { design: { provider: "figma" } },
    )
  })

  it("output path for each target lands under snapshotDir/raw", async () => {
    await withSyntheticProject(
      async project => {
        const { stdout } = await runCapture(["gather"])
        const plan = JSON.parse(stdout)
        expect(plan.targets.length).toBeGreaterThan(0)
        for (const target of plan.targets) {
          expect(target.outputPath).toBe(
            `${project.config.paths.snapshotDir}/raw/${target.fileKey}.json`,
          )
        }
      },
      { design: { provider: "figma" } },
    )
  })

  it("a project with no sources.design anywhere prints a vacuous (empty-targets) plan, not an error", async () => {
    await withSyntheticProject(
      async () => {
        const { code, stdout } = await runCapture(["gather"])
        expect(code).toBe(0)
        const plan = JSON.parse(stdout)
        expect(plan.targets).toEqual([])
      },
      {
        design: { provider: "figma" },
        components: [
          {
            name: "plain",
            tsx: "export function Plain() { return null }\n",
            contract: {
              id: "plain",
              title: "Plain",
              sources: { code: { path: "src/ui/plain/plain.tsx" } },
            },
          },
        ],
      },
    )
  })
})

describe("design-delta gather --tokens (ADR-003 Phase 5.3)", () => {
  it("fails with a stated reason when design.provider is unconfigured", async () => {
    await withSyntheticProject(async () => {
      const { code, stderr, stdout } = await runCapture(["gather", "--tokens"])
      expect(code).toBe(1)
      expect(stdout).toBe("")
      expect(stderr).toContain("no design.provider configured")
    })
  })

  it("prints the file-level plan (#380): variables + text styles per addressed FILE, never per node", async () => {
    // Field (10:20) and Badge (30:40) both address the same file key — ONE
    // file, TWO targets (the two structured tools), regardless of node count.
    await withSyntheticProject(
      async () => {
        const { code, stdout } = await runCapture(["gather", "--tokens"])
        expect(code).toBe(0)
        const plan = JSON.parse(stdout)
        expect(plan.provider).toBe("figma")
        expect(plan.tool).toBe("figma_get_variables")
        expect(plan.targets.map(t => t.tool)).toEqual([
          "figma_get_variables",
          "figma_get_text_styles",
        ])
        for (const target of plan.targets) {
          expect(target.fileKey).toBe(SYNTHETIC_FILE_KEYS.components)
          expect(target.nodeId).toBeUndefined()
        }
      },
      { design: { provider: "figma" } },
    )
  })

  it("output paths land under snapshotDir/raw, keyed by fileKey and the tool's suffix", async () => {
    await withSyntheticProject(
      async project => {
        const { stdout } = await runCapture(["gather", "--tokens"])
        const plan = JSON.parse(stdout)
        const rawDir = `${project.config.paths.snapshotDir}/raw`
        expect(plan.targets.map(t => t.outputPath)).toEqual([
          `${rawDir}/${SYNTHETIC_FILE_KEYS.components}-variables.json`,
          `${rawDir}/${SYNTHETIC_FILE_KEYS.components}-text-styles.json`,
        ])
      },
      { design: { provider: "figma" } },
    )
  })

  it("a project with no sources.design anywhere prints a vacuous (empty-targets) plan, not an error", async () => {
    await withSyntheticProject(
      async () => {
        const { code, stdout } = await runCapture(["gather"])
        expect(code).toBe(0)
        const plan = JSON.parse(stdout)
        expect(plan.targets).toEqual([])
      },
      {
        design: { provider: "figma" },
        components: [
          {
            name: "plain",
            tsx: "export function Plain() { return null }\n",
            contract: {
              id: "plain",
              title: "Plain",
              sources: { code: { path: "src/ui/plain/plain.tsx" } },
            },
          },
        ],
      },
    )
  })
})

describe("design-delta gather --tokens (ADR-003 Phase 5.3)", () => {
  it("fails with a stated reason when design.provider is unconfigured", async () => {
    await withSyntheticProject(async () => {
      const { code, stderr, stdout } = await runCapture(["gather", "--tokens"])
      expect(code).toBe(1)
      expect(stdout).toBe("")
      expect(stderr).toContain("no design.provider configured")
    })
  })

  it("a project with no sources.design anywhere prints a vacuous (empty-targets) plan, not an error", async () => {
    await withSyntheticProject(
      async () => {
        const { code, stdout } = await runCapture(["gather", "--tokens"])
        expect(code).toBe(0)
        const plan = JSON.parse(stdout)
        expect(plan.targets).toEqual([])
      },
      {
        design: { provider: "figma" },
        components: [
          {
            name: "plain",
            tsx: "export function Plain() { return null }\n",
            contract: {
              id: "plain",
              title: "Plain",
              sources: { code: { path: "src/ui/plain/plain.tsx" } },
            },
          },
        ],
      },
    )
  })
})

describe("design-delta gather --bindings (issue #401, retargeted in #417)", () => {
  it("prints one per-file bindings plan covering every addressed contract", async () => {
    await withSyntheticProject(
      async project => {
        const { code, stdout } = await runCapture([
          "--config",
          project.configPath,
          "gather",
          "--bindings",
        ])
        expect(code).toBe(0)
        const plan = JSON.parse(stdout)
        expect(plan.tool).toBe("figma_execute")
        // The synthetic project's two contracts both carry sources.design,
        // and both address the SAME file — so they gather in one call.
        expect(plan.targets).toHaveLength(1)
        const [target] = plan.targets
        expect(target.nodeIds).toHaveLength(2)
        for (const nodeId of target.nodeIds) expect(nodeId).toMatch(/^\d+:\d+$/)
        expect(target.args.code).toContain("getVariableByIdAsync")
        expect(target.outputPath).toMatch(/-bindings\.json$/)
      },
      { design: { provider: "figma" } },
    )
  })
})

describe("design.files (issue #413)", () => {
  it("a config-listed file no contract references joins both plans, deduplicated", async () => {
    await withSyntheticProject(
      async project => {
        const components = await runCapture([
          "--config",
          project.configPath,
          "gather",
        ])
        expect(components.code).toBe(0)
        const componentPlan = JSON.parse(components.stdout)
        // ACME123 comes from the contracts too — listed, but not doubled.
        expect(componentPlan.targets.map(t => t.fileKey)).toEqual([
          "ACME123",
          "EXTRA999",
        ])

        const tokens = await runCapture([
          "--config",
          project.configPath,
          "gather",
          "--tokens",
        ])
        expect(tokens.code).toBe(0)
        const tokenPlan = JSON.parse(tokens.stdout)
        expect([...new Set(tokenPlan.targets.map(t => t.fileKey))]).toEqual([
          "ACME123",
          "EXTRA999",
        ])
      },
      { design: { provider: "figma", files: ["EXTRA999", "ACME123"] } },
    )
  })
})
