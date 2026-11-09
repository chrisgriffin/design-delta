/**
 * modules-lint.test.js — `src/modules/lint.mjs`, the lint surface
 * (ADR-001 D5/D10, Phase 3, issue #120).
 *
 * PURE input: every case hand-builds its normalized violations in memory —
 * the exact shape `sources/code.mjs`'s `censusTokenLint` produces — rather
 * than touching fs or `@terrazzo/parser`. That is the whole reason the vendor
 * stops at `sources/`: a module that took Terrazzo's own token map could not
 * be driven by a plain fixture.
 */

import {
  runLintCheck,
  runTierCheck,
  runVocabularyCheck,
  runRampCheck,
  runContractLintCheck,
  compileDesignNamePatterns,
  runDesignNamingCheck,
  RULES,
  registry,
} from "../src/modules/lint.mjs"

function violation(over = {}) {
  return {
    ruleId: "core/valid-color",
    level: "error",
    message: "bad color",
    entity: undefined,
    ...over,
  }
}

describe("runLintCheck", () => {
  it("emits nothing when there are no violations", () => {
    // The invariant that matters most for this surface: a project which has
    // configured no lint rules must see ZERO findings, never a starter set of
    // some other design system's opinions.
    expect(runLintCheck({ ok: true, violations: [] }, {})).toEqual([])
    expect(runLintCheck(undefined, {})).toEqual([])
  })

  it("maps a vendor violation onto the D5 finding shape", () => {
    const findings = runLintCheck(
      { ok: true, violations: [violation({ entity: "base.color.x" })] },
      {},
    )
    expect(findings).toEqual([
      expect.objectContaining({
        ruleId: "lint/token-rule",
        surface: "lint",
        side: "code",
        severity: "error",
        entity: "base.color.x",
      }),
    ])
    // The DELEGATED rule id must survive into the finding — it is what a
    // consumer sees in a report and filters on with `--rule`.
    expect(findings[0].data.rule).toBe("core/valid-color")
    expect(findings[0].message).toContain("core/valid-color")
  })

  it("carries the violation's file position onto the finding", () => {
    // `entity` above is a token id, not a path — `data.file`/`data.line` are
    // the only real FILE POSITION a finding carries, and they travel together
    // so nothing downstream can render a line without the file it is in.
    const [finding] = runLintCheck(
      {
        ok: true,
        violations: [violation({ file: "tokens/tokens.json", line: 42 })],
      },
      {},
    )
    expect(finding.data.file).toBe("tokens/tokens.json")
    expect(finding.data.line).toBe(42)
  })

  it("takes its severity from the vendor's level when nothing is configured", () => {
    const [err] = runLintCheck(
      { ok: true, violations: [violation({ level: "error" })] },
      {},
    )
    const [warn] = runLintCheck(
      { ok: true, violations: [violation({ level: "warn" })] },
      {},
    )
    // Not flattened to the registry default: a genuine spec violation stays an
    // error, while a vendor warning stays a warning.
    expect(err.severity).toBe("error")
    expect(warn.severity).toBe("warn")
  })

  it("lets a consumer's `rules` entry override the vendor level", () => {
    const [finding] = runLintCheck(
      { ok: true, violations: [violation({ level: "error" })] },
      { rules: { "lint/token-rule": "review" } },
    )
    expect(finding.severity).toBe("review")
  })

  it("`off` silences the surface, like every other surface", () => {
    expect(
      runLintCheck(
        { ok: true, violations: [violation()] },
        { rules: { "lint/token-rule": "off" } },
      ),
    ).toEqual([])
  })

  it("falls back to the rule id when no token id is available", () => {
    // Terrazzo's lint callback carries a raw AST node with no token id, so
    // this is the common case, not an edge one. The finding must not invent a
    // token id — a wrong entity in a report is worse than an unspecific one.
    const [finding] = runLintCheck(
      { ok: true, violations: [violation({ entity: undefined })] },
      {},
    )
    expect(finding.entity).toBe("core/valid-color")
    expect(finding.data.token).toBeUndefined()
  })

  it("registers no vendor rule id — one own id covers the whole delegated set", () => {
    // Deliberate: the delegated set belongs to @terrazzo/parser and changes on
    // their release cadence. Pinning each `core/*` id here would go stale and
    // would let a consumer configure a rule this engine only thinks exists.
    //
    // Asserted as "no id is a vendor id" rather than "there is exactly one
    // rule": PORTED rules (issue #121) are this engine's own and legitimately
    // register their own ids, so a count would have to be bumped with each and
    // would stop testing the thing that actually matters.
    expect(RULES.every(r => r.id.startsWith("lint/"))).toBe(true)
    expect(RULES.some(r => r.id.startsWith("core/"))).toBe(false)
    expect(registry.get("lint/token-rule").surface).toBe("lint")
  })
})

