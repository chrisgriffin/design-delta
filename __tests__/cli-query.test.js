/**
 * cli-query.test.js — `design-delta query raw-values`
 * (`src/cli/commands/query.mjs`, issue #493): the read-only inventory that
 * replaced the deleted `styles/raw-value-uncontracted` rule (removed in
 * 8c9a14e / issue #490).
 *
 * The point of the replacement is that this is a QUERY, not a check, so the
 * cases below assert the two properties that distinguish one from the other
 * as hard as they assert the listing itself:
 *
 *   - exit 0 whatever it finds — literals present, no literals at all, and no
 *     style files at all are all "answered the question", never "failed"
 *   - the payload carries no rule id, no severity, and no findings array —
 *     `runUncontractedRawValueCheck`'s shape must not come back with it
 *
 * Drives `runQuery(cmdArgv, ctx)` directly, the same testable seam
 * `cli-impact.test.js` uses.
 */

import { mkdirSync, symlinkSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { runQuery } from "../src/cli/commands/query.mjs"
import {
  createSyntheticProject,
  SYNTHETIC_CONVENTIONS,
} from "./helpers/synthetic-project.mjs"

// `acme.color.bg` is `#fafafa` in the synthetic token file and censuses to
// the CSS-output value `#fafafa`; `acme.color.fg` is `#111111` and censuses
// to `#111` (Terrazzo shortens it), which is exactly why the matching literal
// below is written as the bg value — the match is on the token's `cssValue`,
// not on its authored `$value`.
const MATCHING_LITERAL = "#fafafa"

function literalComponents() {
  return [
    {
      name: "field",
      dir: "field",
      tsx: "export function Field() { return null }\n",
      styles: [
        ".acmeField {",
        `  color: ${MATCHING_LITERAL};`,
        "  padding: 13px;",
        "  background-color: var(--acme-color-bg);",
        "}",
        "",
      ].join("\n"),
    },
  ]
}

/** A component whose stylesheet is entirely token references — no literals. */
function tokenOnlyComponents() {
  return [
    {
      name: "field",
      dir: "field",
      tsx: "export function Field() { return null }\n",
      styles: ".acmeField {\n  color: var(--acme-color-fg);\n}\n",
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
  const code = await runQuery(cmdArgv, {
    globalOpts: { config },
    io: { stdout, stderr },
    bus: undefined,
  })
  return { code, stdout: stdoutWrites.join(""), stderr: stderrWrites.join("") }
}

// Awaited, like `cli-impact.test.js`'s equivalent: `runQuery` awaits
// `censusTokens`, and an un-awaited `fn` would let `cleanup()` delete the
// project out from under that still-pending read.
async function withSyntheticProject(overrides, fn) {
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

describe("design-delta query raw-values — the listing", () => {
  it("lists every literal with its file, selector, property and token match", async () => {
    await withSyntheticProject(
      { components: literalComponents() },
      async project => {
        const { code, stdout } = await runCapture(["raw-values", "--json"], {
          config: project.configPath,
        })
        expect(code).toBe(0)
        expect(JSON.parse(stdout)).toEqual({
          command: "query",
          subject: "raw-values",
          files: 1,
          literals: [
            {
              file: "src/ui/field/field.styles.scss",
              selector: ".acmeField",
              property: "color",
              value: MATCHING_LITERAL,
              matchesToken: true,
            },
            {
              file: "src/ui/field/field.styles.scss",
              selector: ".acmeField",
              property: "padding",
              value: "13px",
              matchesToken: false,
            },
          ],
        })
      },
    )
  })

  it("omits var() references — a token reference is not a literal", async () => {
    await withSyntheticProject(
      { components: literalComponents() },
      async project => {
        const { stdout } = await runCapture(["raw-values", "--json"], {
          config: project.configPath,
        })
        const { literals } = JSON.parse(stdout)
        expect(literals.map(l => l.property)).not.toContain("background-color")
      },
    )
  })

  it("takes its file globs from config, styleRoots included", async () => {
    // `styleRoots` is a configured scan root distinct from `componentsDir`,
    // and the synthetic project's value for it ("src/theme") is unlike both a
    // real project's layout and the engine's default — so a literal found
    // there proves the scan is config-driven rather than convention-guessed.
    await withSyntheticProject(
      { components: literalComponents() },
      async project => {
        const themeDir = join(project.root, "src/theme")
        mkdirSync(themeDir, { recursive: true })
        writeFileSync(
          join(themeDir, "base.styles.scss"),
          ":root {\n  border-width: 2px;\n}\n",
        )

        const { code, stdout } = await runCapture(["raw-values", "--json"], {
          config: project.configPath,
        })
        expect(code).toBe(0)
        const payload = JSON.parse(stdout)
        expect(payload.files).toBe(2)
        expect(payload.literals).toContainEqual({
          file: "src/theme/base.styles.scss",
          selector: ":root",
          property: "border-width",
          value: "2px",
          matchesToken: false,
        })
      },
    )
  })

  it("prints a human-readable listing without --json", async () => {
    await withSyntheticProject(
      { components: literalComponents() },
      async project => {
        const { code, stdout } = await runCapture(["raw-values"], {
          config: project.configPath,
        })
        expect(code).toBe(0)
        expect(stdout).toContain("src/ui/field/field.styles.scss")
        expect(stdout).toContain(".acmeField")
        expect(stdout).toContain(`color: ${MATCHING_LITERAL}`)
        expect(stdout).toContain("padding: 13px")
      },
    )
  })
})

describe("design-delta query raw-values — a query, not a gate", () => {
  it("exits 0 when it finds literals", async () => {
    await withSyntheticProject(
      { components: literalComponents() },
      async project => {
        const { code } = await runCapture(["raw-values"], {
          config: project.configPath,
        })
        expect(code).toBe(0)
      },
    )
  })

  it("exits 0 when a scanned stylesheet holds no literal at all", async () => {
    await withSyntheticProject(
      { components: tokenOnlyComponents() },
      async project => {
        const { code, stdout } = await runCapture(["raw-values", "--json"], {
          config: project.configPath,
        })
        expect(code).toBe(0)
        expect(JSON.parse(stdout).literals).toEqual([])
      },
    )
  })

  it("exits 0 when the project has no style files to scan", async () => {
    // `stylesSuffix: ""` is the documented "not configured" state
    // `findStyleFiles` answers with an empty list — nothing to match, not an
    // error, and so not an exit code either.
    await withSyntheticProject(
      { components: literalComponents(), conventions: { stylesSuffix: "" } },
      async project => {
        const { code, stdout } = await runCapture(["raw-values", "--json"], {
          config: project.configPath,
        })
        expect(code).toBe(0)
        const payload = JSON.parse(stdout)
        expect(payload.files).toBe(0)
        expect(payload.literals).toEqual([])
      },
    )
  })

  it("reports a style file it could not census rather than dropping it", async () => {
    // A file the scan finds but the census cannot read is excluded from
    // `censusStyles`'s `files`, so without this it vanishes from BOTH the
    // count and the listing with no word to the caller — an undercount
    // presented as a complete answer, which is the dishonest output this
    // engine's own standards forbid. A dangling symlink is the portable way
    // to reach that path: `findStyleFiles` returns it (it is not a
    // directory), and `censusStyleFile`'s `existsSync` then rejects it.
    await withSyntheticProject(
      { components: literalComponents() },
      async project => {
        symlinkSync(
          "./nowhere.scss",
          join(
            project.root,
            "src/ui/field",
            `ghost${SYNTHETIC_CONVENTIONS.stylesSuffix}`,
          ),
        )

        const { code, stdout } = await runCapture(["raw-values", "--json"], {
          config: project.configPath,
        })
        // Still an answer, so still 0 — it just says what it could not read.
        expect(code).toBe(0)
        const payload = JSON.parse(stdout)
        expect(payload.files).toBe(1)
        expect(payload.diagnostics).toEqual([
          {
            code: "missing-style-file",
            file: "src/ui/field/ghost.styles.scss",
            message: "no style file at src/ui/field/ghost.styles.scss",
          },
        ])
      },
    )
  })

  it("names an uncensusable style file in the text output too", async () => {
    await withSyntheticProject(
      { components: literalComponents() },
      async project => {
        symlinkSync(
          "./nowhere.scss",
          join(
            project.root,
            "src/ui/field",
            `ghost${SYNTHETIC_CONVENTIONS.stylesSuffix}`,
          ),
        )

        const { code, stdout } = await runCapture(["raw-values"], {
          config: project.configPath,
        })
        expect(code).toBe(0)
        expect(stdout).toContain("1 diagnostic(s)")
        expect(stdout).toContain("src/ui/field/ghost.styles.scss")
      },
    )
  })

  it("omits diagnostics from the payload entirely when there are none", async () => {
    // Absent rather than empty: an always-present `diagnostics: []` reads as
    // "the command checked and found none" on runs where nothing could go
    // wrong, and every other payload in this CLI omits what did not apply.
    await withSyntheticProject(
      { components: literalComponents() },
      async project => {
        const { stdout } = await runCapture(["raw-values", "--json"], {
          config: project.configPath,
        })
        expect(JSON.parse(stdout)).not.toHaveProperty("diagnostics")
      },
    )
  })

  it("reports no rule id, no severity, and no findings", async () => {
    // `Done means` 2: the restored code is a census + listing, and
    // `runUncontractedRawValueCheck`'s finding shape must not come back with
    // it. Asserted on the serialized payload, so a nested key cannot hide.
    await withSyntheticProject(
      { components: literalComponents() },
      async project => {
        const { stdout } = await runCapture(["raw-values", "--json"], {
          config: project.configPath,
        })
        expect(stdout).not.toContain("ruleId")
        expect(stdout).not.toContain("severity")
        expect(stdout).not.toContain("findings")
        expect(stdout).not.toContain("raw-value-uncontracted")
      },
    )
  })
})

describe("design-delta query — argument handling", () => {
  it("rejects an unknown subject", async () => {
    const { code, stderr } = await runCapture(["tokens"])
    expect(code).toBe(1)
    expect(stderr).toContain("tokens")
    expect(stderr).toContain("raw-values")
  })

  it("rejects a missing subject", async () => {
    const { code, stderr } = await runCapture([])
    expect(code).toBe(1)
    expect(stderr).toContain("raw-values")
  })

  it("rejects an unknown flag rather than running with defaults", async () => {
    const { code, stderr } = await runCapture(["raw-values", "--nope"])
    expect(code).toBe(1)
    expect(stderr).toContain("--nope")
  })

  it("fails loudly on an unreadable config — a missing answer, not an empty one", async () => {
    // Distinct from "found nothing": the command cannot say whether a literal
    // matches a token when it could not load the project at all, and
    // answering 0-with-an-empty-list there would be exactly the dishonest
    // output CLAUDE.md forbids.
    const { code, stderr } = await runCapture(["raw-values"], {
      config: "no/such/design-delta.json",
    })
    expect(code).toBe(1)
    expect(stderr).toContain("no/such/design-delta.json")
  })
})
