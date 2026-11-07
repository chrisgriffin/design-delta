/**
 * providers-index.test.js — `src/providers/index.mjs` (ADR-001 D12, ADR-003
 * Phase 5.1): the `design.provider` config-key -> provider module loader.
 */

import { listProviders, loadProvider } from "../src/providers/index.mjs"

describe("listProviders", () => {
  it("names every provider loadProvider can resolve", async () => {
    const keys = listProviders()
    expect(keys).toContain("figma")
    for (const key of keys) {
      const result = await loadProvider({ design: { provider: key } })
      expect(result.ok).toBe(true)
    }
  })
})

describe("loadProvider", () => {
  it("resolves the figma provider by its config key", async () => {
    const result = await loadProvider({ design: { provider: "figma" } })
    expect(result.ok).toBe(true)
    expect(result.provider.name).toBe("figma")
  })

  it("fails with a stated reason when design.provider is unset", async () => {
    expect(await loadProvider({})).toEqual({
      ok: false,
      reason: "no design.provider configured",
    })
    expect(await loadProvider(undefined)).toEqual({
      ok: false,
      reason: "no design.provider configured",
    })
  })

  it("fails with a stated reason naming the known providers when the key is unrecognized", async () => {
    const result = await loadProvider({
      design: { provider: "acme-design-tool" },
    })
    expect(result.ok).toBe(false)
    expect(result.reason).toMatch(/"acme-design-tool"/)
    expect(result.reason).toMatch(/figma/)
  })

  it("never resolves an arbitrary path from the config value (only the static allowlist)", async () => {
    const result = await loadProvider({
      design: { provider: "../../../etc/passwd" },
    })
    expect(result.ok).toBe(false)
  })

  it("never resolves an inherited Object.prototype member as a provider", async () => {
    for (const key of ["constructor", "toString", "hasOwnProperty"]) {
      const result = await loadProvider({ design: { provider: key } })
      expect(result.ok).toBe(false)
      expect(result.reason).toMatch(/is not a known provider/)
    }
  })
})
