import {
  SEVERITIES,
  CONFIGURABLE_SEVERITIES,
  SEVERITY_RANK,
  SURFACES,
  SIDES,
  makeFinding,
  compareEntities,
  sortFindings,
  groupFindingsByEntity,
  groupFindingsBySurface,
  groupFindingsBySeverityAndRule,
  countBySeverity,
  hasError,
} from "../src/core/findings.mjs"

const VALID_FIELDS = {
  ruleId: "tokens/value-mismatch",
  severity: "error",
  surface: "tokens",
  side: "design",
  entity: "color.bg.primary",
  message: "value mismatch",
}

describe("makeFinding", () => {
  it("constructs a finding from valid fields", () => {
    const finding = makeFinding(VALID_FIELDS)
    expect(finding).toEqual(VALID_FIELDS)
  })

  it("omits the data key entirely when absent (no phantom undefined key)", () => {
    const finding = makeFinding(VALID_FIELDS)
    expect(Object.prototype.hasOwnProperty.call(finding, "data")).toBe(false)
    expect(Object.keys(finding).sort()).toEqual(
      ["ruleId", "severity", "surface", "side", "entity", "message"].sort(),
    )
  })

  it("carries data through when present", () => {
    const data = { expected: "#fff", actual: "#eee" }
    const finding = makeFinding({ ...VALID_FIELDS, data })
    expect(finding.data).toEqual(data)
  })

  it("throws on an invalid severity", () => {
    expect(() => makeFinding({ ...VALID_FIELDS, severity: "off" })).toThrow(
      /severity/i,
    )
    expect(() => makeFinding({ ...VALID_FIELDS, severity: "bogus" })).toThrow(
      /severity/i,
    )
  })

  it("throws on an invalid surface", () => {
    expect(() => makeFinding({ ...VALID_FIELDS, surface: "bogus" })).toThrow(
      /surface/i,
    )
  })

  it("throws on an invalid side", () => {
    expect(() => makeFinding({ ...VALID_FIELDS, side: "bogus" })).toThrow(
      /side/i,
    )
  })

  it.each(["ruleId", "severity", "surface", "side", "entity", "message"])(
    "throws when %s is missing",
    key => {
      const fields = { ...VALID_FIELDS }
      delete fields[key]
      expect(() => makeFinding(fields)).toThrow(
        new RegExp(`missing or invalid required field "${key}"`),
      )
    },
  )

  it("throws when called with no fields at all", () => {
    expect(() => makeFinding()).toThrow(/missing or invalid required field/)
  })
})

describe("severity declarations", () => {
  it("SEVERITIES is worst-first", () => {
    expect(SEVERITIES).toEqual(["error", "warn", "review"])
  })

  it("CONFIGURABLE_SEVERITIES is SEVERITIES plus off", () => {
    expect(CONFIGURABLE_SEVERITIES).toEqual(["error", "warn", "review", "off"])
  })

  it("SEVERITY_RANK ranks error worst, review least bad", () => {
    expect(SEVERITY_RANK.error).toBeGreaterThan(SEVERITY_RANK.warn)
    expect(SEVERITY_RANK.warn).toBeGreaterThan(SEVERITY_RANK.review)
  })

  it("SURFACES and SIDES match the ADR enums (plus Phase 2b's 'styles' (#103) and Phase 2c's 'anatomy' (#104))", () => {
    expect(SURFACES).toEqual([
      "tokens",
      "components",
      "styles",
      "anatomy",
      "lint",
      "coverage",
    ])
    expect(SIDES).toEqual(["design", "code", "spec", "both"])
  })
})

describe("compareEntities", () => {
  it("orders numeric segments numerically, not lexicographically", () => {
    expect(compareEntities("a.9", "a.10")).toBeLessThan(0)
    expect(compareEntities("a.10", "a.9")).toBeGreaterThan(0)
  })

  it("treats equal entities as equal", () => {
    expect(compareEntities("color.bg.primary", "color.bg.primary")).toBe(0)
  })

  it("orders plain string segments lexicographically", () => {
    expect(compareEntities("a.alpha", "a.beta")).toBeLessThan(0)
  })

  it("sorts a purely numeric segment before a non-numeric one", () => {
    expect(compareEntities("fontSize.2", "fontSize.2xl")).toBeLessThan(0)
  })

  it("splits on slash the same way as dot, for file-path entities", () => {
    expect(
      compareEntities("components/Button", "components/Card"),
    ).toBeLessThan(0)
  })

  it("treats a shorter path as less than a longer path sharing its prefix", () => {
    expect(compareEntities("a.b", "a.b.c")).toBeLessThan(0)
    expect(compareEntities("a.b.c", "a.b")).toBeGreaterThan(0)
  })

  it("produces a full natural ordering over a mixed list (a.1 .. a.18)", () => {
    const shuffled = ["a.10", "a.2", "a.1", "a.18", "a.9", "a.11", "a.3"]
    const sorted = [...shuffled].sort(compareEntities)
    expect(sorted).toEqual(["a.1", "a.2", "a.3", "a.9", "a.10", "a.11", "a.18"])
  })
})