// ---------------------------------------------------------------------------
// PORTED rule: tier alias direction (issue #121).
//
// The vocabulary here is DELIBERATELY ALIEN — `quarry`/`forge`/`facade` — and
// shares no substring with `base`/`system`/`component` or any other real
// design system's tier names. That is the point of the fixture, not decoration:
// #121's whole risk is re-hardcoding one project's vocabulary, and a fixture
// written in the vocabulary the engine might have hardcoded would pass whether
// or not the leak exists. If any tier name ever reaches the engine as a
// literal, these tests go red.
// ---------------------------------------------------------------------------

const TIERS = ["quarry", "forge", "facade"]

// Build a census entry the way `censusTokens` REALLY does. The distinction is
// the whole reason the tier rule shipped broken in draft: Terrazzo records the
// FULLY RESOLVED ultimate target in `aliasOf` and the hop-by-hop path in
// `aliasChain`, so `base.x -> {system.y} -> {base.z}` has
// `aliasOf: "base.z"` and `aliasChain: ["system.y", "base.z"]`.
//
// A fixture that sets only `aliasOf` reproduces a shape the real census never
// emits, and every direction test passes against it while the rule is
// incapable of firing on real data. So `aliasing()` always sets BOTH.
function aliasing(id, ...chain) {
  return { id, aliasChain: [...chain], aliasOf: chain[chain.length - 1] }
}

function tokens(list) {
  return { ok: true, tokens: list }
}

function tierConfig(overrides = {}) {
  return { lint: { tiers: TIERS }, ...overrides }
}

describe("runTierCheck — silence without configuration (#121's invariant)", () => {
  const inverted = tokens([aliasing("quarry.color.slate", "facade.button.bg")])

  it("emits nothing when no lint block is configured at all", () => {
    expect(runTierCheck(inverted, {})).toEqual([])
  })

  it("emits nothing when lint is configured but tiers are not", () => {
    expect(runTierCheck(inverted, { lint: { rules: {} } })).toEqual([])
  })

  it("emits nothing for a single tier — one tier has no direction", () => {
    expect(runTierCheck(inverted, { lint: { tiers: ["quarry"] } })).toEqual([])
  })

  it("emits the finding once tiers ARE configured (proves the above is not vacuous)", () => {
    // Without this, every silence test above would pass just as happily if
    // the rule were broken outright.
    expect(runTierCheck(inverted, tierConfig())).toHaveLength(1)
  })
})

