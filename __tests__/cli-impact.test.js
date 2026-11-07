/**
 * cli-impact.test.js — `design-delta impact <entity>` (`src/cli/commands/impact.mjs`,
 * issue #237): the blast-radius query split from #223, covering both entity
 * kinds — a component (reusing `censusComponentUsage`) and a token (reusing
 * the token census + `modules/tokens.mjs`'s candidate-var-name hypothesis).
 *
 * Drives `runImpact(cmdArgv, ctx)` directly, the same testable seam
 * `cli-movers.test.js` uses.
 */

import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { runImpact } from "../src/cli/commands/impact.mjs"
import {
  createSyntheticProject,
  SYNTHETIC_PATHS,
} from "./helpers/synthetic-project.mjs"

// A "Button" imported by a "Toolbar" — the component-usage half needs one
// file another file actually imports, which the default field/badge fixture
// (deliberately standalone, see that fixture's own docblock) does not carry.
// Neither entry needs a `contract`: `impact <Component>` resolves purely off
// the componentsDir file scan, the same way `censusComponentUsage` itself
// does, so no contract is authored for either fixture component here.
function customComponents() {
  return [
    {
      name: "button",
      dir: "button",
      tsx: "export function Button() { return null }\n",
    },
    {
      name: "toolbar",
      dir: "toolbar",
      tsx: 'import { Button } from "../button/button"\n\nexport function Toolbar() { return <Button /> }\n',
    },
  ]
}

