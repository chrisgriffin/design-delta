/**
 * cli-ingest.test.js — the `design-delta ingest <raw...>` subcommand
 * (`src/cli/commands/ingest.mjs`, ADR-003 Phase 5.1), driven through
 * `main.mjs`'s `run`. Raw envelope fixtures use the CONFIRMED-LIVE
 * `list_file_components_for_code_connect` shape (see
 * `providers-figma-normalize.test.js`'s docblock).
 */

import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { run } from "../src/cli/main.mjs"
import { createSyntheticProject } from "./helpers/synthetic-project.mjs"

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

const RAW_ENVELOPE = {
  provider: "figma",
  providerVersion: "1",
  planHash: "test-plan-hash",
  fileKey: "ACME123",
  gatheredAt: "2026-08-18T00:00:00.000Z",
  payload: [
    {
      name: "Eyebrow",
      nodeId: "41:250",
      type: "COMPONENT_SET",
      pageId: "1:37",
      pageName: "Eyebrow",
      hasVariants: true,
      properties: {
        size: {
          name: "size",
          type: "VARIANT",
          key: "size",
          variantOptions: ["lg", "sm"],
          defaultValue: "lg",
        },
      },
      childInstanceTags: [],
      instanceCount: 0,
      dependencies: [],
      assetKey: "x",
    },
  ],
}

function writeRawFile(project, name, content) {
  const path = join(project.root, name)
  writeFileSync(path, JSON.stringify(content))
  return name
}

describe("design-delta ingest", () => {
  it("fails with a stated reason when no raw files are given", async () => {
    await withSyntheticProject(
      async () => {
        const { code, stderr } = await runCapture(["ingest"])
        expect(code).toBe(1)
        expect(stderr).toContain("no raw file(s) given")
      },
      { design: { provider: "figma" } },
    )
  })

  it("fails with a stated reason when design.provider is unconfigured", async () => {
    await withSyntheticProject(async project => {
      const rawPath = writeRawFile(project, "raw.json", RAW_ENVELOPE)
      const { code, stderr } = await runCapture(["ingest", rawPath])
      expect(code).toBe(1)
      expect(stderr).toContain("no design.provider configured")
    })
  })

  it("writes a schema-valid design-components.json from one raw file", async () => {
    await withSyntheticProject(
      async project => {
        const rawPath = writeRawFile(project, "raw.json", RAW_ENVELOPE)
        const { code, stdout } = await runCapture(["ingest", rawPath, "--json"])
        expect(code).toBe(0)
        const result = JSON.parse(stdout)
        // The fixture census carries `usedVars` on two addresses this raw
        // file doesn't census, so the issue-#418 guard reports both as
        // dropped rather than taking them silently — see its own describe
        // block below.
        expect(result.counts).toEqual({
          components: 1,
          filesIngested: 1,
          bindingsCarriedForward: 0,
          bindingsDropped: 2,
          skipped: 1,
        })

        const snapshot = JSON.parse(
          readFileSync(
            join(
              project.root,
              project.config.paths.snapshotDir,
              "design-components.json",
            ),
            "utf8",
          ),
        )
        expect(snapshot.components).toEqual([
          expect.objectContaining({
            fileKey: "ACME123",
            nodeId: "41:250",
            name: "Eyebrow",
            type: "COMPONENT_SET",
            variantProperties: { size: ["lg", "sm"] },
          }),
        ])
      },
      { design: { provider: "figma" } },
    )
  })

  it("combines multiple raw files, sorted deterministically regardless of argument order", async () => {
    await withSyntheticProject(
      async project => {
        const envelopeB = {
          ...RAW_ENVELOPE,
          fileKey: "BBBB",
          payload: [
            { ...RAW_ENVELOPE.payload[0], nodeId: "1:1", name: "Zeta" },
          ],
        }
        const pathA = writeRawFile(project, "a.json", RAW_ENVELOPE)
        const pathB = writeRawFile(project, "b.json", envelopeB)

        await runCapture(["ingest", pathB, pathA])
        const first = readFileSync(
          join(
            project.root,
            project.config.paths.snapshotDir,
            "design-components.json",
          ),
          "utf8",
        )

        await runCapture(["ingest", pathA, pathB])
        const second = readFileSync(
          join(
            project.root,
            project.config.paths.snapshotDir,
            "design-components.json",
          ),
          "utf8",
        )

        expect(first).toBe(second)
        const snapshot = JSON.parse(first)
        expect(snapshot.components.map(c => c.fileKey)).toEqual([
          "ACME123",
          "BBBB",
        ])
      },
      { design: { provider: "figma" } },
    )
  })

  it("skips a malformed raw file with a stated reason, still ingesting the rest", async () => {
    await withSyntheticProject(
      async project => {
        mkdirSync(join(project.root, "raw"), { recursive: true })
        writeFileSync(join(project.root, "raw", "bad.json"), "{ not json")
        const goodPath = writeRawFile(project, "good.json", RAW_ENVELOPE)

        const { code, stdout } = await runCapture([
          "ingest",
          "raw/bad.json",
          goodPath,
          "--json",
        ])
        expect(code).toBe(0)
        const result = JSON.parse(stdout)
        expect(result.counts.components).toBe(1)
        // Two: the unreadable raw file, plus the fixture census's dropped
        // `usedVars` records (issue #418's guard, exercised properly below).
        expect(result.counts.skipped).toBe(2)
        // The unreadable file was never actually ingested — filesIngested
        // counts what was READ, not how many paths were given.
        expect(result.counts.filesIngested).toBe(1)
        expect(result.skipped[0].file).toBe("raw/bad.json")
      },
      { design: { provider: "figma" } },
    )
  })

  it("a raw file whose payload isn't the provider's expected shape is skipped with a reason, never a silent empty census", async () => {
    // The bug this guards: a payload the provider doesn't recognize used to
    // produce 0 components, 0 skipped, exit 0 — "checked, nothing there" —
    // which then made every addressed contract read as coverage/design-
    // missing with no diagnostic anywhere explaining why.
    await withSyntheticProject(
      async project => {
        const badShapePath = writeRawFile(project, "bad-shape.json", {
          ...RAW_ENVELOPE,
          payload: { not: "the expected array shape" },
        })

        const { code, stdout } = await runCapture([
          "ingest",
          badShapePath,
          "--json",
        ])
        expect(code).toBe(0)
        const result = JSON.parse(stdout)
        expect(result.counts.components).toBe(0)
        expect(result.counts.filesIngested).toBe(0)
        // The second entry is issue #418's dropped-`usedVars` report for the
        // fixture census, not a second reading of this raw file.
        expect(result.counts.skipped).toBe(2)
        expect(result.skipped[0]).toEqual(
          expect.objectContaining({
            file: badShapePath,
            reason: expect.stringMatching(/does not match this provider/),
          }),
        )
      },
      { design: { provider: "figma" } },
    )
  })

  it("ingest run twice on the same raw file produces a byte-identical snapshot", async () => {
    await withSyntheticProject(
      async project => {
        const rawPath = writeRawFile(project, "raw.json", RAW_ENVELOPE)
        await runCapture(["ingest", rawPath])
        const first = readFileSync(
          join(
            project.root,
            project.config.paths.snapshotDir,
            "design-components.json",
          ),
          "utf8",
        )
        await runCapture(["ingest", rawPath])
        const second = readFileSync(
          join(
            project.root,
            project.config.paths.snapshotDir,
            "design-components.json",
          ),
          "utf8",
        )
        expect(first).toBe(second)
      },
      { design: { provider: "figma" } },
    )
  })
})

