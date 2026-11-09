/**
 * Issue #117 — `code.framework` selects the adapter; the CLI never imports a
 * framework by name. Pins the registry, the config default, the loud error
 * on an unknown name, and that `.tsx` file conventions now belong to the
 * adapter rather than core/.
 */
import { describe, expect, it } from "@jest/globals"
import { readFileSync, readdirSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import {
  FRAMEWORKS,
  DEFAULT_FRAMEWORK,
  resolveFramework,
} from "../src/sources/frameworks.mjs"
import {
  DEFAULT_CODE,
  DEFAULT_CONVENTIONS,
  resolveCode,
  validateConfig,
} from "../src/core/config.mjs"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")

describe("sources/frameworks.mjs (issue #117)", () => {
  it("defaults to react and resolves it from config", () => {
    expect(DEFAULT_FRAMEWORK).toBe("react")
    expect(DEFAULT_CODE).toEqual({ framework: "react" })
    expect(resolveCode({})).toEqual({ framework: "react" })
    expect(resolveFramework({}).name).toBe("react")
    expect(resolveFramework({ code: { framework: "react" } })).toBe(
      FRAMEWORKS.react,
    )
  })

  it("exposes the whole adapter surface the CLI needs", () => {
    const a = resolveFramework({})
    for (const fn of [
      "extractComponent",
      "extractComponents",
      "findComponentFiles",
      "extractJsxComponent",
      "extractJsxComponents",
    ]) {
      expect(typeof a[fn]).toBe("function")
    }
    expect(a.conventions).toEqual({
      componentFileExtension: ".tsx",
      nonComponentFileSuffixes: [".stories.tsx", ".test.tsx"],
    })
  })

  it("names the known adapters on an unknown framework instead of falling through to react", () => {
    expect(() => resolveFramework({ code: { framework: "angular" } })).toThrow(
      /code\.framework "angular" is not a known framework adapter \(known: react\)/,
    )
  })

  it("the schema accepts code.framework and rejects a name no adapter has", () => {
    expect(validateConfig({ code: { framework: "react" } }).valid).toBe(true)
    expect(validateConfig({ code: { framework: "angular" } }).valid).toBe(false)
    expect(validateConfig({ code: { frameworks: "react" } }).valid).toBe(false)
  })

  it("core/ ships no .tsx default — the adapter owns file conventions", () => {
    expect(DEFAULT_CONVENTIONS.nonComponentFileSuffixes).toBeUndefined()
  })

  it("no cli/ module imports sources/react by name", () => {
    const cli = join(ROOT, "src", "cli")
    const walk = d =>
      readdirSync(d, { withFileTypes: true }).flatMap(e =>
        e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)],
      )
    const offenders = walk(cli).filter(f =>
      /^import .*sources\/react\//m.test(readFileSync(f, "utf8")),
    )
    expect(offenders).toEqual([])
  })
})