function finding(overrides) {
  return makeFinding({ ...VALID_FIELDS, ...overrides })
}

describe("sortFindings", () => {
  it("orders worst severity first", () => {
    const findings = [
      finding({ severity: "review", entity: "a" }),
      finding({ severity: "error", entity: "b" }),
      finding({ severity: "warn", entity: "c" }),
    ]
    const sorted = sortFindings(findings)
    expect(sorted.map(f => f.severity)).toEqual(["error", "warn", "review"])
  })

  it("orders by entity (natural) within the same severity", () => {
    const findings = [
      finding({ severity: "error", entity: "a.10" }),
      finding({ severity: "error", entity: "a.9" }),
      finding({ severity: "error", entity: "a.2" }),
    ]
    const sorted = sortFindings(findings)
    expect(sorted.map(f => f.entity)).toEqual(["a.2", "a.9", "a.10"])
  })

  it("breaks a severity+entity tie by ruleId alphabetically", () => {
    const findings = [
      finding({ severity: "error", entity: "a", ruleId: "tokens/zeta" }),
      finding({ severity: "error", entity: "a", ruleId: "tokens/alpha" }),
      finding({ severity: "error", entity: "a", ruleId: "tokens/mid" }),
    ]
    const sorted = sortFindings(findings)
    expect(sorted.map(f => f.ruleId)).toEqual([
      "tokens/alpha",
      "tokens/mid",
      "tokens/zeta",
    ])
  })

  it("is a full deterministic ordering across severity, entity, and ruleId together", () => {
    const findings = [
      finding({ severity: "warn", entity: "b", ruleId: "tokens/b" }),
      finding({ severity: "error", entity: "a", ruleId: "tokens/z" }),
      finding({ severity: "error", entity: "a", ruleId: "tokens/a" }),
      finding({ severity: "review", entity: "a", ruleId: "tokens/a" }),
      finding({ severity: "error", entity: "b", ruleId: "tokens/a" }),
    ]
    const sorted = sortFindings(findings)
    expect(sorted.map(f => `${f.severity}:${f.entity}:${f.ruleId}`)).toEqual([
      "error:a:tokens/a",
      "error:a:tokens/z",
      "error:b:tokens/a",
      "warn:b:tokens/b",
      "review:a:tokens/a",
    ])
  })

  it("returns a new array and does not mutate the input", () => {
    const findings = [
      finding({ severity: "warn", entity: "b" }),
      finding({ severity: "error", entity: "a" }),
    ]
    const original = [...findings]
    const sorted = sortFindings(findings)
    expect(sorted).not.toBe(findings)
    expect(findings).toEqual(original)
  })
})

describe("groupFindingsByEntity", () => {
  it("groups findings by entity, entities in natural sorted order", () => {
    const findings = [
      finding({ entity: "a.10", ruleId: "tokens/a" }),
      finding({ entity: "a.2", ruleId: "tokens/b" }),
      finding({ entity: "a.9", ruleId: "tokens/c" }),
    ]
    const grouped = groupFindingsByEntity(findings)
    expect(grouped.map(g => g.entity)).toEqual(["a.2", "a.9", "a.10"])
  })

  it("returns an array of {entity, findings} — each entity's findings sorted", () => {
    const findings = [
      finding({ entity: "a", severity: "warn", ruleId: "tokens/b" }),
      finding({ entity: "a", severity: "error", ruleId: "tokens/a" }),
    ]
    const grouped = groupFindingsByEntity(findings)
    expect(grouped).toEqual([
      {
        entity: "a",
        findings: [
          finding({ entity: "a", severity: "error", ruleId: "tokens/a" }),
          finding({ entity: "a", severity: "warn", ruleId: "tokens/b" }),
        ],
      },
    ])
  })

  it("is deterministic across repeated calls with the same input", () => {
    const findings = [
      finding({ entity: "b", ruleId: "tokens/1" }),
      finding({ entity: "a", ruleId: "tokens/2" }),
    ]
    expect(groupFindingsByEntity(findings)).toEqual(
      groupFindingsByEntity(findings),
    )
  })

  it("returns an empty array for no findings", () => {
    expect(groupFindingsByEntity([])).toEqual([])
  })
})

