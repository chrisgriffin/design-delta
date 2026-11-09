/**
 * cli-scaffold-degradation.test.js — the census shapes `design-delta
 * scaffold` (`src/cli/commands/scaffold.mjs`) degrades on that no file on
 * disk can produce (issue #598). Every case a real fixture reaches lives in
 * `cli-scaffold.test.js`; this file holds only the rest.
 *
 * `runScaffold` builds its own census with no seam to inject one: a skipped
 * census needs a missing `typescript` install, and a variant selector the
 * file index has no entry for needs the selector mapping to disagree with
 * the index it was built from. So the framework registry and the styles
 * module are wrapped — each passes straight through to the real
 * implementation unless a test sets an override, cleared after every test.
 */

import { jest } from "@jest/globals"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

import * as realFrameworks from "../src/sources/frameworks.mjs"
import * as realStyles from "../src/modules/styles.mjs"
import {
  createSyntheticProject,
  SYNTHETIC_PATHS,
} from "./helpers/synthetic-project.mjs"

// `(real, files, options) => census` — `real` is the adapter's own
// `extractComponents`, so an override can reshape a genuine census.
let extractComponentsOverride = null
// `(real, ...args) => selector|null` — same idea for `locateVariantSelector`.
let locateVariantSelectorOverride = null

jest.unstable_mockModule("../src/sources/frameworks.mjs", () => ({
  ...realFrameworks,
  resolveFramework: config => {
    const adapter = realFrameworks.resolveFramework(config)
    return {
      ...adapter,
      extractComponents: (files, options) =>
        extractComponentsOverride
          ? extractComponentsOverride(adapter.extractComponents, files, options)
          : adapter.extractComponents(files, options),
    }
  },
}))

jest.unstable_mockModule("../src/modules/styles.mjs", () => ({
  ...realStyles,
  locateVariantSelector: (...args) =>
    locateVariantSelectorOverride
      ? locateVariantSelectorOverride(realStyles.locateVariantSelector, ...args)
      : realStyles.locateVariantSelector(...args),
}))

const { runScaffold } = await import("../src/cli/commands/scaffold.mjs")

afterEach(() => {
  extractComponentsOverride = null
  locateVariantSelectorOverride = null
})

const BUTTON_TSX = `export type ButtonProps = {
  label: string
}

export function Button({ label }: ButtonProps) {
  return null
}
`

// Confirmed (an exported function is found) but its props parameter carries
// no type, so it lands in `unreadableProps`, never in `components`.
const WEIRD_TSX = `export function Weird(props) {
  return null
}
`

const STYLED_ICON_BUTTON_TSX = `export type IconButtonProps = {
  label: string
  size?: "sm" | "lg"
}

export function IconButton({ label, size = "sm" }: IconButtonProps) {
  return (
    <button className="acmeIconButton">
      <span>{label}</span>
    </button>
  )
}
`

const STYLED_ICON_BUTTON_STYLES = `.acmeIconButton {
  padding: 4px;

  &.lg {
    padding: 8px;
  }
}
`

// The shape a missing `typescript` install produces — `skipped: true` and
// nothing else read.
function skippedCensus(diagnostics) {
  return () => ({
    ok: false,
    skipped: true,
    components: [],
    unreadableProps: [],
    diagnostics,
  })
}

const TYPESCRIPT_DIAGNOSTIC = {
  code: "typescript-not-installed",
  message: "install typescript to run the components check",
}

function fakeStream() {
  const writes = []
  return { stream: { write: chunk => writes.push(chunk) }, writes }
}

async function runCapture(cmdArgv, { config } = {}) {
  const { stream: stdout, writes: stdoutWrites } = fakeStream()
  const { stream: stderr, writes: stderrWrites } = fakeStream()
  const code = await runScaffold(cmdArgv, {
    globalOpts: { config },
    io: { stdout, stderr },
    bus: undefined,
  })
  return { code, stdout: stdoutWrites.join(""), stderr: stderrWrites.join("") }
}

// Awaiting `fn` inside `try` is load-bearing — see `cli-scaffold.test.js`.
async function withSyntheticProject(components, fn) {
  const project = createSyntheticProject({ components })
  const originalCwd = process.cwd()
  process.chdir(project.root)
  try {
    return await fn(project)
  } finally {
    process.chdir(originalCwd)
    project.cleanup()
  }
}

function contractPath(project, id) {
  return join(project.root, SYNTHETIC_PATHS.contractsDir, `${id}.spec.json`)
}

const button = { name: "button", dir: "button", tsx: BUTTON_TSX }
const weird = { name: "weird", dir: "weird", tsx: WEIRD_TSX }

