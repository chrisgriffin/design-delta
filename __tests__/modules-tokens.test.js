/**
 * modules-tokens.test.js — `src/modules/tokens.mjs`, the token parity checker
 * (ADR-001 D3/D5/D13, issue #102).
 *
 * PURE input: every case here hand-builds its `tokenCensus`/`cssVarCensus`
 * fixtures in memory (the exact shapes `sources/code.mjs`'s `censusTokens`/
 * `censusCssVars` produce) rather than touching fs — the layering guard
 * (`__tests__/layering.test.js`'s "modules never import sources") is what
 * that buys.
 */

import {
  candidateTokenIds,
  candidateVarName,
  runTokensCheck,
} from "../src/modules/tokens.mjs"

const PREFIX = "--acme-"

function token(id) {
  return { id }
}

function tokenCensus(tokens) {
  return { ok: true, tokens }
}

function cssVar(name, { declarations = [], usages = [] } = {}) {
  return { name, declarations, usages }
}

function varCensus(vars) {
  return { ok: true, vars }
}

function config(overrides = {}) {
  return { conventions: { cssVarPrefix: PREFIX }, ...overrides }
}

function findingIds(findings) {
  return findings.map(f => f.ruleId).sort()
}

// ---------------------------------------------------------------------------
// The mapping hypothesis, directly.
// ---------------------------------------------------------------------------

