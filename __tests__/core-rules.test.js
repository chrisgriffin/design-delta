import {
  defineRule,
  createRegistry,
  normalizeRuleEntry,
  validateRuleIds,
  validateExemptionRuleIds,
  resolveRuleConfig,
  disabledRuleIds,
  isDisabled,
  resolveAll,
} from "../src/core/rules.mjs"

const validDef = (overrides = {}) => ({
  id: "tokens/value-mismatch",
  surface: "tokens",
  defaultSeverity: "warn",
  description: "A token's resolved value disagrees with its contract.",
  ...overrides,
})

describe("defineRule", () => {
  it("returns a normalized, frozen rule for a valid definition", () => {
    const rule = defineRule(validDef())
    expect(rule).toEqual({
      id: "tokens/value-mismatch",
      surface: "tokens",
      defaultSeverity: "warn",
      description: "A token's resolved value disagrees with its contract.",
      options: {},
    })
    expect(Object.isFrozen(rule)).toBe(true)
    expect(Object.isFrozen(rule.options)).toBe(true)
  })

  it("carries a provided options default through as a fresh frozen copy", () => {
    const opts = { maxLines: 300 }
    const rule = defineRule(validDef({ options: opts }))
    expect(rule.options).toEqual({ maxLines: 300 })
    opts.maxLines = 999
    expect(rule.options.maxLines).toBe(300)
  })

  it("throws when the definition is not an object", () => {
    expect(() => defineRule(null)).toThrow(/must be an object/)
    expect(() => defineRule("tokens/value-mismatch")).toThrow(
      /must be an object/,
    )
    expect(() => defineRule(["tokens/value-mismatch"])).toThrow(
      /must be an object/,
    )
  })

  it("throws on a malformed id", () => {
    expect(() => defineRule(validDef({ id: "TokensValueMismatch" }))).toThrow(
      /rule id must match/,
    )
    expect(() => defineRule(validDef({ id: "tokens" }))).toThrow(
      /rule id must match/,
    )
    expect(() => defineRule(validDef({ id: "tokens/Value-Mismatch" }))).toThrow(
      /rule id must match/,
    )
    expect(() => defineRule(validDef({ id: "/value-mismatch" }))).toThrow(
      /rule id must match/,
    )
    expect(() => defineRule(validDef({ id: 42 }))).toThrow(/rule id must match/)
  })

  it("throws on an unknown surface", () => {
    expect(() => defineRule(validDef({ surface: "mockups" }))).toThrow(
      /surface must be one of/,
    )
  })

  it("throws on an invalid defaultSeverity, including 'off'", () => {
    expect(() => defineRule(validDef({ defaultSeverity: "critical" }))).toThrow(
      /defaultSeverity must be one of/,
    )
    expect(() => defineRule(validDef({ defaultSeverity: "off" }))).toThrow(
      /defaultSeverity must be one of/,
    )
  })

  it("throws on a missing or blank description", () => {
    expect(() => defineRule(validDef({ description: "" }))).toThrow(
      /description must be a non-empty string/,
    )
    expect(() => defineRule(validDef({ description: "   " }))).toThrow(
      /description must be a non-empty string/,
    )
    expect(() => defineRule(validDef({ description: undefined }))).toThrow(
      /description must be a non-empty string/,
    )
  })

  it("throws when options is provided but not a plain object", () => {
    expect(() => defineRule(validDef({ options: "nope" }))).toThrow(
      /options must be a plain object/,
    )
    expect(() => defineRule(validDef({ options: [1, 2] }))).toThrow(
      /options must be a plain object/,
    )
  })
})