const RAW_TOKEN_ENVELOPE = {
  provider: "figma",
  providerVersion: "1",
  planHash: "test-plan-hash",
  fileKey: "ACME123",
  nodeId: "1:1",
  gatheredAt: "2026-08-18T00:00:00.000Z",
  payload: { "fg/default": "#181818", "inset/md": "16" },
}

function readSnapshot(project, file) {
  return readFileSync(
    join(project.root, project.config.paths.snapshotDir, file),
    "utf8",
  )
}

describe("design-delta ingest --tokens (ADR-003 Phase 5.3)", () => {
  it("fails with a stated reason when design.provider is unconfigured", async () => {
    await withSyntheticProject(async project => {
      const rawPath = writeRawFile(project, "raw.json", RAW_TOKEN_ENVELOPE)
      const { code, stderr } = await runCapture(["ingest", "--tokens", rawPath])
      expect(code).toBe(1)
      expect(stderr).toContain("no design.provider configured")
    })
  })

  it("writes a schema-valid design-tokens.json from one raw file", async () => {
    await withSyntheticProject(
      async project => {
        const rawPath = writeRawFile(project, "raw.json", RAW_TOKEN_ENVELOPE)
        const { code, stdout } = await runCapture([
          "ingest",
          "--tokens",
          rawPath,
          "--json",
        ])
        expect(code).toBe(0)
        const result = JSON.parse(stdout)
        expect(result.counts).toEqual({
          tokens: 2,
          filesIngested: 1,
          skipped: 0,
        })

        const snapshot = JSON.parse(readSnapshot(project, "design-tokens.json"))
        expect(snapshot.tokens).toEqual([
          { name: "fg/default", kind: "variable", value: "#181818" },
          { name: "inset/md", kind: "variable", value: "16" },
        ])
      },
      { design: { provider: "figma" } },
    )
  })

  it("never persists an empty-valued entry, and says how many it dropped (issue #347)", async () => {
    await withSyntheticProject(
      async project => {
        const rawPath = writeRawFile(project, "raw.json", {
          ...RAW_TOKEN_ENVELOPE,
          payload: {
            "fg/default": "#181818",
            "gradient/rainbow/default/dark": "",
          },
        })
        const { code, stdout } = await runCapture([
          "ingest",
          "--tokens",
          rawPath,
          "--json",
        ])
        expect(code).toBe(0)
        const result = JSON.parse(stdout)
        expect(result.counts.tokens).toBe(1)
        expect(result.counts.skipped).toBe(1)
        // Dropped, but never silently: the reason names the gap.
        expect(result.skipped[0].reason).toMatch(/1 raw entr/)

        const snapshot = JSON.parse(readSnapshot(project, "design-tokens.json"))
        expect(snapshot.tokens).toEqual([
          { name: "fg/default", kind: "variable", value: "#181818" },
        ])
      },
      { design: { provider: "figma" } },
    )
  })

  it("combines multiple raw files, deduplicating a shared name and sorting deterministically regardless of argument order", async () => {
    await withSyntheticProject(
      async project => {
        // "fg/default" appears in BOTH nodes (typical — the same variable is
        // bound in many components' trees); the second file also contributes
        // a genuinely new name.
        const envelopeB = {
          ...RAW_TOKEN_ENVELOPE,
          nodeId: "2:2",
          payload: { "fg/default": "#181818", "radius/full": "1600" },
        }
        const pathA = writeRawFile(project, "a.json", RAW_TOKEN_ENVELOPE)
        const pathB = writeRawFile(project, "b.json", envelopeB)

        await runCapture(["ingest", "--tokens", pathB, pathA])
        const first = readSnapshot(project, "design-tokens.json")

        await runCapture(["ingest", "--tokens", pathA, pathB])
        const second = readSnapshot(project, "design-tokens.json")

        expect(first).toBe(second)
        const snapshot = JSON.parse(first)
        expect(snapshot.tokens).toEqual([
          { name: "fg/default", kind: "variable", value: "#181818" },
          { name: "inset/md", kind: "variable", value: "16" },
          { name: "radius/full", kind: "variable", value: "1600" },
        ])
      },
      { design: { provider: "figma" } },
    )
  })

  it("skips a malformed raw file with a stated reason, still ingesting the rest", async () => {
    await withSyntheticProject(
      async project => {
        mkdirSync(join(project.root, "raw"), { recursive: true })
        writeFileSync(join(project.root, "raw", "bad.json"), "{ not json")
        const goodPath = writeRawFile(project, "good.json", RAW_TOKEN_ENVELOPE)

        const { code, stdout } = await runCapture([
          "ingest",
          "--tokens",
          "raw/bad.json",
          goodPath,
          "--json",
        ])
        expect(code).toBe(0)
        const result = JSON.parse(stdout)
        expect(result.counts.tokens).toBe(2)
        expect(result.counts.skipped).toBe(1)
        expect(result.counts.filesIngested).toBe(1)
        expect(result.skipped[0].file).toBe("raw/bad.json")
      },
      { design: { provider: "figma" } },
    )
  })

  it("a raw envelope missing nodeId is skipped with a reason — it cannot have come from gather --tokens' plan", async () => {
    await withSyntheticProject(
      async project => {
        const { nodeId, ...withoutNodeId } = RAW_TOKEN_ENVELOPE
        const rawPath = writeRawFile(project, "raw.json", withoutNodeId)
        const { code, stdout } = await runCapture([
          "ingest",
          "--tokens",
          rawPath,
          "--json",
        ])
        expect(code).toBe(0)
        const result = JSON.parse(stdout)
        expect(result.counts.tokens).toBe(0)
        expect(result.counts.skipped).toBe(1)
        expect(result.skipped[0].reason).toMatch(/TOKEN envelope shape/)
      },
      { design: { provider: "figma" } },
    )
  })

  it("a raw file whose payload isn't the provider's expected shape is skipped with a reason, never a silent empty census", async () => {
    await withSyntheticProject(
      async project => {
        const badShapePath = writeRawFile(project, "bad-shape.json", {
          ...RAW_TOKEN_ENVELOPE,
          payload: ["not", "a", "flat", "object"],
        })

        const { code, stdout } = await runCapture([
          "ingest",
          "--tokens",
          badShapePath,
          "--json",
        ])
        expect(code).toBe(0)
        const result = JSON.parse(stdout)
        expect(result.counts.tokens).toBe(0)
        expect(result.counts.filesIngested).toBe(0)
        expect(result.counts.skipped).toBe(1)
        expect(result.skipped).toEqual([
          expect.objectContaining({
            file: badShapePath,
            reason: expect.stringMatching(/does not match this provider/),
          }),
        ])
      },
      { design: { provider: "figma" } },
    )
  })

  it("ingest --tokens run twice on the same raw file produces a byte-identical snapshot", async () => {
    await withSyntheticProject(
      async project => {
        const rawPath = writeRawFile(project, "raw.json", RAW_TOKEN_ENVELOPE)
        await runCapture(["ingest", "--tokens", rawPath])
        const first = readSnapshot(project, "design-tokens.json")
        await runCapture(["ingest", "--tokens", rawPath])
        const second = readSnapshot(project, "design-tokens.json")
        expect(first).toBe(second)
      },
      { design: { provider: "figma" } },
    )
  })

  it("writes design-tokens.json and design-components.json to two separate files, not conflicting", async () => {
    await withSyntheticProject(
      async project => {
        await runCapture([
          "ingest",
          writeRawFile(project, "c.json", RAW_ENVELOPE),
        ])
        await runCapture([
          "ingest",
          "--tokens",
          writeRawFile(project, "t.json", RAW_TOKEN_ENVELOPE),
        ])
        const components = JSON.parse(
          readSnapshot(project, "design-components.json"),
        )
        const tokens = JSON.parse(readSnapshot(project, "design-tokens.json"))
        expect(components.components).toHaveLength(1)
        expect(tokens.tokens).toHaveLength(2)
      },
      { design: { provider: "figma" } },
    )
  })
})