describe("runTierCheck — direction", () => {
  it("reports an alias pointing to a HIGHER tier", () => {
    const findings = runTierCheck(
      tokens([aliasing("quarry.color.slate", "forge.color.fg")]),
      tierConfig(),
    )
    expect(findings).toEqual([
      expect.objectContaining({
        ruleId: "lint/tier-alias-inverted",
        surface: "lint",
        side: "code",
        entity: "quarry.color.slate",
        data: {
          token: "quarry.color.slate",
          aliasOf: "forge.color.fg",
          tier: "quarry",
          aliasTier: "forge",
        },
      }),
    ])
  })

  it("stays silent on an alias pointing DOWNWARD", () => {
    expect(
      runTierCheck(
        tokens([aliasing("facade.button.bg", "quarry.color.slate")]),
        tierConfig(),
      ),
    ).toEqual([])
  })

  it("stays silent on a SAME-tier alias — deliberately not this rule's question", () => {
    // Measured at 16 hits on a real design system, every one a shared numeric
    // scale, several already reported by `tokens/token-unreferenced`.
    expect(
      runTierCheck(
        tokens([aliasing("quarry.lineHeight.16", "quarry.spacing.16")]),
        tierConfig(),
      ),
    ).toEqual([])
  })

  it("stays silent on a token holding a raw value", () => {
    expect(
      runTierCheck(tokens([{ id: "forge.easing.standard" }]), tierConfig()),
    ).toEqual([])
  })

  it("skips a token whose first segment is no configured tier", () => {
    expect(
      runTierCheck(
        tokens([aliasing("unlisted.color.x", "facade.button.bg")]),
        tierConfig(),
      ),
    ).toEqual([])
  })

  it("reads the tier from before a mode suffix", () => {
    // `quarry/midnight.color.x` is the midnight MODE of a quarry token — an
    // alternate value of that tier's token, not a tier of its own.
    const findings = runTierCheck(
      tokens([aliasing("quarry/midnight.color.x", "facade.button.bg")]),
      tierConfig(),
    )
    expect(findings).toHaveLength(1)
    expect(findings[0].data.tier).toBe("quarry")
  })

  it("honours `off` in the rules config", () => {
    const findings = runTierCheck(
      tokens([aliasing("quarry.color.slate", "facade.button.bg")]),
      tierConfig({ rules: { "lint/tier-alias-inverted": "off" } }),
    )
    expect(findings).toEqual([])
  })
})