// Issue #254: a component reached only via a dynamic `import(...)` — the
// next/dynamic/React.lazy code-splitting pattern — must still show up as
// "used", not report an empty `usedBy`.
function dynamicImportComponents() {
  return [
    {
      name: "portrait-ascii",
      dir: "portrait-ascii",
      tsx: "export function PortraitAscii() { return null }\n",
    },
    {
      name: "portrait",
      dir: "portrait",
      tsx: [
        'import dynamic from "next/dynamic"',
        "",
        'const PortraitAscii = dynamic(() => import("../portrait-ascii/portrait-ascii"))',
        "",
        "export function Portrait() { return null }",
        "",
      ].join("\n"),
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
  const code = await runImpact(cmdArgv, {
    globalOpts: { config },
    io: { stdout, stderr },
    bus: undefined,
  })
  return { code, stdout: stdoutWrites.join(""), stderr: stderrWrites.join("") }
}

// async + awaited `fn(project)` matters here (unlike `cli-movers.test.js`'s
// sync equivalent): `runImpact`'s token branch awaits `censusTokens`, and an
// un-awaited `fn` would let `finally`'s `cleanup()` delete the project
// directory out from under that still-pending read.
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

describe("design-delta impact — component entity", () => {
  it("lists the file(s) that import a used component", async () => {
    await withSyntheticProject(
      { components: customComponents() },
      async project => {
        const { code, stdout } = await runCapture(["Button", "--json"], {
          config: project.configPath,
        })
        expect(code).toBe(0)
        expect(JSON.parse(stdout)).toEqual({
          command: "impact",
          entity: "Button",
          kind: "component",
          file: `${SYNTHETIC_PATHS.componentsDir}/button/button.tsx`,
          usedBy: [
            {
              file: `${SYNTHETIC_PATHS.componentsDir}/toolbar/toolbar.tsx`,
              line: 1,
            },
          ],
        })
      },
    )
  })

  it("non-JSON output names each referencing file", async () => {
    await withSyntheticProject(
      { components: customComponents() },
      async project => {
        const { code, stdout } = await runCapture(["Button"], {
          config: project.configPath,
        })
        expect(code).toBe(0)
        expect(stdout).toBe(
          `1 reference(s) to "Button":\n  ${SYNTHETIC_PATHS.componentsDir}/toolbar/toolbar.tsx:1\n`,
        )
      },
    )
  })

  it("lists a component reached only via a dynamic import(...) (#254)", async () => {
    await withSyntheticProject(
      { components: dynamicImportComponents() },
      async project => {
        const { code, stdout } = await runCapture(["PortraitAscii", "--json"], {
          config: project.configPath,
        })
        expect(code).toBe(0)
        expect(JSON.parse(stdout)).toEqual({
          command: "impact",
          entity: "PortraitAscii",
          kind: "component",
          file: `${SYNTHETIC_PATHS.componentsDir}/portrait-ascii/portrait-ascii.tsx`,
          usedBy: [
            {
              file: `${SYNTHETIC_PATHS.componentsDir}/portrait/portrait.tsx`,
              line: 3,
            },
          ],
        })
      },
    )
  })

  it("errors when no component file matches the given name", async () => {
    await withSyntheticProject(
      { components: customComponents() },
      async project => {
        const { code, stderr } = await runCapture(["NoSuchComponent"], {
          config: project.configPath,
        })
        expect(code).toBe(1)
        expect(stderr).toContain('no component file matches "NoSuchComponent"')
      },
    )
  })
})

describe("design-delta impact — token entity", () => {
  it("lists every file that references a used token, sorted by file", async () => {
    await withSyntheticProject({}, async project => {
      const { code, stdout } = await runCapture(["acme.color.fg", "--json"], {
        config: project.configPath,
      })
      expect(code).toBe(0)
      expect(JSON.parse(stdout)).toEqual({
        command: "impact",
        entity: "acme.color.fg",
        kind: "token",
        vars: ["--acme-color-fg"],
        usedBy: [
          {
            file: `${SYNTHETIC_PATHS.componentsDir}/badge/badge.styles.scss`,
            line: 2,
          },
          {
            file: `${SYNTHETIC_PATHS.componentsDir}/field/field.styles.scss`,
            line: 2,
          },
        ],
      })
    })
  })

  it("reports no references for a token nothing declares or uses", async () => {
    await withSyntheticProject({}, async project => {
      const { code, stdout } = await runCapture(
        ["acme.color.danger", "--json"],
        { config: project.configPath },
      )
      expect(code).toBe(0)
      expect(JSON.parse(stdout)).toEqual({
        command: "impact",
        entity: "acme.color.danger",
        kind: "token",
        vars: [],
        usedBy: [],
      })
    })
  })

  it("does not count a declaration under styleRoots as a reference", async () => {
    // `censusCssVars` records a name for a DECLARATION (`--acme-color-danger:`)
    // separately from a USAGE (`var(--acme-color-danger)`) — a token
    // stylesheet under `styleRoots` that declares a var but never uses it
    // anywhere must still read as unreferenced, not as one reference.
    await withSyntheticProject({}, async project => {
      const themeDir = join(project.root, "src/theme")
      mkdirSync(themeDir, { recursive: true })
      writeFileSync(
        join(themeDir, "tokens.css"),
        ":root {\n  --acme-color-danger: #b00020;\n}\n",
      )

      const { code, stdout } = await runCapture(
        ["acme.color.danger", "--json"],
        { config: project.configPath },
      )
      expect(code).toBe(0)
      expect(JSON.parse(stdout)).toEqual({
        command: "impact",
        entity: "acme.color.danger",
        kind: "token",
        vars: [],
        usedBy: [],
      })
    })
  })

  it("errors when no token has the given id", async () => {
    await withSyntheticProject({}, async project => {
      const { code, stderr } = await runCapture(["no.such.token"], {
        config: project.configPath,
      })
      expect(code).toBe(1)
      expect(stderr).toContain('no token with id "no.such.token"')
    })
  })
})

describe("design-delta impact — entity shape", () => {
  it("rejects an entity that is neither PascalCase nor dotted", async () => {
    await withSyntheticProject({}, async project => {
      const { code, stderr } = await runCapture(["lowercase"], {
        config: project.configPath,
      })
      expect(code).toBe(1)
      expect(stderr).toContain("neither a PascalCase component name")
    })
  })
})