// ---------------------------------------------------------------------------
// Issue #389 — provenance: the snapshot says when it was gathered.

// The engine stamps its own version (issue #458) — read from package.json
// here the same way the CLI reads it, so the test never hardcodes a number.
const ENGINE_VERSION = JSON.parse(
  readFileSync(join(process.cwd(), "package.json"), "utf8"),
).version

describe("design-delta ingest --tokens — a color alias with a bound opacity (#517)", () => {
  // The live Figma shape: the pair's two halves alias variables in ANOTHER
  // gathered file, and the tool resolves the pair to null, so a per-file
  // census can never resolve it — ingest indexes every payload first.
  const WEB = {
    ...RAW_TOKEN_ENVELOPE,
    fileKey: "WEB123",
    tool: "figma_get_variables",
    payload: {
      data: {
        variables: [
          {
            id: "VariableID:503:3",
            name: "bg/scrim/default",
            key: "d7a2",
            resolvedType: "COLOR",
            valuesByMode: {
              "1:0": {
                color: {
                  type: "VARIABLE_ALIAS",
                  id: "VariableID:84b5/3312:466",
                },
                opacity: { type: "VARIABLE_ALIAS", id: "VariableID:1034:2901" },
              },
            },
            resolvedValuesByMode: { dark: { value: null } },
            variableCollectionId: "VariableCollectionId:1:2",
          },
          {
            id: "VariableID:1034:2901",
            name: "opacity/scrim",
            key: "09be",
            resolvedType: "FLOAT",
            valuesByMode: {
              "440:2": {
                type: "VARIABLE_ALIAS",
                id: "VariableID:82ca/3263:143",
              },
            },
            variableCollectionId: "VariableCollectionId:440:10",
          },
        ],
        variableCollections: [
          {
            id: "VariableCollectionId:1:2",
            name: "theme",
            defaultModeId: "1:0",
            modes: [{ modeId: "1:0", name: "dark" }],
          },
          {
            id: "VariableCollectionId:440:10",
            name: "static",
            defaultModeId: "440:2",
            modes: [{ modeId: "440:2", name: "Mode 1" }],
          },
        ],
      },
    },
  }

  const GLOBAL = {
    ...RAW_TOKEN_ENVELOPE,
    fileKey: "GLOBAL1",
    tool: "figma_get_variables",
    payload: {
      data: {
        variables: [
          {
            id: "VariableID:3312:14",
            name: "color/black/100",
            key: "84b5",
            resolvedType: "COLOR",
            valuesByMode: { "1785:2": { r: 0, g: 0, b: 0, a: 1 } },
            variableCollectionId: "VariableCollectionId:1785:1296",
          },
          {
            id: "VariableID:2121:380",
            name: "opacity/90",
            key: "82ca",
            resolvedType: "FLOAT",
            valuesByMode: { "1785:2": 90 },
            variableCollectionId: "VariableCollectionId:1785:1296",
          },
        ],
        variableCollections: [
          {
            id: "VariableCollectionId:1785:1296",
            name: "base",
            defaultModeId: "1785:2",
            modes: [{ modeId: "1785:2", name: "Value" }],
          },
        ],
      },
    },
  }

  it("resolves the pair across the gathered files, in either argument order", async () => {
    for (const order of [
      ["web.json", "global.json"],
      ["global.json", "web.json"],
    ]) {
      await withSyntheticProject(
        async project => {
          const paths = {
            "web.json": writeRawFile(project, "web.json", WEB),
            "global.json": writeRawFile(project, "global.json", GLOBAL),
          }
          const { code } = await runCapture([
            "ingest",
            "--tokens",
            ...order.map(name => paths[name]),
          ])
          expect(code).toBe(0)
          const snapshot = JSON.parse(
            readSnapshot(project, "design-tokens.json"),
          )
          const scrim = snapshot.tokens.find(
            token => token.name === "bg/scrim/default",
          )
          expect(scrim.value).toBe("#000000E6")
          expect(scrim.aliasOf).toBe("color/black/100")
          expect(JSON.stringify(snapshot)).not.toContain("NAN")
        },
        { design: { provider: "figma" } },
      )
    }
  })

  it("gathering only the file that HAS the pair skips it with a stated reason", async () => {
    await withSyntheticProject(
      async project => {
        const rawPath = writeRawFile(project, "web.json", WEB)
        const { code, stdout } = await runCapture([
          "ingest",
          "--tokens",
          rawPath,
          "--json",
        ])
        expect(code).toBe(0)
        const result = JSON.parse(stdout)
        expect(
          result.skipped.some(
            entry =>
              entry.reason.includes("bg/scrim/default") &&
              entry.reason.includes("gather every file this one subscribes to"),
          ),
        ).toBe(true)
        const snapshot = JSON.parse(readSnapshot(project, "design-tokens.json"))
        expect(snapshot.tokens.map(token => token.name)).not.toContain(
          "bg/scrim/default",
        )
      },
      { design: { provider: "figma" } },
    )
  })
})

