/**
 * cli-movers.test.js — `design-delta movers` (`src/cli/commands/movers.mjs`),
 * roadmap #216 slice (c).
 *
 * Drives `runMovers(cmdArgv, ctx)` directly, the same testable seam
 * `cli-snapshot.test.js` uses — `runSnapshot` first writes the prior
 * `state.json` these tests then diff against.
 */

import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { runMovers } from "../src/cli/commands/movers.mjs"
import { runSnapshot } from "../src/cli/commands/snapshot.mjs"
import {
  createSyntheticProject,
  SYNTHETIC_PATHS,
} from "./helpers/synthetic-project.mjs"

function customComponents() {
  const dir = `${SYNTHETIC_PATHS.componentsDir}/button`
  return [
    {
      name: "button",
      dir: "button",
      tsx: "export type ButtonProps = { label: string }\nexport function Button({ label }: ButtonProps) { return null }\n",
      contract: {
        id: "button",
        title: "Button",
        sources: { code: { path: `${dir}/button.tsx` } },
        props: { label: { type: "string", required: true } },
      },
    },
  ]
}

function fakeStream() {
  const writes = []
  return { stream: { write: chunk => writes.push(chunk) }, writes }
}

async function runCapture(run, cmdArgv, { config } = {}) {
  const { stream: stdout, writes: stdoutWrites } = fakeStream()
  const { stream: stderr, writes: stderrWrites } = fakeStream()
  const code = await run(cmdArgv, {
    globalOpts: { config },
    io: { stdout, stderr },
    bus: undefined,
  })
  return { code, stdout: stdoutWrites.join(""), stderr: stderrWrites.join("") }
}

const snapshotCapture = (...args) => runCapture(runSnapshot, ...args)
const moversCapture = (...args) => runCapture(runMovers, ...args)

async function withSyntheticProject(fn, overrides = {}) {
  const project = createSyntheticProject({
    components: customComponents(),
    ...overrides,
  })
  const originalCwd = process.cwd()
  process.chdir(project.root)
  try {
    return await fn(project)
  } finally {
    process.chdir(originalCwd)
    project.cleanup()
  }
}

describe("design-delta movers", () => {
  it("prints a clear message and exits 0 when no state.json exists yet", async () => {
    await withSyntheticProject(async project => {
      const { code, stdout } = await moversCapture([], {
        config: project.configPath,
      })
      expect(code).toBe(0)
      expect(stdout).toBe("no prior run recorded, nothing to compare\n")
    })
  })

  it("--json reports an empty moved list and a null sinceRun with no state.json", async () => {
    await withSyntheticProject(async project => {
      const { code, stdout } = await moversCapture(["--json"], {
        config: project.configPath,
      })
      expect(code).toBe(0)
      expect(JSON.parse(stdout)).toEqual({
        command: "movers",
        moved: [],
        sinceRun: null,
      })
    })
  })

  it("does not list an entity whose code and contract are unchanged", async () => {
    await withSyntheticProject(async project => {
      await snapshotCapture([], { config: project.configPath })
      const { code, stdout } = await moversCapture(["--json"], {
        config: project.configPath,
      })
      expect(code).toBe(0)
      const payload = JSON.parse(stdout)
      expect(payload.moved).toEqual([])
      expect(typeof payload.sinceRun).toBe("string")
    })
  })

  it("lists a changed entity with the codeHash-changed reason", async () => {
    await withSyntheticProject(async project => {
      await snapshotCapture([], { config: project.configPath })

      const tsxPath = join(
        project.root,
        SYNTHETIC_PATHS.componentsDir,
        "button",
        "button.tsx",
      )
      writeFileSync(
        tsxPath,
        "export type ButtonProps = { label: string, size?: string }\nexport function Button({ label, size }: ButtonProps) { return null }\n",
      )

      const { code, stdout } = await moversCapture(["--json"], {
        config: project.configPath,
      })
      expect(code).toBe(0)
      const payload = JSON.parse(stdout)
      expect(payload.moved).toEqual([
        { kind: "component", id: "button", reason: "codeHash changed" },
      ])
    })
  })

  it("lists an entity whose design counterpart changed since the snapshot (#481)", async () => {
    const project = createSyntheticProject({ design: { provider: "figma" } })
    const originalCwd = process.cwd()
    process.chdir(project.root)
    try {
      await snapshotCapture([], { config: project.configPath })
      const snapshotPath = join(
        project.root,
        SYNTHETIC_PATHS.snapshotDir,
        "design-components.json",
      )
      const census = JSON.parse(readFileSync(snapshotPath, "utf8"))
      const field = census.components.find(c => c.name === "Field")
      field.treeHash = "synthetic-field-v2"
      writeFileSync(snapshotPath, JSON.stringify(census))

      const { code, stdout } = await moversCapture(["--json"], {
        config: project.configPath,
      })
      expect(code).toBe(0)
      expect(JSON.parse(stdout).moved).toEqual([
        { kind: "component", id: "field", reason: "designHash changed" },
      ])
    } finally {
      process.chdir(originalCwd)
      project.cleanup()
    }
  })

  it("non-JSON output names the changed entity and its reason", async () => {
    await withSyntheticProject(async project => {
      await snapshotCapture([], { config: project.configPath })

      const tsxPath = join(
        project.root,
        SYNTHETIC_PATHS.componentsDir,
        "button",
        "button.tsx",
      )
      writeFileSync(
        tsxPath,
        "export type ButtonProps = { label: string, size?: string }\nexport function Button({ label, size }: ButtonProps) { return null }\n",
      )

      const { code, stdout } = await moversCapture([], {
        config: project.configPath,
      })
      expect(code).toBe(0)
      expect(stdout).toMatch(/^1 entity changed since /)
      expect(stdout).toContain("component:button — codeHash changed")
    })
  })
})
