/**
 * core-exemptions.test.js — `src/core/exemptions.mjs` (ADR-001 D5, issue #181).
 *
 * The block was schema-validated, documented in `docs/config-reference.md` and
 * named in the ADR while nothing read it. These pin the behaviour the schema
 * already promised, including the half that makes an exemption honest: an
 * entity that matches nothing is REPORTED, because "exemptions are claims to
 * re-verify, not permanent silence".
 */

import { applyExemptions, matchesEntity } from "../src/core/exemptions.mjs"

const finding = (ruleId, entity) => ({
  ruleId,
  entity,
  severity: "warn",
  surface: "coverage",
  side: "code",
  message: `${ruleId} on ${entity}`,
})

const ids = findings => findings.map(f => f.ruleId).sort()

describe("matchesEntity", () => {
  it("matches a literal entity exactly", () => {
    expect(matchesEntity("components/flex", "components/flex")).toBe(true)
    expect(matchesEntity("components/flex", "components/grid")).toBe(false)
  })

  it("matches a glob", () => {
    expect(matchesEntity("header/*", "header/nav-box")).toBe(true)
    expect(matchesEntity("header/*", "footer/nav-box")).toBe(false)
  })

  it("treats regex metacharacters in an entity as literal", () => {
    // A token id is full of dots. If `.` were a wildcard, exempting
    // `base.color.red` would also silence `baseXcolorXred` — and worse, an
    // author would never know their waiver was broader than they wrote.
    expect(matchesEntity("base.color.red", "baseXcolorXred")).toBe(false)
    expect(matchesEntity("base.color.red", "base.color.red")).toBe(true)
  })
})

describe("applyExemptions — filtering", () => {
  it("removes a finding whose entity is exempted for that rule", () => {
    const { findings, exempted } = applyExemptions(
      [finding("coverage/uncontracted-component", "components/flex")],
      { "coverage/uncontracted-component": ["components/flex"] },
    )
    expect(
      findings.filter(f => f.ruleId !== "coverage/stale-exemption"),
    ).toEqual([])
    expect(exempted).toBe(1)
  })

  it("is scoped to the rule it is declared under", () => {
    // The same entity can be legitimately waived for one rule and a real
    // finding for another. A global ignore list cannot express that.
    const { findings } = applyExemptions(
      [
        finding("coverage/uncontracted-component", "components/flex"),
        finding("styles/binding-missing", "components/flex"),
      ],
      { "coverage/uncontracted-component": ["components/flex"] },
    )
    expect(ids(findings)).toEqual(["styles/binding-missing"])
  })

  it("accepts the {entity, reason} form as well as a bare string", () => {
    const { exempted } = applyExemptions(
      [finding("coverage/uncontracted-component", "components/flex")],
      {
        "coverage/uncontracted-component": [
          {
            entity: "components/flex",
            reason: "layout primitive, no design surface",
          },
        ],
      },
    )
    expect(exempted).toBe(1)
  })

  it("exempts every entity a glob covers", () => {
    const { findings, exempted } = applyExemptions(
      [
        finding("coverage/uncontracted-component", "header/nav-box"),
        finding("coverage/uncontracted-component", "header/logo-link"),
        finding("coverage/uncontracted-component", "footer/social"),
      ],
      { "coverage/uncontracted-component": ["header/*"] },
    )
    expect(exempted).toBe(2)
    expect(findings.map(f => f.entity)).toEqual(["footer/social"])
  })

  it("is a no-op when no exemptions are configured", () => {
    const input = [
      finding("coverage/uncontracted-component", "components/flex"),
    ]
    expect(applyExemptions(input, {}).findings).toBe(input)
    expect(applyExemptions(input, undefined).findings).toBe(input)
  })
})