describe("design-delta ingest — provenance (#389)", () => {
  it("records the NEWEST gatheredAt across ingested envelopes, and planHash/providerVersion when they agree", async () => {
    await withSyntheticProject(
      async project => {
        const older = writeRawFile(project, "a.json", {
          ...RAW_TOKEN_ENVELOPE,
          gatheredAt: "2026-08-18T00:00:00.000Z",
        })
        const newer = writeRawFile(project, "b.json", {
          ...RAW_TOKEN_ENVELOPE,
          gatheredAt: "2026-08-29T12:00:00.000Z",
          payload: { "radius/full": "1600" },
        })
        const { code } = await runCapture(["ingest", "--tokens", older, newer])
        expect(code).toBe(0)
        const snapshot = JSON.parse(readSnapshot(project, "design-tokens.json"))
        expect(snapshot.provenance).toEqual({
          files: 2,
          gatheredAt: "2026-08-29T12:00:00.000Z",
          planHash: "test-plan-hash",
          providerVersion: "1",
          engineVersion: ENGINE_VERSION,
        })
      },
      { design: { provider: "figma" } },
    )
  })

  it("omits planHash when envelopes disagree, and gatheredAt when none carries a parseable one", async () => {
    await withSyntheticProject(
      async project => {
        const a = writeRawFile(project, "a.json", {
          ...RAW_ENVELOPE,
          planHash: "plan-1",
          gatheredAt: "not a date",
        })
        const { gatheredAt, ...noDate } = RAW_ENVELOPE
        const b = writeRawFile(project, "b.json", {
          ...noDate,
          planHash: "plan-2",
        })
        const { code } = await runCapture(["ingest", a, b])
        expect(code).toBe(0)
        const snapshot = JSON.parse(
          readSnapshot(project, "design-components.json"),
        )
        expect(snapshot.provenance).toEqual({
          files: 2,
          providerVersion: "1",
          engineVersion: ENGINE_VERSION,
        })
      },
      { design: { provider: "figma" } },
    )
  })

  it("re-emits a loosely spelled gatheredAt as RFC 3339 UTC instead of aborting the ingest, and picks the newest by TIME, not by string", async () => {
    await withSyntheticProject(
      async project => {
        const loose = writeRawFile(project, "a.json", {
          ...RAW_TOKEN_ENVELOPE,
          gatheredAt: "2026-08-29", // Date.parse-able, not date-time
        })
        // Later by the clock, earlier by string comparison.
        const offset = writeRawFile(project, "b.json", {
          ...RAW_TOKEN_ENVELOPE,
          gatheredAt: "2026-08-29T10:00:00+05:00", // = 05:00Z
          payload: { "radius/full": "1600" },
        })
        const zulu = writeRawFile(project, "c.json", {
          ...RAW_TOKEN_ENVELOPE,
          gatheredAt: "2026-08-29T09:00:00Z",
          payload: { "radius/sm": "8" },
        })
        const { code, stderr } = await runCapture([
          "ingest",
          "--tokens",
          loose,
          offset,
          zulu,
        ])
        expect(stderr).toBe("")
        expect(code).toBe(0)
        const snapshot = JSON.parse(readSnapshot(project, "design-tokens.json"))
        expect(snapshot.provenance.gatheredAt).toBe("2026-08-29T09:00:00.000Z")
        expect(snapshot.provenance.files).toBe(3)
      },
      { design: { provider: "figma" } },
    )
  })

  it("a skipped envelope contributes nothing to provenance", async () => {
    await withSyntheticProject(
      async project => {
        const good = writeRawFile(project, "good.json", RAW_TOKEN_ENVELOPE)
        const bad = writeRawFile(project, "bad.json", {
          ...RAW_TOKEN_ENVELOPE,
          gatheredAt: "2099-01-01T00:00:00.000Z",
          payload: ["not", "a", "map"],
        })
        await runCapture(["ingest", "--tokens", good, bad])
        const snapshot = JSON.parse(readSnapshot(project, "design-tokens.json"))
        expect(snapshot.provenance.files).toBe(1)
        expect(snapshot.provenance.gatheredAt).toBe("2026-08-18T00:00:00.000Z")
      },
      { design: { provider: "figma" } },
    )
  })
})

