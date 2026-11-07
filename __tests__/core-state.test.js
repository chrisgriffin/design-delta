import {
  STATE_SCHEMA_FILE,
  hashJson,
  validateState,
} from "../src/core/state.mjs"

describe("core/state — STATE_SCHEMA_FILE", () => {
  it("resolves to an absolute, on-disk path (package-root anchored, not cwd-anchored)", async () => {
    const { existsSync } = await import("node:fs")
    const { isAbsolute } = await import("node:path")
    expect(isAbsolute(STATE_SCHEMA_FILE)).toBe(true)
    expect(existsSync(STATE_SCHEMA_FILE)).toBe(true)
  })
})

describe("core/state — validateState", () => {
  it("validates a minimal state document", () => {
    expect(
      validateState({ entities: {}, lastRun: "2026-08-12T00:00:00.000Z" }),
    ).toEqual({ valid: true, errors: [] })
  })

  it("validates a fully-populated entity, designHash included", () => {
    const state = {
      entities: {
        "component:Button": {
          codeHash: "abc",
          specHash: "def",
          designHash: "ghi",
          lastSeen: "2026-08-12T00:00:00.000Z",
        },
      },
      lastRun: "2026-08-12T00:00:00.000Z",
      lastRunByScope: {
        components: "2026-08-12T00:00:00.000Z",
        tokens: "2026-08-12T00:00:00.000Z",
      },
    }
    expect(validateState(state)).toEqual({ valid: true, errors: [] })
  })

  it("validates an entity with designHash OMITTED, not required", () => {
    const state = {
      entities: {
        "component:Button": {
          codeHash: "abc",
          specHash: "def",
          lastSeen: "2026-08-12T00:00:00.000Z",
        },
      },
      lastRun: "2026-08-12T00:00:00.000Z",
    }
    expect(validateState(state)).toEqual({ valid: true, errors: [] })
  })

  it("rejects a missing lastRun", () => {
    const { valid, errors } = validateState({ entities: {} })
    expect(valid).toBe(false)
    expect(errors.length).toBeGreaterThan(0)
  })

  it("rejects an entity missing codeHash", () => {
    const { valid } = validateState({
      entities: {
        "component:Button": {
          specHash: "def",
          lastSeen: "2026-08-12T00:00:00.000Z",
        },
      },
      lastRun: "2026-08-12T00:00:00.000Z",
    })
    expect(valid).toBe(false)
  })

  it("rejects an unknown top-level key", () => {
    const { valid } = validateState({
      entities: {},
      lastRun: "2026-08-12T00:00:00.000Z",
      bogus: true,
    })
    expect(valid).toBe(false)
  })
})

describe("core/state — hashJson", () => {
  it("is deterministic for the same logical value regardless of key insertion order", () => {
    const a = { name: "Button", type: "string", required: true }
    const b = { required: true, type: "string", name: "Button" }
    expect(hashJson(a)).toBe(hashJson(b))
  })

  it("is deterministic across repeated calls", () => {
    const value = { a: 1, b: [1, 2, 3] }
    expect(hashJson(value)).toBe(hashJson(value))
  })

  it("changes when the value actually changes", () => {
    expect(hashJson({ a: 1 })).not.toBe(hashJson({ a: 2 }))
  })

  it("distinguishes nested key order too, not just top-level", () => {
    const a = { outer: { x: 1, y: 2 } }
    const b = { outer: { y: 2, x: 1 } }
    expect(hashJson(a)).toBe(hashJson(b))
  })

  it("returns a sha256 hex digest (64 lowercase hex chars)", () => {
    expect(hashJson({})).toMatch(/^[0-9a-f]{64}$/)
  })
})