// issue #191: a grouped `tokens/token-unreferenced` finding keys `entity` on
// the shared var it's about, not on any one of the tokens that fold to it —
// but an exemption is usually authored against a TOKEN id, written before the
// var-keyed entity ever existed as something to match. `data.tokens` is the
// alternate-identity list a finding may declare so a waiver written against
// any one of them keeps matching, whatever `entity` itself displays.
describe("applyExemptions — a finding may declare alternate identities via data.tokens", () => {
  const groupedFinding = {
    ruleId: "tokens/token-unreferenced",
    entity: "--system-color-bg-disabled",
    severity: "review",
    surface: "tokens",
    side: "code",
    message: "nothing references ...",
    data: {
      token: "system/dark.color.bg.disabled",
      tokens: [
        "system/dark.color.bg.disabled",
        "system/light.color.bg.disabled",
      ],
      expectedVar: "--system-color-bg-disabled",
    },
  }

  it("matches an exemption written against one of the declaring token ids", () => {
    const { findings, exempted } = applyExemptions(
      [groupedFinding],
      { "tokens/token-unreferenced": ["system/dark.color.bg.disabled"] },
      { wasEvaluated: () => true },
    )
    expect(
      findings.filter(f => f.ruleId !== "coverage/stale-exemption"),
    ).toEqual([])
    expect(exempted).toBe(1)
  })

  it("matches an exemption written against the OTHER declaring token id", () => {
    const { findings } = applyExemptions(
      [groupedFinding],
      { "tokens/token-unreferenced": ["system/light.color.bg.disabled"] },
      { wasEvaluated: () => true },
    )
    expect(
      findings.filter(f => f.ruleId !== "coverage/stale-exemption"),
    ).toEqual([])
  })

  it("still matches an exemption written against the entity itself (the var)", () => {
    const { findings } = applyExemptions(
      [groupedFinding],
      { "tokens/token-unreferenced": ["--system-color-bg-disabled"] },
      { wasEvaluated: () => true },
    )
    expect(
      findings.filter(f => f.ruleId !== "coverage/stale-exemption"),
    ).toEqual([])
  })

  it("does not ALSO report a token-id exemption as stale once matched via data.tokens", () => {
    // The bug this closes: a match via data.tokens must count as "matched"
    // for stale-tracking too, or a perfectly valid waiver gets both silently
    // ignored for filtering purposes AND flagged as dead — worse than doing
    // nothing.
    const { findings } = applyExemptions(
      [groupedFinding],
      { "tokens/token-unreferenced": ["system/dark.color.bg.disabled"] },
      { wasEvaluated: () => true },
    )
    expect(findings.some(f => f.ruleId === "coverage/stale-exemption")).toBe(
      false,
    )
  })

  it("a glob still matches against a declaring token id, not only the entity", () => {
    const { findings } = applyExemptions(
      [groupedFinding],
      { "tokens/token-unreferenced": ["system/dark.*"] },
      { wasEvaluated: () => true },
    )
    expect(
      findings.filter(f => f.ruleId !== "coverage/stale-exemption"),
    ).toEqual([])
  })

  it("falls back to entity alone when a finding carries no data.tokens", () => {
    // Every other rule in the engine, and this rule's own single-token
    // findings — no change in behavior for the overwhelming common case.
    const plain = finding("coverage/uncontracted-component", "components/flex")
    const { findings } = applyExemptions([plain], {
      "coverage/uncontracted-component": ["components/flex"],
    })
    expect(
      findings.filter(f => f.ruleId !== "coverage/stale-exemption"),
    ).toEqual([])
  })

  // The reverse direction: an exemption written against the VAR NAME must
  // keep matching even after a group shrinks back to one token and `entity`
  // reverts to that token's own id. `expectedVar` is present on every
  // finding of this rule regardless of current group size, so this needs no
  // grouping at all to demonstrate — a single-token finding already carries
  // it.
  const singleFinding = {
    ruleId: "tokens/token-unreferenced",
    entity: "system.color.bg.hover",
    severity: "review",
    surface: "tokens",
    side: "code",
    message: "nothing references ...",
    data: {
      token: "system.color.bg.hover",
      tokens: ["system.color.bg.hover"],
      expectedVar: "--system-color-bg-hover",
    },
  }

  it("matches an exemption written against expectedVar, even on a single-token finding", () => {
    const { findings } = applyExemptions(
      [singleFinding],
      { "tokens/token-unreferenced": ["--system-color-bg-hover"] },
      { wasEvaluated: () => true },
    )
    expect(
      findings.filter(f => f.ruleId !== "coverage/stale-exemption"),
    ).toEqual([])
  })

  it("does not report an expectedVar-matched exemption as stale", () => {
    const { findings } = applyExemptions(
      [singleFinding],
      { "tokens/token-unreferenced": ["--system-color-bg-hover"] },
      { wasEvaluated: () => true },
    )
    expect(findings.some(f => f.ruleId === "coverage/stale-exemption")).toBe(
      false,
    )
  })

  it("survives a group shrinking back to one token — a var-name exemption keeps matching", () => {
    // Simulates the shape #191's fix originally left open: the exemption is
    // written while grouped, then the SAME finding is mutated in place —
    // its sibling drops out, entity reverts from the shared var to the one
    // remaining token's own id, data.tokens shrinks to match — and exemptions
    // are re-applied across that transition. expectedVar is the one field
    // that never changes, so it's what has to carry the match.
    const shrinking = { ...groupedFinding, data: { ...groupedFinding.data } }
    const exemptions = {
      "tokens/token-unreferenced": ["--system-color-bg-disabled"],
    }

    const grouped = applyExemptions([shrinking], exemptions, {
      wasEvaluated: () => true,
    })
    expect(
      grouped.findings.filter(f => f.ruleId !== "coverage/stale-exemption"),
    ).toEqual([])

    shrinking.entity = "system/dark.color.bg.disabled"
    shrinking.data.token = "system/dark.color.bg.disabled"
    shrinking.data.tokens = ["system/dark.color.bg.disabled"]

    const shrunk = applyExemptions([shrinking], exemptions, {
      wasEvaluated: () => true,
    })
    expect(
      shrunk.findings.filter(f => f.ruleId !== "coverage/stale-exemption"),
    ).toEqual([])
  })

  it("ignores a malformed expectedVar rather than throwing", () => {
    const malformed = {
      ...singleFinding,
      data: { ...singleFinding.data, expectedVar: 42 },
    }
    expect(() =>
      applyExemptions(
        [malformed],
        { "tokens/token-unreferenced": ["--system-color-bg-hover"] },
        { wasEvaluated: () => true },
      ),
    ).not.toThrow()
  })

  it("does not exempt an unrelated finding just because SOME finding has matching data.tokens", () => {
    const unrelated = finding(
      "tokens/token-unreferenced",
      "system/dark.color.bg.hover",
    )
    const { findings } = applyExemptions(
      [groupedFinding, unrelated],
      { "tokens/token-unreferenced": ["system/dark.color.bg.disabled"] },
      { wasEvaluated: () => true },
    )
    expect(findings.map(f => f.entity)).toEqual(["system/dark.color.bg.hover"])
  })
})