describe("design-delta ingest --bindings (issue #401)", () => {
  it("merges usedVars onto the matching design-components.json entry and re-validates", async () => {
    await withSyntheticProject(
      async project => {
        const rawPath = join(".agents", "raw-bindings.json")
        mkdirSync(join(project.root, ".agents"), { recursive: true })
        writeFileSync(
          join(project.root, rawPath),
          JSON.stringify({
            provider: "figma",
            fileKey: "ACME123",
            nodeId: "10-20",
            gatheredAt: "2026-08-30T00:00:00.000Z",
            payload: {
              id: "10:20",
              name: "Field",
              children: [
                { boundVariables: { fills: [{ name: "color/fg" }] } },
                { boundVariables: { gap: "space/sm" } },
              ],
            },
          }),
        )
        const { code, stdout, stderr } = await runCapture([
          "--config",
          project.configPath,
          "ingest",
          "--bindings",
          "--json",
          rawPath,
        ])
        expect(stderr).toBe("")
        expect(code).toBe(0)
        const result = JSON.parse(stdout)
        expect(result.counts.components).toBe(1)
        const snapshot = JSON.parse(
          readFileSync(join(project.root, result.snapshotPath), "utf8"),
        )
        const field = snapshot.components.find(c => c.nodeId === "10:20")
        expect(field.usedVars).toEqual(["color/fg", "space/sm"])
      },
      { design: { provider: "figma" } },
    )
  })

  it("merges variantCombinations off the same payload, for a COMPONENT_SET (issue #403)", async () => {
    await withSyntheticProject(
      async project => {
        const rawPath = join(".agents", "raw-bindings-variants.json")
        mkdirSync(join(project.root, ".agents"), { recursive: true })
        writeFileSync(
          join(project.root, rawPath),
          JSON.stringify({
            provider: "figma",
            fileKey: "ACME123",
            nodeId: "10-20",
            payload: {
              id: "10:20",
              name: "Field",
              type: "COMPONENT_SET",
              children: [
                { id: "10:21", name: "size=sm, state=rest" },
                { id: "10:22", name: "size=lg, state=rest" },
              ],
            },
          }),
        )
        const { code, stdout } = await runCapture([
          "--config",
          project.configPath,
          "ingest",
          "--bindings",
          "--json",
          rawPath,
        ])
        expect(code).toBe(0)
        const result = JSON.parse(stdout)
        const snapshot = JSON.parse(
          readFileSync(join(project.root, result.snapshotPath), "utf8"),
        )
        const field = snapshot.components.find(c => c.nodeId === "10:20")
        expect(field.variantCombinations).toEqual([
          { size: "lg", state: "rest" },
          { size: "sm", state: "rest" },
        ])
        // A payload with no variant children asserts nothing: the field stays
        // ABSENT so a reader can tell "not gathered" from "gathered, none".
        const badge = snapshot.components.find(c => c.nodeId === "30:40")
        expect(badge.variantCombinations).toBeUndefined()
      },
      { design: { provider: "figma" } },
    )
  })

  it("an envelope matching no census entry is skipped with a stated reason, never silently dropped", async () => {
    await withSyntheticProject(
      async project => {
        const rawPath = join(".agents", "raw-bindings-miss.json")
        mkdirSync(join(project.root, ".agents"), { recursive: true })
        writeFileSync(
          join(project.root, rawPath),
          JSON.stringify({
            provider: "figma",
            fileKey: "ACME123",
            nodeId: "99:99",
            payload: { id: "99:99", children: [] },
          }),
        )
        const { code, stdout } = await runCapture([
          "--config",
          project.configPath,
          "ingest",
          "--bindings",
          "--json",
          rawPath,
        ])
        expect(code).toBe(0)
        const result = JSON.parse(stdout)
        expect(result.counts.components).toBe(0)
        expect(result.skipped[0].reason).toContain(
          "no design-components.json entry matches",
        )
      },
      { design: { provider: "figma" } },
    )
  })
})