describe("groupFindingsBySeverityAndRule", () => {
  it("orders severities worst-first and rules by descending count, then id", () => {
    const findings = [
      finding({ entity: "a", severity: "review", ruleId: "tokens/z" }),
      finding({ entity: "b", severity: "error", ruleId: "tokens/b" }),
      finding({ entity: "c", severity: "error", ruleId: "tokens/a" }),
      finding({ entity: "d", severity: "error", ruleId: "tokens/b" }),
    ]
    const grouped = groupFindingsBySeverityAndRule(findings)
    expect(grouped.map(g => g.severity)).toEqual(["error", "review"])
    expect(grouped[0].findings).toHaveLength(3)
    expect(grouped[0].rules.map(r => [r.ruleId, r.findings.length])).toEqual([
      ["tokens/b", 2],
      ["tokens/a", 1],
    ])
    expect(grouped[0].rules[0].findings.map(f => f.entity)).toEqual(["b", "d"])
  })

  it("omits a severity with no findings and returns [] for none", () => {
    expect(groupFindingsBySeverityAndRule([])).toEqual([])
    const only = groupFindingsBySeverityAndRule([
      finding({ entity: "a", severity: "warn", ruleId: "tokens/a" }),
    ])
    expect(only.map(g => g.severity)).toEqual(["warn"])
  })
})

describe("groupFindingsBySurface", () => {
  it("groups by surface in SURFACES declaration order, regardless of input order", () => {
    const findings = [
      finding({ surface: "lint", entity: "a" }),
      finding({ surface: "tokens", entity: "b" }),
      finding({ surface: "coverage", entity: "c" }),
      finding({ surface: "components", entity: "d" }),
    ]
    const grouped = groupFindingsBySurface(findings)
    expect(grouped.map(g => g.surface)).toEqual([
      "tokens",
      "components",
      "lint",
      "coverage",
    ])
  })

  it("omits a surface with no findings", () => {
    const findings = [finding({ surface: "tokens", entity: "a" })]
    const grouped = groupFindingsBySurface(findings)
    expect(grouped.map(g => g.surface)).toEqual(["tokens"])
  })

  it("sorts each surface's findings", () => {
    const findings = [
      finding({ surface: "tokens", severity: "warn", entity: "b" }),
      finding({ surface: "tokens", severity: "error", entity: "a" }),
    ]
    const grouped = groupFindingsBySurface(findings)
    expect(grouped[0].findings.map(f => f.severity)).toEqual(["error", "warn"])
  })

  it("is deterministic across repeated calls with the same input", () => {
    const findings = [
      finding({ surface: "lint", entity: "a" }),
      finding({ surface: "tokens", entity: "b" }),
    ]
    expect(groupFindingsBySurface(findings)).toEqual(
      groupFindingsBySurface(findings),
    )
  })
})

describe("countBySeverity", () => {
  it("always includes all three severity keys, even at zero", () => {
    expect(countBySeverity([])).toEqual({ error: 0, warn: 0, review: 0 })
  })

  it("counts findings by severity", () => {
    const findings = [
      finding({ severity: "error" }),
      finding({ severity: "error" }),
      finding({ severity: "warn" }),
      finding({ severity: "review" }),
    ]
    expect(countBySeverity(findings)).toEqual({ error: 2, warn: 1, review: 1 })
  })
})

describe("hasError", () => {
  it("is true when any finding is error severity", () => {
    expect(
      hasError([finding({ severity: "warn" }), finding({ severity: "error" })]),
    ).toBe(true)
  })

  it("is false when no finding is error severity", () => {
    expect(
      hasError([
        finding({ severity: "warn" }),
        finding({ severity: "review" }),
      ]),
    ).toBe(false)
  })

  it("is false for an empty list", () => {
    expect(hasError([])).toBe(false)
  })
})