describe("createRegistry", () => {
  const defs = [
    validDef(),
    validDef({
      id: "components/prop-missing",
      surface: "components",
      defaultSeverity: "error",
      description: "A contracted prop has no code-side equivalent.",
    }),
    validDef({
      id: "lint/camel-case",
      surface: "lint",
      defaultSeverity: "warn",
      description: "A token name is not camelCase.",
    }),
  ]

  it("builds a registry exposing get/ids/bySurface", () => {
    const registry = createRegistry(defs)
    expect(registry.get("tokens/value-mismatch").surface).toBe("tokens")
    expect(registry.get("nope/nope")).toBeUndefined()
  })

  it("ids() returns every id sorted, and is defensively copied", () => {
    const registry = createRegistry(defs)
    const ids = registry.ids()
    expect(ids).toEqual([
      "components/prop-missing",
      "lint/camel-case",
      "tokens/value-mismatch",
    ])
    ids.push("mutated/entry")
    expect(registry.ids()).not.toContain("mutated/entry")
  })

  it("bySurface() returns only that surface's rules, sorted by id", () => {
    const registry = createRegistry(defs)
    expect(registry.bySurface("tokens").map(r => r.id)).toEqual([
      "tokens/value-mismatch",
    ])
    expect(registry.bySurface("coverage")).toEqual([])
  })

  it("throws on a duplicate id", () => {
    expect(() => createRegistry([validDef(), validDef()])).toThrow(
      /duplicate rule id 'tokens\/value-mismatch'/,
    )
  })

  it("throws when any entry is a malformed rule definition", () => {
    expect(() => createRegistry([validDef(), { id: "bad" }])).toThrow(
      /rule id must match/,
    )
  })

  it("throws when not given an array", () => {
    expect(() => createRegistry({})).toThrow(/expects an array/)
  })
})

describe("normalizeRuleEntry", () => {
  it("accepts each bare configurable severity", () => {
    expect(normalizeRuleEntry("off")).toEqual({ severity: "off", options: {} })
    expect(normalizeRuleEntry("error")).toEqual({
      severity: "error",
      options: {},
    })
    expect(normalizeRuleEntry("warn")).toEqual({
      severity: "warn",
      options: {},
    })
    expect(normalizeRuleEntry("review")).toEqual({
      severity: "review",
      options: {},
    })
  })

  it("accepts a [severity, options] tuple and copies the options", () => {
    const opts = { maxLines: 10 }
    const result = normalizeRuleEntry(["warn", opts])
    expect(result).toEqual({ severity: "warn", options: { maxLines: 10 } })
    opts.maxLines = 999
    expect(result.options.maxLines).toBe(10)
  })

  it("throws on an unknown severity string", () => {
    expect(() => normalizeRuleEntry("critical")).toThrow(/must be one of/)
  })

  it("throws on a bare plain object", () => {
    expect(() => normalizeRuleEntry({ maxLines: 10 })).toThrow(/must be one of/)
  })

  it("throws on a wrong-length array", () => {
    expect(() => normalizeRuleEntry(["warn"])).toThrow(/must be one of/)
    expect(() => normalizeRuleEntry(["warn", {}, {}])).toThrow(/must be one of/)
  })

  it("throws on a tuple whose second element is not a plain object", () => {
    expect(() => normalizeRuleEntry(["warn", "nope"])).toThrow(/must be one of/)
    expect(() => normalizeRuleEntry(["warn", [1, 2]])).toThrow(/must be one of/)
  })

  it("throws on other unrelated shapes", () => {
    expect(() => normalizeRuleEntry(null)).toThrow(/must be one of/)
    expect(() => normalizeRuleEntry(42)).toThrow(/must be one of/)
    expect(() => normalizeRuleEntry(undefined)).toThrow(/must be one of/)
  })
})