// Issue #417 — the bindings gather now resolves variable names INSIDE the
// design tool and returns one result document per FILE, keyed by node id.
// Values are the 2026-09-08 live measurement's (the components the issue
// sampled resolved 9/9 and 13/13 names, nothing unresolved) — including the
// two bindings that sit on HIDDEN, prop-toggled nodes, `border/subtle` and
// `layout/gutter`, which is why the walk does not skip hidden nodes.
describe("design-delta ingest --bindings — the in-plugin result document (issue #417)", () => {
  const HEADING_ALT_VARS = [
    "border/subtle",
    "fg/default",
    "fontFamily/condensed",
    "fontSize/headingalt/xl",
    "fontWeight/regular",
    "inset/xs",
    "layout/gutter",
    "letterSpacing/1000",
    "paragraphSpacing/0",
  ]
  const DISPLAY_CONTAINER_VARS = [
    "borderWidth/thin",
    "color/blue-vivid/400",
    "color/purple-vivid/400",
    "color/red-vivid/400",
    "color/turquoise-vivid/400",
    "fg/inverse/default",
    "fontFamily/monospace",
    "fontSize/mono/lg",
    "fontSize/mono/md",
    "fontWeight/medium",
    "letterSpacing/wider",
    "paragraphSpacing/0",
    "radius/full",
  ]

  // ONE envelope, TWO components — the shape a per-file `figma_execute`
  // target produces, against the two nodes the synthetic project addresses.
  const EXECUTE_ENVELOPE = {
    provider: "figma",
    fileKey: "ACME123",
    tool: "figma_execute",
    gatheredAt: "2026-09-08T00:00:00.000Z",
    payload: {
      "10:20": {
        name: "Field",
        type: "COMPONENT",
        nodes: 41,
        usedVars: HEADING_ALT_VARS,
        unresolved: [],
      },
      "30:40": {
        name: "Badge",
        type: "COMPONENT_SET",
        nodes: 63,
        usedVars: DISPLAY_CONTAINER_VARS,
        unresolved: [],
        variantChildren: ["size=lg, state=rest", "size=sm, state=rest"],
      },
    },
  }

  it("merges every node in the document onto its own component entry", async () => {
    await withSyntheticProject(
      async project => {
        const rawPath = writeRawFile(project, "raw-exec.json", EXECUTE_ENVELOPE)
        const { code, stdout, stderr } = await runCapture([
          "ingest",
          "--bindings",
          "--json",
          rawPath,
        ])
        expect(stderr).toBe("")
        expect(code).toBe(0)
        const result = JSON.parse(stdout)
        // Two components merged out of ONE raw file — the whole point of the
        // per-file target.
        expect(result.counts.components).toBe(2)
        const snapshot = JSON.parse(
          readFileSync(join(project.root, result.snapshotPath), "utf8"),
        )
        const field = snapshot.components.find(c => c.nodeId === "10:20")
        const badge = snapshot.components.find(c => c.nodeId === "30:40")
        expect(field.usedVars).toEqual(HEADING_ALT_VARS)
        expect(badge.usedVars).toEqual(DISPLAY_CONTAINER_VARS)
        // `variantCombinations` still comes off the same pass (issue #403),
        // from the variant children the walk returned.
        expect(badge.variantCombinations).toEqual([
          { size: "lg", state: "rest" },
          { size: "sm", state: "rest" },
        ])
        // The entry with no variant children records none at all, so absent
        // still means "not gathered" rather than "gathered, none".
        expect(field.variantCombinations).toBeUndefined()
      },
      { design: { provider: "figma" } },
    )
  })

  it("an unresolved id is reported, never ingested as a variable name", async () => {
    await withSyntheticProject(
      async project => {
        const rawPath = writeRawFile(project, "raw-exec-unresolved.json", {
          ...EXECUTE_ENVELOPE,
          payload: {
            "10:20": {
              name: "Field",
              type: "COMPONENT",
              nodes: 3,
              usedVars: ["fg/default", "VariableID:1:2/3:4"],
              unresolved: ["VariableID:5:6/7:8"],
            },
          },
        })
        const { code, stdout } = await runCapture([
          "ingest",
          "--bindings",
          "--json",
          rawPath,
        ])
        expect(code).toBe(0)
        const result = JSON.parse(stdout)
        const snapshot = JSON.parse(
          readFileSync(join(project.root, result.snapshotPath), "utf8"),
        )
        const field = snapshot.components.find(c => c.nodeId === "10:20")
        // The id-rejection guard holds on this shape too: an opaque id is
        // never a name, so an unresolvable gather is visibly empty rather
        // than quietly poisoned with strings nothing can ever match.
        expect(field.usedVars).toEqual(["fg/default"])
      },
      { design: { provider: "figma" } },
    )
  })

  it("a node the script could not find is skipped with a stated reason", async () => {
    await withSyntheticProject(
      async project => {
        const rawPath = writeRawFile(project, "raw-exec-missing.json", {
          ...EXECUTE_ENVELOPE,
          payload: { "10:20": { error: "not found" } },
        })
        const { code, stdout } = await runCapture([
          "ingest",
          "--bindings",
          "--json",
          rawPath,
        ])
        expect(code).toBe(0)
        const result = JSON.parse(stdout)
        expect(result.counts.components).toBe(0)
        expect(result.skipped[0].reason).toContain("not found")
      },
      { design: { provider: "figma" } },
    )
  })

  it("a payload that is not a result document at all is skipped, never censused", async () => {
    await withSyntheticProject(
      async project => {
        const rawPath = writeRawFile(project, "raw-exec-bad.json", {
          ...EXECUTE_ENVELOPE,
          payload: ["not", "a", "result", "document"],
        })
        const { code, stdout } = await runCapture([
          "ingest",
          "--bindings",
          "--json",
          rawPath,
        ])
        expect(code).toBe(0)
        const result = JSON.parse(stdout)
        expect(result.counts.components).toBe(0)
        expect(result.skipped).toHaveLength(1)
      },
      { design: { provider: "figma" } },
    )
  })
})