describe("applyExemptions — an exemption is a claim to re-verify", () => {
  it("reports a literal exemption that matched nothing", () => {
    // The half that keeps a waiver list from rotting. An entity is renamed or
    // deleted, its exemption stops matching, and without this nothing says so
    // — the list silently becomes a place real drift can hide.
    const { findings } = applyExemptions([], {
      "coverage/uncontracted-component": ["components/deleted-thing"],
    })
    expect(ids(findings)).toEqual(["coverage/stale-exemption"])
    expect(findings[0].entity).toBe("components/deleted-thing")
    expect(findings[0].message).toContain("stale")
  })

  it("does NOT report a stale glob", () => {
    // `header/*` matching nothing today may be correct tomorrow — a pattern is
    // a statement about a shape, not a claim about a specific entity.
    const { findings } = applyExemptions([], {
      "coverage/uncontracted-component": ["header/*"],
    })
    expect(findings).toEqual([])
  })

  it("does not report one that DID match", () => {
    const { findings } = applyExemptions(
      [finding("coverage/uncontracted-component", "components/flex")],
      { "coverage/uncontracted-component": ["components/flex"] },
    )
    expect(ids(findings)).toEqual([])
  })

  it("carries the recorded reason into the stale message", () => {
    const { findings } = applyExemptions([], {
      "coverage/uncontracted-component": [
        { entity: "components/gone", reason: "behaviour wrapper" },
      ],
    })
    expect(findings[0].message).toContain("behaviour wrapper")
  })

  it("can be silenced without disabling the exemptions themselves", () => {
    // Turning the stale REPORT off must not turn the filtering off — they are
    // separate decisions, and conflating them would make a project choose
    // between waivers and quiet.
    const { findings, exempted } = applyExemptions(
      [finding("coverage/uncontracted-component", "components/flex")],
      {
        "coverage/uncontracted-component": [
          "components/flex",
          "components/gone",
        ],
      },
      { severityOf: () => "off" },
    )
    expect(exempted).toBe(1)
    expect(findings).toEqual([])
  })

  it("is deterministic in the order it reports stale entries", () => {
    const config = {
      "z/rule": ["b-entity", "a-entity"],
      "a/rule": ["c-entity"],
    }
    const once = applyExemptions([], config).findings.map(f => f.entity)
    const twice = applyExemptions([], config).findings.map(f => f.entity)
    expect(once).toEqual(twice)
  })
})