describe("candidateVarName — the mapping hypothesis", () => {
  it("dash-joins the id and prepends the prefix as-is when no fold applies", () => {
    expect(candidateVarName("color.bg.primary", "--")).toBe(
      "--color-bg-primary",
    )
  })

  it("folds a leading segment that textually equals the prefix's own root", () => {
    expect(candidateVarName("acme.color.fg", "--acme-")).toBe("--acme-color-fg")
  })

  it("does not fold when the leading segment differs from the prefix's root", () => {
    expect(candidateVarName("brand.color.fg", "--acme-")).toBe(
      "--acme-brand-color-fg",
    )
  })

  it("returns null when nothing is left to join after the fold (unmappable)", () => {
    expect(candidateVarName("acme", "--acme-")).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Every rule, firing.
// ---------------------------------------------------------------------------

describe("runTokensCheck — each rule firing", () => {
  it("tokens/token-unreferenced: a token with no matching var anywhere", () => {
    const findings = runTokensCheck(
      tokenCensus([token("acme.color.danger")]),
      varCensus([]),
      config(),
    )
    expect(findings).toEqual([
      expect.objectContaining({
        ruleId: "tokens/token-unreferenced",
        surface: "tokens",
        side: "code",
        severity: "review",
        entity: "acme.color.danger",
        data: {
          token: "acme.color.danger",
          tokens: ["acme.color.danger"],
          expectedVar: "--acme-color-danger",
        },
      }),
    ])
  })

  it("tokens/token-untracked: a declared var with no token behind it", () => {
    const findings = runTokensCheck(
      tokenCensus([]),
      varCensus([
        cssVar("--acme-color-rogue", {
          declarations: [{ file: "a.scss", line: 1 }],
        }),
      ]),
      config(),
    )
    expect(findings).toEqual([
      expect.objectContaining({
        ruleId: "tokens/token-untracked",
        surface: "tokens",
        side: "code",
        severity: "warn",
        entity: "--acme-color-rogue",
        data: { var: "--acme-color-rogue" },
      }),
    ])
  })

  it("tokens/token-unreferenced: mapped and declared, but never referenced", () => {
    const findings = runTokensCheck(
      tokenCensus([token("acme.color.fg")]),
      varCensus([
        cssVar("--acme-color-fg", {
          declarations: [{ file: "tokens.css", line: 3 }],
        }),
      ]),
      config(),
    )
    expect(findings).toEqual([
      expect.objectContaining({
        ruleId: "tokens/token-unreferenced",
        surface: "tokens",
        side: "code",
        severity: "review",
        entity: "acme.color.fg",
        data: {
          token: "acme.color.fg",
          tokens: ["acme.color.fg"],
          expectedVar: "--acme-color-fg",
        },
      }),
    ])
  })

  it("tokens/var-unresolved: used, undeclared, and no token accounts for it", () => {
    const findings = runTokensCheck(
      tokenCensus([]),
      varCensus([
        cssVar("--acme-color-typo", {
          usages: [{ file: "field.tsx", line: 4 }],
        }),
      ]),
      config(),
    )
    expect(findings).toEqual([
      expect.objectContaining({
        ruleId: "tokens/var-unresolved",
        surface: "tokens",
        side: "code",
        severity: "error",
        entity: "--acme-color-typo",
        data: { var: "--acme-color-typo" },
      }),
    ])
  })
})

// ---------------------------------------------------------------------------
// Every rule, NOT firing (clean parity + the unmappable-token silence).
// ---------------------------------------------------------------------------

describe("runTokensCheck — clean parity and silence", () => {
  it("a token emitted (declared) and used produces no findings", () => {
    const findings = runTokensCheck(
      tokenCensus([token("acme.color.fg")]),
      varCensus([
        cssVar("--acme-color-fg", {
          declarations: [{ file: "tokens.css", line: 1 }],
          usages: [{ file: "field.tsx", line: 2 }],
        }),
      ]),
      config(),
    )
    expect(findings).toEqual([])
  })

  it("a used-but-undeclared var that matches a token is NOT var-unresolved (D3: the contract resolves it)", () => {
    const findings = runTokensCheck(
      tokenCensus([token("acme.color.fg")]),
      varCensus([
        cssVar("--acme-color-fg", { usages: [{ file: "field.tsx", line: 2 }] }),
      ]),
      config(),
    )
    // No var-unresolved (a token accounts for it); no token-unreferenced either,
    // since it IS referenced.
    expect(findings).toEqual([])
  })

  it("an unmappable token (id collapses to nothing after the fold) emits NOTHING", () => {
    const findings = runTokensCheck(
      tokenCensus([token("acme")]),
      varCensus([]),
      config(),
    )
    expect(findings).toEqual([])
  })

  it("empty censuses produce no findings", () => {
    expect(runTokensCheck(tokenCensus([]), varCensus([]), config())).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Config: severity overrides via the one `rules` block.
// ---------------------------------------------------------------------------

describe("runTokensCheck — config-driven severity", () => {
  it("honors a rules override, including 'off'", () => {
    const tokens = tokenCensus([token("acme.color.danger")])
    const vars = varCensus([])

    const errored = runTokensCheck(tokens, vars, {
      ...config(),
      rules: { "tokens/token-unreferenced": "error" },
    })
    expect(errored[0].severity).toBe("error")

    const off = runTokensCheck(tokens, vars, {
      ...config(),
      rules: { "tokens/token-unreferenced": "off" },
    })
    expect(off).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Determinism.
// ---------------------------------------------------------------------------

describe("runTokensCheck — determinism", () => {
  it("the same inputs produce byte-identical findings JSON twice, regardless of input order", () => {
    const tokens = [token("acme.color.zeta"), token("acme.color.alpha")]
    const vars = []

    const a = JSON.stringify(
      runTokensCheck(tokenCensus(tokens), varCensus(vars), config()),
    )
    const b = JSON.stringify(
      runTokensCheck(
        tokenCensus([...tokens].reverse()),
        varCensus(vars),
        config(),
      ),
    )
    expect(a).toBe(b)
    expect(JSON.parse(a).map(f => f.entity)).toEqual([
      "acme.color.alpha",
      "acme.color.zeta",
    ])
  })
})

// ---------------------------------------------------------------------------
// Regression pins from issue #123 — both bugs were invisible while the tokens
// surface never ran at all on real data.
// ---------------------------------------------------------------------------

describe("mode-scoped token ids (issue #123)", () => {
  it("drops the `/mode` suffix when deriving a var name", () => {
    // `system/light` and `system/dark` are alternate VALUES of one token, not
    // different tokens: they emit a single var whose value the active theme
    // swaps. Before this, the id produced `--system-system/light-color-bg-
    // default` — a name containing a slash, which no stylesheet can declare —
    // and every themed colour was reported `var-unresolved` at error severity.
    // Measured on a real design system: 79 false errors.
    expect(candidateVarName("system/light.color.bg.default", "--system-")).toBe(
      "--system-color-bg-default",
    )
    expect(candidateVarName("system/dark.color.bg.default", "--system-")).toBe(
      "--system-color-bg-default",
    )
  })

  it("does not report a var whose token the census EXCLUDED", () => {
    // A token dropped so the rest of the file could parse still exists in the
    // project. Reporting its var as untracked would trade one silence for a
    // lie — the exclusion is already a diagnostic, it must not also be a
    // finding.
    const tokenCensus = {
      ok: true,
      tokens: [],
      excluded: ["system/dark.color.focus-ring.color"],
    }
    const cssVarCensus = {
      vars: [
        {
          name: "--system-color-focus-ring-color",
          declarations: [{ file: "a.scss" }],
          usages: [],
        },
      ],
    }
    expect(runTokensCheck(tokenCensus, cssVarCensus, {})).toEqual([])
  })
})

describe("token-unreferenced counts alias references (issue #123 follow-up)", () => {
  it("a primitive consumed by another token is not unreferenced", () => {
    // Tiered design systems alias primitives upward and never touch them from
    // a component, so judging them by component usage alone calls a correctly-
    // consumed primitive dead. Measured on a real design system: 147 of 277
    // `base.*` leaves are alias-referenced and every one was being reported.
    const tokenCensus = {
      ok: true,
      tokens: [
        { id: "base.color.neutral.900", $type: "color" },
        {
          id: "system.color.fg.default",
          $type: "color",
          aliasOf: "base.color.neutral.900",
        },
      ],
    }
    const cssVarCensus = {
      vars: [
        {
          name: "--system-color-fg-default",
          declarations: [],
          usages: [{ file: "a.scss" }],
        },
      ],
    }
    expect(runTokensCheck(tokenCensus, cssVarCensus, {})).toEqual([])
  })

  it("a token consumed only as another token's opacity is not unreferenced (#517)", () => {
    // `system.opacity.scrim` exists so `bg.scrim.default` can point at it
    // through the project's own `$extensions` key. Nothing else in the code
    // references it, and before #517 it was reported dead.
    const tokenCensus = {
      ok: true,
      tokens: [
        { id: "system.opacity.scrim", $type: "number" },
        {
          id: "system.color.bg.scrim",
          $type: "color",
          aliasOf: "base.color.black",
          opacityOf: "system.opacity.scrim",
        },
        { id: "base.color.black", $type: "color" },
      ],
    }
    const cssVarCensus = {
      vars: [
        {
          name: "--acme-system-color-bg-scrim",
          declarations: [],
          usages: [{ file: "a.scss" }],
        },
      ],
    }
    expect(
      runTokensCheck(tokenCensus, cssVarCensus, config()).filter(
        f => f.ruleId === "tokens/token-unreferenced",
      ),
    ).toEqual([])
  })

  it("still reports a primitive nothing aliases and nothing uses", () => {
    const tokenCensus = {
      ok: true,
      tokens: [{ id: "base.color.orphan.500", $type: "color" }],
    }
    const findings = runTokensCheck(tokenCensus, { vars: [] }, {})
    expect(findings).toEqual([
      expect.objectContaining({
        ruleId: "tokens/token-unreferenced",
        entity: "base.color.orphan.500",
      }),
    ])
  })
})

// ---------------------------------------------------------------------------
// A primitive consumed only through a COMPOSITE's aliased `$value` member
// (issue #192) — `system.fontSize.body.md` referenced from
// `system.typography.body.md`'s `fontSize` field, never by a component
// directly. `aliasOf`/`aliasChain` (above) only ever cover a token whose
// WHOLE value is an alias; a composite that aliases just one member needs
// `partialAliasOf` walked instead. Measured against a real design system: 28
// `system.fontSize.*` primitives, false-flagged this way.
// ---------------------------------------------------------------------------

describe("token-unreferenced counts partial alias references (issue #192)", () => {
  it("a primitive consumed only by a composite's aliased sub-property is not unreferenced", () => {
    const tokenCensus = {
      ok: true,
      tokens: [
        { id: "system.fontSize.body.md", $type: "dimension" },
        {
          id: "system.typography.body.md",
          $type: "typography",
          value: { fontSize: { value: 16, unit: "px" }, fontFamily: "Inter" },
          partialAliasOf: { fontSize: "system.fontSize.body.md" },
        },
      ],
    }
    const cssVarCensus = {
      vars: [
        {
          name: "--system-typography-body-md-font-size",
          declarations: [],
          usages: [{ file: "a.scss" }],
        },
      ],
    }
    const findings = runTokensCheck(tokenCensus, cssVarCensus, {
      conventions: { cssVarPrefix: "--system-" },
    })
    expect(
      findings.filter(f => f.ruleId === "tokens/token-unreferenced"),
    ).toEqual([])
  })

  it("reports only the composite head when nothing consumes the chain at all", () => {
    // The owner's call on the open question: one finding for the dead
    // composite, not one per primitive underneath it.
    const tokenCensus = {
      ok: true,
      tokens: [
        { id: "system.fontSize.body.md", $type: "dimension" },
        {
          id: "system.typography.body.md",
          $type: "typography",
          value: { fontSize: { value: 16, unit: "px" } },
          partialAliasOf: { fontSize: "system.fontSize.body.md" },
        },
      ],
    }
    const findings = runTokensCheck(
      tokenCensus,
      { vars: [] },
      { conventions: { cssVarPrefix: "--system-" } },
    ).filter(f => f.ruleId === "tokens/token-unreferenced")
    expect(findings.map(f => f.entity)).toEqual(["system.typography.body.md"])
  })

  it("still reports a sibling primitive no composite member aliases (fontWeight.light)", () => {
    const tokenCensus = {
      ok: true,
      tokens: [
        { id: "system.fontWeight.light", $type: "fontWeight" },
        { id: "system.fontWeight.medium", $type: "fontWeight" },
        {
          id: "system.typography.body.md",
          $type: "typography",
          value: { fontWeight: 500 },
          partialAliasOf: { fontWeight: "system.fontWeight.medium" },
        },
      ],
    }
    const cssVarCensus = {
      vars: [
        {
          name: "--system-typography-body-md-font-weight",
          declarations: [],
          usages: [{ file: "a.scss" }],
        },
      ],
    }
    const findings = runTokensCheck(tokenCensus, cssVarCensus, {
      conventions: { cssVarPrefix: "--system-" },
    }).filter(f => f.ruleId === "tokens/token-unreferenced")
    expect(findings.map(f => f.entity)).toEqual(["system.fontWeight.light"])
  })

  it("walks a shadow's array-of-layers partialAliasOf shape", () => {
    const tokenCensus = {
      ok: true,
      tokens: [
        { id: "base.color.shadow.100", $type: "color" },
        {
          id: "system.shadow.raised",
          $type: "shadow",
          value: [{ color: "#000", offsetX: 0 }],
          partialAliasOf: [{ color: "base.color.shadow.100" }],
        },
      ],
    }
    const cssVarCensus = {
      vars: [
        {
          name: "--system-shadow-raised",
          declarations: [],
          usages: [{ file: "a.scss" }],
        },
      ],
    }
    const findings = runTokensCheck(tokenCensus, cssVarCensus, {
      conventions: { cssVarPrefix: "--system-" },
    }).filter(f => f.ruleId === "tokens/token-unreferenced")
    expect(findings).toEqual([])
  })
})

describe("candidateVarName kebab-cases camelCase segments", () => {
  it("maps a camelCase token id to the kebab-case var every emitter produces", () => {
    // Without this the SAME token is reported twice as two different false
    // findings: `system.borderWidth.medium` as `token-unreferenced` (expecting
    // `--system-borderWidth-medium`, which nothing declares) and the real
    // `--system-border-width-medium` as `token-untracked` (declared, backed by
    // no apparent token).
    expect(candidateVarName("system.borderWidth.medium", "--system-")).toBe(
      "--system-border-width-medium",
    )
    expect(candidateVarName("base.color.vividPurple.600", "--system-")).toBe(
      "--system-base-color-vivid-purple-600",
    )
  })

  it("leaves an already-kebab or single-word segment alone", () => {
    expect(candidateVarName("system.radius.md", "--system-")).toBe(
      "--system-radius-md",
    )
    expect(candidateVarName("system.color.bg.high-contrast", "--system-")).toBe(
      "--system-color-bg-high-contrast",
    )
  })
})

// ---------------------------------------------------------------------------
// DTCG COMPOSITE tokens — one token, MANY custom properties.
//
// Regression pins for the false-finding class measured on a real design
// system: 280 false `token-untracked` + 45 false `token-unreferenced` from a
// single unmodeled fact. A composite `$type` (DTCG: border, gradient, shadow,
// strokeStyle, transition, typography) has an OBJECT `$value` whose keys are
// sub-properties, and every DTCG emitter flattens each key into its own custom
// property (`--x-font-size`, `--x-line-height`, …) alongside an optional
// shorthand for the token itself. A one-token-one-var hypothesis therefore
// reports each emitted sub-field var as untracked AND the parent as
// unreferenced — the same double-report the kebab-case fix removed, one layer
// up.
//
// The trap these pin against: `$type` is what marks a composite, NOT "the
// value is an object". A `color` normalizes to `{alpha, colorSpace,
// components}` and a `dimension` to `{value, unit}` — expanding those would
// invent `--x-color-space` and `--x-unit` and silently accept junk vars as
// token-backed, which is strictly worse than the bug being fixed.
// ---------------------------------------------------------------------------

function compositeToken(id, $type, value) {
  return { id, $type, value }
}

describe("composite tokens expand to one var per sub-field", () => {
  const TYPOGRAPHY = {
    fontFamily: "Some Sans",
    fontSize: { value: 1, unit: "rem" },
    fontWeight: 600,
    letterSpacing: { value: 0, unit: "em" },
    lineHeight: 1.5,
  }

  it("does not report a composite's emitted sub-field vars as untracked", () => {
    const findings = runTokensCheck(
      tokenCensus([compositeToken("acme.text.body", "typography", TYPOGRAPHY)]),
      varCensus([
        cssVar("--acme-text-body-font-family", {
          declarations: [{ file: "t.css", line: 1 }],
        }),
        cssVar("--acme-text-body-font-size", {
          declarations: [{ file: "t.css", line: 2 }],
        }),
        cssVar("--acme-text-body-font-weight", {
          declarations: [{ file: "t.css", line: 3 }],
        }),
        cssVar("--acme-text-body-letter-spacing", {
          declarations: [{ file: "t.css", line: 4 }],
        }),
        cssVar("--acme-text-body-line-height", {
          declarations: [{ file: "t.css", line: 5 }],
        }),
      ]),
      config(),
    )
    expect(findings.filter(f => f.ruleId === "tokens/token-untracked")).toEqual(
      [],
    )
  })

  it("counts a composite as referenced when only a SUB-FIELD var is used", () => {
    // Measured: all 45 composite parents on a real design system were used
    // this way — components consume `var(--x-font-size)` directly and never
    // the parent shorthand. Judging the parent name alone called every one dead.
    const findings = runTokensCheck(
      tokenCensus([compositeToken("acme.text.body", "typography", TYPOGRAPHY)]),
      varCensus([
        cssVar("--acme-text-body-font-size", {
          declarations: [{ file: "t.css", line: 1 }],
          usages: [{ file: "c.css", line: 9 }],
        }),
      ]),
      config(),
    )
    expect(
      findings.filter(f => f.ruleId === "tokens/token-unreferenced"),
    ).toEqual([])
  })

  it("still reports a composite whose parent AND every sub-field var is unused", () => {
    const findings = runTokensCheck(
      tokenCensus([
        compositeToken("acme.text.unused", "typography", TYPOGRAPHY),
      ]),
      varCensus([]),
      config(),
    )
    expect(findingIds(findings)).toEqual(["tokens/token-unreferenced"])
  })

  it("does NOT expand a color, whose normalized value is also an object", () => {
    // `--acme-color-fg-alpha` is not a var any emitter produces for this
    // token; accepting it as token-backed would mute a genuinely untracked var.
    const findings = runTokensCheck(
      tokenCensus([
        compositeToken("acme.color.fg", "color", {
          alpha: 1,
          colorSpace: "srgb",
          components: [0, 0, 0],
        }),
      ]),
      varCensus([
        cssVar("--acme-color-fg", {
          declarations: [{ file: "t.css", line: 1 }],
          usages: [{ file: "c.css", line: 2 }],
        }),
        cssVar("--acme-color-fg-alpha", {
          declarations: [{ file: "hand-written.css", line: 3 }],
        }),
      ]),
      config(),
    )
    expect(findings).toEqual([
      expect.objectContaining({
        ruleId: "tokens/token-untracked",
        entity: "--acme-color-fg-alpha",
      }),
    ])
  })

  it("does NOT expand a dimension, whose value object is {value, unit}", () => {
    const findings = runTokensCheck(
      tokenCensus([
        compositeToken("acme.space.md", "dimension", { value: 8, unit: "px" }),
      ]),
      varCensus([
        cssVar("--acme-space-md", {
          declarations: [{ file: "t.css", line: 1 }],
          usages: [{ file: "c.css", line: 2 }],
        }),
        cssVar("--acme-space-md-unit", {
          declarations: [{ file: "hand-written.css", line: 3 }],
        }),
      ]),
      config(),
    )
    expect(findings).toEqual([
      expect.objectContaining({
        ruleId: "tokens/token-untracked",
        entity: "--acme-space-md-unit",
      }),
    ])
  })

  it("does not expand a composite whose value is an array, and does not throw", () => {
    // A multi-layer `shadow` normalizes to an array — there is no sub-field
    // name to derive, so the hypothesis simply does not apply.
    const findings = runTokensCheck(
      tokenCensus([
        compositeToken("acme.shadow.raised", "shadow", [
          { color: "#000", offsetX: 0 },
        ]),
      ]),
      varCensus([
        cssVar("--acme-shadow-raised", {
          declarations: [{ file: "t.css", line: 1 }],
          usages: [{ file: "c.css", line: 2 }],
        }),
      ]),
      config(),
    )
    expect(findings).toEqual([])
  })

  it("keeps a sub-field var used-but-undeclared out of var-unresolved", () => {
    const findings = runTokensCheck(
      tokenCensus([compositeToken("acme.text.body", "typography", TYPOGRAPHY)]),
      varCensus([
        cssVar("--acme-text-body-line-height", {
          usages: [{ file: "c.css", line: 4 }],
        }),
      ]),
      config(),
    )
    expect(findings.filter(f => f.ruleId === "tokens/var-unresolved")).toEqual(
      [],
    )
  })
})

// ---------------------------------------------------------------------------
// One variable, one finding (issue #170).
//
// A mode-scoped token set declares the same semantic token once per mode, and
// every mode folds to ONE custom property. "Nothing references this variable"
// is then one fact about one variable, and reporting it per declaring token
// stated it twice — measured on a real design system, 268 findings covered
// only 231 distinct variables.
//
// Both findings in such a pair were TRUE, so this is redundancy rather than a
// false finding. It still mattered: a consumer reading the count saw 14% more
// work than existed, and would have fixed each pair once.
// ---------------------------------------------------------------------------

describe("token-unreferenced deduplicates by variable (#170)", () => {
  const modeScoped = {
    ok: true,
    tokens: [
      { id: "system/dark.color.bg.disabled", $type: "color" },
      { id: "system/light.color.bg.disabled", $type: "color" },
    ],
  }
  const noVars = { ok: true, vars: [] }
  const prefixed = { conventions: { cssVarPrefix: "--system-" } }

  it("emits ONE finding for two modes of the same token", () => {
    const findings = runTokensCheck(modeScoped, noVars, prefixed)
    const unreferenced = findings.filter(
      f => f.ruleId === "tokens/token-unreferenced",
    )
    expect(unreferenced).toHaveLength(1)
    expect(unreferenced[0].data.expectedVar).toBe("--system-color-bg-disabled")
  })

  it("names every declaring token, losing nothing to the collapse", () => {
    const [finding] = runTokensCheck(modeScoped, noVars, prefixed).filter(
      f => f.ruleId === "tokens/token-unreferenced",
    )
    expect(finding.data.tokens).toEqual([
      "system/dark.color.bg.disabled",
      "system/light.color.bg.disabled",
    ])
    expect(finding.message).toContain("system/dark.color.bg.disabled")
    expect(finding.message).toContain("system/light.color.bg.disabled")
  })

  it("still emits one finding per token when the variables DIFFER", () => {
    // The collapse must key on the variable, never on "these look similar" —
    // two tokens with distinct vars are two separate facts.
    const distinct = {
      ok: true,
      tokens: [
        { id: "system/dark.color.bg.disabled", $type: "color" },
        { id: "system/dark.color.bg.hover", $type: "color" },
      ],
    }
    const unreferenced = runTokensCheck(distinct, noVars, prefixed).filter(
      f => f.ruleId === "tokens/token-unreferenced",
    )
    expect(unreferenced).toHaveLength(2)
    expect(unreferenced.map(f => f.data.expectedVar).sort()).toEqual([
      "--system-color-bg-disabled",
      "--system-color-bg-hover",
    ])
  })

  it("reads as a list, not a chain of ands, for three or more modes", () => {
    // light/dark/high-contrast is a real mode set. `"a" and "b" and "c"` reads
    // as three separate facts rather than one variable declared three times.
    const threeModes = {
      ok: true,
      tokens: [
        { id: "system/dark.color.bg.disabled", $type: "color" },
        { id: "system/hc.color.bg.disabled", $type: "color" },
        { id: "system/light.color.bg.disabled", $type: "color" },
      ],
    }
    const [finding] = runTokensCheck(threeModes, noVars, prefixed).filter(
      f => f.ruleId === "tokens/token-unreferenced",
    )
    expect(finding.data.tokens).toHaveLength(3)
    expect(finding.message).toContain(
      'tokens "system/dark.color.bg.disabled", "system/hc.color.bg.disabled" and "system/light.color.bg.disabled"',
    )
  })

  it("describes sub-properties if ANY token in the group is composite", () => {
    // `composite` must be OR-ed across the group, not read off whichever token
    // was inserted first: sub-property vars WERE checked for usage, so the
    // wording must not depend on input order.
    const mixed = {
      ok: true,
      tokens: [
        { id: "system/dark.type.body", $type: "typography" },
        { id: "system/light.type.body", $type: "color" },
      ],
    }
    const forward = runTokensCheck(mixed, noVars, prefixed).filter(
      f => f.ruleId === "tokens/token-unreferenced",
    )
    const reversed = runTokensCheck(
      { ok: true, tokens: [...mixed.tokens].reverse() },
      noVars,
      prefixed,
    ).filter(f => f.ruleId === "tokens/token-unreferenced")
    expect(forward.map(f => f.message)).toEqual(reversed.map(f => f.message))
  })

  it("is deterministic in which token becomes the entity", () => {
    const forward = runTokensCheck(modeScoped, noVars, prefixed)
    const reversed = runTokensCheck(
      { ok: true, tokens: [...modeScoped.tokens].reverse() },
      noVars,
      prefixed,
    )
    expect(JSON.stringify(forward)).toBe(JSON.stringify(reversed))
  })

  // issue #191: a token-id entity for a GROUPED finding always picks the
  // alphabetically-first token — "dark" before "light" — which reads as a
  // dark-only false positive to anything scanning `entity` alone, even though
  // the message and `data.tokens` already name both. The var name has no such
  // bias, because it is the one thing every member of the group agrees on.
  it("keys a grouped finding's entity on the shared var, not a token id", () => {
    const [finding] = runTokensCheck(modeScoped, noVars, prefixed).filter(
      f => f.ruleId === "tokens/token-unreferenced",
    )
    expect(finding.entity).toBe("--system-color-bg-disabled")
    expect(finding.entity).not.toBe("system/dark.color.bg.disabled")
  })

  it("still keys a single-token finding's entity on the token id", () => {
    // The grouped case is the exception, not a rule-wide change of vocabulary
    // — the common case (one token, one var) stays token-centric.
    const single = {
      ok: true,
      tokens: [{ id: "system.color.bg.hover", $type: "color" }],
    }
    const [finding] = runTokensCheck(single, noVars, prefixed).filter(
      f => f.ruleId === "tokens/token-unreferenced",
    )
    expect(finding.entity).toBe("system.color.bg.hover")
  })

  it("still names the first declaring token in data.token for a grouped finding", () => {
    const [finding] = runTokensCheck(modeScoped, noVars, prefixed).filter(
      f => f.ruleId === "tokens/token-unreferenced",
    )
    expect(finding.data.token).toBe("system/dark.color.bg.disabled")
  })

  it("formats message with proper conjunctions for 3+ tokens", () => {
    // The message format should be: "a" and "b" for 2 items, "a", "b" and "c"
    // for 3+, not chained with multiple "and"s.
    const threeTokens = {
      ok: true,
      tokens: [
        { id: "theme/contrast.color.bg.default", $type: "color" },
        { id: "theme/dark.color.bg.default", $type: "color" },
        { id: "theme/light.color.bg.default", $type: "color" },
      ],
    }
    const [finding] = runTokensCheck(threeTokens, noVars, prefixed).filter(
      f => f.ruleId === "tokens/token-unreferenced",
    )
    // Should have all three tokens in the data
    expect(finding.data.tokens).toEqual([
      "theme/contrast.color.bg.default",
      "theme/dark.color.bg.default",
      "theme/light.color.bg.default",
    ])
    // Should mention all three tokens in message
    expect(finding.message).toContain("theme/contrast.color.bg.default")
    expect(finding.message).toContain("theme/dark.color.bg.default")
    expect(finding.message).toContain("theme/light.color.bg.default")
    // Should have proper formatting: "a", "b" and "c" not "a" and "b" and "c"
    expect(finding.message).toMatch(
      /"theme\/contrast\.color\.bg\.default",\s*"theme\/dark\.color\.bg\.default"\s+and\s+"theme\/light\.color\.bg\.default"/,
    )
  })
})

// ---------------------------------------------------------------------------
// Scoping token-unreferenced by tier prefix (issue #182).
//
// A design system deliberately keeps a colour ramp or spacing scale complete
// even when the current component set consumes only part of it. An unused
// PRIMITIVE is raw material; an unused SEMANTIC token is dead design-system
// surface. Only the second is worth a human.
//
// Measured on a real design system: 233 findings, 135 of them primitive-scale
// steps — 58% noise, and the only way to quiet it was turning the whole rule
// off, which loses the semantic half too. That project had done exactly that.
//
// The option takes PREFIXES FROM THE PROJECT. This engine must not learn what
// "base" means or which tier is primitive: that is a fact about a consumer's
// token architecture, not about drift.
// ---------------------------------------------------------------------------

describe("token-unreferenced — ignorePrefixes (#182)", () => {
  const tokens = {
    ok: true,
    tokens: [
      { id: "base.color.blue.100", $type: "color" },
      { id: "base.spacing.112", $type: "dimension" },
      { id: "system.color.fg.unused", $type: "color" },
    ],
  }
  const noVars = { ok: true, vars: [] }
  const withOption = prefixes => ({
    conventions: { cssVarPrefix: "--x-" },
    rules: {
      "tokens/token-unreferenced": ["review", { ignorePrefixes: prefixes }],
    },
  })
  const unreferenced = findings =>
    findings
      .filter(f => f.ruleId === "tokens/token-unreferenced")
      .map(f => f.entity)
      .sort()

  it("reports every tier when no prefix is configured", () => {
    const findings = runTokensCheck(tokens, noVars, {
      conventions: { cssVarPrefix: "--x-" },
    })
    expect(unreferenced(findings)).toEqual([
      "base.color.blue.100",
      "base.spacing.112",
      "system.color.fg.unused",
    ])
  })

  it("drops the ignored tier and KEEPS the semantic one", () => {
    // The whole point: the semantic token must survive, or this is just an
    // elaborate way to turn the rule off.
    const findings = runTokensCheck(tokens, noVars, withOption(["base."]))
    expect(unreferenced(findings)).toEqual(["system.color.fg.unused"])
  })

  it("accepts more than one prefix", () => {
    const findings = runTokensCheck(
      tokens,
      noVars,
      withOption(["base.color.", "base.spacing."]),
    )
    expect(unreferenced(findings)).toEqual(["system.color.fg.unused"])
  })

  it("matches a PREFIX, not a substring", () => {
    // `color.` appears inside every id here. Substring matching would silence
    // the whole census while looking like it worked.
    const findings = runTokensCheck(tokens, noVars, withOption(["color."]))
    expect(unreferenced(findings)).toHaveLength(3)
  })

  it("has no opinion by default", () => {
    // The engine must not ship knowing that "base" is a primitive tier.
    const findings = runTokensCheck(tokens, noVars, withOption([]))
    expect(unreferenced(findings)).toHaveLength(3)
  })

  it("does not scope any OTHER rule", () => {
    // The option is declared on one rule. A prefix that silences
    // token-unreferenced must not quietly silence token-untracked too.
    const vars = {
      ok: true,
      vars: [
        {
          name: "--x-base-orphan-var",
          declarations: [{ file: "a.scss", line: 1 }],
          usages: [],
        },
      ],
    }
    const findings = runTokensCheck(tokens, vars, withOption(["base."]))
    expect(findings.some(f => f.ruleId === "tokens/token-untracked")).toBe(true)
  })
  // issue #191's fix: a grouped finding's `entity` becomes the shared var
  // name (`--x-system-...`), not a token id (`system/dark....`).
  // ignorePrefixes is authored against TOKEN id prefixes, so it must keep
  // matching the token id regardless of what `entity` displays — otherwise
  // a grouped, mode-scoped token would silently stop being filterable the
  // moment it started sharing a var with its other mode. The prefix here
  // deliberately includes the mode segment (`system/dark.`, not `system.`) —
  // a mode-marked id never starts with the bare tier prefix (it starts with
  // `tier/mode.`), so that is the realistic shape a project scoping a moded
  // tier would actually write.
  it("still filters a GROUPED finding by its token-id prefix, not its var-name entity", () => {
    const modeScoped = {
      ok: true,
      tokens: [
        { id: "system/dark.color.neutral.100", $type: "color" },
        { id: "system/light.color.neutral.100", $type: "color" },
      ],
    }
    const findings = runTokensCheck(
      modeScoped,
      noVars,
      withOption(["system/dark."]),
    )
    expect(unreferenced(findings)).toEqual([])
  })

  it("a rule that does NOT declare the option cannot acquire it", () => {
    // The distinction the earlier test missed. `resolveRuleConfig` merges
    // config options over registry defaults without rejecting unknown keys, so
    // checking the RESOLVED options alone let any rule pick this up by being
    // configured with it — here matching a CSS var name against a token-id
    // option, behaviour no doc describes. The gate is the registry
    // DECLARATION, not the resolved value.
    const vars = {
      ok: true,
      vars: [
        {
          name: "--x-legacy-thing",
          declarations: [{ file: "a.scss", line: 1 }],
          usages: [],
        },
      ],
    }
    const findings = runTokensCheck({ ok: true, tokens: [] }, vars, {
      conventions: { cssVarPrefix: "--x-" },
      rules: {
        "tokens/token-untracked": ["warn", { ignorePrefixes: ["--x-legacy-"] }],
      },
    })
    expect(
      findings.filter(f => f.ruleId === "tokens/token-untracked"),
    ).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// The design side (ADR-003 Phase 5.3): value-matched, never name-matched.
// ---------------------------------------------------------------------------

function tokenWithCssValue(id, cssValue) {
  return { id, cssValue }
}

function designTokenCensus(entries) {
  return { entries }
}

// The code-side fixture tokens below have no matching CSS var usage (this
// describe block isn't testing THAT rule), so `tokens/token-unreferenced`
// legitimately fires alongside on every case — filtered out here so each
// assertion below is about design-value-untracked alone.
function designOnly(findings) {
  return findings.filter(f => f.ruleId === "tokens/design-value-untracked")
}

describe("runTokensCheck — tokens/design-value-untracked (ADR-003 Phase 5.3)", () => {
  it("fires when a design value matches no code token's cssValue anywhere", () => {
    const findings = runTokensCheck(
      tokenCensus([tokenWithCssValue("acme.color.fg", "#111111")]),
      varCensus([]),
      config(),
      designTokenCensus([{ name: "fg/inverse/default", value: "#181818" }]),
    )
    expect(designOnly(findings)).toEqual([
      expect.objectContaining({
        ruleId: "tokens/design-value-untracked",
        surface: "tokens",
        side: "design",
        entity: "fg/inverse/default",
        data: { name: "fg/inverse/default", value: "#181818" },
      }),
    ])
  })

  it("stays silent when the value matches, EXACTLY (case-insensitive)", () => {
    const findings = runTokensCheck(
      tokenCensus([tokenWithCssValue("acme.color.fg", "#111111")]),
      varCensus([]),
      config(),
      designTokenCensus([{ name: "fg/default", value: "#111111" }]),
    )
    expect(designOnly(findings)).toEqual([])
  })

  it("matches after stripping a trailing px unit — the one measured friction (a design provider's dimensions come back unitless)", () => {
    const findings = runTokensCheck(
      tokenCensus([tokenWithCssValue("acme.spacing.md", "16px")]),
      varCensus([]),
      config(),
      designTokenCensus([{ name: "inset/md", value: "16" }]),
    )
    expect(designOnly(findings)).toEqual([])
  })

  it("matches after expanding a 3-digit hex shorthand — the second measured friction (cssValue minifies #111111 to #111)", () => {
    const findings = runTokensCheck(
      tokenCensus([tokenWithCssValue("acme.color.fg", "#111")]),
      varCensus([]),
      config(),
      designTokenCensus([{ name: "fg/default", value: "#111111" }]),
    )
    expect(designOnly(findings)).toEqual([])
  })

  it("matches after expanding a 4-digit hex shorthand — the same minification, one alpha byte further (#446)", () => {
    // `#00000033` minifies to `#0003` for the same reason `#111111` minifies
    // to `#111`: every byte's two digits repeat, the alpha byte included.
    const pairs = [
      ["#0003", "#00000033"],
      ["#0006", "#00000066"],
      ["#0009", "#00000099"],
      ["#000c", "#000000cc"],
      ["#fff3", "#ffffff33"],
      ["#fff6", "#ffffff66"],
      ["#fff9", "#ffffff99"],
      ["#fffc", "#ffffffcc"],
    ]
    for (const [cssValue, designValue] of pairs) {
      const findings = runTokensCheck(
        tokenCensus([tokenWithCssValue("acme.color.alpha", cssValue)]),
        varCensus([]),
        config(),
        designTokenCensus([{ name: "color/alpha", value: designValue }]),
      )
      expect(designOnly(findings)).toEqual([])
    }
  })

  it("matches a CSS-quoted font family against the bare design value (issue #346)", () => {
    // `resolveTokenCssValue` quotes a family whose name contains a space —
    // correct CSS, and the reason every fontFamily variable was reported
    // untracked while its code counterpart held the identical text.
    const findings = runTokensCheck(
      tokenCensus([
        tokenWithCssValue("acme.fontFamily.sans", '"Instrument Sans"'),
      ]),
      varCensus([]),
      config(),
      designTokenCensus([
        { name: "fontFamily/sans", value: "Instrument Sans" },
      ]),
    )
    expect(designOnly(findings)).toEqual([])
  })

  it("matches in the other direction too — a quoted design value against a bare code one (#346)", () => {
    const findings = runTokensCheck(
      tokenCensus([tokenWithCssValue("acme.fontFamily.mono", "Inconsolata")]),
      varCensus([]),
      config(),
      designTokenCensus([
        { name: "fontFamily/monospace", value: '"Inconsolata"' },
      ]),
    )
    expect(designOnly(findings)).toEqual([])
  })

  it("leaves a multi-family stack's inner quotes alone — only a WHOLLY quoted value is unwrapped (#346)", () => {
    // Stripping the outer characters here would splice two families into one
    // string. The stack matches its own identical form and nothing else.
    const stack = '"Instrument Sans", sans-serif'
    const matching = runTokensCheck(
      tokenCensus([tokenWithCssValue("acme.fontFamily.sans", stack)]),
      varCensus([]),
      config(),
      designTokenCensus([{ name: "fontFamily/sans", value: stack }]),
    )
    expect(designOnly(matching)).toEqual([])

    const spliced = runTokensCheck(
      tokenCensus([tokenWithCssValue("acme.fontFamily.sans", stack)]),
      varCensus([]),
      config(),
      designTokenCensus([
        { name: "fontFamily/sans", value: 'Instrument Sans", "sans-serif' },
      ]),
    )
    // Amendment 4: the name maps uniquely, so the differing value is a
    // per-token MISMATCH now rather than coverage — still a finding, still
    // because the inner quotes were left alone.
    expect(designOnly(spliced)).toEqual([])
    expect(
      spliced
        .filter(f => f.ruleId === "tokens/design-token-mismatch")
        .map(f => f.entity),
    ).toEqual(["fontFamily/sans"])
  })

  it("says nothing about an entry with no value to compare (issue #347)", () => {
    // `""` is the absence of a value, not a value that fails to match. The
    // engine never read one, so it cannot report the outcome of a comparison.
    const findings = runTokensCheck(
      tokenCensus([tokenWithCssValue("acme.color.fg", "#111111")]),
      varCensus([]),
      config(),
      designTokenCensus([
        { name: "gradient/rainbow/default/dark", value: "" },
        { name: "gradient/rainbow/default/light", value: "   " },
        { name: "gradient/rainbow/hover/dark" },
      ]),
    )
    expect(designOnly(findings)).toEqual([])
  })

  it("a name that maps to exactly one token asserts identity — a differing value is a MISMATCH, never merely untracked (Amendment 4)", () => {
    // Pre-Amendment 4 this test asserted the opposite ("never matches by
    // name"). The corpus measurement behind #280 reversed that for tokens.
    const findings = runTokensCheck(
      tokenCensus([tokenWithCssValue("acme.color.fg", "#111111")]),
      varCensus([]),
      config(),
      designTokenCensus([{ name: "color/fg", value: "#999999" }]),
    )
    expect(designOnly(findings)).toEqual([])
    expect(
      findings.filter(f => f.ruleId === "tokens/design-token-mismatch"),
    ).toHaveLength(1)
  })

  it("is NOT evaluated at all when designTokenCensus is omitted — the same OMITTED-means-skip contract as usageCensus", () => {
    const findings = runTokensCheck(
      tokenCensus([tokenWithCssValue("acme.color.fg", "#111111")]),
      varCensus([]),
      config(),
    )
    expect(designOnly(findings)).toEqual([])
  })

  it("never checks the reverse direction — a code token with no design counterpart is not reported", () => {
    const findings = runTokensCheck(
      tokenCensus([
        tokenWithCssValue("acme.color.fg", "#111111"),
        tokenWithCssValue("acme.color.unsampled", "#222222"),
      ]),
      varCensus([]),
      config(),
      designTokenCensus([{ name: "fg/default", value: "#111111" }]),
    )
    expect(designOnly(findings)).toEqual([])
  })

  it("a code token with no cssValue at all (a multi-property composite) is never a match candidate", () => {
    const findings = runTokensCheck(
      tokenCensus([{ id: "acme.typography.body" /* no cssValue */ }]),
      varCensus([]),
      config(),
      designTokenCensus([{ name: "typography/body", value: "16" }]),
    )
    expect(designOnly(findings).map(f => f.entity)).toEqual(["typography/body"])
  })

  it("honors a rules override, including 'off'", () => {
    const args = [
      tokenCensus([tokenWithCssValue("acme.color.fg", "#111111")]),
      varCensus([]),
    ]
    const designCensus = designTokenCensus([
      { name: "fg/inverse/default", value: "#181818" },
    ])

    const off = runTokensCheck(
      ...args,
      { ...config(), rules: { "tokens/design-value-untracked": "off" } },
      designCensus,
    )
    expect(designOnly(off)).toEqual([])

    const warned = runTokensCheck(
      ...args,
      { ...config(), rules: { "tokens/design-value-untracked": "warn" } },
      designCensus,
    )
    expect(designOnly(warned)[0].severity).toBe("warn")
  })

  it("is sorted by design entry name, deterministic regardless of input order", () => {
    const a = runTokensCheck(
      tokenCensus([tokenWithCssValue("acme.color.fg", "#111111")]),
      varCensus([]),
      config(),
      designTokenCensus([
        { name: "zzz/untracked", value: "#aaaaaa" },
        { name: "aaa/untracked", value: "#bbbbbb" },
      ]),
    )
    const b = runTokensCheck(
      tokenCensus([tokenWithCssValue("acme.color.fg", "#111111")]),
      varCensus([]),
      config(),
      designTokenCensus([
        { name: "aaa/untracked", value: "#bbbbbb" },
        { name: "zzz/untracked", value: "#aaaaaa" },
      ]),
    )
    expect(a).toEqual(b)
    expect(designOnly(a).map(f => f.entity)).toEqual([
      "aaa/untracked",
      "zzz/untracked",
    ])
  })
})

// ---------------------------------------------------------------------------
// ADR-003 Amendment 4 (#280) — design-name → token-id candidates, and the two
// rules that hang off them. The rule was measured on a real corpus first.
// ---------------------------------------------------------------------------

describe("candidateTokenIds — the candidate rule", () => {
  const T = (id, $type, cssValue) => ({ id, $type, cssValue })
  const corpus = [
    T("system.inset.md", "dimension", "16px"),
    T("system/light.color.fg.default", "color", "#111"),
    T("system/dark.color.fg.default", "color", "#eee"),
    T("system.print.color.fg.default", "color", "#000"),
    T("system.typography.heading.h1", "typography"),
    T("system.fontSize.heading.h1", "dimension", "48px"),
    T("base.fontWeight.bold", "fontWeight", "700"),
    T("system.fontWeight.bold", "fontWeight", "700"),
    T("system.color.bg.default", "color", "#fff"),
    T("system.color.border.default", "color", "#ccc"),
  ]

  it("matches trailing segments, folded, with mode heads collapsed to ONE candidate", () => {
    expect(candidateTokenIds("inset/md", "16", corpus)).toEqual([
      "system.inset.md",
    ])
    expect(candidateTokenIds("fg/default", "#111", corpus)).toEqual([
      "system.color.fg.default",
      "system.print.color.fg.default",
    ])
  })

  it("a single-segment name never matches a nested id — `default` alone would be a coin flip", () => {
    expect(candidateTokenIds("default", "#fff", corpus)).toEqual([])
  })

  it("a single-segment name pairs with the token directly under a root (#637)", () => {
    expect(candidateTokenIds("none", 0, [{ id: "system.none" }], {})).toEqual([
      "system.none",
    ])
    // Mode heads collapse here too: two modes of one root-level token are
    // ONE candidate, and a nested `none` is still not a candidate.
    expect(
      candidateTokenIds("None", "0", [
        T("system/light.none", "dimension", "0px"),
        T("system/dark.none", "dimension", "0px"),
        T("system.spacing.none", "dimension", "0px"),
      ]),
    ).toEqual(["system.none"])
    // Two roots carrying the same name stay a tie, for the caller to call
    // ambiguous.
    expect(
      candidateTokenIds("none", "0", [T("base.none"), T("system.none")]),
    ).toEqual(["base.none", "system.none"])
  })

  it("narrows by the value's unmistakable shape: Font(…) can only be typography", () => {
    expect(
      candidateTokenIds("Heading/h1", "Font(family: x, size: 48)", corpus),
    ).toEqual(["system.typography.heading.h1"])
    // A shape that says nothing leaves both.
    expect(candidateTokenIds("Heading/h1", "48", corpus)).toEqual([
      "system.fontSize.heading.h1",
      "system.typography.heading.h1",
    ])
  })

  it("codeAuthoritativeGroups drops candidates under those prefixes", () => {
    expect(
      candidateTokenIds("fg/default", "#111", corpus, {
        codeAuthoritativeGroups: ["system.print"],
      }),
    ).toEqual(["system.color.fg.default"])
  })

  it("tokenMap is the answer when present; null declares no token", () => {
    expect(
      candidateTokenIds("fontWeight/bold", "700", corpus, {
        tokenMap: { "fontWeight/bold": "base.fontWeight.bold" },
      }),
    ).toEqual(["base.fontWeight.bold"])
    expect(
      candidateTokenIds("fontWeight/bold", "700", corpus, {
        tokenMap: { "fontWeight/bold": null },
      }),
    ).toEqual([])
    // Without it, the tier tie stays a tie.
    expect(candidateTokenIds("fontWeight/bold", "700", corpus)).toEqual([
      "base.fontWeight.bold",
      "system.fontWeight.bold",
    ])
  })
})

describe("runTokensCheck — design-token-mismatch / design-token-ambiguous (#280)", () => {
  const rulesOf = findings =>
    findings.filter(f => f.side === "design").map(f => f.ruleId)
  const withOptions = options => config({ design: { provider: "x", options } })

  it("one candidate whose value matches is silent — even when the value is otherwise untracked", () => {
    const findings = runTokensCheck(
      tokenCensus([tokenWithCssValue("acme.inset.md", "16px")]),
      varCensus([]),
      config(),
      designTokenCensus([{ name: "inset/md", value: "16" }]),
    )
    expect(rulesOf(findings)).toEqual([])
  })

  it("one candidate whose value differs is design-token-mismatch (error), not untracked", () => {
    const findings = runTokensCheck(
      tokenCensus([tokenWithCssValue("acme.inset.md", "16px")]),
      varCensus([]),
      config(),
      designTokenCensus([{ name: "inset/md", value: "24" }]),
    )
    expect(rulesOf(findings)).toEqual(["tokens/design-token-mismatch"])
    expect(findings.find(f => f.side === "design")).toEqual(
      expect.objectContaining({
        severity: "error",
        entity: "inset/md",
        data: {
          name: "inset/md",
          value: "24",
          token: "acme.inset.md",
          expected: ["16px"],
        },
      }),
    )
  })

  it("a mode-scoped token matches when the design value equals ANY mode's value", () => {
    const findings = runTokensCheck(
      tokenCensus([
        tokenWithCssValue("acme/light.color.fg.default", "#111"),
        tokenWithCssValue("acme/dark.color.fg.default", "#eee"),
      ]),
      varCensus([]),
      config(),
      designTokenCensus([{ name: "fg/default", value: "#eeeeee" }]),
    )
    expect(rulesOf(findings)).toEqual([])
  })

  it("more than one candidate is design-token-ambiguous (review), listing them", () => {
    const findings = runTokensCheck(
      tokenCensus([
        tokenWithCssValue("base.fontWeight.bold", "700"),
        tokenWithCssValue("acme.fontWeight.bold", "700"),
      ]),
      varCensus([]),
      config(),
      designTokenCensus([{ name: "fontWeight/bold", value: "700" }]),
    )
    const [ambiguous] = findings.filter(f => f.side === "design")
    expect(rulesOf(findings)).toEqual(["tokens/design-token-ambiguous"])
    expect(ambiguous.severity).toBe("review")
    expect(ambiguous.data.candidates).toEqual([
      "acme.fontWeight.bold",
      "base.fontWeight.bold",
    ])
  })

  it("compares lengths across px/rem at the 16px root, rounding a design tool's floats", () => {
    const census = tokenCensus([
      tokenWithCssValue("acme.radius.sm", "0.5rem"),
      tokenWithCssValue("acme.radius.lg", "1rem"),
      tokenWithCssValue("acme.opacity.faint", "0.3"),
    ])
    const findings = runTokensCheck(
      census,
      varCensus([]),
      config(),
      designTokenCensus([
        { name: "radius/sm", value: "8" }, // 0.5rem — equal
        { name: "radius/lg", value: "8" }, // 1rem is 16 — real drift
        { name: "opacity/faint", value: "0.30000001192092896" }, // float noise
      ]),
    )
    const design = findings.filter(f => f.side === "design")
    expect(design.map(f => [f.ruleId, f.entity])).toEqual([
      ["tokens/design-token-mismatch", "radius/lg"],
    ])
  })

  it("an incomparable pair — em vs a bare number, a composite — is never a mismatch; it falls through to coverage", () => {
    const census = tokenCensus([
      tokenWithCssValue("acme.letterSpacing.wide", "0.01em"),
      tokenWithCssValue("acme.elevation.4", "0 4px 6px -2px #00000005"),
    ])
    const findings = runTokensCheck(
      census,
      varCensus([]),
      config(),
      designTokenCensus([
        { name: "letterSpacing/wide", value: "0.10000000149011612" },
        { name: "elevation/4", value: "Effect(type: DROP_SHADOW, …)" },
      ]),
    )
    expect(
      findings.filter(f => f.side === "design").map(f => f.ruleId),
    ).toEqual([
      "tokens/design-value-untracked",
      "tokens/design-value-untracked",
    ])
  })

  it("no candidate falls back to the value-coverage rule", () => {
    const findings = runTokensCheck(
      tokenCensus([tokenWithCssValue("acme.color.fg", "#111111")]),
      varCensus([]),
      config(),
      designTokenCensus([{ name: "Black (#000) / 10%", value: "#000000" }]),
    )
    expect(rulesOf(findings)).toEqual(["tokens/design-value-untracked"])
  })

  it("design.options: tokenMap resolves a tie, codeAuthoritativeGroups drops a group, ignoreVariables skips entirely", () => {
    const census = tokenCensus([
      tokenWithCssValue("base.fontWeight.bold", "700"),
      tokenWithCssValue("acme.fontWeight.bold", "600"),
      tokenWithCssValue("acme.print.color.fg.default", "#000"),
      tokenWithCssValue("acme.color.fg.default", "#111"),
    ])
    const design = designTokenCensus([
      { name: "fontWeight/bold", value: "700" },
      { name: "fg/default", value: "#222" },
      { name: "Gray / 500 (#C3C7CF)", value: "#c3c7cf" },
    ])
    const findings = runTokensCheck(
      census,
      varCensus([]),
      withOptions({
        tokenMap: { "fontWeight/bold": "acme.fontWeight.bold" },
        codeAuthoritativeGroups: ["acme.print"],
        ignoreVariables: ["/^Gray /"],
      }),
      design,
    )
    // fontWeight/bold → acme (600) vs 700: mismatch. fg/default → the one
    // non-print token (#111) vs #222: mismatch. Gray: skipped, not untracked.
    expect(rulesOf(findings)).toEqual([
      "tokens/design-token-mismatch",
      "tokens/design-token-mismatch",
    ])
    expect(
      findings.filter(f => f.side === "design").map(f => f.data.token),
    ).toEqual(["acme.color.fg.default", "acme.fontWeight.bold"])
  })
})

// ---------------------------------------------------------------------------
// Issue #380 part 2 — canonical typography, field-level mismatches, alpha hex.
// ---------------------------------------------------------------------------

describe("runTokensCheck — a text style against a typography token (#380)", () => {
  const typography = (id, value) => ({ id, $type: "typography", value })
  const H1 = typography("acme.typography.heading.h1", {
    fontFamily: ["Instrument Sans"],
    fontWeight: 600,
    fontSize: { value: 34, unit: "px" },
    lineHeight: 1.25,
    letterSpacing: { value: -0.02, unit: "em" },
  })
  const style = overrides => ({
    name: "Heading/h1",
    kind: "textStyle",
    value: "Font(…)",
    style: {
      fontFamily: "Instrument Sans",
      fontStyle: "SemiBold",
      fontSize: 34,
      lineHeight: { value: 42.5, unit: "PIXELS" }, // 42.5 / 34 = 1.25
      letterSpacing: { value: -2, unit: "PERCENT" }, // -0.02 em
      ...overrides,
    },
  })
  const designSide = findings => findings.filter(f => f.side === "design")

  it("matches when every field agrees after canonicalization: weight name → number, px line height → ratio, percent spacing → em", () => {
    const findings = runTokensCheck(
      tokenCensus([H1]),
      varCensus([]),
      config(),
      designTokenCensus([style()]),
    )
    expect(designSide(findings)).toEqual([])
  })

  it("names the differing FIELD, with both canonical values", () => {
    const findings = runTokensCheck(
      tokenCensus([H1]),
      varCensus([]),
      config(),
      designTokenCensus([
        style({
          fontStyle: "Bold",
          lineHeight: { value: 140, unit: "PERCENT" },
        }),
      ]),
    )
    const [finding] = designSide(findings)
    expect(finding.ruleId).toBe("tokens/design-token-mismatch")
    expect(finding.data.fields).toEqual([
      { field: "fontWeight", design: 700, code: 600 },
      { field: "lineHeight", design: 1.4, code: 1.25 },
    ])
    expect(finding.message).toContain(
      "fontWeight is 700 in design and 600 in code",
    )
    expect(finding.message).toContain(
      "lineHeight is 1.4 in design and 1.25 in code",
    )
  })

  it("a mode-scoped typography token matches when ANY mode agrees, and reports only when none does", () => {
    const light = typography("acme/light.typography.heading.h1", {
      ...H1.value,
      fontWeight: 700,
    })
    const dark = typography("acme/dark.typography.heading.h1", H1.value) // 600
    const agrees = runTokensCheck(
      tokenCensus([light, dark]),
      varCensus([]),
      config(),
      designTokenCensus([style()]), // SemiBold = 600 — the dark mode
    )
    expect(designSide(agrees)).toEqual([])
    const none = runTokensCheck(
      tokenCensus([light, dark]),
      varCensus([]),
      config(),
      designTokenCensus([style({ fontStyle: "Light" })]), // 300 — neither
    )
    const [finding] = designSide(none)
    expect(finding.ruleId).toBe("tokens/design-token-mismatch")
    expect(finding.data.modesCompared).toBe(2)
    expect(finding.message).toContain("no mode of the token agrees")
  })

  it("a field one side cannot express (lineHeight AUTO) is left out, never assumed", () => {
    const findings = runTokensCheck(
      tokenCensus([H1]),
      varCensus([]),
      config(),
      designTokenCensus([style({ lineHeight: { value: 0, unit: "AUTO" } })]),
    )
    expect(designSide(findings)).toEqual([])
  })

  it("a legacy prose entry with no `style` still falls through to coverage — never a field-level verdict", () => {
    const findings = runTokensCheck(
      tokenCensus([H1]),
      varCensus([]),
      config(),
      designTokenCensus([{ name: "Heading/h1", value: "Font(family: x)" }]),
    )
    expect(designSide(findings).map(f => f.ruleId)).toEqual([
      "tokens/design-value-untracked",
    ])
  })

  it("an 8-digit opaque hex equals the 6-digit color; a translucent one does not", () => {
    const census = tokenCensus([tokenWithCssValue("acme.color.fg", "#9cc0ff")])
    const opaque = runTokensCheck(
      census,
      varCensus([]),
      config(),
      designTokenCensus([{ name: "color/fg", value: "#9CC0FFFF" }]),
    )
    expect(designSide(opaque)).toEqual([])
    const translucent = runTokensCheck(
      census,
      varCensus([]),
      config(),
      designTokenCensus([{ name: "color/fg", value: "#9CC0FF80" }]),
    )
    expect(designSide(translucent).map(f => f.ruleId)).toEqual([
      "tokens/design-token-mismatch",
    ])
  })

  it("a 4-digit hex equals its 8-digit spelling, and still differs from another colour (#446)", () => {
    const pairs = [
      ["#0003", "#00000033"],
      ["#0006", "#00000066"],
      ["#0009", "#00000099"],
      ["#000c", "#000000CC"],
      ["#fff3", "#FFFFFF33"],
      ["#fff6", "#FFFFFF66"],
      ["#fff9", "#FFFFFF99"],
      ["#fffc", "#FFFFFFCC"],
    ]
    for (const [cssValue, designValue] of pairs) {
      const findings = runTokensCheck(
        tokenCensus([tokenWithCssValue("acme.color.fg", cssValue)]),
        varCensus([]),
        config(),
        designTokenCensus([{ name: "color/fg", value: designValue }]),
      )
      expect(designSide(findings)).toEqual([])
    }
    const differing = runTokensCheck(
      tokenCensus([tokenWithCssValue("acme.color.fg", "#0003")]),
      varCensus([]),
      config(),
      designTokenCensus([{ name: "color/fg", value: "#00000034" }]),
    )
    expect(designSide(differing).map(f => f.ruleId)).toEqual([
      "tokens/design-token-mismatch",
    ])
  })
})

// ---------------------------------------------------------------------------
// Issue #380 part 3 — `design.options.units` for a bare-number variable.
// ---------------------------------------------------------------------------

describe("runTokensCheck — design.options.units (#380)", () => {
  const designSide = findings => findings.filter(f => f.side === "design")
  const withUnits = units =>
    config({ design: { provider: "x", options: { units } } })
  const census = tokenCensus([
    tokenWithCssValue("acme.letterSpacing.wide", "0.01em"),
    tokenWithCssValue("acme.letterSpacing.tight", "-0.02em"),
  ])

  it("without a declaration, a bare number against an em token is incomparable and falls through — as before", () => {
    const findings = runTokensCheck(
      census,
      varCensus([]),
      config(),
      designTokenCensus([{ name: "letterSpacing/wide", value: "1" }]),
    )
    expect(designSide(findings).map(f => f.ruleId)).toEqual([
      "tokens/design-value-untracked",
    ])
  })

  it("`%` declares a fraction of the font size: 1 → 0.01em equal, -1 vs -0.02em a mismatch", () => {
    const findings = runTokensCheck(
      census,
      varCensus([]),
      withUnits({ letterSpacing: "%" }),
      designTokenCensus([
        { name: "letterSpacing/wide", value: "1" },
        { name: "letterSpacing/tight", value: "-1.0000000149" },
      ]),
    )
    expect(designSide(findings).map(f => [f.ruleId, f.entity])).toEqual([
      ["tokens/design-token-mismatch", "letterSpacing/tight"],
    ])
  })

  it("the longest matching prefix wins, and a `/`-boundary is required", () => {
    const findings = runTokensCheck(
      census,
      varCensus([]),
      withUnits({ letterSpacing: "px", "letterSpacing/wide": "%" }),
      designTokenCensus([{ name: "letterSpacing/wide", value: "1" }]),
    )
    expect(designSide(findings)).toEqual([]) // "%" won: 1% = 0.01em
    const other = runTokensCheck(
      tokenCensus([tokenWithCssValue("acme.letterSpacingX.wide", "0.01em")]),
      varCensus([]),
      withUnits({ letterSpacing: "%" }),
      designTokenCensus([{ name: "letterSpacingX/wide", value: "1" }]),
    )
    // `letterSpacingX` is not under the `letterSpacing` prefix — undeclared,
    // so incomparable, so coverage.
    expect(designSide(other).map(f => f.ruleId)).toEqual([
      "tokens/design-value-untracked",
    ])
  })

  it("`px` keeps a length a length: 8 with units px against 0.5rem is equal", () => {
    const findings = runTokensCheck(
      tokenCensus([tokenWithCssValue("acme.radius.sm", "0.5rem")]),
      varCensus([]),
      withUnits({ radius: "px" }),
      designTokenCensus([{ name: "radius/sm", value: "8" }]),
    )
    expect(designSide(findings)).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Issue #447 — durations. A provider renders a variable it types as a
// duration with its unit (`0.15s`, seconds being the tool's unit) and a code
// duration token is `150ms`; before this, neither side reduced to anything
// and a bare FLOAT holding milliseconds coincided with px lengths.
// ---------------------------------------------------------------------------

describe("runTokensCheck — durations (#447)", () => {
  const designSide = findings => findings.filter(f => f.side === "design")
  const withUnits = units =>
    config({ design: { provider: "x", options: { units } } })

  it("a duration variable in seconds equals a `ms` token: 0.15s vs 150ms", () => {
    const findings = runTokensCheck(
      tokenCensus([tokenWithCssValue("acme.duration.fast", "150ms")]),
      varCensus([]),
      config(),
      designTokenCensus([{ name: "duration/fast", value: "0.15s" }]),
    )
    expect(designSide(findings)).toEqual([])
  })

  it("a duration variable equals an `s` token, and a differing one is a mismatch", () => {
    const equal = runTokensCheck(
      tokenCensus([tokenWithCssValue("acme.duration.slow", "0.5s")]),
      varCensus([]),
      config(),
      designTokenCensus([{ name: "duration/slow", value: "0.5s" }]),
    )
    expect(designSide(equal)).toEqual([])
    const differing = runTokensCheck(
      tokenCensus([tokenWithCssValue("acme.duration.slow", "0.5s")]),
      varCensus([]),
      config(),
      designTokenCensus([{ name: "duration/slow", value: "0.3s" }]),
    )
    expect(designSide(differing).map(f => [f.ruleId, f.entity])).toEqual([
      ["tokens/design-token-mismatch", "duration/slow"],
    ])
  })

  it("a bare FLOAT declared `ms` by name prefix equals a `ms` token", () => {
    const findings = runTokensCheck(
      tokenCensus([tokenWithCssValue("acme.duration.base", "200ms")]),
      varCensus([]),
      withUnits({ duration: "ms" }),
      designTokenCensus([{ name: "duration/base", value: "200" }]),
    )
    expect(designSide(findings)).toEqual([])
  })

  it("an undeclared bare 200 is a length, so it never matches a duration token", () => {
    const findings = runTokensCheck(
      tokenCensus([
        { id: "acme.duration.base", cssValue: "200ms", $type: "duration" },
      ]),
      varCensus([]),
      config(),
      designTokenCensus([{ name: "duration/base", value: "200" }]),
    )
    // Identity resolves by name, but the kinds differ (length vs duration),
    // so no verdict is possible and it falls through to coverage.
    expect(designSide(findings).map(f => f.ruleId)).toEqual([
      "tokens/design-value-untracked",
    ])
  })
})

// ---------------------------------------------------------------------------
// Issue #404 — per-mode comparison. The code side declares one token per mode
// (`acme/light.*`, `acme/dark.*`); a design variable carries one value per
// mode in `values`. Measured against a consumer project before these were
// written: 73 light/dark pairs on the code side, and a committed design
// snapshot with zero `values` — so the legacy-degradation cases below are the
// live shape, not a hypothetical.
// ---------------------------------------------------------------------------

describe("runTokensCheck — per-mode design values (#404)", () => {
  const designSide = findings => findings.filter(f => f.side === "design")
  const themed = tokenCensus([
    tokenWithCssValue("acme/light.color.fg.default", "#111111"),
    tokenWithCssValue("acme/dark.color.fg.default", "#eeeeee"),
  ])
  const variable = values => ({
    name: "fg/default",
    kind: "variable",
    resolvedType: "COLOR",
    value: "#111111",
    values,
  })

  it("compares each mode against its own code token and names the mode", () => {
    const findings = runTokensCheck(
      themed,
      varCensus([]),
      config(),
      designTokenCensus([variable({ Light: "#111111", Dark: "#000000" })]),
    )
    expect(designSide(findings).map(f => f.ruleId)).toEqual([
      "tokens/design-token-mismatch",
    ])
    const [mismatch] = designSide(findings)
    expect(mismatch.message).toContain('mode "Dark"')
    expect(mismatch.data).toEqual({
      name: "fg/default",
      value: "#000000",
      token: "acme.color.fg.default",
      mode: "Dark",
      expected: ["#eeeeee"],
    })
  })

  it("a dark mode drifting ALONE is invisible to the folded comparison and visible here", () => {
    // Legacy census — no `values`, and the one folded value matches one of
    // the modes, so nothing is reported. That is the blind spot #404 names.
    expect(
      designSide(
        runTokensCheck(
          themed,
          varCensus([]),
          config(),
          designTokenCensus([{ name: "fg/default", value: "#111111" }]),
        ),
      ),
    ).toEqual([])
    // The same variable gathered with per-mode values: the drift surfaces.
    expect(
      designSide(
        runTokensCheck(
          themed,
          varCensus([]),
          config(),
          designTokenCensus([variable({ Light: "#111111", Dark: "#000000" })]),
        ),
      ).map(f => f.ruleId),
    ).toEqual(["tokens/design-token-mismatch"])
  })

  it("stays silent when every shared mode agrees", () => {
    const findings = runTokensCheck(
      themed,
      varCensus([]),
      config(),
      designTokenCensus([variable({ Light: "#111111", Dark: "#eeeeee" })]),
    )
    expect(designSide(findings)).toEqual([])
  })

  it("reports one mismatch per drifting mode, deterministically ordered", () => {
    const forward = runTokensCheck(
      themed,
      varCensus([]),
      config(),
      designTokenCensus([variable({ Light: "#222222", Dark: "#000000" })]),
    )
    const reversed = runTokensCheck(
      themed,
      varCensus([]),
      config(),
      designTokenCensus([variable({ Dark: "#000000", Light: "#222222" })]),
    )
    expect(designSide(forward).map(f => f.data.mode)).toEqual(["Dark", "Light"])
    expect(JSON.stringify(designSide(reversed))).toBe(
      JSON.stringify(designSide(forward)),
    )
  })

  it("a code mode with no design counterpart is design-mode-missing (warn)", () => {
    const findings = runTokensCheck(
      themed,
      varCensus([]),
      config(),
      designTokenCensus([variable({ Light: "#111111" })]),
    )
    expect(designSide(findings).map(f => [f.ruleId, f.severity])).toEqual([
      ["tokens/design-mode-missing", "warn"],
    ])
    expect(designSide(findings)[0].data).toEqual({
      name: "fg/default",
      token: "acme.color.fg.default",
      mode: "dark",
      missingOn: "design",
    })
  })

  it("reports the reverse too — a design mode with no code counterpart", () => {
    const findings = runTokensCheck(
      themed,
      varCensus([]),
      config(),
      designTokenCensus([
        variable({ Light: "#111111", Dark: "#eeeeee", Contrast: "#ffffff" }),
      ]),
    )
    expect(designSide(findings).map(f => f.ruleId)).toEqual([
      "tokens/design-mode-missing",
    ])
    expect(designSide(findings)[0].data).toEqual({
      name: "fg/default",
      token: "acme.color.fg.default",
      mode: "Contrast",
      missingOn: "code",
    })
  })

  it("folds mode names across case and separators before matching them", () => {
    const findings = runTokensCheck(
      tokenCensus([
        tokenWithCssValue("acme/light.color.fg.default", "#111111"),
        tokenWithCssValue("acme/high-contrast.color.fg.default", "#ffffff"),
      ]),
      varCensus([]),
      config(),
      designTokenCensus([
        variable({ Light: "#111111", "High Contrast": "#ffffff" }),
      ]),
    )
    expect(designSide(findings)).toEqual([])
  })

  it("says nothing when the two sides share no mode vocabulary at all", () => {
    // A single-mode design collection (`Mode 1`) against mode-scoped code:
    // the two do not speak the same mode names, so neither a per-mode verdict
    // nor a "missing mode" claim is available — it falls back to the folded
    // comparison, which the default-mode value satisfies.
    const findings = runTokensCheck(
      themed,
      varCensus([]),
      config(),
      designTokenCensus([variable({ "Mode 1": "#111111" })]),
    )
    expect(designSide(findings)).toEqual([])
  })

  it("never reports a mode against a code token that has none", () => {
    const findings = runTokensCheck(
      tokenCensus([tokenWithCssValue("acme.color.fg.default", "#111111")]),
      varCensus([]),
      config(),
      designTokenCensus([variable({ Light: "#111111", Dark: "#eeeeee" })]),
    )
    expect(designSide(findings)).toEqual([])
  })

  it("degrades honestly on a legacy census: no `values`, no mode findings", () => {
    const findings = runTokensCheck(
      themed,
      varCensus([]),
      config(),
      designTokenCensus([{ name: "fg/default", value: "#eeeeee" }]),
    )
    expect(designSide(findings)).toEqual([])
  })

  it("never compares a mode whose value is an unresolved alias object", () => {
    const findings = runTokensCheck(
      themed,
      varCensus([]),
      config(),
      designTokenCensus([
        variable({ Light: "#111111", Dark: { alias: "VariableID:9:9" } }),
      ]),
    )
    expect(designSide(findings)).toEqual([])
  })

  it("honors a rules override for design-mode-missing, including 'off'", () => {
    const findings = runTokensCheck(
      themed,
      varCensus([]),
      config({ rules: { "tokens/design-mode-missing": "off" } }),
      designTokenCensus([variable({ Light: "#111111" })]),
    )
    expect(designSide(findings)).toEqual([])
  })

  it("keeps the #191 dedupe: one token-unreferenced per var, not per mode", () => {
    const findings = runTokensCheck(
      themed,
      varCensus([]),
      config(),
      designTokenCensus([variable({ Light: "#111111", Dark: "#000000" })]),
    )
    const unreferenced = findings.filter(
      f => f.ruleId === "tokens/token-unreferenced",
    )
    expect(unreferenced).toHaveLength(1)
    expect(unreferenced[0].entity).toBe("--acme-color-fg-default")
    expect(unreferenced[0].data.tokens).toEqual([
      "acme/dark.color.fg.default",
      "acme/light.color.fg.default",
    ])
  })
})

// ---------------------------------------------------------------------------
// Token parity (#566): every compared design variable lands in one outcome,
// and a code token no variable maps to is reported under a covered group.
// ---------------------------------------------------------------------------

describe("runTokensCheck — token parity (#566)", () => {
  const parityIds = findings =>
    findings
      .filter(f =>
        [
          "tokens/design-token-mismatch",
          "tokens/design-token-unmatched",
          "tokens/code-token-undesigned",
          "tokens/design-value-untracked",
        ].includes(f.ruleId),
      )
      .map(f => [f.ruleId, f.entity])

  const codeTokens = [
    tokenWithCssValue("acme.color.fg", "#111111"),
    tokenWithCssValue("acme.color.bg", "#ffffff"),
    tokenWithCssValue("acme.color.border", "#cccccc"),
  ]
  const design = designTokenCensus([
    { name: "color/fg", value: "#111111" }, // matched
    { name: "color/bg", value: "#000000" }, // mismatched
    { name: "brand/ink", value: "#111111" }, // design-only, value in code
  ])

  it("reports one design-only and one code-only token, with exact parity counts", () => {
    const report = {}
    const findings = runTokensCheck(
      tokenCensus(codeTokens),
      varCensus([]),
      config(),
      design,
      report,
    )
    expect(parityIds(findings)).toEqual([
      ["tokens/design-token-mismatch", "color/bg"],
      ["tokens/code-token-undesigned", "acme.color.border"],
      ["tokens/design-token-unmatched", "brand/ink"],
    ])
    expect(
      findings.find(f => f.ruleId === "tokens/design-token-unmatched").data,
    ).toEqual({
      name: "brand/ink",
      value: "#111111",
      sameValue: ["acme.color.fg"],
    })
    expect(report.tokenParity).toEqual({
      matched: 1,
      mismatched: 1,
      ambiguous: 0,
      designOnly: 1,
      codeOnly: 1,
    })
  })

  it("keeps design-value-untracked, never both, when no code token has the value", () => {
    const report = {}
    const findings = runTokensCheck(
      tokenCensus([tokenWithCssValue("acme.color.fg", "#111111")]),
      varCensus([]),
      config(),
      designTokenCensus([
        { name: "color/fg", value: "#111111" },
        { name: "brand/red", value: "#ff0000" },
      ]),
      report,
    )
    expect(parityIds(findings)).toEqual([
      ["tokens/design-value-untracked", "brand/red"],
    ])
    expect(report.tokenParity.designOnly).toBe(1)
  })

  it("skips code tokens under a codeOnlyGroups prefix", () => {
    const findings = runTokensCheck(
      tokenCensus(codeTokens),
      varCensus([]),
      {
        ...config(),
        design: { options: { codeOnlyGroups: ["acme.color.border"] } },
      },
      design,
    )
    expect(
      findings.filter(f => f.ruleId === "tokens/code-token-undesigned"),
    ).toEqual([])
  })

  it("does not report a group no design variable maps into", () => {
    const findings = runTokensCheck(
      tokenCensus([
        tokenWithCssValue("acme.color.fg", "#111111"),
        tokenWithCssValue("layout.columns", "12"),
      ]),
      varCensus([]),
      config(),
      designTokenCensus([{ name: "color/fg", value: "#111111" }]),
    )
    expect(
      findings.filter(f => f.ruleId === "tokens/code-token-undesigned"),
    ).toEqual([])
  })

  it("counts mode-scoped tokens once, as their collapsed id", () => {
    const report = {}
    const findings = runTokensCheck(
      tokenCensus([
        tokenWithCssValue("system/dark.color.fg", "#111111"),
        tokenWithCssValue("system/light.color.fg", "#eeeeee"),
        tokenWithCssValue("system/dark.color.bg", "#000000"),
        tokenWithCssValue("system/light.color.bg", "#ffffff"),
      ]),
      varCensus([]),
      config(),
      designTokenCensus([{ name: "color/fg", value: "#111111" }]),
      report,
    )
    expect(parityIds(findings)).toEqual([
      ["tokens/code-token-undesigned", "system.color.bg"],
    ])
    expect(report.tokenParity).toEqual({
      matched: 1,
      mismatched: 0,
      ambiguous: 0,
      designOnly: 0,
      codeOnly: 1,
    })
  })

  it("keeps a tokenMap null an opt-out: not reported, not counted", () => {
    const report = {}
    const findings = runTokensCheck(
      tokenCensus([tokenWithCssValue("acme.color.fg", "#111111")]),
      varCensus([]),
      {
        ...config(),
        design: {
          options: { tokenMap: { "brand/ink": null, "brand/x": null } },
        },
      },
      designTokenCensus([
        { name: "color/fg", value: "#111111" },
        { name: "brand/ink", value: "#111111" },
        { name: "brand/x", value: "#abcdef" },
      ]),
      report,
    )
    expect(
      findings.filter(f => f.entity === "brand/ink" || f.entity === "brand/x"),
    ).toEqual([])
    expect(report.tokenParity).toEqual({
      matched: 1,
      mismatched: 0,
      ambiguous: 0,
      designOnly: 0,
      codeOnly: 0,
    })
  })

  it("leaves report untouched when no design census ran", () => {
    const report = {}
    runTokensCheck(
      tokenCensus(codeTokens),
      varCensus([]),
      config(),
      undefined,
      report,
    )
    expect(report).toEqual({})
  })
})

// ---------------------------------------------------------------------------
// tokenMapping applied to pairing (#569).
// ---------------------------------------------------------------------------

describe("runTokensCheck — a single-segment variable pairs (#637)", () => {
  it("matches the token directly under a root, with no tokenMap", () => {
    const report = {}
    const findings = runTokensCheck(
      tokenCensus([
        tokenWithCssValue("acme.none", "0px"),
        tokenWithCssValue("acme.space.none", "0px"),
      ]),
      varCensus([]),
      config(),
      designTokenCensus([{ name: "none", value: "0" }]),
      report,
    )
    const pairing = findings
      .filter(f =>
        [
          "tokens/design-token-unmatched",
          "tokens/design-token-ambiguous",
          "tokens/design-token-mismatch",
        ].includes(f.ruleId),
      )
      .map(f => [f.ruleId, f.entity])
    expect(pairing).toEqual([])
    expect(
      findings
        .filter(f => f.ruleId === "tokens/code-token-undesigned")
        .map(f => f.entity),
    ).toEqual(["acme.space.none"])
    expect(report.tokenParity).toMatchObject({ matched: 1, designOnly: 0 })
  })
})

describe("runTokensCheck — tokenMapping pairs design names with code paths (#569)", () => {
  const tokenMapping = {
    collections: {
      global: { collection: "base", prefix: "base" },
      icons: { collection: "icons", prefix: null },
    },
    aliasFoldingRules: {
      groups: {
        color: [
          {
            when: { index: 0, endsWith: "-vivid" },
            template: "vivid{0^~}.{1+}",
          },
        ],
      },
    },
  }
  const codeTokens = [
    tokenWithCssValue("base.color.vividBlue.50", "#eaeffb"),
    tokenWithCssValue("base.color.neutral.900", "#111111"),
  ]
  const run = (entries, cfg = { ...config(), tokenMapping }) => {
    const report = {}
    const findings = runTokensCheck(
      tokenCensus(codeTokens),
      varCensus([]),
      cfg,
      designTokenCensus(entries),
      report,
    )
    return {
      report,
      parity: findings
        .filter(f => f.ruleId !== "tokens/token-unreferenced")
        .map(f => [f.ruleId, f.entity]),
    }
  }

  it("folds, prefixes and compares: a vivid ramp pairs with its base token", () => {
    const { parity, report } = run([
      { name: "color/blue-vivid/50", value: "#EAEFFB", collection: "base" },
      { name: "color/neutral/900", value: "#111111", collection: "base" },
    ])
    expect(parity).toEqual([])
    expect(report.tokenParity).toEqual({
      matched: 2,
      mismatched: 0,
      ambiguous: 0,
      designOnly: 0,
      codeOnly: 0,
    })
  })

  it("reports a value mismatch on the prefixed pair", () => {
    const { parity } = run([
      { name: "color/blue-vivid/50", value: "#000000", collection: "base" },
      { name: "color/neutral/900", value: "#111111", collection: "base" },
    ])
    expect(parity).toEqual([
      ["tokens/design-token-mismatch", "color/blue-vivid/50"],
    ])
  })

  it("skips a prefix: null collection entirely", () => {
    const { parity, report } = run([
      { name: "color/neutral/900", value: "#111111", collection: "base" },
      { name: "secondaryDefault", value: "#abcdef", collection: "icons" },
    ])
    expect(parity).toEqual([
      ["tokens/code-token-undesigned", "base.color.vividBlue.50"],
    ])
    expect(report.tokenParity.designOnly).toBe(0)
  })

  it("without tokenMapping the vivid name finds no pair, exactly as before", () => {
    const { parity } = run(
      [
        { name: "color/blue-vivid/50", value: "#EAEFFB", collection: "base" },
        { name: "color/neutral/900", value: "#111111", collection: "base" },
      ],
      config(),
    )
    expect(parity).toEqual([
      ["tokens/code-token-undesigned", "base.color.vividBlue.50"],
      ["tokens/design-token-unmatched", "color/blue-vivid/50"],
    ])
  })

  it("keeps tokenMap ahead of fold rules and prefixes", () => {
    const { parity } = run(
      [
        { name: "color/blue-vivid/50", value: "#111111", collection: "base" },
        { name: "color/neutral/900", value: "#111111", collection: "base" },
      ],
      {
        ...config(),
        tokenMapping,
        design: {
          options: {
            tokenMap: { "color/blue-vivid/50": "base.color.neutral.900" },
          },
        },
      },
    )
    expect(parity).toEqual([
      ["tokens/code-token-undesigned", "base.color.vividBlue.50"],
    ])
  })
})

// ---------------------------------------------------------------------------
// Unemitted vs unused (issue #562, `docs/deferred-rules.md` row 2).
//
// `paths.styleRoots` is where a project's token stylesheets live, and the
// census scans it for declarations. With it configured and on disk, "no
// candidate var is declared anywhere" is a fact the engine can see, so an
// unreferenced token splits: never emitted (`tokens/token-unemitted`) or
// emitted and unused (`tokens/token-unreferenced`). Without it, or with a
// configured root missing from disk, the engine cannot see the stylesheet and
// stays with the one rule.
// ---------------------------------------------------------------------------

describe("token-unemitted — the split by declaration (#562)", () => {
  const declared = name =>
    cssVar(name, { declarations: [{ file: "tokens/css/t.css", line: 1 }] })
  const withRoots = (overrides = {}) =>
    config({ paths: { styleRoots: ["tokens/css"] }, ...overrides })
  const byRule = findings =>
    findings
      .filter(f => f.ruleId.startsWith("tokens/token-un"))
      .map(f => [f.ruleId, f.entity])
      .sort()

  it("splits an undeclared token from a declared one when styleRoots is set", () => {
    const findings = runTokensCheck(
      tokenCensus([token("acme.color.gone"), token("acme.color.idle")]),
      varCensus([declared("--acme-color-idle")]),
      withRoots(),
    )
    expect(byRule(findings)).toEqual([
      ["tokens/token-unemitted", "acme.color.gone"],
      ["tokens/token-unreferenced", "acme.color.idle"],
    ])
    const unemitted = findings.find(f => f.ruleId === "tokens/token-unemitted")
    expect(unemitted).toEqual(
      expect.objectContaining({
        severity: "review",
        surface: "tokens",
        data: {
          token: "acme.color.gone",
          tokens: ["acme.color.gone"],
          expectedVar: "--acme-color-gone",
        },
      }),
    )
    expect(unemitted.message).toContain("--acme-color-gone")
  })

  it("never claims unemitted when styleRoots is empty", () => {
    const findings = runTokensCheck(
      tokenCensus([token("acme.color.gone"), token("acme.color.idle")]),
      varCensus([declared("--acme-color-idle")]),
      config(),
    )
    expect(byRule(findings)).toEqual([
      ["tokens/token-unreferenced", "acme.color.gone"],
      ["tokens/token-unreferenced", "acme.color.idle"],
    ])
  })

  it("never claims unemitted when a configured styleRoot is missing from disk", () => {
    const findings = runTokensCheck(
      tokenCensus([token("acme.color.gone")]),
      { ...varCensus([]), missingStyleRoots: ["tokens/css"] },
      withRoots(),
    )
    expect(byRule(findings)).toEqual([
      ["tokens/token-unreferenced", "acme.color.gone"],
    ])
  })

  it("keeps one finding per variable for a mode group, either way", () => {
    const modes = tokenCensus([
      token("system/dark.color.bg.disabled"),
      token("system/light.color.bg.disabled"),
    ])
    const roots = {
      conventions: { cssVarPrefix: "--system-" },
      paths: { styleRoots: ["tokens/css"] },
    }
    expect(byRule(runTokensCheck(modes, varCensus([]), roots))).toEqual([
      ["tokens/token-unemitted", "--system-color-bg-disabled"],
    ])
    expect(
      byRule(
        runTokensCheck(
          modes,
          varCensus([declared("--system-color-bg-disabled")]),
          roots,
        ),
      ),
    ).toEqual([["tokens/token-unreferenced", "--system-color-bg-disabled"]])
  })

  it("counts a composite as emitted when only a sub-property is declared", () => {
    const findings = runTokensCheck(
      tokenCensus([
        compositeToken("acme.text.body", "typography", {
          fontFamily: "Some Sans",
          fontSize: { value: 1, unit: "rem" },
        }),
      ]),
      varCensus([declared("--acme-text-body-font-size")]),
      withRoots(),
    )
    expect(byRule(findings)).toEqual([
      ["tokens/token-unreferenced", "acme.text.body"],
    ])
  })

  it("is scoped by token-unreferenced's ignorePrefixes", () => {
    const findings = runTokensCheck(
      tokenCensus([token("base.color.blue.100"), token("acme.color.gone")]),
      varCensus([]),
      withRoots({
        rules: {
          "tokens/token-unreferenced": [
            "review",
            { ignorePrefixes: ["base."] },
          ],
        },
      }),
    )
    expect(byRule(findings)).toEqual([
      ["tokens/token-unemitted", "acme.color.gone"],
    ])
  })

  it("has its own severity", () => {
    const findings = runTokensCheck(
      tokenCensus([token("acme.color.gone")]),
      varCensus([]),
      withRoots({ rules: { "tokens/token-unemitted": "off" } }),
    )
    expect(byRule(findings)).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// A per-mode `tokenMap` entry: the code side keeps one token per mode under a
// path segment (`acme.layout.sm.gutter`), not a set head, so name matching
// cannot pair the modes. The entry pairs each mode with its own token.
// ---------------------------------------------------------------------------

describe("runTokensCheck — per-mode tokenMap entries", () => {
  const tiers = tokenCensus([
    tokenWithCssValue("acme.layout.sm.gutter", "16px"),
    tokenWithCssValue("acme.layout.lg.gutter", "32px"),
  ])
  const gutter = values => ({
    name: "layout/gutter",
    kind: "variable",
    resolvedType: "FLOAT",
    value: values.lg ?? "32",
    values,
  })
  const withMap = (
    map = { sm: "acme.layout.sm.gutter", lg: "acme.layout.lg.gutter" },
  ) => ({
    ...config(),
    design: { options: { tokenMap: { "layout/gutter": map } } },
  })
  const parity = findings =>
    findings
      .filter(f => f.ruleId !== "tokens/token-unreferenced")
      .map(f => [
        f.ruleId,
        f.data?.mode ?? null,
        f.data && "token" in f.data ? f.data.token : f.entity,
      ])

  it("pairs every mode with its token: silence, and no tier is code-only", () => {
    const report = {}
    const findings = runTokensCheck(
      tiers,
      varCensus([]),
      withMap(),
      designTokenCensus([gutter({ sm: "16", lg: "32" })]),
      report,
    )
    expect(parity(findings)).toEqual([])
    expect(report.tokenParity).toEqual({
      matched: 1,
      mismatched: 0,
      ambiguous: 0,
      designOnly: 0,
      codeOnly: 0,
    })
  })

  it("a mode drifting from its own token is a mismatch naming that token", () => {
    const findings = runTokensCheck(
      tiers,
      varCensus([]),
      withMap(),
      designTokenCensus([gutter({ sm: "20", lg: "32" })]),
    )
    expect(parity(findings)).toEqual([
      ["tokens/design-token-mismatch", "sm", "acme.layout.sm.gutter"],
    ])
  })

  it("a design mode the entry maps nowhere is design-mode-missing on code", () => {
    const findings = runTokensCheck(
      tiers,
      varCensus([]),
      withMap({ lg: "acme.layout.lg.gutter" }),
      designTokenCensus([gutter({ sm: "16", lg: "32" })]),
    )
    expect(parity(findings)).toEqual([
      ["tokens/design-mode-missing", "sm", null],
      ["tokens/code-token-undesigned", null, "acme.layout.sm.gutter"],
    ])
  })

  it("a mode may name several tokens, the base token aliasing a tier; each is compared", () => {
    const withBase = tokenCensus([
      tokenWithCssValue("acme.layout.sm.gutter", "16px"),
      tokenWithCssValue("acme.layout.gutter", "20px"),
      tokenWithCssValue("acme.layout.lg.gutter", "32px"),
    ])
    const report = {}
    const findings = runTokensCheck(
      withBase,
      varCensus([]),
      withMap({
        sm: ["acme.layout.sm.gutter", "acme.layout.gutter"],
        lg: "acme.layout.lg.gutter",
      }),
      designTokenCensus([gutter({ sm: "16", lg: "32" })]),
      report,
    )
    expect(parity(findings)).toEqual([
      ["tokens/design-token-mismatch", "sm", "acme.layout.gutter"],
    ])
    expect(report.tokenParity.codeOnly).toBe(0)
  })

  it("candidateTokenIds returns every mode's token", () => {
    expect(
      candidateTokenIds("layout/gutter", null, [], {
        tokenMap: {
          "layout/gutter": {
            sm: "acme.layout.sm.gutter",
            lg: "acme.layout.lg.gutter",
          },
        },
      }),
    ).toEqual(["acme.layout.lg.gutter", "acme.layout.sm.gutter"])
  })
})

// ---------------------------------------------------------------------------
// A `tokenMap` id the code census lacks (#653): a typo or a renamed token is
// reported, never counted as a match that compared nothing.
// ---------------------------------------------------------------------------

describe("runTokensCheck — tokenMap ids not in the census", () => {
  const tiers = tokenCensus([
    tokenWithCssValue("acme.layout.sm.gutter", "16px"),
    tokenWithCssValue("acme.layout.lg.gutter", "32px"),
  ])
  const gutter = values => ({
    name: "layout/gutter",
    kind: "variable",
    resolvedType: "FLOAT",
    value: values.lg ?? "32",
    values,
  })
  const withMap = map => ({
    ...config(),
    design: { options: { tokenMap: { "layout/gutter": map } } },
  })
  const parity = findings =>
    findings
      .filter(f => f.ruleId !== "tokens/token-unreferenced")
      .map(f => [
        f.ruleId,
        f.data?.mode ?? null,
        f.data && "token" in f.data ? f.data.token : f.entity,
      ])

  it("a single-id entry naming an unknown token is reported and design-only", () => {
    const report = {}
    const findings = runTokensCheck(
      tiers,
      varCensus([]),
      withMap("acme.layout.gutterr"),
      designTokenCensus([
        { name: "layout/gutter", kind: "variable", value: "32" },
      ]),
      report,
    )
    const unknown = findings.filter(
      f => f.ruleId === "tokens/design-token-map-unknown",
    )
    expect(unknown).toHaveLength(1)
    // The value hint survives the unknown id (#659).
    expect(unknown[0].data).toEqual({
      name: "layout/gutter",
      token: "acme.layout.gutterr",
      sameValue: ["acme.layout.lg.gutter"],
    })
    expect(unknown[0].message).toContain('"layout/gutter"')
    expect(unknown[0].message).toContain('"acme.layout.gutterr"')
    expect(report.tokenParity).toMatchObject({ matched: 0, designOnly: 1 })
    // Nothing claimed on its strength, so no group opens as code-only.
    expect(
      findings.filter(f => f.ruleId === "tokens/code-token-undesigned"),
    ).toEqual([])
  })

  it("a per-mode entry whose ids are all unknown is reported per mode, not matched", () => {
    const report = {}
    const findings = runTokensCheck(
      tiers,
      varCensus([]),
      withMap({ sm: "acme.layout.xs.gutter", lg: "acme.layout.xl.gutter" }),
      designTokenCensus([gutter({ sm: "16", lg: "32" })]),
      report,
    )
    expect(parity(findings)).toEqual([
      ["tokens/design-token-map-unknown", "lg", "acme.layout.xl.gutter"],
      ["tokens/design-token-map-unknown", "sm", "acme.layout.xs.gutter"],
    ])
    expect(report.tokenParity).toMatchObject({
      matched: 0,
      mismatched: 0,
      designOnly: 1,
    })
  })

  it("a per-mode entry with an unknown id still compares its valid modes", () => {
    const report = {}
    const findings = runTokensCheck(
      tiers,
      varCensus([]),
      withMap({ sm: "acme.layout.xs.gutter", lg: "acme.layout.lg.gutter" }),
      designTokenCensus([gutter({ sm: "16", lg: "30" })]),
      report,
    )
    expect(parity(findings)).toEqual([
      ["tokens/design-token-mismatch", "lg", "acme.layout.lg.gutter"],
      ["tokens/design-token-map-unknown", "sm", "acme.layout.xs.gutter"],
      ["tokens/code-token-undesigned", null, "acme.layout.sm.gutter"],
    ])
    expect(report.tokenParity).toMatchObject({ matched: 0, mismatched: 1 })
  })

  it("a mode listing a valid and an unknown id compares the valid one and reports the unknown", () => {
    const findings = runTokensCheck(
      tiers,
      varCensus([]),
      withMap({
        sm: ["acme.layout.sm.gutter", "acme.layout.gutterr"],
        lg: "acme.layout.lg.gutter",
      }),
      designTokenCensus([gutter({ sm: "16", lg: "32" })]),
    )
    expect(parity(findings)).toEqual([
      ["tokens/design-token-map-unknown", "sm", "acme.layout.gutterr"],
    ])
  })
})

// ---------------------------------------------------------------------------
// A `tokenMap` finding names its real cause and keeps the same-value hint
// (#659): a mode-scoped id is named with the collapsed id `tokenMap` takes,
// an unknown single id still lists the code tokens holding the value, and a
// per-mode entry's mode is said to come from its `tokenMap` key.
// ---------------------------------------------------------------------------

describe("runTokensCheck — tokenMap unknown id names its cause", () => {
  const themed = tokenCensus([
    tokenWithCssValue("system/light.color.fg", "#111111"),
    tokenWithCssValue("system/dark.color.fg", "#eeeeee"),
    tokenWithCssValue("acme.layout.lg.gutter", "32px"),
  ])
  const withMap = tokenMap => ({
    ...config(),
    design: { options: { tokenMap } },
  })
  const unknownOf = findings =>
    findings.filter(f => f.ruleId === "tokens/design-token-map-unknown")

  it("a mode-scoped id is reported with the collapsed id tokenMap takes", () => {
    const findings = runTokensCheck(
      themed,
      varCensus([]),
      withMap({ "color/fg": "system/dark.color.fg" }),
      designTokenCensus([
        { name: "color/fg", kind: "variable", value: "#eeeeee" },
      ]),
    )
    const unknown = unknownOf(findings)
    expect(unknown).toHaveLength(1)
    expect(unknown[0].data.token).toBe("system/dark.color.fg")
    expect(unknown[0].message).toContain("mode-scoped")
    expect(unknown[0].message).toContain('"system.color.fg"')
  })

  it("an unknown single id still names the code tokens holding its value", () => {
    const report = {}
    const findings = runTokensCheck(
      themed,
      varCensus([]),
      withMap({ "layout/gutter": "acme.layout.gutterr" }),
      designTokenCensus([
        { name: "layout/gutter", kind: "variable", value: "32px" },
      ]),
      report,
    )
    const unknown = unknownOf(findings)
    expect(unknown).toHaveLength(1)
    expect(unknown[0].data).toEqual({
      name: "layout/gutter",
      token: "acme.layout.gutterr",
      sameValue: ["acme.layout.lg.gutter"],
    })
    expect(unknown[0].message).toContain('"acme.layout.lg.gutter"')
    expect(report.tokenParity).toMatchObject({ matched: 0, designOnly: 1 })
  })

  it("an unknown single id whose value no code token holds carries no sameValue", () => {
    const findings = runTokensCheck(
      themed,
      varCensus([]),
      withMap({ "layout/gutter": "acme.layout.gutterr" }),
      designTokenCensus([
        { name: "layout/gutter", kind: "variable", value: "48px" },
      ]),
    )
    expect(unknownOf(findings)[0].data).toEqual({
      name: "layout/gutter",
      token: "acme.layout.gutterr",
    })
  })

  it("a per-mode entry's extra mode is said to come from its tokenMap key", () => {
    const tiers = tokenCensus([
      tokenWithCssValue("acme.layout.sm.gutter", "16px"),
      tokenWithCssValue("acme.layout.md.gutter", "24px"),
      tokenWithCssValue("acme.layout.lg.gutter", "32px"),
    ])
    const findings = runTokensCheck(
      tiers,
      varCensus([]),
      withMap({
        "layout/gutter": {
          sm: "acme.layout.sm.gutter",
          md: "acme.layout.md.gutter",
          lg: "acme.layout.lg.gutter",
        },
      }),
      designTokenCensus([
        {
          name: "layout/gutter",
          kind: "variable",
          resolvedType: "FLOAT",
          value: "32",
          values: { sm: "16", lg: "32" },
        },
      ]),
    )
    const missing = findings.filter(
      f => f.ruleId === "tokens/design-mode-missing",
    )
    expect(missing).toHaveLength(1)
    expect(missing[0].data).toMatchObject({ mode: "md", missingOn: "design" })
    expect(missing[0].message).toContain("design.options.tokenMap")
    expect(missing[0].message).not.toContain("declares")
  })
})