// Issue #418 — the three passes write ONE pair of snapshots between them, and
// only the bindings pass produces `usedVars`. Re-running one pass alone (the
// normal case when a session can reach only some of the provider's tools) must
// never quietly take another pass's fields with it: raw envelopes are
// gitignored, so a dropped field is unrecoverable from the repo.
describe("design-delta ingest — a partial gather never drops another pass's fields (issue #418)", () => {
  // The fixture census (helpers/synthetic-project.mjs) already carries
  // `usedVars` on both components, exactly as a prior `ingest --bindings`
  // would have left it — this payload re-censuses those same two addresses.
  const COMPONENTS_ONLY_ENVELOPE = {
    ...RAW_ENVELOPE,
    payload: [
      { ...RAW_ENVELOPE.payload[0], nodeId: "10-20", name: "Field" },
      { ...RAW_ENVELOPE.payload[0], nodeId: "30-40", name: "Badge" },
    ],
  }

  it("components-only: carries every previous usedVars forward and says how many", async () => {
    await withSyntheticProject(
      async project => {
        const rawPath = writeRawFile(
          project,
          "raw.json",
          COMPONENTS_ONLY_ENVELOPE,
        )
        const { code, stdout } = await runCapture(["ingest", rawPath, "--json"])
        expect(code).toBe(0)
        const result = JSON.parse(stdout)
        expect(result.counts.bindingsCarriedForward).toBe(2)
        expect(result.counts.bindingsDropped).toBe(0)

        const snapshot = JSON.parse(
          readSnapshot(project, "design-components.json"),
        )
        expect(snapshot.components.map(c => [c.nodeId, c.usedVars])).toEqual([
          ["10:20", ["color/fg", "color/bg"]],
          ["30:40", ["color/fg", "color/danger"]],
        ])

        // The operator reading a terminal, not `--json`, is the one the
        // issue says nothing told — so the human line says it too.
        const human = await runCapture(["ingest", rawPath])
        expect(human.stdout).toContain("2 bindings record(s) carried forward")
      },
      { design: { provider: "figma" } },
    )
  })

  it("components-only: carries variantCombinations forward too, not just usedVars (issue #403)", async () => {
    await withSyntheticProject(
      async project => {
        // Stand in for a prior `ingest --bindings` that merged both fields.
        const before = JSON.parse(
          readSnapshot(project, "design-components.json"),
        )
        before.components.find(c => c.nodeId === "10:20").variantCombinations =
          [{ size: "sm" }, { size: "lg" }]
        writeFileSync(
          project.paths.designComponentsFile,
          JSON.stringify(before),
        )

        const rawPath = writeRawFile(
          project,
          "raw.json",
          COMPONENTS_ONLY_ENVELOPE,
        )
        const { code } = await runCapture(["ingest", rawPath, "--json"])
        expect(code).toBe(0)
        const snapshot = JSON.parse(
          readSnapshot(project, "design-components.json"),
        )
        const field = snapshot.components.find(c => c.nodeId === "10:20")
        expect(field.variantCombinations).toEqual([
          { size: "sm" },
          { size: "lg" },
        ])
        expect(field.usedVars).toEqual(["color/fg", "color/bg"])
      },
      { design: { provider: "figma" } },
    )
  })

  it("components-only: a previous usedVars record matching nothing in this gather is counted, never silently dropped", async () => {
    await withSyntheticProject(
      async project => {
        // RAW_ENVELOPE censuses 41:250 only — neither address the fixture's
        // bindings were merged onto survives this gather.
        const rawPath = writeRawFile(project, "raw.json", RAW_ENVELOPE)
        const { code, stdout } = await runCapture(["ingest", rawPath, "--json"])
        expect(code).toBe(0)
        const result = JSON.parse(stdout)
        expect(result.counts.bindingsCarriedForward).toBe(0)
        expect(result.counts.bindingsDropped).toBe(2)
      },
      { design: { provider: "figma" } },
    )
  })

  it("components-only: the first ever ingest has nothing to carry forward and says so with zeroes", async () => {
    await withSyntheticProject(
      async project => {
        rmSync(project.paths.designComponentsFile)
        const rawPath = writeRawFile(project, "raw.json", RAW_ENVELOPE)
        const { code, stdout } = await runCapture(["ingest", rawPath, "--json"])
        expect(code).toBe(0)
        const result = JSON.parse(stdout)
        expect(result.counts.components).toBe(1)
        expect(result.counts.bindingsCarriedForward).toBe(0)
        expect(result.counts.bindingsDropped).toBe(0)
      },
      { design: { provider: "figma" } },
    )
  })

  it("bindings-only: with no component census to merge into, fails naming the missing pass", async () => {
    await withSyntheticProject(
      async project => {
        rmSync(project.paths.designComponentsFile)
        const rawPath = writeRawFile(project, "raw-bindings.json", {
          provider: "figma",
          fileKey: "ACME123",
          nodeId: "10-20",
          payload: { id: "10:20", children: [] },
        })
        const { code, stderr, stdout } = await runCapture([
          "ingest",
          "--bindings",
          rawPath,
        ])
        expect(code).toBe(1)
        expect(stdout).toBe("")
        expect(stderr).toContain("covers only the bindings pass")
        expect(stderr).toContain("design-delta gather")
      },
      { design: { provider: "figma" } },
    )
  })

  it("tokens-only: leaves design-components.json byte-identical", async () => {
    await withSyntheticProject(
      async project => {
        const before = readSnapshot(project, "design-components.json")
        const rawPath = writeRawFile(project, "raw.json", RAW_TOKEN_ENVELOPE)
        const { code } = await runCapture(["ingest", "--tokens", rawPath])
        expect(code).toBe(0)
        expect(readSnapshot(project, "design-components.json")).toBe(before)
      },
      { design: { provider: "figma" } },
    )
  })
})

