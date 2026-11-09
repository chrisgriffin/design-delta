/**
 * cli-snapshot.test.js — `design-delta snapshot` (`src/cli/commands/snapshot.mjs`),
 * roadmap #216 slice (a).
 *
 * Drives `runSnapshot(cmdArgv, ctx)` directly, the same testable seam every
 * other subcommand test uses. `withSyntheticProject`/`runCapture` mirror
 * `cli-codegen.test.js`'s harness.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { runSnapshot } from "../src/cli/commands/snapshot.mjs"
import { validateState } from "../src/core/state.mjs"
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
    {
      name: "orphan",
      dir: "orphan",
      tsx: "export function Orphan() { return null }\n",
      contract: {
        id: "orphan",
        title: "Orphan",
        // Deliberately no `sources` — nothing to hash against.
        props: {},
      },
    },
  ]
}

function fakeStream() {
  const writes = []
  return { stream: { write: chunk => writes.push(chunk) }, writes }
}

async function runCapture(cmdArgv, { config } = {}) {
  const { stream: stdout, writes: stdoutWrites } = fakeStream()
  const { stream: stderr, writes: stderrWrites } = fakeStream()
  const code = await runSnapshot(cmdArgv, {
    globalOpts: { config },
    io: { stdout, stderr },
    bus: undefined,
  })
  return { code, stdout: stdoutWrites.join(""), stderr: stderrWrites.join("") }
}

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

function readState(project) {
  const path = join(project.root, SYNTHETIC_PATHS.stateFile)
  return JSON.parse(readFileSync(path, "utf8"))
}

describe("design-delta snapshot", () => {
  it("writes a schema-valid state.json with one entity per contracted, readable component", async () => {
    await withSyntheticProject(async project => {
      const { code, stdout } = await runCapture([], {
        config: project.configPath,
      })
      expect(code).toBe(0)
      expect(stdout).toMatch(/wrote .*state\.json/)

      const state = readState(project)
      expect(validateState(state)).toEqual({ valid: true, errors: [] })

      expect(Object.keys(state.entities)).toEqual(["component:button"])
      const entry = state.entities["component:button"]
      expect(typeof entry.codeHash).toBe("string")
      expect(typeof entry.specHash).toBe("string")
      expect(typeof entry.lastSeen).toBe("string")
      // No design provider here — the key is omitted, never a placeholder.
      expect(entry.designHash).toBeUndefined()
    })
  })

  it("skips an orphan contract (no sources.code.path) rather than guessing", async () => {
    await withSyntheticProject(async project => {
      const { code, stdout } = await runCapture(["--json"], {
        config: project.configPath,
      })
      expect(code).toBe(0)
      const payload = JSON.parse(stdout)
      expect(payload.counts).toEqual({ entities: 1, skipped: 1 })
      expect(payload.skipped).toEqual([
        { id: "orphan", reason: "no sources.code.path" },
      ])
    })
  })

  it("produces the identical codeHash/specHash across two runs with no changes", async () => {
    await withSyntheticProject(async project => {
      await runCapture([], { config: project.configPath })
      const first = readState(project).entities["component:button"]

      await runCapture([], { config: project.configPath })
      const second = readState(project).entities["component:button"]

      expect(second.codeHash).toBe(first.codeHash)
      expect(second.specHash).toBe(first.specHash)
    })
  })

  it("changes ONLY the affected entity's codeHash when its props change", async () => {
    await withSyntheticProject(async project => {
      await runCapture([], { config: project.configPath })
      const before = readState(project).entities["component:button"]

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

      await runCapture([], { config: project.configPath })
      const after = readState(project).entities["component:button"]

      expect(after.codeHash).not.toBe(before.codeHash)
      // The contract on disk didn't change — only the code did.
      expect(after.specHash).toBe(before.specHash)
    })
  })

  it("writes designHash from the design census's treeHash for a contract whose sources.design resolves (#481)", async () => {
    // The default synthetic components (field, badge) address the default
    // design snapshot, whose entries carry `synthetic-field-v1` /
    // `synthetic-badge-v1` as treeHash.
    const project = createSyntheticProject({ design: { provider: "figma" } })
    const originalCwd = process.cwd()
    process.chdir(project.root)
    try {
      const { code } = await runCapture([], { config: project.configPath })
      expect(code).toBe(0)
      const state = readState(project)
      expect(validateState(state)).toEqual({ valid: true, errors: [] })
      expect(state.entities["component:field"].designHash).toBe(
        "synthetic-field-v1",
      )
      expect(state.entities["component:badge"].designHash).toBe(
        "synthetic-badge-v1",
      )
    } finally {
      process.chdir(originalCwd)
      project.cleanup()
    }
  })

  it("a present but invalid design census is said out loud, never silently 'no designHash' (#481)", async () => {
    const project = createSyntheticProject({ design: { provider: "figma" } })
    const originalCwd = process.cwd()
    process.chdir(project.root)
    try {
      writeFileSync(
        join(
          project.root,
          SYNTHETIC_PATHS.snapshotDir,
          "design-components.json",
        ),
        JSON.stringify({ components: [{ name: "no address at all" }] }),
      )
      const { code, stdout, stderr } = await runCapture(["--json"], {
        config: project.configPath,
      })
      expect(code).toBe(0)
      expect(stderr).toMatch(
        /designHash not recorded — .*failed schema validation/,
      )
      expect(JSON.parse(stdout).designSkipped).toMatch(
        /failed schema validation/,
      )
      const state = readState(project)
      expect(state.entities["component:field"].designHash).toBeUndefined()
    } finally {
      process.chdir(originalCwd)
      project.cleanup()
    }
  })

  it("never writes to any other command's surface — audit/verify files are untouched", async () => {
    await withSyntheticProject(async project => {
      const stateAbs = join(project.root, SYNTHETIC_PATHS.stateFile)
      expect(existsSync(stateAbs)).toBe(false)
      await runCapture([], { config: project.configPath })
      expect(existsSync(stateAbs)).toBe(true)
    })
  })
})