describe("validateRuleIds", () => {
  const registry = createRegistry([
    validDef(),
    validDef({
      id: "tokens/code-only",
      description: "A token exists in code but not in the contract.",
    }),
    validDef({
      id: "lint/camel-case",
      surface: "lint",
      description: "A token name is not camelCase.",
    }),
  ])

  it("returns [] for an empty or absent rules block", () => {
    expect(validateRuleIds({}, registry)).toEqual([])
    expect(validateRuleIds(undefined, registry)).toEqual([])
    expect(validateRuleIds(null, registry)).toEqual([])
  })

  it("returns [] when every entry is valid", () => {
    expect(
      validateRuleIds(
        { "tokens/value-mismatch": "off", "lint/camel-case": "warn" },
        registry,
      ),
    ).toEqual([])
  })

  it("reports an unknown id, listing the known ids for its surface", () => {
    const errors = validateRuleIds(
      { "tokens/valeu-mismatch": "warn" },
      registry,
    )
    expect(errors).toHaveLength(1)
    expect(errors[0]).toMatch(/unknown rule id 'tokens\/valeu-mismatch'/)
    expect(errors[0]).toMatch(/did you mean 'tokens\/value-mismatch'\?/)
    expect(errors[0]).toMatch(/tokens\/code-only/)
    expect(errors[0]).toMatch(/tokens\/value-mismatch/)
    expect(errors[0]).not.toMatch(/lint\/camel-case/)
  })

  it("falls back to the full id list when the surface prefix isn't a known surface", () => {
    const errors = validateRuleIds({ "bogus/thing": "warn" }, registry)
    expect(errors).toHaveLength(1)
    expect(errors[0]).toMatch(/unknown rule id 'bogus\/thing'/)
    expect(errors[0]).toMatch(/tokens\/value-mismatch/)
    expect(errors[0]).toMatch(/lint\/camel-case/)
  })

  it("reports a malformed entry for a known id", () => {
    const errors = validateRuleIds(
      { "tokens/value-mismatch": "critical" },
      registry,
    )
    expect(errors).toHaveLength(1)
    expect(errors[0]).toMatch(/^rules\.tokens\/value-mismatch /)
    expect(errors[0]).toMatch(/must be one of/)
  })

  it("aggregates multiple problems", () => {
    const errors = validateRuleIds(
      { "tokens/nope": "warn", "lint/camel-case": "critical" },
      registry,
    )
    expect(errors).toHaveLength(2)
  })

  it("returns an error when rules is not an object", () => {
    expect(validateRuleIds("warn", registry)).toEqual([
      "rules must be an object",
    ])
    expect(validateRuleIds(["warn"], registry)).toEqual([
      "rules must be an object",
    ])
  })

  it("names which block a message is about, so rules and exemptions don't read as the same problem", () => {
    const errors = validateRuleIds({ "tokens/nope": "warn" }, registry)
    expect(errors[0]).toMatch(/unknown rule id 'tokens\/nope' in rules/)
  })
})

describe("validateExemptionRuleIds", () => {
  const registry = createRegistry([
    validDef(),
    validDef({
      id: "tokens/code-only",
      description: "A token exists in code but not in the contract.",
    }),
    validDef({
      id: "lint/camel-case",
      surface: "lint",
      description: "A token name is not camelCase.",
    }),
  ])

  it("returns [] for an empty or absent exemptions block", () => {
    expect(validateExemptionRuleIds({}, registry)).toEqual([])
    expect(validateExemptionRuleIds(undefined, registry)).toEqual([])
    expect(validateExemptionRuleIds(null, registry)).toEqual([])
  })

  it("returns [] when every key is a known rule id", () => {
    expect(
      validateExemptionRuleIds(
        {
          "tokens/value-mismatch": ["components/flex"],
          "lint/camel-case": ["header/*"],
        },
        registry,
      ),
    ).toEqual([])
  })

  it("does not care about the SHAPE of an exemption entry — only the key", () => {
    // A malformed entry inside a known rule's list is applyExemptions'
    // normalizeEntry's problem (it silently no-ops it), not this function's —
    // this only checks that the KEY is a rule the registry actually has.
    expect(
      validateExemptionRuleIds(
        { "tokens/value-mismatch": [42, null, "components/flex"] },
        registry,
      ),
    ).toEqual([])
  })

  it("reports an unknown id, naming the exemptions block and the nearest real id", () => {
    const errors = validateExemptionRuleIds(
      { "tokens/token-unreferened": ["system.color.bg.hover"] },
      registry,
    )
    expect(errors).toHaveLength(1)
    expect(errors[0]).toMatch(
      /unknown rule id 'tokens\/token-unreferened' in exemptions/,
    )
  })

  it("falls back to the full id list when the surface prefix isn't known", () => {
    const errors = validateExemptionRuleIds({ "bogus/thing": ["x"] }, registry)
    expect(errors[0]).toMatch(/tokens\/value-mismatch/)
    expect(errors[0]).toMatch(/lint\/camel-case/)
  })

  it("aggregates multiple unknown ids", () => {
    const errors = validateExemptionRuleIds(
      { "tokens/nope": ["x"], "lint/nope": ["y"] },
      registry,
    )
    expect(errors).toHaveLength(2)
  })

  it("returns an error when exemptions is not an object", () => {
    expect(validateExemptionRuleIds("nope", registry)).toEqual([
      "exemptions must be an object",
    ])
    expect(validateExemptionRuleIds(["nope"], registry)).toEqual([
      "exemptions must be an object",
    ])
  })
})