describe("runTierCheck — the DIRECT alias target decides direction", () => {
  it("reports a chain whose FIRST hop goes upward, though it resolves downward", () => {
    // `quarry.x -> {forge.y} -> {quarry.z}`. Terrazzo records
    // `aliasOf: "quarry.z"` (the resolved leaf, same tier — invisible) and
    // `aliasChain: ["forge.y", "quarry.z"]`. The inversion is the FIRST hop.
    // Reading `aliasOf` made this rule unable to fire on any real inversion,
    // because a well-formed system always resolves to a primitive.
    const findings = runTierCheck(
      tokens([aliasing("quarry.x", "forge.y", "quarry.z")]),
      tierConfig(),
    )
    expect(findings).toHaveLength(1)
    expect(findings[0].data).toEqual({
      token: "quarry.x",
      aliasOf: "forge.y",
      tier: "quarry",
      aliasTier: "forge",
    })
  })

  it("stays silent when the first hop is downward but a later one is not", () => {
    // Only the edge THIS token owns is its responsibility; the later hop is
    // the intermediate token's own finding, reported against that token.
    expect(
      runTierCheck(
        tokens([aliasing("facade.a", "quarry.b", "forge.c")]),
        tierConfig(),
      ),
    ).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// PORTED rule: closed-vocabulary token leaves (issue #121).
//
// One mechanism serves two v1 concerns — "canonical ordered scale" and
// "closed state set" — because measured against how they would be
// configured, both ask "is this leaf a member of the set configured for this
// path". A separate `scale/no-legacy-ordinal` needs no rule of its own: a
// legacy numbered step is automatically excluded by not being in the
// canonical set.
//
// The vocabulary here is again DELIBERATELY ALIEN — `titan`/`colossal`/
// `wisp`, sharing no substring with `xs`/`sm`/`md`/`lg`/`xl` or any real
// t-shirt scale, and `dormant`/`kindled`/`ablaze` instead of
// `default`/`hover`/`active`. A fixture using real-looking names would pass
// whether or not a real vocabulary leaked into the engine.
// ---------------------------------------------------------------------------

function token(id) {
  return { id }
}

function vocabConfig(overrides = {}) {
  return {
    lint: {
      vocabularies: [
        { paths: ["system.radius"], values: ["wisp", "titan", "colossal"] },
        {
          paths: ["*.color.bg.secondary"],
          values: ["dormant", "kindled", "ablaze"],
        },
      ],
    },
    ...overrides,
  }
}

describe("runVocabularyCheck — silence without configuration", () => {
  const offVocab = { ok: true, tokens: [token("system.radius.medium")] }

  it("emits nothing when no lint block is configured at all", () => {
    expect(runVocabularyCheck(offVocab, {})).toEqual([])
  })

  it("emits nothing when lint is configured but vocabularies are not", () => {
    expect(runVocabularyCheck(offVocab, { lint: { rules: {} } })).toEqual([])
  })

  it("emits nothing for an empty vocabularies array", () => {
    expect(
      runVocabularyCheck(offVocab, { lint: { vocabularies: [] } }),
    ).toEqual([])
  })

  it("emits the finding once a vocabulary IS configured (proves the above is not vacuous)", () => {
    expect(runVocabularyCheck(offVocab, vocabConfig())).toHaveLength(1)
  })
})

describe("runVocabularyCheck — membership", () => {
  it("stays silent on a leaf that IS in the configured vocabulary", () => {
    expect(
      runVocabularyCheck(
        { ok: true, tokens: [token("system.radius.titan")] },
        vocabConfig(),
      ),
    ).toEqual([])
  })

  it("reports a leaf that is NOT in the configured vocabulary", () => {
    const findings = runVocabularyCheck(
      { ok: true, tokens: [token("system.radius.medium")] },
      vocabConfig(),
    )
    expect(findings).toEqual([
      expect.objectContaining({
        ruleId: "lint/vocabulary-invalid",
        surface: "lint",
        side: "code",
        entity: "system.radius.medium",
        data: {
          token: "system.radius.medium",
          leaf: "medium",
          allowed: ["wisp", "titan", "colossal"],
        },
      }),
    ])
  })

  it("catches a legacy ordinal step with no rule of its own", () => {
    // The whole reason a separate no-legacy-ordinal rule is unnecessary: "1"
    // is simply not a member of the configured set.
    expect(
      runVocabularyCheck(
        { ok: true, tokens: [token("system.radius.1")] },
        vocabConfig(),
      ),
    ).toHaveLength(1)
  })

  it("does not govern a path with no matching vocabulary entry", () => {
    expect(
      runVocabularyCheck(
        { ok: true, tokens: [token("system.unlisted.medium")] },
        vocabConfig(),
      ),
    ).toEqual([])
  })

  it("`*` matches a mode segment for a state vocabulary", () => {
    for (const id of [
      "system/light.color.bg.secondary.dormant",
      "system/dark.color.bg.secondary.dormant",
    ]) {
      expect(
        runVocabularyCheck({ ok: true, tokens: [token(id)] }, vocabConfig()),
      ).toEqual([])
    }
  })

  it("reports a state leaf outside its closed set", () => {
    const findings = runVocabularyCheck(
      { ok: true, tokens: [token("system/light.color.bg.secondary.hover")] },
      vocabConfig(),
    )
    expect(findings).toHaveLength(1)
    expect(findings[0].data.allowed).toEqual(["dormant", "kindled", "ablaze"])
  })

  it("`*` matches exactly one segment, not a longer or shorter path", () => {
    // Guards against a `*` silently degrading into "any depth" — the parent
    // path must have the SAME segment count as the pattern.
    expect(
      runVocabularyCheck(
        { ok: true, tokens: [token("system.color.bg.secondary.subgroup.x")] },
        vocabConfig(),
      ),
    ).toEqual([])
  })

  it("the FIRST matching entry wins when two entries could both govern a token", () => {
    const overlapping = {
      lint: {
        vocabularies: [
          { paths: ["system.radius"], values: ["wisp"] },
          { paths: ["system.radius"], values: ["titan"] },
        ],
      },
    }
    const findings = runVocabularyCheck(
      { ok: true, tokens: [token("system.radius.titan")] },
      overlapping,
    )
    // Governed by the FIRST entry only ("wisp"), so "titan" — valid under the
    // second entry — is still reported. Proves there is no dedupe silently
    // consulting both.
    expect(findings).toHaveLength(1)
  })

  it("honours `off` in the rules config", () => {
    // `rules` is the engine's ONE severity mechanism (top-level, like every
    // other surface) — not nested under `lint`.
    expect(
      runVocabularyCheck(
        { ok: true, tokens: [token("system.radius.medium")] },
        vocabConfig({ rules: { "lint/vocabulary-invalid": "off" } }),
      ),
    ).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// PORTED rule: monotonic color ramps (issue #121).
// ---------------------------------------------------------------------------

// A DTCG color token at ramp step `step`, with `l` chosen as the RGB triple
// [l, l, l] — a neutral gray whose HSL lightness IS l, by construction. `path`
// defaults to an alien-vocabulary ramp name so no real color group's name
// leaks into a fixture.
function colorToken(path, step, l) {
  return {
    id: `${path}.${step}`,
    $type: "color",
    value: { components: [l, l, l] },
  }
}

function rampConfig(overrides = {}) {
  return { lint: { rampPaths: ["glimmer.hue.slate"] }, ...overrides }
}

const DESCENDING = [
  colorToken("glimmer.hue.slate", 50, 0.95),
  colorToken("glimmer.hue.slate", 100, 0.8),
  colorToken("glimmer.hue.slate", 200, 0.6),
  colorToken("glimmer.hue.slate", 300, 0.4),
]

describe("runRampCheck — silence without configuration", () => {
  const reversed = [
    colorToken("glimmer.hue.slate", 50, 0.95),
    colorToken("glimmer.hue.slate", 100, 0.6),
    colorToken("glimmer.hue.slate", 200, 0.8), // reverses back upward
  ]

  it("emits nothing when no lint block is configured at all", () => {
    expect(runRampCheck({ ok: true, tokens: reversed }, {})).toEqual([])
  })

  it("emits nothing when lint is configured but rampPaths are not", () => {
    expect(
      runRampCheck({ ok: true, tokens: reversed }, { lint: { rules: {} } }),
    ).toEqual([])
  })

  it("emits nothing for an empty rampPaths array", () => {
    expect(
      runRampCheck({ ok: true, tokens: reversed }, { lint: { rampPaths: [] } }),
    ).toEqual([])
  })

  it("emits the finding once rampPaths ARE configured (proves the above is not vacuous)", () => {
    expect(
      runRampCheck({ ok: true, tokens: reversed }, rampConfig()),
    ).toHaveLength(1)
  })
})

describe("runRampCheck — direction", () => {
  it("stays silent on a cleanly descending ramp", () => {
    expect(
      runRampCheck({ ok: true, tokens: DESCENDING }, rampConfig()),
    ).toEqual([])
  })

  it("stays silent on a cleanly ascending ramp", () => {
    const ascending = [
      colorToken("glimmer.hue.slate", 50, 0.1),
      colorToken("glimmer.hue.slate", 100, 0.3),
      colorToken("glimmer.hue.slate", 200, 0.5),
    ]
    expect(runRampCheck({ ok: true, tokens: ascending }, rampConfig())).toEqual(
      [],
    )
  })

  it("reports the step that reverses the established trend", () => {
    const broken = [
      colorToken("glimmer.hue.slate", 50, 0.95),
      colorToken("glimmer.hue.slate", 100, 0.8),
      colorToken("glimmer.hue.slate", 200, 0.9), // breaks the descent
      colorToken("glimmer.hue.slate", 300, 0.4),
    ]
    const findings = runRampCheck({ ok: true, tokens: broken }, rampConfig())
    expect(findings).toEqual([
      expect.objectContaining({
        ruleId: "lint/ramp-not-monotonic",
        surface: "lint",
        side: "code",
        entity: "glimmer.hue.slate.200",
        data: {
          token: "glimmer.hue.slate.200",
          previous: "glimmer.hue.slate.100",
          lightness: 0.9,
          previousLightness: 0.8,
        },
      }),
    ])
  })

  it("tolerates a plateau — a delta of exactly 0 never reverses a trend", () => {
    const plateau = [
      colorToken("glimmer.hue.slate", 50, 0.9),
      colorToken("glimmer.hue.slate", 100, 0.9),
      colorToken("glimmer.hue.slate", 200, 0.5),
    ]
    expect(runRampCheck({ ok: true, tokens: plateau }, rampConfig())).toEqual(
      [],
    )
  })

  it("asserts nothing about a ramp whose lightness never changes at all", () => {
    // Measured on a real design system: pure black/white/opaque groups hold a
    // CONSTANT lightness across every step, varying only alpha. Flat is not a
    // reversal — there is no established trend to break.
    const flat = [
      colorToken("glimmer.hue.slate", 50, 0.05),
      colorToken("glimmer.hue.slate", 100, 0.05),
      colorToken("glimmer.hue.slate", 200, 0.05),
    ]
    expect(runRampCheck({ ok: true, tokens: flat }, rampConfig())).toEqual([])
  })

  it("checks MULTIPLE configured ramps in one call, not just one", () => {
    // Regression: a single-group fixture never exercises the cross-group sort
    // this rule does before returning findings, so a missing import there
    // (`compareEntities`) passed every other test in this file and crashed
    // only against real config with more than one ramp path — caught only by
    // running against a consumer project, not by this suite alone.
    const twoRamps = [
      ...DESCENDING,
      colorToken("glimmer.hue.amber", 50, 0.9),
      colorToken("glimmer.hue.amber", 100, 0.7),
      colorToken("glimmer.hue.amber", 200, 0.8), // reverses
    ]
    const findings = runRampCheck(
      { ok: true, tokens: twoRamps },
      { lint: { rampPaths: ["glimmer.hue.slate", "glimmer.hue.amber"] } },
    )
    expect(findings.map(f => f.entity)).toEqual(["glimmer.hue.amber.200"])
  })

  it("orders by numeric STEP, not census/array order", () => {
    const outOfOrder = [
      colorToken("glimmer.hue.slate", 300, 0.4),
      colorToken("glimmer.hue.slate", 50, 0.95),
      colorToken("glimmer.hue.slate", 200, 0.9), // still the true reversal
      colorToken("glimmer.hue.slate", 100, 0.8),
    ]
    const findings = runRampCheck(
      { ok: true, tokens: outOfOrder },
      rampConfig(),
    )
    expect(findings.map(f => f.entity)).toEqual(["glimmer.hue.slate.200"])
  })
})

describe("runRampCheck — what this rule cannot read, it skips rather than flags", () => {
  it("skips a token whose $type is not color", () => {
    const notColor = [
      {
        id: "glimmer.hue.slate.50",
        $type: "dimension",
        value: { value: 1, unit: "rem" },
      },
      {
        id: "glimmer.hue.slate.100",
        $type: "dimension",
        value: { value: 2, unit: "rem" },
      },
    ]
    expect(runRampCheck({ ok: true, tokens: notColor }, rampConfig())).toEqual(
      [],
    )
  })

  it("skips a token whose leaf is not a parseable number", () => {
    const nonNumeric = [
      {
        id: "glimmer.hue.slate.default",
        $type: "color",
        value: { components: [0.9, 0.9, 0.9] },
      },
      colorToken("glimmer.hue.slate", 100, 0.1),
    ]
    // Only one comparable member remains once the unparseable leaf is
    // dropped — no pair to compare, so no finding, not a crash.
    expect(
      runRampCheck({ ok: true, tokens: nonNumeric }, rampConfig()),
    ).toEqual([])
  })

  it("skips a value with fewer than 3 components", () => {
    const malformed = [
      {
        id: "glimmer.hue.slate.50",
        $type: "color",
        value: { components: [0.9, 0.9] },
      },
      colorToken("glimmer.hue.slate", 100, 0.1),
    ]
    expect(runRampCheck({ ok: true, tokens: malformed }, rampConfig())).toEqual(
      [],
    )
  })

  it("does not govern a path with no matching rampPaths entry", () => {
    expect(
      runRampCheck(
        { ok: true, tokens: DESCENDING },
        { lint: { rampPaths: ["unrelated.path"] } },
      ),
    ).toEqual([])
  })

  it("honours `off` in the rules config", () => {
    const reversed = [
      colorToken("glimmer.hue.slate", 50, 0.95),
      colorToken("glimmer.hue.slate", 100, 0.6),
      colorToken("glimmer.hue.slate", 200, 0.8),
    ]
    expect(
      runRampCheck(
        { ok: true, tokens: reversed },
        rampConfig({ rules: { "lint/ramp-not-monotonic": "off" } }),
      ),
    ).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Contract lint (issue #406)
// ---------------------------------------------------------------------------

function loaded(id, contract) {
  return { id, file: `${id}.contract.json`, contract }
}

const SIZE_VOCAB = { props: ["size"], values: ["sm", "md", "lg"] }

describe("runContractLintCheck — silence without configuration", () => {
  const badName = [loaded("card", { props: { BigLabel: { type: "string" } } })]

  it("emits nothing when no lint block is configured at all", () => {
    expect(runContractLintCheck(badName, {})).toEqual([])
  })

  it("emits nothing for an empty contracts block", () => {
    expect(runContractLintCheck(badName, { lint: { contracts: {} } })).toEqual(
      [],
    )
  })

  it("emits the finding once nameCase IS configured (proves the above is not vacuous)", () => {
    expect(
      runContractLintCheck(badName, {
        lint: { contracts: { nameCase: "camelCase" } },
      }),
    ).toHaveLength(1)
  })
})

describe("runContractLintCheck — name case", () => {
  const config = { lint: { contracts: { nameCase: "camelCase" } } }

  it("reports a prop and an anatomy element that break the configured case, never a _comment or $sigil key", () => {
    const findings = runContractLintCheck(
      [
        loaded("card", {
          props: { label: { type: "string" }, IconSlot: { type: "slot" } },
          anatomy: {
            root: {},
            Title: {},
            _note: "documentary",
            // ADR-002's variant block is a sigil key, not an element — and
            // unlike `_note` it SURVIVES loading, so it reaches this check.
            $variants: { asLink: { root: { element: "a" } } },
          },
        }),
      ],
      config,
    )
    expect(findings.map(f => [f.ruleId, f.side, f.data])).toEqual([
      [
        "lint/contract-name-case",
        "spec",
        { kind: "prop", name: "IconSlot", nameCase: "camelCase" },
      ],
      [
        "lint/contract-name-case",
        "spec",
        { kind: "anatomy element", name: "Title", nameCase: "camelCase" },
      ],
    ])
  })

  it("accepts PascalCase when that is what is configured", () => {
    expect(
      runContractLintCheck(
        [loaded("card", { props: { Label: { type: "string" } } })],
        { lint: { contracts: { nameCase: "PascalCase" } } },
      ),
    ).toEqual([])
  })
})

describe("runContractLintCheck — enum vocabularies", () => {
  const config = { lint: { contracts: { enumVocabularies: [SIZE_VOCAB] } } }

  it("stays silent on a governed enum whose values are all in the set, and on an ungoverned prop", () => {
    expect(
      runContractLintCheck(
        [
          loaded("badge", {
            props: {
              size: { type: "enum", values: ["sm", "lg"] },
              tone: { type: "enum", values: ["anything"] },
            },
          }),
        ],
        config,
      ),
    ).toEqual([])
  })

  it("reports the values outside the set, naming the allowed ones", () => {
    const findings = runContractLintCheck(
      [
        loaded("heading", {
          props: { size: { type: "enum", values: ["h1", "md", "h2"] } },
        }),
      ],
      config,
    )
    expect(findings).toEqual([
      expect.objectContaining({
        ruleId: "lint/contract-enum-invalid",
        surface: "lint",
        side: "spec",
        entity: "heading",
        data: {
          prop: "size",
          invalid: ["h1", "h2"],
          allowed: ["sm", "md", "lg"],
        },
      }),
    ])
    expect(findings[0].message).toContain('"h1", "h2"')
  })

  it("matches numeric enum values by their string form, as the config carries them", () => {
    expect(
      runContractLintCheck(
        [loaded("grid", { props: { cols: { type: "enum", values: [1, 2] } } })],
        {
          lint: {
            contracts: {
              enumVocabularies: [{ props: ["cols"], values: [1, 2, 3] }],
            },
          },
        },
      ),
    ).toEqual([])
  })

  it("honours rules config: off silences, error escalates", () => {
    const bad = [
      loaded("heading", { props: { size: { type: "enum", values: ["h1"] } } }),
    ]
    expect(
      runContractLintCheck(bad, {
        ...config,
        rules: { "lint/contract-enum-invalid": "off" },
      }),
    ).toEqual([])
    expect(
      runContractLintCheck(bad, {
        ...config,
        rules: { "lint/contract-enum-invalid": "error" },
      })[0].severity,
    ).toBe("error")
  })
})

// ---------------------------------------------------------------------------
// Design naming lint (issue #407)
// ---------------------------------------------------------------------------

describe("compileDesignNamePatterns", () => {
  it("compiles configured patterns and reports invalid ones instead of throwing", () => {
    const { patterns, errors } = compileDesignNamePatterns({
      lint: {
        designNames: { variablePattern: "^[a-z]+$", componentPattern: "[" },
      },
    })
    expect(patterns.variable).toBeInstanceOf(RegExp)
    expect(patterns.component).toBeUndefined()
    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain("componentPattern")
  })

  it("returns nothing when the block is absent", () => {
    expect(compileDesignNamePatterns({})).toEqual({ patterns: {}, errors: [] })
  })
})

describe("runDesignNamingCheck", () => {
  const config = {
    lint: {
      designNames: {
        variablePattern: "^[a-z]+/[a-z]+$",
        componentPattern: "^[A-Z]",
      },
    },
  }

  it("reports names that miss their kind's pattern, side design", () => {
    const findings = runDesignNamingCheck(
      {
        variables: ["fg/default", "Black 3"],
        components: ["Badge", "lowercase name"],
      },
      config,
    )
    expect(findings.map(f => [f.entity, f.data.kind])).toEqual([
      ["Black 3", "variable"],
      ["lowercase name", "component"],
    ])
    expect(findings[0]).toMatchObject({
      ruleId: "lint/design-name-invalid",
      surface: "lint",
      side: "design",
    })
    expect(findings[0].message).toContain("^[a-z]+/[a-z]+$")
  })

  it("checks only the kinds a pattern is configured for, and honours off", () => {
    expect(
      runDesignNamingCheck(
        { variables: ["Whatever"], components: ["bad name"] },
        { lint: { designNames: { componentPattern: "^[A-Z]" } } },
      ),
    ).toHaveLength(1)
    expect(
      runDesignNamingCheck(
        { components: ["bad name"] },
        { ...config, rules: { "lint/design-name-invalid": "off" } },
      ),
    ).toEqual([])
  })
})