// The layer tree (issue #402) rides on the SAME bindings envelope — one
// gather, two censuses — and is carried forward by a components-only ingest
// for exactly the reason `usedVars` is (issue #418).
describe("design-delta ingest --bindings — the layer tree off the in-plugin walk (issue #462)", () => {
  // The shape `buildBindingsGatherPlan`'s script returns since #462: the tree
  // the bindings walk already traverses, alongside the counts it already
  // reported. An INSTANCE's children are not returned — its subtree is
  // another component's contract to answer for.
  const WITH_LAYERS = {
    provider: "figma",
    fileKey: "ACME123",
    tool: "figma_execute",
    gatheredAt: "2026-09-17T00:00:00.000Z",
    payload: {
      "10:20": {
        name: "Field",
        type: "COMPONENT",
        nodes: 4,
        layers: {
          name: "Field",
          type: "COMPONENT",
          children: [
            { name: "Label", type: "TEXT" },
            { name: "Icon", type: "INSTANCE" },
          ],
        },
        usedVars: ["color/fg"],
        unresolved: [],
      },
    },
  }

  async function ingest(project, envelope, name) {
    const rawPath = join(".agents", name)
    mkdirSync(join(project.root, ".agents"), { recursive: true })
    writeFileSync(join(project.root, rawPath), JSON.stringify(envelope))
    const { code, stdout } = await runCapture([
      "--config",
      project.configPath,
      "ingest",
      "--bindings",
      "--json",
      rawPath,
    ])
    expect(code).toBe(0)
    const result = JSON.parse(stdout)
    return JSON.parse(
      readFileSync(join(project.root, result.snapshotPath), "utf8"),
    )
  }

  it("merges the walked tree onto the matching component, normalized the same way the deep envelope's was", async () => {
    await withSyntheticProject(
      async project => {
        const snapshot = await ingest(project, WITH_LAYERS, "raw-layers.json")
        const field = snapshot.components.find(c => c.nodeId === "10:20")
        expect(field.layers).toEqual({
          name: "Field",
          // The PROVIDER's own vocabulary, not Figma's: `COMPONENT` is a
          // container to the engine.
          type: "container",
          children: [
            { name: "Label", type: "text" },
            // An instance's subtree is NOT KNOWN, not empty — the same word
            // the deep-component census used for it.
            { name: "Icon", type: "instance", childrenResolved: false },
          ],
        })
        // The fields the same record already carried are untouched.
        expect(field.usedVars).toEqual(["color/fg"])
      },
      { design: { provider: "figma" } },
    )
  })

  it("a result from before #462 carries no tree, and the entry says nothing about layers", async () => {
    await withSyntheticProject(
      async project => {
        const { layers, ...withoutLayers } = WITH_LAYERS.payload["10:20"]
        const snapshot = await ingest(
          project,
          { ...WITH_LAYERS, payload: { "10:20": withoutLayers } },
          "raw-no-layers.json",
        )
        const field = snapshot.components.find(c => c.nodeId === "10:20")
        expect(field.layers).toBeUndefined()
        expect(field.usedVars).toEqual(["color/fg"])
      },
      { design: { provider: "figma" } },
    )
  })
})

describe("design-delta ingest --bindings — the design layer tree (issue #402)", () => {
  const LAYERS_ENVELOPE = {
    provider: "figma",
    fileKey: "ACME123",
    nodeId: "10-20",
    payload: {
      id: "10:20",
      name: "Field",
      type: "COMPONENT_SET",
      children: [
        {
          id: "10:21",
          name: "Label",
          type: "TEXT",
          boundVariables: { fills: [{ name: "color/fg" }] },
        },
        {
          id: "10:22",
          name: "Icon",
          type: "INSTANCE",
          children: [{ id: "10:23", name: "Glyph", type: "VECTOR" }],
        },
      ],
    },
  }

  it("merges the normalized layer tree onto the matching entry alongside usedVars", async () => {
    await withSyntheticProject(
      async project => {
        const rawPath = writeRawFile(
          project,
          "raw-layers.json",
          LAYERS_ENVELOPE,
        )
        const { code, stdout } = await runCapture([
          "ingest",
          "--bindings",
          "--json",
          rawPath,
        ])
        expect(code).toBe(0)
        const result = JSON.parse(stdout)
        const snapshot = JSON.parse(
          readFileSync(join(project.root, result.snapshotPath), "utf8"),
        )
        const field = snapshot.components.find(c => c.nodeId === "10:20")
        expect(field.layers).toEqual({
          name: "Field",
          type: "container",
          children: [
            { name: "Label", type: "text" },
            { name: "Icon", type: "instance", childrenResolved: false },
          ],
        })
      },
      { design: { provider: "figma" } },
    )
  })

  it("a components-only ingest carries the layer tree forward, never drops it", async () => {
    await withSyntheticProject(
      async project => {
        const bindingsPath = writeRawFile(
          project,
          "raw-layers.json",
          LAYERS_ENVELOPE,
        )
        await runCapture(["ingest", "--bindings", bindingsPath])

        const componentsPath = writeRawFile(project, "raw.json", {
          ...RAW_ENVELOPE,
          payload: [
            { ...RAW_ENVELOPE.payload[0], nodeId: "10-20", name: "Field" },
          ],
        })
        const { code, stdout } = await runCapture([
          "ingest",
          componentsPath,
          "--json",
        ])
        expect(code).toBe(0)
        const result = JSON.parse(stdout)
        expect(result.counts.bindingsCarriedForward).toBe(1)
        const snapshot = JSON.parse(
          readSnapshot(project, "design-components.json"),
        )
        const field = snapshot.components.find(c => c.nodeId === "10:20")
        expect(field.layers.children).toHaveLength(2)
        // Both fields of the bindings pass survive, not just one.
        expect(field.usedVars).toEqual(["color/fg"])
      },
      { design: { provider: "figma" } },
    )
  })
})