describe("applyExemptions — stale needs the rule to have RUN (#181 review)", () => {
  // The trap: "matched no finding" and "the surface never ran" are not the
  // same fact. `audit --tokens` produces only token findings, and a missing
  // `typescript` install skips the component surface entirely — so without
  // this scoping, every exemption on a rule that did not run gets called
  // stale. True in form, misleading in substance.
  const config = { "components/prop-missing": ["Button"] }

  it("does NOT report stale when the rule was not evaluated", () => {
    const { findings } = applyExemptions([], config, {
      wasEvaluated: () => false,
    })
    expect(findings).toEqual([])
  })

  it("DOES report stale when the rule ran and matched nothing", () => {
    const { findings } = applyExemptions([], config, {
      wasEvaluated: () => true,
    })
    expect(findings.map(f => f.ruleId)).toEqual(["coverage/stale-exemption"])
  })

  it("scopes per rule, not all-or-nothing", () => {
    // A narrowed run evaluates SOME rules. The ones it ran are still checked.
    const { findings } = applyExemptions(
      [],
      {
        "tokens/token-unreferenced": ["gone.token"],
        "components/prop-missing": ["Button"],
      },
      { wasEvaluated: ruleId => ruleId.startsWith("tokens/") },
    )
    expect(findings.map(f => f.entity)).toEqual(["gone.token"])
  })

  it("assumes evaluated when the caller says nothing", () => {
    // A caller that ran everything should not have to opt in.
    const { findings } = applyExemptions([], config)
    expect(findings.map(f => f.ruleId)).toEqual(["coverage/stale-exemption"])
  })

  it("still FILTERS for a rule that did not run", () => {
    // Scoping affects the stale REPORT only. If a finding somehow arrives for
    // an unevaluated rule the waiver must still apply — filtering and
    // reporting are separate decisions.
    const { exempted } = applyExemptions(
      [
        {
          ruleId: "components/prop-missing",
          entity: "Button",
          severity: "warn",
          surface: "components",
          side: "code",
          message: "m",
        },
      ],
      config,
      { wasEvaluated: () => false },
    )
    expect(exempted).toBe(1)
  })
})

describe("core/exemptions — the file itself", () => {
  it("is plain text, with no raw control characters", async () => {
    // It shipped as a BINARY blob: the map-key delimiter was written as a
    // literal NUL rather than an escape, so git classified the file as binary
    // and the central module of its own PR could not be reviewed, grepped or
    // blamed. Cheap to pin, and invisible to every other check.
    const { readFileSync } = await import("node:fs")
    const source = readFileSync("src/core/exemptions.mjs")
    expect(source.includes(0)).toBe(false)
  })
})

describe("applyExemptions — exempted findings keep a visible decision (#565)", () => {
  const rule = "components/binding-file-stale"

  it("reads a bare string as a waived decision with no reason or issue", () => {
    const { findings, decided } = applyExemptions(
      [finding(rule, "flex"), finding(rule, "grid")],
      { [rule]: ["flex"] },
    )
    expect(findings.map(f => f.entity)).toEqual(["grid"])
    expect(decided).toEqual([
      {
        ...finding(rule, "flex"),
        decision: {
          kind: "waived",
          reason: null,
          issue: null,
          exemption: "flex",
        },
      },
    ])
  })

  it("carries each decision kind, its reason and its issue", () => {
    const { decided } = applyExemptions(
      [finding(rule, "a"), finding(rule, "b"), finding(rule, "c")],
      {
        [rule]: [
          { entity: "a", decision: "tracked", issue: "o/r#12", reason: "r1" },
          { entity: "b", decision: "accepted", reason: "r2" },
          { entity: "c", reason: "r3" },
        ],
      },
    )
    expect(decided.map(f => [f.entity, f.decision])).toEqual([
      ["a", { kind: "tracked", reason: "r1", issue: "o/r#12", exemption: "a" }],
      ["b", { kind: "accepted", reason: "r2", issue: null, exemption: "b" }],
      ["c", { kind: "waived", reason: "r3", issue: null, exemption: "c" }],
    ])
  })

  it("names the glob that matched, not the finding's entity", () => {
    const { decided } = applyExemptions([finding(rule, "header/nav")], {
      [rule]: ["header/*"],
    })
    expect(decided[0].decision.exemption).toBe("header/*")
  })

  it("keeps the count equal to the decided list and leaves stale reporting alone", () => {
    const { exempted, decided, findings } = applyExemptions(
      [finding(rule, "flex")],
      { [rule]: ["flex", "gone"] },
    )
    expect(exempted).toBe(decided.length)
    expect(findings.map(f => [f.ruleId, f.entity])).toEqual([
      ["coverage/stale-exemption", "gone"],
    ])
  })

  it("returns an empty decided list when nothing is configured", () => {
    expect(applyExemptions([finding(rule, "x")], {}).decided).toEqual([])
  })
})
