/**
 * core-version.test.js — `src/core/version.mjs` (issue #458).
 */

import { readFileSync } from "node:fs"
import { join } from "node:path"

import { compareVersions, packageVersion } from "../src/core/version.mjs"

describe("packageVersion", () => {
  it("is the version package.json declares", () => {
    const pkg = JSON.parse(
      readFileSync(join(process.cwd(), "package.json"), "utf8"),
    )
    expect(packageVersion()).toBe(pkg.version)
  })
})

describe("compareVersions", () => {
  it("orders MAJOR.MINOR.PATCH numerically, not lexically", () => {
    expect(compareVersions("0.18.0", "0.18.1")).toBe(-1)
    expect(compareVersions("0.18.1", "0.18.1")).toBe(0)
    expect(compareVersions("0.19.0", "0.18.1")).toBe(1)
    expect(compareVersions("0.9.0", "0.18.1")).toBe(-1)
    expect(compareVersions("1.0.0", "0.99.99")).toBe(1)
  })

  it("ignores a prerelease suffix and reads a missing segment as 0", () => {
    expect(compareVersions("0.19.0-next.1", "0.19.0")).toBe(0)
    expect(compareVersions("0.19", "0.19.0")).toBe(0)
  })
})
