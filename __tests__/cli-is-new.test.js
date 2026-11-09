/**
 * cli-is-new.test.js — read-only `isNew` consumption in `audit`/`verify`
 * (issue #243, the read-only half of roadmap #216's plan).
 *
 * Drives the same synthetic project `cli-audit.test.js` does, through
 * `run(argv, {...})` — `snapshot` writes `state.json`, `audit --json` reads
 * it back. The `badge` fixture's deliberate `components/enum-values-
 * mismatch` finding (entity `"badge"`) is the one under test throughout:
 * its presence never depends on anything `state.json` does, only whether
 * it's tagged `isNew`.
 */

import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { run } from "../src/cli/main.mjs"
import {
  createSyntheticProject,
  SYNTHETIC_PATHS,
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

async function withSyntheticProject(fn, overrides = {}) {
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

function badgeFinding(payload) {
  return payload.findings.find(
    f => f.ruleId === "components/enum-values-mismatch",
  )
}

function stateAbsPath(project) {
  return join(project.root, SYNTHETIC_PATHS.stateFile)
}

describe("design-delta audit/verify — isNew consumption (issue #243)", () => {
  it("a finding present in both runs with an unchanged hash is not new", async () => {
    await withSyntheticProject(async project => {
      await runCapture(["snapshot", "--config", project.configPath])

      const { stdout } = await runCapture([
        "audit",
        "--components",
        "--json",
        "--config",
        project.configPath,
      ])
      const finding = badgeFinding(JSON.parse(stdout))
      expect(finding.isNew).toBe(false)
    })
  })

  it("a finding whose entity's code hash changed since the snapshot is new", async () => {
    await withSyntheticProject(async project => {
      await runCapture(["snapshot", "--config", project.configPath])

      const tsxPath = join(
        project.root,
        SYNTHETIC_PATHS.componentsDir,
        "badge",
        "badge.tsx",
      )
      const original = readFileSync(tsxPath, "utf8")
      writeFileSync(
        tsxPath,
        original.replace(
          `size?: "sm" | "md"`,
          `size?: "sm" | "md"\n  tone?: "neutral"`,
        ),
      )

      const { stdout } = await runCapture([
        "audit",
        "--components",
        "--json",
        "--config",
        project.configPath,
      ])
      const finding = badgeFinding(JSON.parse(stdout))
      expect(finding.isNew).toBe(true)
    })
  })

  it("an entity with no matching prior-run entry is new", async () => {
    await withSyntheticProject(async project => {
      // A schema-valid state.json with no entities at all — as if `snapshot`
      // had run before `badge`'s contract existed.
      writeFileSync(
        stateAbsPath(project),
        JSON.stringify({
          entities: {},
          lastRun: "2026-01-01T00:00:00.000Z",
        }),
      )

      const { stdout } = await runCapture([
        "audit",
        "--components",
        "--json",
        "--config",
        project.configPath,
      ])
      const finding = badgeFinding(JSON.parse(stdout))
      expect(finding.isNew).toBe(true)
    })
  })

  it("a finding with no prior state file at all is unmarked, not new and not old", async () => {
    await withSyntheticProject(async project => {
      const { stdout } = await runCapture([
        "audit",
        "--components",
        "--json",
        "--config",
        project.configPath,
      ])
      const finding = badgeFinding(JSON.parse(stdout))
      expect(finding).not.toHaveProperty("isNew")
    })
  })

  it("never writes to state.json — mtime is unchanged after audit and verify runs", async () => {
    await withSyntheticProject(async project => {
      await runCapture(["snapshot", "--config", project.configPath])
      const before = readFileSync(stateAbsPath(project))

      await runCapture([
        "audit",
        "--components",
        "--json",
        "--config",
        project.configPath,
      ])
      await runCapture(["verify", "--json", "--config", project.configPath])

      const after = readFileSync(stateAbsPath(project))
      expect(after).toEqual(before)
    })
  })

  it("a finding whose entity has no known contract id (a token finding) is unmarked", async () => {
    await withSyntheticProject(async project => {
      await runCapture(["snapshot", "--config", project.configPath])

      const { stdout } = await runCapture([
        "audit",
        "--tokens",
        "--json",
        "--config",
        project.configPath,
      ])
      const payload = JSON.parse(stdout)
      expect(payload.findings.length).toBeGreaterThan(0)
      for (const finding of payload.findings) {
        expect(finding).not.toHaveProperty("isNew")
      }
    })
  })

  it("a token finding whose entity happens to share a prefix with a real contract id stays unmarked", async () => {
    // "badge" is this fixture's real component contract id. A token
    // "badge.color.bg" resolves, by prefix, to that same id — the exact
    // collision `resolveContractId` is built to allow for legitimate
    // components/anatomy/styles entities. Gating on `finding.surface` is
    // what stops a `tokens` finding from riding that collision to a
    // component's isNew verdict it has nothing to do with.
    await withSyntheticProject(
      async project => {
        await runCapture(["snapshot", "--config", project.configPath])

        const { stdout } = await runCapture([
          "audit",
          "--json",
          "--config",
          project.configPath,
        ])
        const payload = JSON.parse(stdout)
        const tokenFinding = payload.findings.find(
          f => f.surface === "tokens" && f.entity === "badge.color.bg",
        )
        expect(tokenFinding).toBeDefined()
        expect(tokenFinding).not.toHaveProperty("isNew")
      },
      {
        tokens: {
          badge: { color: { bg: { $type: "color", $value: "#000000" } } },
        },
      },
    )
  })

  it("a coverage/stale-exemption finding — entity is a config-chosen string, not necessarily a contract id — stays unmarked", async () => {
    // "badge" already has a contract, so exempting it from
    // `coverage/uncontracted-component` matches nothing and is reported
    // stale — with `entity: "badge"`, which happens to equal the real
    // contract id exactly (not just a prefix). `coverage/contract-only` is
    // the only other rule on this surface, and IS legitimately contract-
    // scoped; `stale-exemption`'s entity space is whatever a config author
    // wrote, so the surface alone can't be the gate.
    await withSyntheticProject(
      async project => {
        await runCapture(["snapshot", "--config", project.configPath])

        const { stdout } = await runCapture([
          "audit",
          "--json",
          "--config",
          project.configPath,
        ])
        const payload = JSON.parse(stdout)
        const staleFinding = payload.findings.find(
          f => f.ruleId === "coverage/stale-exemption" && f.entity === "badge",
        )
        expect(staleFinding).toBeDefined()
        expect(staleFinding).not.toHaveProperty("isNew")
      },
      {
        exemptions: {
          "coverage/uncontracted-component": ["badge"],
        },
      },
    )
  })

  it("state.json unreadable due to invalid JSON reports a relative path, never the absolute one", async () => {
    await withSyntheticProject(async project => {
      await runCapture(["snapshot", "--config", project.configPath])
      writeFileSync(stateAbsPath(project), "{ not valid json")

      const { stdout } = await runCapture([
        "audit",
        "--components",
        "--json",
        "--config",
        project.configPath,
      ])
      const payload = JSON.parse(stdout)
      const diagnostic = payload.diagnostics.find(
        d => d.code === "state-unreadable",
      )
      expect(diagnostic).toBeDefined()
      expect(diagnostic.message).toContain("could not be parsed")
      expect(diagnostic.message).not.toContain(project.root)
      expect(diagnostic.file).toBe(SYNTHETIC_PATHS.stateFile)

      // Unreadable state degrades to "no prior run" — findings are never
      // blocked or crashed by it, just left unmarked.
      const finding = badgeFinding(payload)
      expect(finding).not.toHaveProperty("isNew")
    })
  })

  it("state.json unreadable due to a schema-invalid document reports a relative path, never the absolute one", async () => {
    await withSyntheticProject(async project => {
      await runCapture(["snapshot", "--config", project.configPath])
      // Valid JSON, but missing the schema's required `lastRun`.
      writeFileSync(stateAbsPath(project), JSON.stringify({ entities: {} }))

      const { stdout } = await runCapture([
        "audit",
        "--components",
        "--json",
        "--config",
        project.configPath,
      ])
      const payload = JSON.parse(stdout)
      const diagnostic = payload.diagnostics.find(
        d => d.code === "state-unreadable",
      )
      expect(diagnostic).toBeDefined()
      expect(diagnostic.message).not.toContain(project.root)
      expect(diagnostic.file).toBe(SYNTHETIC_PATHS.stateFile)

      const finding = badgeFinding(payload)
      expect(finding).not.toHaveProperty("isNew")
    })
  })
})