describe("resolveRuleConfig", () => {
  const registry = createRegistry([
    validDef({ options: { tolerance: 0 } }),
    validDef({
      id: "lint/camel-case",
      surface: "lint",
      defaultSeverity: "warn",
      description: "A token name is not camelCase.",
    }),
  ])

  it("falls back to the registry default when unconfigured", () => {
    expect(resolveRuleConfig("tokens/value-mismatch", {}, registry)).toEqual({
      severity: "warn",
      options: { tolerance: 0 },
    })
  })

  it("lets a config severity override the default", () => {
    expect(
      resolveRuleConfig(
        "tokens/value-mismatch",
        { "tokens/value-mismatch": "error" },
        registry,
      ),
    ).toEqual({ severity: "error", options: { tolerance: 0 } })
  })

  it("lets a config entry turn a rule off, winning outright", () => {
    expect(
      resolveRuleConfig(
        "tokens/value-mismatch",
        { "tokens/value-mismatch": "off" },
        registry,
      ),
    ).toEqual({ severity: "off", options: { tolerance: 0 } })
  })

  it("merges config options on top of the registry default options", () => {
    expect(
      resolveRuleConfig(
        "tokens/value-mismatch",
        { "tokens/value-mismatch": ["warn", { strict: true }] },
        registry,
      ),
    ).toEqual({
      severity: "warn",
      options: { tolerance: 0, strict: true },
    })
  })

  it("lets config options override a same-named default option", () => {
    expect(
      resolveRuleConfig(
        "tokens/value-mismatch",
        { "tokens/value-mismatch": ["warn", { tolerance: 5 }] },
        registry,
      ),
    ).toEqual({ severity: "warn", options: { tolerance: 5 } })
  })

  it("does not mutate the registry's default options across calls", () => {
    resolveRuleConfig(
      "tokens/value-mismatch",
      { "tokens/value-mismatch": ["warn", { tolerance: 5 }] },
      registry,
    )
    expect(resolveRuleConfig("tokens/value-mismatch", {}, registry)).toEqual({
      severity: "warn",
      options: { tolerance: 0 },
    })
  })

  it("throws for an id absent from the registry", () => {
    expect(() => resolveRuleConfig("tokens/nope", {}, registry)).toThrow(
      /unknown rule id 'tokens\/nope'/,
    )
  })

  it("throws when the configured entry for this id is malformed", () => {
    expect(() =>
      resolveRuleConfig(
        "tokens/value-mismatch",
        { "tokens/value-mismatch": "critical" },
        registry,
      ),
    ).toThrow(/must be one of/)
  })
})

describe("disabledRuleIds", () => {
  const registry = createRegistry([
    validDef(),
    validDef({
      id: "tokens/code-only",
      description: "A token exists in code but not in the contract.",
    }),
    validDef({
      id: "lint/camel-case",
      surface: "lint",
      defaultSeverity: "warn",
      description: "A token name is not camelCase.",
    }),
  ])

  it("returns an empty set when nothing is disabled", () => {
    expect(disabledRuleIds({}, registry)).toEqual(new Set())
  })

  it("returns exactly the ids resolving to off", () => {
    const disabled = disabledRuleIds(
      { "tokens/value-mismatch": "off", "lint/camel-case": "warn" },
      registry,
    )
    expect(disabled).toEqual(new Set(["tokens/value-mismatch"]))
  })

  it("is a real Set", () => {
    expect(disabledRuleIds({}, registry)).toBeInstanceOf(Set)
  })
})

describe("isDisabled", () => {
  const registry = createRegistry([validDef()])

  it("is true only when the rule resolves to off", () => {
    expect(isDisabled("tokens/value-mismatch", {}, registry)).toBe(false)
    expect(
      isDisabled(
        "tokens/value-mismatch",
        { "tokens/value-mismatch": "off" },
        registry,
      ),
    ).toBe(true)
    expect(
      isDisabled(
        "tokens/value-mismatch",
        { "tokens/value-mismatch": "error" },
        registry,
      ),
    ).toBe(false)
  })
})

describe("resolveAll", () => {
  const registry = createRegistry([
    validDef(),
    validDef({
      id: "tokens/code-only",
      description: "A token exists in code but not in the contract.",
    }),
  ])

  it("resolves every registered rule into a Map", () => {
    const resolved = resolveAll({ "tokens/value-mismatch": "off" }, registry)
    expect(resolved).toBeInstanceOf(Map)
    expect(resolved.size).toBe(2)
    expect(resolved.get("tokens/value-mismatch")).toEqual({
      severity: "off",
      options: {},
    })
    expect(resolved.get("tokens/code-only")).toEqual({
      severity: "warn",
      options: {},
    })
  })
})