describe("design-delta scaffold — a skipped components census (#598)", () => {
  const paths = [
    ["--uncontracted", ["--uncontracted"]],
    ["single-component", ["Button"]],
  ]

  describe.each(paths)("%s path", (_label, argv) => {
    it("writes the `components census skipped` warning, exits 1, and drafts nothing", async () => {
      await withSyntheticProject([button], async project => {
        extractComponentsOverride = skippedCensus([])
        const { code, stdout, stderr } = await runCapture(argv, {
          config: project.configPath,
        })
        expect(code).toBe(1)
        expect(stdout).toBe("")
        expect(stderr).toBe(
          "design-delta scaffold: components census skipped\n",
        )
        expect(existsSync(contractPath(project, "button"))).toBe(false)
      })
    })

    it("names the census's own reason instead when it carries one", async () => {
      await withSyntheticProject([button], async project => {
        extractComponentsOverride = skippedCensus([TYPESCRIPT_DIAGNOSTIC])
        const { code, stderr } = await runCapture(argv, {
          config: project.configPath,
        })
        expect(code).toBe(1)
        expect(stderr).toBe(
          `design-delta scaffold: ${TYPESCRIPT_DIAGNOSTIC.message}\n`,
        )
        expect(existsSync(contractPath(project, "button"))).toBe(false)
      })
    })
  })
})

// A real census with its diagnostics dropped: the file is still in
// `unreadableProps`, but nothing says why — the `extraction failed` fallback.
function withoutDiagnostics(real, files, options) {
  return { ...real(files, options), diagnostics: [] }
}

describe("design-delta scaffold — props that cannot be read, with no stated reason (#598)", () => {
  it("--uncontracted skips that file with the fallback reason and drafts the rest", async () => {
    await withSyntheticProject([button, weird], async project => {
      extractComponentsOverride = withoutDiagnostics
      const { code, stdout, stderr } = await runCapture(["--uncontracted"], {
        config: project.configPath,
      })
      expect(code).toBe(0)
      expect(stderr).toBe(
        `design-delta scaffold: skipping "${SYNTHETIC_PATHS.componentsDir}/weird/weird.tsx" — its props could not be read (extraction failed)\n`,
      )
      expect(stdout).toMatch(/wrote .*button\.spec\.json/)
      expect(existsSync(contractPath(project, "button"))).toBe(true)
      expect(existsSync(contractPath(project, "weird"))).toBe(false)
    })
  })

  it("the single-component path refuses with the fallback reason and writes nothing", async () => {
    await withSyntheticProject([button, weird], async project => {
      extractComponentsOverride = withoutDiagnostics
      const { code, stdout, stderr } = await runCapture(["Weird"], {
        config: project.configPath,
      })
      expect(code).toBe(1)
      expect(stdout).toBe("")
      expect(stderr).toBe(
        `design-delta scaffold: "Weird"'s props could not be read (extraction failed) — refusing to write a partial contract\n`,
      )
      expect(existsSync(contractPath(project, "weird"))).toBe(false)
    })
  })
})

describe("design-delta scaffold — a variant selector with no file-index entry (#598)", () => {
  it("drafts no variant for it, and still drafts the element's base", async () => {
    await withSyntheticProject(
      [
        {
          name: "icon-button",
          dir: "icon-button",
          tsx: STYLED_ICON_BUTTON_TSX,
          styles: STYLED_ICON_BUTTON_STYLES,
        },
      ],
      async project => {
        // Every variant lookup "finds" a selector the index never saw.
        locateVariantSelectorOverride = () => ".acmeIconButton.absent"
        const { code, stdout } = await runCapture(["IconButton", "--json"], {
          config: project.configPath,
        })
        expect(code).toBe(0)
        expect(JSON.parse(stdout).styleElementCount).toBe(1)

        const contract = JSON.parse(
          readFileSync(contractPath(project, "icon-button"), "utf8"),
        )
        expect(contract.styles).toEqual({
          root: {
            base: {
              padding: {
                blockStart: "raw(4px)",
                blockEnd: "raw(4px)",
                inlineStart: "raw(4px)",
                inlineEnd: "raw(4px)",
              },
            },
          },
        })
      },
    )
  })

  it("passes through to the real mapping when no override is set", async () => {
    await withSyntheticProject(
      [
        {
          name: "icon-button",
          dir: "icon-button",
          tsx: STYLED_ICON_BUTTON_TSX,
          styles: STYLED_ICON_BUTTON_STYLES,
        },
      ],
      async project => {
        const { code } = await runCapture(["IconButton"], {
          config: project.configPath,
        })
        expect(code).toBe(0)
        const contract = JSON.parse(
          readFileSync(contractPath(project, "icon-button"), "utf8"),
        )
        // The control for the case above: the same fixture, unwrapped, does
        // draft the `lg` variant — so its absence there is the missing entry.
        expect(contract.styles.root.variants).toEqual([
          {
            when: { size: "lg" },
            padding: {
              blockStart: "raw(8px)",
              blockEnd: "raw(8px)",
              inlineStart: "raw(8px)",
              inlineEnd: "raw(8px)",
            },
          },
        ])
      },
    )
  })
})
