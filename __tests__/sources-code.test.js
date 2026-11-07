/**
 * sources-code.test.js — `src/sources/code.mjs`'s code-side census (ADR-001
 * Phase 1 slice 1a, issue #94): the DTCG `tokens.json` loader (via
 * `@terrazzo/parser`) and the emitted-CSS-var census. No Figma, no diff, no
 * findings — see the module docblock.
 *
 * Every fixture here is in-repo and generically named. The engine is
 * consumer-agnostic by charter (CLAUDE.md), and that applies to its tests as
 * much as to its defaults: a suite that reaches into a particular checkout, or
 * asserts a particular design system's token names, bakes one consumer into the
 * engine and can only ever pass on one machine. The alias fixture reproduces
 * the STRUCTURE of the bug the Terrazzo spike found, so the contract is proven
 * everywhere, CI included.
 *
 * `DESIGN_DELTA_TEST_TOKENS=/path/to/tokens.json` opts into an extra smoke
 * check against a real design system's file, with deliberately generic
 * assertions. It has no default and is skipped when unset.
 */

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import {
  censusComponentUsage,
  censusCssVars,
  censusTokenLint,
  censusTokens,
  findUnresolvableAliases,
} from "../src/sources/code.mjs"
import { runTokensCheck } from "../src/modules/tokens.mjs"
import { createSyntheticProject } from "./helpers/synthetic-project.mjs"

const TEST_DIR = dirname(fileURLToPath(import.meta.url))
const FIXTURES_DIR = join(TEST_DIR, "fixtures")

function writeFile(path, content) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
}

// ---------------------------------------------------------------------------
// Synthetic project — proves the census reads the RESOLVED config (synthetic
// tokensFile/componentsDir/cssVarPrefix), never an engine default or a
// hardcoded path.
// ---------------------------------------------------------------------------

describe("sources/code — synthetic project (config-driven, nothing hardcoded)", () => {
  let project

  beforeEach(() => {
    project = createSyntheticProject()
  })

  afterEach(() => {
    project.cleanup()
  })

  it("censusTokens loads the synthetic tokens.json, at its synthetic path", async () => {
    const result = await censusTokens(project.config, { root: project.root })
    expect(result.ok).toBe(true)
    expect(result.diagnostics).toEqual([])
    expect(result.tokens.map(t => t.id)).toEqual([
      "acme.color.bg",
      "acme.color.danger",
      "acme.color.fg",
    ])
    // The synthetic values themselves round-trip through Terrazzo's color
    // normalization — proof this is the SYNTHETIC file's content, not a
    // fixture the engine happens to ship.
    const fg = result.tokens.find(t => t.id === "acme.color.fg")
    expect(fg.$type).toBe("color")
    expect(fg.value).toEqual({
      colorSpace: "srgb",
      components: [
        0.06666666666666667, 0.06666666666666667, 0.06666666666666667,
      ],
      alpha: 1,
    })
    expect(fg.modes).toEqual(["."])
  })

  it("censusCssVars scans the synthetic componentsDir for the synthetic prefix", () => {
    const result = censusCssVars(project.config, { root: project.root })
    expect(result.ok).toBe(true)
    const names = result.vars.map(v => v.name)
    expect(names).toEqual(["--acme-color-bg", "--acme-color-fg"])

    const fg = result.vars.find(v => v.name === "--acme-color-fg")
    // Both field and badge reference --acme-color-fg (see
    // helpers/synthetic-project.mjs renderField/renderBadge) — under the
    // SYNTHETIC componentsDir ("src/ui"), never the engine's default
    // ("components") or v1's ("--system-").
    expect(fg.usages).toEqual([
      { file: "src/ui/badge/badge.styles.scss", line: 2 },
      { file: "src/ui/field/field.styles.scss", line: 2 },
    ])
    expect(fg.declarations).toEqual([])
  })

  it("censusCssVars names each configured styleRoot missing from disk (#562)", () => {
    const config = {
      ...project.config,
      paths: { ...project.config.paths, styleRoots: ["src/ui", "src/gone"] },
    }
    const result = censusCssVars(config, { root: project.root })
    expect(result.missingStyleRoots).toEqual(["src/gone"])
  })
})

// ---------------------------------------------------------------------------
// The fixed, in-repo fixture — a small, hand-authored, valid DTCG file
// proving the happy path: aliases, a per-mode `$extensions.mode` override,
// and DTCG color objects.
// ---------------------------------------------------------------------------

describe("sources/code — censusTokens against the in-repo fixture", () => {
  it("parses every token, with aliasOf/aliasChain/modes populated correctly", async () => {
    const config = { paths: { tokensFile: "tokens-fixture.json" } }
    const result = await censusTokens(config, { root: FIXTURES_DIR })

    expect(result.ok).toBe(true)
    expect(result.diagnostics).toEqual([])
    expect(result.tokens.map(t => t.id)).toEqual([
      "base.color.ink",
      "base.color.paper",
      "base.spacing.2",
      "base.spacing.16",
      "system.border.hairline",
      "system.color.bg",
      "system.color.fg",
      "system.space.gutter",
    ])

    const bg = result.tokens.find(t => t.id === "system.color.bg")
    expect(bg.aliasOf).toBe("base.color.paper")
    expect(bg.value).toEqual({
      colorSpace: "srgb",
      components: [0.98, 0.98, 0.98],
      alpha: 1,
    })

    // The $extensions.mode override — both modes present, aliasOf resolved
    // for the default mode.
    const fg = result.tokens.find(t => t.id === "system.color.fg")
    expect(fg.modes).toEqual([".", "dark"])
    expect(fg.aliasOf).toBe("base.color.ink")

    // A composite (border) token whose fields are PARTIALLY aliased —
    // resolved into a fully literal value, but with the alias EDGES also
    // preserved (issue #192): `modules/tokens.mjs` needs to know
    // `base.color.ink` and `base.spacing.2` are consumed by this composite's
    // `color`/`width` members, not just their resolved values.
    const hairline = result.tokens.find(t => t.id === "system.border.hairline")
    expect(hairline.$type).toBe("border")
    expect(hairline.value).toEqual({
      color: { colorSpace: "srgb", components: [0.06, 0.06, 0.06], alpha: 1 },
      width: { value: 2, unit: "px" },
      style: "solid",
    })
    expect(hairline.partialAliasOf).toEqual({
      color: "system.color.fg",
      width: "base.spacing.2",
    })

    const gutter = result.tokens.find(t => t.id === "system.space.gutter")
    expect(gutter.aliasOf).toBe("base.spacing.16")
  })

  it("natural-sorts numeric segments (spacing.2 before spacing.16)", async () => {
    const config = { paths: { tokensFile: "tokens-fixture.json" } }
    const result = await censusTokens(config, { root: FIXTURES_DIR })
    const spacingIds = result.tokens
      .map(t => t.id)
      .filter(id => id.startsWith("base.spacing."))
    expect(spacingIds).toEqual(["base.spacing.2", "base.spacing.16"])
  })
})

// ---------------------------------------------------------------------------
// `cssValue` — the CSS-output flattening of a composite `$value` (issue #255).
// Without this, `dimension`/`color`/`duration`/`cubicBezier` (and anything
// composed of them) stay in their raw DTCG shape forever, and nothing
// structured can ever equal a single hardcoded CSS declaration or a design
// tool's flat value.
// ---------------------------------------------------------------------------

describe("sources/code — censusTokens flattens composite $values to cssValue (#255)", () => {
  it("flattens dimension/duration/cubicBezier to their one CSS string", async () => {
    const config = { paths: { tokensFile: "tokens-composite-fixture.json" } }
    const result = await censusTokens(config, { root: FIXTURES_DIR })
    expect(result.ok).toBe(true)

    const byId = Object.fromEntries(result.tokens.map(t => [t.id, t]))
    expect(byId["base.spacing.sm"].cssValue).toBe("4px")
    expect(byId["system.motion.fast"].cssValue).toBe("150ms")
    expect(byId["system.motion.ease"].cssValue).toBe(
      "cubic-bezier(0.4, 0, 0.2, 1)",
    )
  })

  it("resolves an ALIASED composite token to its final literal value, never `var(...)`", async () => {
    // `system.gap` aliases `base.spacing.sm` — Terrazzo's own default alias
    // transform would render this as `var(--base-spacing-sm)`, which is what
    // this TOKEN's own generated declaration would say, but not what a
    // hardcoded literal equal to its VALUE should be compared against. Most
    // tokens in a real system alias a primitive, so getting this wrong would
    // leave the fix from #255 working only for a minority of tokens.
    const config = { paths: { tokensFile: "tokens-composite-fixture.json" } }
    const result = await censusTokens(config, { root: FIXTURES_DIR })
    const gap = result.tokens.find(t => t.id === "system.gap")
    expect(gap.aliasOf).toBe("base.spacing.sm")
    expect(gap.cssValue).toBe("4px")
  })

  it("flattens color via legacyHex, closer to a hand-authored literal than modern rgb()", async () => {
    const config = { paths: { tokensFile: "tokens-composite-fixture.json" } }
    const result = await censusTokens(config, { root: FIXTURES_DIR })
    const brand = result.tokens.find(t => t.id === "system.brand")
    expect(brand.cssValue).toBe("#fafafa")
  })

  it("leaves cssValue OUT for a composite that expands to multiple CSS properties (typography)", async () => {
    // `typography` has no single CSS value — it expands to font-family,
    // font-size, font-weight, line-height, … as separate declarations. A
    // single hardcoded CSS declaration only ever has one property's one
    // value, so there is nothing in a multi-property composite that could
    // equal one; `cssValue` is correctly absent rather than an object callers
    // would have to special-case.
    const config = { paths: { tokensFile: "tokens-composite-fixture.json" } }
    const result = await censusTokens(config, { root: FIXTURES_DIR })
    const body = result.tokens.find(t => t.id === "system.type.body")
    expect(body.cssValue).toBeUndefined()
    // The raw DTCG shape is still there — this fix only ADDS `cssValue`, it
    // never removes `value`.
    expect(body.value).toEqual({
      fontFamily: ["Inter"],
      fontSize: { value: 16, unit: "px" },
      fontWeight: 400,
      lineHeight: 1.5,
    })
  })
})

// ---------------------------------------------------------------------------
// Unresolvable aliases degrade instead of exploding — the behavior this slice
// exists for (issue #94).
//
// This runs against an in-repo fixture with entirely generic names. The engine
// is consumer-agnostic by charter (CLAUDE.md), and that has to hold for its
// TESTS too: a suite that reaches into a particular checkout, or asserts a
// particular design system's token names, bakes one consumer into the engine
// just as surely as a hardcoded default would — and it can only ever run on one
// machine. The fixture reproduces the structural bug instead, so the contract
// is verified everywhere, CI included.
//
// To sanity-check a real design system's file, point DESIGN_DELTA_TEST_TOKENS
// at it (see below). No path is assumed and nothing is hardcoded.
// ---------------------------------------------------------------------------

describe("sources/code — censusTokens with unresolvable aliases", () => {
  const brokenFixture = join(FIXTURES_DIR, "tokens-unresolvable-alias.json")

  it("EXCLUDES only the bad leaves and still censuses the rest, naming ALL of them", async () => {
    const result = await censusTokens({
      paths: { tokensFile: brokenFixture },
    })

    // Partial, not all-or-nothing (issue #123). The previous contract returned
    // `{ok: false, tokens: []}`, so on a real design system TWO bad leaves out
    // of 657 meant this surface produced zero findings — and reported that
    // only as a diagnostic, which reads like "we noticed something" rather
    // than "your token rules never ran".
    expect(result.ok).toBe(true)
    expect(result.tokens.length).toBeGreaterThan(0)
    expect(result.excluded).toEqual(["theme.focus.color", "theme.ring.color"])
    // The excluded leaves are gone from the census, not silently kept.
    const censusedIds = result.tokens.map(t => t.id)
    for (const id of result.excluded) expect(censusedIds).not.toContain(id)
    // BOTH, not one: @terrazzo/parser aborts on the first bad alias it meets,
    // which is exactly why the pre-scan exists — a consumer must not have to
    // fix, re-run, discover the next, and repeat.
    expect(result.diagnostics).toHaveLength(2)
    expect(result.diagnostics.every(d => d.code === "unresolvable-alias")).toBe(
      true,
    )

    const tokenIds = result.diagnostics.map(d => d.tokenId).sort()
    expect(tokenIds).toEqual(["theme.focus.color", "theme.ring.color"])
    // Every diagnostic names the token path and the unresolvable target.
    for (const diagnostic of result.diagnostics) {
      expect(diagnostic.target).toBe("theme.border.primary")
      expect(diagnostic.message).toContain(diagnostic.tokenId)
      expect(diagnostic.message).toContain(diagnostic.target)
    }
  })

  it("suggests only slash-qualified siblings that actually resolve", async () => {
    const result = await censusTokens({
      paths: { tokensFile: brokenFixture },
    })

    // The bare "theme" group EXISTS in the fixture, so a suggestion can't be
    // derived by assuming the head segment is simply absent — each candidate
    // has to be resolved before it is offered.
    expect(result.diagnostics.length).toBeGreaterThan(0)
    for (const diagnostic of result.diagnostics) {
      expect([...diagnostic.suggestions].sort()).toEqual([
        "theme/dark.border.primary",
        "theme/light.border.primary",
      ])
    }
  })

  it("offers every resolving sibling, in one deterministic order", async () => {
    // This used to assert that the referencing token's OWN group led the list
    // (#171), for a `theme/dark` token whose alias had "lost its mode". #564
    // settled that such an alias had lost nothing — it is the folded path, and
    // the engine resolves it now — so the only token that can still reach a
    // suggestion is one OUTSIDE the mode sets, which has no own group among
    // the candidates. Sorted order is all that is left to pin, and pinning it
    // is what keeps the message reproducible run to run.
    const result = await censusTokens({
      paths: { tokensFile: brokenFixture },
    })

    expect(result.diagnostics.length).toBeGreaterThan(0)
    for (const diagnostic of result.diagnostics) {
      expect(diagnostic.suggestions).toEqual([
        "theme/dark.border.primary",
        "theme/light.border.primary",
      ])
    }
  })

  it("puts the suggestions in the message, not only in the payload", async () => {
    // The suggestions were computed correctly all along and never reached the
    // human-readable message, which stated the problem accurately and gave no
    // way to act on it (issue #171). A consumer reads the message.
    const result = await censusTokens({
      paths: { tokensFile: brokenFixture },
    })

    expect(result.diagnostics.length).toBeGreaterThan(0)
    for (const diagnostic of result.diagnostics) {
      expect(diagnostic.message).toContain("did you mean")
      expect(diagnostic.message).toContain(`{${diagnostic.suggestions[0]}}`)
    }
  })

  it("formats suggestions with proper conjunctions for 3+ candidates", async () => {
    // The message format should be: "a" or "b" or "c" -> "a", "b" or "c"
    // for 3+, not chained with multiple "or"s.
    const threeCandidate = join(
      FIXTURES_DIR,
      "tokens-unresolvable-alias-three-candidates.json",
    )
    const result = await censusTokens({
      paths: { tokensFile: threeCandidate },
    })

    expect(result.diagnostics.length).toBeGreaterThan(0)
    expect(result.diagnostics[0].code).toBe("unresolvable-alias")

    for (const diagnostic of result.diagnostics) {
      // All suggestions should be in the message
      expect(diagnostic.message).toContain("did you mean")
      for (const suggestion of diagnostic.suggestions) {
        expect(diagnostic.message).toContain(`{${suggestion}}`)
      }

      // For 3+ suggestions, should use proper Oxford-comma style: "a", "b" or "c"
      // not "a" or "b" or "c"
      if (diagnostic.suggestions.length >= 3) {
        const quoted = diagnostic.suggestions.map(s => `"{${s}}"`)
        // The formatted list should have a comma between first and second-to-last items
        expect(diagnostic.message).toMatch(/", "/)
        // And "or" before the last item
        expect(diagnostic.message).toMatch(/" or "/)
      } else if (diagnostic.suggestions.length === 2) {
        // Two suggestions should be joined with " or " only
        expect(diagnostic.message).toMatch(/" or "/)
        expect(diagnostic.message).not.toMatch(/", "/)
      }
    }
  })
})

// ---------------------------------------------------------------------------
// Sibling mode sets read as modes of their head (#564).
//
// A source that keeps each mode as its own top-level set refers between tokens
// of the SAME mode by the folded path, because that is the path the alias has
// once the sets are modes. Before this, the engine read `system/dark` as a
// group whose name happens to contain a slash: the alias resolved nowhere, the
// "did you mean" advice pointed at a mode-qualified path that breaks the
// consumer's own token build, and the aliasing token was dropped from the
// census. `paths.resolvedTokensFile` was the only way out, and it asks the
// consumer for a build artifact.
//
// The fold is inferred only from structure, never from a name: two or more
// `x/<...>` top-level sets, an alias the document cannot resolve as authored,
// and the same path resolving in the referencing token's OWN set.
// ---------------------------------------------------------------------------

describe("censusTokens — sibling mode sets resolve their own aliases (#564)", () => {
  const modeSetFixture = join(FIXTURES_DIR, "tokens-mode-set-alias.json")

  it("reports no unresolvable alias for a same-mode folded path", async () => {
    const result = await censusTokens({
      paths: { tokensFile: modeSetFixture },
    })

    const folded = result.diagnostics.filter(
      d =>
        d.code === "unresolvable-alias" &&
        d.target === "system.color.border.primary",
    )
    expect(folded).toEqual([])
  })

  it("censuses the aliasing token, at its OWN mode's value", async () => {
    // The half a suppressed diagnostic cannot deliver: the leaf has to reach
    // the parser with a path the parser can resolve, or it is still excluded.
    const result = await censusTokens({
      paths: { tokensFile: modeSetFixture },
    })

    const ids = result.tokens.map(t => t.id)
    expect(ids).toContain("system/light.color.focusRing.color")
    expect(ids).toContain("system/dark.color.focusRing.color")
    expect(result.excluded).not.toContain("system/light.color.focusRing.color")
    expect(result.excluded).not.toContain("system/dark.color.focusRing.color")

    // Each mode resolves to its own border, never the sibling's.
    const light = result.tokens.find(
      t => t.id === "system/light.color.focusRing.color",
    )
    const dark = result.tokens.find(
      t => t.id === "system/dark.color.focusRing.color",
    )
    const borderLight = result.tokens.find(
      t => t.id === "system/light.color.border.primary",
    )
    const borderDark = result.tokens.find(
      t => t.id === "system/dark.color.border.primary",
    )
    expect(light.value).toEqual(borderLight.value)
    expect(dark.value).toEqual(borderDark.value)
    expect(light.value).not.toEqual(dark.value)
  })

  it("pairs the aliasing token with its design variable — not excluded, not unmatched (#637)", async () => {
    // The end of the chain a census-only test cannot see: a mode-set token
    // aliasing another token of its head was excluded, so its design
    // variable was reported `design-token-unmatched` and the token
    // `code-token-undesigned`. Folded, the two pair and their value compares.
    const census = await censusTokens({
      paths: { tokensFile: modeSetFixture },
    })
    const dark = census.tokens.find(
      t => t.id === "system/dark.color.focusRing.color",
    )
    const report = {}
    const findings = runTokensCheck(
      census,
      { ok: true, vars: [] },
      { conventions: { cssVarPrefix: "--system-" } },
      { entries: [{ name: "focusRing/color", value: dark.cssValue }] },
      report,
    )

    const about = findings.filter(
      f =>
        f.entity === "focusRing/color" ||
        f.entity === "system.color.focusRing.color",
    )
    expect(about.map(f => f.ruleId)).toEqual([])
    expect(report.tokenParity).toMatchObject({
      matched: 1,
      mismatched: 0,
      designOnly: 0,
    })
  })

  it("censuses the AUTHORED ids — the fold never reaches the consumer", async () => {
    // The rewrite exists so the parser can resolve the leaf. Drift is reported
    // against what a human wrote, so no id may come back folded.
    const result = await censusTokens({
      paths: { tokensFile: modeSetFixture },
    })

    const ids = result.tokens.map(t => t.id)
    expect(ids.some(id => id.startsWith("system/light."))).toBe(true)
    expect(ids.some(id => id.startsWith("system/dark."))).toBe(true)
    expect(ids.some(id => id.startsWith("system.color."))).toBe(false)
  })

  it("still reports an alias that resolves only in the OTHER mode", async () => {
    // FR4, and the line the whole inference rests on: one mode's value is
    // never silently substituted for another's.
    const result = await censusTokens({
      paths: { tokensFile: modeSetFixture },
    })

    const crossMode = result.diagnostics.find(
      d => d.tokenId === "system/light.color.crossMode.color",
    )
    expect(crossMode.code).toBe("unresolvable-alias")
    expect(crossMode.target).toBe("system.color.border.onlyInDark")
    // And it still says what WOULD resolve, which is the sibling set.
    expect(crossMode.suggestions).toEqual([
      "system/dark.color.border.onlyInDark",
    ])
  })

  it("still reports an alias that resolves in no set at all", async () => {
    const result = await censusTokens({
      paths: { tokensFile: modeSetFixture },
    })

    const typo = result.diagnostics.find(
      d => d.tokenId === "system/dark.color.typo.color",
    )
    expect(typo.code).toBe("unresolvable-alias")
    expect(typo.target).toBe("system.color.bordr.primary")
    expect(typo.suggestions).toBeUndefined()
  })

  it("excludes ONLY the two genuinely broken leaves", async () => {
    const result = await censusTokens({
      paths: { tokensFile: modeSetFixture },
    })

    expect(result.ok).toBe(true)
    expect(result.excluded).toEqual([
      "system/dark.color.typo.color",
      "system/light.color.crossMode.color",
    ])
  })

  it("infers nothing from a LONE x/<mode> group", async () => {
    // FR6. One group whose name contains a slash is not a set of siblings, and
    // reading a mode out of it would pre-empt the prep steps
    // `paths.resolvedTokensFile` exists for. Two or more is the signature.
    const project = createSyntheticProject({
      paths: { resolvedTokensFile: "" },
      tokens: {
        "system/light": {
          color: {
            border: { $type: "color", $value: "#111111" },
            focus: { $type: "color", $value: "{system.color.border}" },
          },
        },
      },
    })
    try {
      const result = await censusTokens(project.config, { root: project.root })
      expect(
        result.diagnostics.some(d => d.code === "unresolvable-alias"),
      ).toBe(true)
    } finally {
      project.cleanup()
    }
  })

  it("folds on the lint surface too, not only in censusTokens", async () => {
    // The pre-scan has two callers and fixing one has already left the other
    // behind once (#176). The fold lands in the shared loader for that reason.
    const project = createSyntheticProject({
      paths: { resolvedTokensFile: "" },
      tokens: {
        "system/light": {
          color: {
            border: { $type: "color", $value: "#111111" },
            focus: { $type: "color", $value: "{system.color.border}" },
          },
        },
        "system/dark": {
          color: {
            border: { $type: "color", $value: "#eeeeee" },
            focus: { $type: "color", $value: "{system.color.border}" },
          },
        },
      },
    })
    try {
      const result = await censusTokenLint(project.config, {
        root: project.root,
        rules: { "core/valid-color": "error" },
      })
      expect(
        result.diagnostics.filter(d => d.code === "unresolvable-alias"),
      ).toEqual([])
    } finally {
      project.cleanup()
    }
  })

  it("folds a per-mode override under $extensions.mode too", async () => {
    // `$extensions.mode` is Terrazzo's own multi-mode escape hatch, and a
    // project can use it INSIDE a set that is itself a mode. Those values are
    // resolved by the parser exactly like the default `$value`, so a fold that
    // only reached `$value` would leave the override unresolvable and take the
    // whole file down with it — `collectAliasSources` already scans both for
    // the same reason.
    const project = createSyntheticProject({
      paths: { resolvedTokensFile: "" },
      tokens: {
        "system/light": {
          color: {
            border: { $type: "color", $value: "#111111" },
            contrast: { $type: "color", $value: "#000000" },
            focus: {
              $type: "color",
              $value: "#222222",
              $extensions: {
                mode: { hc: { $value: "{system.color.contrast}" } },
              },
            },
          },
        },
        "system/dark": {
          color: {
            border: { $type: "color", $value: "#eeeeee" },
            contrast: { $type: "color", $value: "#ffffff" },
          },
        },
      },
    })
    try {
      const result = await censusTokens(project.config, { root: project.root })
      expect(
        result.diagnostics.filter(d => d.code === "unresolvable-alias"),
      ).toEqual([])
      expect(result.excluded).toEqual([])
      expect(result.tokens.map(t => t.id)).toContain("system/light.color.focus")
    } finally {
      project.cleanup()
    }
  })

  it("folds across FILES when tokensFile names a directory", async () => {
    // Each mode commonly lives in its own file, so resolvability has to be
    // judged against the merged document, not the file the token sits in.
    const root = mkdtempSync(join(tmpdir(), "dd-mode-sets-"))
    try {
      writeFile(
        join(root, "tokens", "light.json"),
        JSON.stringify({
          "system/light": {
            color: {
              border: { $type: "color", $value: "#111111" },
              focus: { $type: "color", $value: "{system.color.border}" },
            },
          },
        }),
      )
      writeFile(
        join(root, "tokens", "dark.json"),
        JSON.stringify({
          "system/dark": {
            color: {
              border: { $type: "color", $value: "#eeeeee" },
              focus: { $type: "color", $value: "{system.color.border}" },
            },
          },
        }),
      )
      const result = await censusTokens(
        { paths: { tokensFile: "tokens" } },
        { root },
      )
      expect(
        result.diagnostics.filter(d => d.code === "unresolvable-alias"),
      ).toEqual([])
      expect(result.tokens.map(t => t.id)).toContain("system/dark.color.focus")
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

// Opt-in smoke check against a REAL design system's tokens file, for a human
// verifying the loader against their own data:
//
//   DESIGN_DELTA_TEST_TOKENS=/path/to/tokens.json npm test
//
// Skipped unless the env var is set — no default path, no assumption that any
// particular repo is checked out. Assertions are deliberately generic (the
// contract: never throw, always answer), since a real file's contents are the
// consumer's business and not something the engine's suite may encode.
const realTokensFile = process.env.DESIGN_DELTA_TEST_TOKENS
const describeRealFile =
  realTokensFile && existsSync(realTokensFile) ? describe : describe.skip

describeRealFile("sources/code — opt-in real tokens file", () => {
  it("answers without throwing, whatever the file contains", async () => {
    const result = await censusTokens({
      paths: { tokensFile: realTokensFile },
    })

    expect(typeof result.ok).toBe("boolean")
    expect(Array.isArray(result.tokens)).toBe(true)
    expect(Array.isArray(result.diagnostics)).toBe(true)
    // ok:false must always come with a reason, and ok:true with real tokens —
    // a silent empty census would be the dishonest outcome.
    if (result.ok) expect(result.tokens.length).toBeGreaterThan(0)
    else expect(result.diagnostics.length).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------
// Determinism gate (ADR-001 working method): same input, two runs ->
// byte-identical output.
// ---------------------------------------------------------------------------

describe("sources/code — determinism", () => {
  it("censusTokens is byte-identical across two runs over the same input", async () => {
    const config = { paths: { tokensFile: "tokens-fixture.json" } }
    const options = { root: FIXTURES_DIR }
    const first = await censusTokens(config, options)
    const second = await censusTokens(config, options)
    expect(JSON.stringify(first)).toBe(JSON.stringify(second))
  })

  it("censusCssVars is byte-identical across two runs over the same input", () => {
    const project = createSyntheticProject()
    try {
      const first = censusCssVars(project.config, { root: project.root })
      const second = censusCssVars(project.config, { root: project.root })
      expect(JSON.stringify(first)).toBe(JSON.stringify(second))
    } finally {
      project.cleanup()
    }
  })
})

// ---------------------------------------------------------------------------
// Missing file / malformed JSON — ok:false + a clear diagnostic, never a
// raw stack trace, using an injected fake fs (a "practical" injection point,
// unlike the directory-walking CSS-var scan).
// ---------------------------------------------------------------------------

describe("sources/code — censusTokens degrades honestly on a bad tokens file", () => {
  it("missing file -> ok:false with a missing-tokens-file diagnostic", async () => {
    const fakeFs = { existsSync: () => false, readFileSync: () => "" }
    const result = await censusTokens(
      { paths: { tokensFile: "nowhere/tokens.json" } },
      { root: "/does/not/matter", fs: fakeFs },
    )
    expect(result.ok).toBe(false)
    expect(result.tokens).toEqual([])
    expect(result.diagnostics).toHaveLength(1)
    expect(result.diagnostics[0].code).toBe("missing-tokens-file")
    expect(result.diagnostics[0].message).toContain("nowhere/tokens.json")
  })

  it("malformed JSON -> ok:false with an invalid-json diagnostic, no throw", async () => {
    const fakeFs = {
      existsSync: () => true,
      readFileSync: () => "{ not: valid json",
    }
    await expect(
      censusTokens(
        { paths: { tokensFile: "tokens.json" } },
        { root: "/x", fs: fakeFs },
      ),
    ).resolves.toMatchObject({
      ok: false,
      tokens: [],
    })
    const result = await censusTokens(
      { paths: { tokensFile: "tokens.json" } },
      { root: "/x", fs: fakeFs },
    )
    expect(result.diagnostics).toHaveLength(1)
    expect(result.diagnostics[0].code).toBe("invalid-json")
  })

  it("a non-object JSON document -> ok:false with an invalid-tokens-shape diagnostic", async () => {
    const fakeFs = { existsSync: () => true, readFileSync: () => "[1, 2, 3]" }
    const result = await censusTokens(
      { paths: { tokensFile: "tokens.json" } },
      { root: "/x", fs: fakeFs },
    )
    expect(result.ok).toBe(false)
    expect(result.diagnostics[0].code).toBe("invalid-tokens-shape")
  })
})

// ---------------------------------------------------------------------------
// findUnresolvableAliases — the pre-scan unit itself, isolated from Terrazzo.
// ---------------------------------------------------------------------------

describe("sources/code — findUnresolvableAliases", () => {
  it("reports every unresolvable alias in one pass, sorted, not just the first", () => {
    const doc = {
      base: { color: { ink: { $type: "color", $value: "#000000" } } },
      system: {
        a: { $type: "color", $value: "{system.missing.one}" },
        b: { $type: "color", $value: "{system.missing.two}" },
        ok: { $type: "color", $value: "{base.color.ink}" },
      },
    }
    const diagnostics = findUnresolvableAliases(doc)
    expect(diagnostics).toHaveLength(2)
    expect(diagnostics.map(d => d.tokenId)).toEqual(["system.a", "system.b"])
  })

  it("suggests a slash-qualified sibling group when it makes the alias resolve", () => {
    const doc = {
      "system/light": {
        color: { border: { $type: "color", $value: "#ffffff" } },
      },
      system: {
        focusRing: { $type: "color", $value: "{system.color.border}" },
      },
    }
    const diagnostics = findUnresolvableAliases(doc)
    expect(diagnostics).toHaveLength(1)
    expect(diagnostics[0].suggestions).toEqual(["system/light.color.border"])
  })

  it("returns [] when every alias resolves", () => {
    const doc = {
      base: { color: { ink: { $type: "color", $value: "#000000" } } },
      system: { fg: { $type: "color", $value: "{base.color.ink}" } },
    }
    expect(findUnresolvableAliases(doc)).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// CSS var census — declarations vs usages, prefix filtering, sorted output.
// A dedicated tmp tree (not the synthetic-project fixture) for tight control
// over exactly which declarations/usages/prefixes are present.
// ---------------------------------------------------------------------------

describe("sources/code — censusCssVars", () => {
  let root
  let cleanup

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "design-delta-cssvars-"))
    cleanup = () => rmSync(root, { recursive: true, force: true })
  })

  afterEach(() => {
    cleanup()
  })

  const config = {
    paths: { componentsDir: "ui" },
    conventions: { cssVarPrefix: "--ds-" },
  }

  it("finds declarations and usages, sorted by var name then file then line", () => {
    writeFile(
      join(root, "ui", "button", "button.css"),
      "/* line1 */\n.button {\n  --ds-color-fg: #111;\n  color: var(--ds-color-fg);\n}\n",
    )
    writeFile(
      join(root, "ui", "alert", "alert.css"),
      ".alert {\n  color: var(--ds-color-fg);\n  border-color: var(--ds-color-border);\n}\n",
    )

    const result = censusCssVars(config, { root })
    expect(result.ok).toBe(true)
    expect(result.vars.map(v => v.name)).toEqual([
      "--ds-color-border",
      "--ds-color-fg",
    ])

    const fg = result.vars.find(v => v.name === "--ds-color-fg")
    expect(fg.declarations).toEqual([{ file: "ui/button/button.css", line: 3 }])
    // Sorted by file then line — alert.css before button.css.
    expect(fg.usages).toEqual([
      { file: "ui/alert/alert.css", line: 2 },
      { file: "ui/button/button.css", line: 4 },
    ])

    const border = result.vars.find(v => v.name === "--ds-color-border")
    expect(border.declarations).toEqual([])
    expect(border.usages).toEqual([{ file: "ui/alert/alert.css", line: 3 }])
  })

  it("ignores a var whose name does not match the configured prefix", () => {
    writeFile(
      join(root, "ui", "widget", "widget.css"),
      ".widget {\n  --ds-color-fg: #111;\n  --other-prefix-x: #222;\n  color: var(--ds-color-fg);\n  border-color: var(--other-prefix-x);\n}\n",
    )
    const result = censusCssVars(config, { root })
    expect(result.vars.map(v => v.name)).toEqual(["--ds-color-fg"])
  })

  it("scans .ts/.tsx in addition to .css/.scss", () => {
    writeFile(
      join(root, "ui", "flex", "flex.ts"),
      'export const style = { color: "var(--ds-color-fg)" }\n',
    )
    const result = censusCssVars(config, { root })
    expect(result.vars.map(v => v.name)).toEqual(["--ds-color-fg"])
    expect(result.vars[0].usages).toEqual([
      { file: "ui/flex/flex.ts", line: 1 },
    ])
  })

  it("an empty/missing componentsDir yields an empty, ok:true census", () => {
    const result = censusCssVars(config, { root: join(root, "does-not-exist") })
    expect(result.ok).toBe(true)
    expect(result.vars).toEqual([])
  })

  it("respects the default cssVarPrefix ('--') when none is configured", () => {
    writeFile(
      join(root, "ui", "any", "any.css"),
      ".any { color: var(--whatever-name); }\n",
    )
    const result = censusCssVars({ paths: { componentsDir: "ui" } }, { root })
    expect(result.vars.map(v => v.name)).toEqual(["--whatever-name"])
  })
})

// ---------------------------------------------------------------------------
// Component-usage census (issue #223).
// ---------------------------------------------------------------------------

describe("sources/code — censusComponentUsage", () => {
  let root
  let cleanup

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "design-delta-usage-"))
    cleanup = () => rmSync(root, { recursive: true, force: true })
  })

  afterEach(() => {
    cleanup()
  })

  const config = { paths: { componentsDir: "ui" } }

  it("records a component imported by another file, and leaves an unimported one out", () => {
    writeFile(
      join(root, "ui", "button.tsx"),
      "export function Button() { return null }\n",
    )
    writeFile(
      join(root, "ui", "toolbar.tsx"),
      'import { Button } from "./button"\n\nexport function Toolbar() { return <Button /> }\n',
    )
    writeFile(
      join(root, "ui", "orphan.tsx"),
      "export function Orphan() { return null }\n",
    )

    const result = censusComponentUsage(config, { root })
    expect(result.ok).toBe(true)
    expect(result.usages).toEqual([
      {
        file: "ui/button.tsx",
        usedBy: [{ file: "ui/toolbar.tsx", line: 1 }],
      },
    ])
  })

  it("resolves an import against an index file", () => {
    writeFile(
      join(root, "ui", "icon", "index.tsx"),
      "export function Icon() { return null }\n",
    )
    writeFile(
      join(root, "ui", "button.tsx"),
      'import { Icon } from "./icon"\n\nexport function Button() { return <Icon /> }\n',
    )

    const result = censusComponentUsage(config, { root })
    expect(result.usages).toEqual([
      {
        file: "ui/icon/index.tsx",
        usedBy: [{ file: "ui/button.tsx", line: 1 }],
      },
    ])
  })

  it("does not count a type-only import as usage", () => {
    writeFile(
      join(root, "ui", "button.tsx"),
      "export type ButtonProps = { label: string }\n",
    )
    writeFile(
      join(root, "ui", "toolbar.tsx"),
      'import type { ButtonProps } from "./button"\n\nexport function Toolbar(props: ButtonProps) { return null }\n',
    )

    const result = censusComponentUsage(config, { root })
    expect(result.usages).toEqual([])
  })

  it("an empty/missing componentsDir yields an empty, ok:true census", () => {
    const result = censusComponentUsage(config, {
      root: join(root, "does-not-exist"),
    })
    expect(result.ok).toBe(true)
    expect(result.usages).toEqual([])
  })

  // Issue #254: a component only ever reached via a dynamic `import(...)`
  // call — the next/dynamic / React.lazy pattern — was invisible to the
  // static-import-only regex, so it false-positived as unused even though
  // both files are inside the scanned componentsDir tree.
  it("records a component reached only via a bare dynamic import(...)", () => {
    writeFile(
      join(root, "ui", "chart.tsx"),
      "export function Chart() { return null }\n",
    )
    writeFile(
      join(root, "ui", "panel.tsx"),
      'const Chart = () => import("./chart")\n\nexport function Panel() { return null }\n',
    )

    const result = censusComponentUsage(config, { root })
    expect(result.usages).toEqual([
      { file: "ui/chart.tsx", usedBy: [{ file: "ui/panel.tsx", line: 1 }] },
    ])
  })

  it("records a component reached via next/dynamic's dynamic(() => import(...)) wrapper", () => {
    writeFile(
      join(root, "ui", "portrait-ascii.tsx"),
      "export function PortraitAscii() { return null }\n",
    )
    writeFile(
      join(root, "ui", "portrait.tsx"),
      [
        'import dynamic from "next/dynamic"',
        "",
        'const PortraitAscii = dynamic(() => import("./portrait-ascii"))',
        "",
        "export function Portrait() { return null }",
        "",
      ].join("\n"),
    )

    const result = censusComponentUsage(config, { root })
    expect(result.usages).toEqual([
      {
        file: "ui/portrait-ascii.tsx",
        usedBy: [{ file: "ui/portrait.tsx", line: 3 }],
      },
    ])
  })

  it("records a component reached via import(...).then(...)", () => {
    writeFile(
      join(root, "ui", "chart.tsx"),
      "export function Chart() { return null }\n",
    )
    writeFile(
      join(root, "ui", "panel.tsx"),
      'import("./chart").then(mod => mod.Chart)\n',
    )

    const result = censusComponentUsage(config, { root })
    expect(result.usages).toEqual([
      { file: "ui/chart.tsx", usedBy: [{ file: "ui/panel.tsx", line: 1 }] },
    ])
  })

  it("does not treat a dynamically-composed import() specifier as resolving to a real file", () => {
    writeFile(
      join(root, "ui", "chart.tsx"),
      "export function Chart() { return null }\n",
    )
    writeFile(
      join(root, "ui", "panel.tsx"),
      'const name = "chart"\nimport(`./${name}`)\n',
    )

    const result = censusComponentUsage(config, { root })
    expect(result.usages).toEqual([])
  })

  it("records both a static and a dynamic import of the same target in one file as distinct occurrences", () => {
    writeFile(
      join(root, "ui", "button.tsx"),
      "export function Button() { return null }\n",
    )
    writeFile(
      join(root, "ui", "toolbar.tsx"),
      'import { Button } from "./button"\n\nconst Lazy = () => import("./button")\n',
    )

    const result = censusComponentUsage(config, { root })
    expect(result.usages).toEqual([
      {
        file: "ui/button.tsx",
        usedBy: [
          { file: "ui/toolbar.tsx", line: 1 },
          { file: "ui/toolbar.tsx", line: 3 },
        ],
      },
    ])
  })
})

// ---------------------------------------------------------------------------
// Delegated token lint (Phase 3, issue #120).
// ---------------------------------------------------------------------------

describe("censusTokenLint", () => {
  let root

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true })
    root = undefined
  })

  function project(tokens) {
    root = mkdtempSync(join(tmpdir(), "design-delta-lint-"))
    writeFileSync(join(root, "tokens.json"), JSON.stringify(tokens))
    return { paths: { tokensFile: "tokens.json" } }
  }

  const GOOD = {
    base: {
      c: {
        $type: "color",
        $value: { colorSpace: "srgb", components: [1, 0, 0] },
      },
    },
  }

  it("is silent when no rules are configured", async () => {
    // The surface's central invariant: opinions ship OFF. A project that has
    // configured nothing must not receive another design system's defaults.
    const config = project(GOOD)
    const result = await censusTokenLint(config, { root })
    expect(result).toMatchObject({ ok: true, violations: [], diagnostics: [] })
  })

  // `delegated` answers a DIFFERENT question from `ok`, and the CLI's
  // stale-exemption scoping depends on it: `ok: true, delegated: false` is a
  // silent success in which the rule never ran and could not have reported.
  // Its documented return type promises a boolean, so every path has to set
  // one — an `undefined` here is falsy and would behave correctly by luck
  // while making the annotation a lie.
  describe("delegated", () => {
    it("is true only when the vendor's rules actually ran", async () => {
      const config = project(GOOD)
      const ran = await censusTokenLint(config, {
        root,
        rules: { "core/valid-color": "error" },
      })
      expect(ran).toMatchObject({ ok: true, delegated: true })

      const notRun = await censusTokenLint(config, { root })
      expect(notRun).toMatchObject({ ok: true, delegated: false })
    })

    it("is a boolean on every return path, including the failures", async () => {
      const config = project(GOOD)
      const rules = { "core/valid-color": "error" }
      const paths = [
        // no rules configured — the silent-success path
        await censusTokenLint(config, { root }),
        // missing tokens file
        await censusTokenLint(
          { paths: { tokensFile: "absent.json" } },
          { root, rules },
        ),
        // present but not JSON
        await (async () => {
          writeFileSync(join(root, "broken.json"), "{not json")
          return censusTokenLint(
            { paths: { tokensFile: "broken.json" } },
            { root, rules },
          )
        })(),
        // the success path
        await censusTokenLint(config, { root, rules }),
      ]
      for (const result of paths)
        expect(typeof result.delegated).toBe("boolean")
    })
  })

  it("reports a violation from a delegated rule", async () => {
    const config = project({
      base: { bad: { $type: "dimension", $value: "12" } },
    })
    const result = await censusTokenLint(config, {
      root,
      rules: { "core/valid-dimension": ["error", {}] },
    })
    expect(result.ok).toBe(true)
    expect(result.violations).toHaveLength(1)
    expect(result.violations[0]).toMatchObject({
      ruleId: "core/valid-dimension",
      level: "error",
    })
  })

  it("names the tokens file a violation's line belongs to", async () => {
    // The line alone is not a location: a consumer rendering a file position
    // (a SARIF region, an editor jump) needs the file it is a line IN, and a
    // violation's `entity` is a token id or the rule id, never a path.
    const config = project({
      base: { bad: { $type: "dimension", $value: "12" } },
    })
    const result = await censusTokenLint(config, {
      root,
      rules: { "core/valid-dimension": ["error", {}] },
    })
    expect(result.violations[0].file).toBe("tokens.json")
  })

  it("excludes an unresolvable alias instead of throwing or abandoning the file", async () => {
    // THE hard requirement for this slice. Terrazzo's `parse()` refuses an
    // entire file over one unresolvable alias; a real design system had two,
    // which the token census already reports as ordinary diagnostics. Lint
    // must never be able to fail a run that `audit` survives.
    const config = project({
      base: { a: { $type: "color", $value: "{nope.missing}" } },
    })
    const result = await censusTokenLint(config, {
      root,
      rules: { "core/valid-color": ["error", {}] },
    })
    // Reported and EXCLUDED, not fatal: the run continues over whatever else
    // the file contains, and never throws past here.
    expect(result.ok).toBe(true)
    expect(result.excluded).toEqual(["base.a"])
    expect(result.diagnostics.length).toBeGreaterThan(0)
  })

  it("reports a missing tokens file rather than throwing", async () => {
    root = mkdtempSync(join(tmpdir(), "design-delta-lint-"))
    const result = await censusTokenLint(
      { paths: { tokensFile: "tokens.json" } },
      { root, rules: { "core/valid-color": ["error", {}] } },
    )
    expect(result.ok).toBe(false)
    expect(result.diagnostics[0].code).toBe("missing-tokens-file")
  })

  it("reports EVERY offending token, not just the first (issue #138)", async () => {
    // Measured directly against @terrazzo/parser: a single `lintRunner` call
    // over the whole token set stops after the FIRST violation — three
    // malformed dimensions produced exactly one finding. That is the
    // fix-one-rerun-repeat loop issue #123's alias pre-scan exists to
    // eliminate, reintroduced one layer up. `censusTokenLint` now calls
    // `lintRunner` once PER TOKEN so each gets its own chance to report.
    const config = project({
      base: {
        d1: { $type: "dimension", $value: "1 furlong" },
        d2: { $type: "dimension", $value: "2 furlongs" },
        d3: { $type: "dimension", $value: "3 furlongs" },
      },
    })
    const result = await censusTokenLint(config, {
      root,
      rules: { "core/valid-dimension": ["error", {}] },
    })
    expect(result.ok).toBe(true)
    expect(result.violations).toHaveLength(3)
    expect(
      result.violations.every(v => v.ruleId === "core/valid-dimension"),
    ).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Interpolated var references (issue #127).
// ---------------------------------------------------------------------------

describe("censusCssVars — dynamically composed names", () => {
  let root

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true })
    root = undefined
  })

  function project(files) {
    root = mkdtempSync(join(tmpdir(), "design-delta-interp-"))
    mkdirSync(join(root, "ui"), { recursive: true })
    for (const [name, body] of Object.entries(files))
      writeFileSync(join(root, "ui", name), body)
    return {
      paths: { componentsDir: "ui" },
      conventions: { cssVarPrefix: "--kit-" },
    }
  }

  it("skips a JS template-interpolated reference instead of recording the prefix", () => {
    // `var(--kit-color-fg-${slot}-default)` matches only as far as the `$`,
    // yielding `--kit-color-fg-` — a name nothing declares because nothing
    // could. Recorded, it becomes a false `tokens/var-unresolved` at error
    // severity, which alone fails `verify` on a healthy project.
    const config = project({
      "a.ts": "const c = `var(--kit-color-fg-${slot}-default)`\n",
    })
    const result = censusCssVars(config, { root })
    expect(result.vars.map(v => v.name)).toEqual([])
  })

  it("skips an SCSS-interpolated reference too", () => {
    const config = project({
      "a.scss": "a { color: var(--kit-fg-#{$tone}); }\n",
    })
    expect(censusCssVars(config, { root }).vars).toEqual([])
  })

  it("still records a complete reference, and a malformed literal one", () => {
    // The guard keys on interpolation SYNTAX, not on "ends in a dash" — a
    // genuinely malformed literal must still be caught.
    const config = project({
      "a.scss":
        "a { color: var(--kit-color-fg-default); border-color: var(--kit-broken-); }\n",
    })
    expect(
      censusCssVars(config, { root })
        .vars.map(v => v.name)
        .sort(),
    ).toEqual(["--kit-broken-", "--kit-color-fg-default"])
  })
})

// ---------------------------------------------------------------------------
// Which document an alias is judged against (issue #176).
//
// The alias pre-scan asks "does this target exist?", and that only means
// something against the document the PARSER resolves. A project may run its own
// prep step first — folding mode-scoped groups, renaming tiers — and then a
// reference that cannot resolve in the AUTHORED file is the only one that
// resolves in the PARSED one.
//
// This was a real false positive on a real consumer: two aliases were reported
// broken, and applying the "fix" the diagnostic suggested failed that project's
// token build outright, because its prep step folds `system/<mode>.color.*`
// into `system.color.*` before Terrazzo ever sees the file.
// ---------------------------------------------------------------------------

describe("censusTokens — alias scan honours paths.resolvedTokensFile (#176)", () => {
  // Authored: mode-scoped groups, and an alias to the FOLDED path — which
  // cannot resolve here, and is the only form that resolves after the prep.
  //
  // The alias points at `accent`, which the project authors in ONE mode only.
  // That matters: the engine folds sibling mode sets on its own now (#564),
  // but only when the path resolves in the referencing token's own set, so a
  // cross-mode reference like this one is exactly what it declines and leaves
  // to this field. An alias resolvable in its own set would be resolved before
  // it ever reached the `resolvedTokensFile` branch, and these tests would be
  // asserting against a diagnostic that no longer exists.
  const authored = {
    "system/light": {
      color: {
        border: { $type: "color", $value: "#111111" },
        focus: { $type: "color", $value: "{system.color.accent}" },
      },
    },
    "system/dark": {
      color: {
        border: { $type: "color", $value: "#eeeeee" },
        accent: { $type: "color", $value: "#00ff00" },
      },
    },
  }
  // What the parser actually sees: one folded group where the alias resolves.
  const parsed = {
    system: {
      color: {
        border: { $type: "color", $value: "#111111" },
        accent: { $type: "color", $value: "#00ff00" },
        focus: { $type: "color", $value: "{system.color.accent}" },
      },
    },
  }

  it("reports the alias as unresolvable when judged against the authored file", async () => {
    // The false positive, pinned: without the field, the scan judges the
    // document the parser never reads.
    const project = createSyntheticProject({
      tokens: authored,
      paths: { resolvedTokensFile: "" },
    })
    try {
      const result = await censusTokens(project.config, { root: project.root })
      expect(
        result.diagnostics.filter(d => d.code === "unresolvable-alias").length,
      ).toBeGreaterThan(0)
    } finally {
      project.cleanup()
    }
  })

  it("reports NO unresolvable alias once the parsed document is declared", async () => {
    const project = createSyntheticProject({ tokens: authored })
    try {
      writeFileSync(
        join(project.root, project.config.paths.resolvedTokensFile),
        JSON.stringify(parsed),
      )
      const result = await censusTokens(project.config, { root: project.root })
      expect(
        result.diagnostics.filter(d => d.code === "unresolvable-alias"),
      ).toEqual([])
    } finally {
      project.cleanup()
    }
  })

  it("says so when the declared document is missing, and still excludes", async () => {
    // It is usually a build artifact, so absence is normal. The scan cannot
    // simply be skipped — dropping the leaves is what lets the REST of the
    // document parse — so it falls back to the authored file and states that
    // it did, rather than leaving a reader to assume the parsed one was used.
    const project = createSyntheticProject({ tokens: authored })
    try {
      rmSync(join(project.root, project.config.paths.resolvedTokensFile))
      const result = await censusTokens(project.config, { root: project.root })
      expect(
        result.diagnostics.some(d => d.code === "resolved-tokens-file-missing"),
      ).toBe(true)
      // The census still works — the point of excluding the bad leaves.
      expect(result.tokens.length).toBeGreaterThan(0)
    } finally {
      project.cleanup()
    }
  })

  it("reclassifies rather than deletes — the exclusion is still reported", async () => {
    // The token IS absent from the census, because this engine parses the
    // authored file. Saying "correct as authored" without saying "and excluded
    // here" would trade a false positive for a silent gap.
    const project = createSyntheticProject({ tokens: authored })
    try {
      writeFileSync(
        join(project.root, project.config.paths.resolvedTokensFile),
        JSON.stringify(parsed),
      )
      const result = await censusTokens(project.config, { root: project.root })
      const reclassified = result.diagnostics.filter(
        d => d.code === "alias-resolved-after-preprocessing",
      )
      expect(reclassified.length).toBeGreaterThan(0)
      expect(reclassified[0].message).toContain("correct as authored")
      expect(reclassified[0].message).toContain("excluded from this census")
      // And it carries NO suggestion — the old one would have broken a build.
      expect(reclassified[0].suggestions).toBeUndefined()
      expect(result.excluded).toContain(reclassified[0].tokenId)
    } finally {
      project.cleanup()
    }
  })

  it("still censuses the AUTHORED tokens, not the parsed ones", async () => {
    // Only the alias scan consults the parsed document. Everything else reads
    // what a human authors, which is what drift is reported against.
    const project = createSyntheticProject({ tokens: authored })
    try {
      writeFileSync(
        join(project.root, project.config.paths.resolvedTokensFile),
        JSON.stringify(parsed),
      )
      const result = await censusTokens(project.config, { root: project.root })
      const ids = result.tokens.map(t => t.id)
      expect(ids.some(id => id.startsWith("system/light."))).toBe(true)
      expect(ids.some(id => id.startsWith("system/dark."))).toBe(true)
    } finally {
      project.cleanup()
    }
  })
})

describe("censusTokens — a misconfigured resolvedTokensFile is always reported (#176)", () => {
  it("reports a missing declared document even when every alias resolves", async () => {
    // Gating this behind "some alias was unresolvable" is how a typo'd path
    // survives for months: the check the user configured is not the one
    // running, and nothing says so until an alias happens to break.
    const project = createSyntheticProject({
      tokens: {
        color: { good: { $type: "color", $value: "#000000" } },
      },
    })
    try {
      rmSync(join(project.root, project.config.paths.resolvedTokensFile))
      const result = await censusTokens(project.config, { root: project.root })
      expect(
        result.diagnostics.filter(d => d.code === "unresolvable-alias"),
      ).toEqual([])
      expect(
        result.diagnostics.some(d => d.code === "resolved-tokens-file-missing"),
      ).toBe(true)
    } finally {
      project.cleanup()
    }
  })

  it("honours an injected fs for the resolved-document read", async () => {
    // Every other read in censusTokens goes through the injected seam; one
    // that escapes to the real disk makes a caller's fs a half-truth.
    const project = createSyntheticProject({
      tokens: { color: { good: { $type: "color", $value: "#000000" } } },
    })
    try {
      const asked = []
      const realFs = await import("node:fs")
      const spyFs = {
        existsSync: p => (asked.push(String(p)), realFs.existsSync(p)),
        readFileSync: (p, e) => realFs.readFileSync(p, e),
        readdirSync: (p, o) => realFs.readdirSync(p, o),
      }
      await censusTokens(project.config, { root: project.root, fs: spyFs })
      expect(
        asked.some(p => p.includes(project.config.paths.resolvedTokensFile)),
      ).toBe(true)
    } finally {
      project.cleanup()
    }
  })
})

describe("censusTokenLint — the SECOND caller of the alias pre-scan (#176)", () => {
  // Fixing only `censusTokens` left `lint` emitting the exact suggestion
  // `docs/spikes/terrazzo-fit.md` retracts as build-breaking. It did not show
  // up on the consumer that motivated the fix only because that project
  // configures no lint rules — the code path was live the whole time.
  const authored = {
    "system/light": {
      color: {
        border: { $type: "color", $value: "#111111" },
        focus: { $type: "color", $value: "{system.color.border}" },
      },
    },
  }
  const parsed = {
    system: {
      color: {
        border: { $type: "color", $value: "#111111" },
        focus: { $type: "color", $value: "{system.color.border}" },
      },
    },
  }

  it("reclassifies here too, not only in censusTokens", async () => {
    const project = createSyntheticProject({ tokens: authored })
    try {
      writeFileSync(
        join(project.root, project.config.paths.resolvedTokensFile),
        JSON.stringify(parsed),
      )
      const result = await censusTokenLint(project.config, {
        root: project.root,
        rules: { "core/valid-color": "error" },
      })
      expect(
        result.diagnostics.filter(d => d.code === "unresolvable-alias"),
      ).toEqual([])
      expect(
        result.diagnostics.some(
          d => d.code === "alias-resolved-after-preprocessing",
        ),
      ).toBe(true)
    } finally {
      project.cleanup()
    }
  })

  it("still reports a genuinely unresolvable alias here", async () => {
    // The reclassification must not become a blanket silence on this surface.
    const project = createSyntheticProject({ tokens: authored })
    try {
      writeFileSync(
        join(project.root, project.config.paths.resolvedTokensFile),
        JSON.stringify({ unrelated: {} }),
      )
      const result = await censusTokenLint(project.config, {
        root: project.root,
        rules: { "core/valid-color": "error" },
      })
      expect(
        result.diagnostics.some(d => d.code === "unresolvable-alias"),
      ).toBe(true)
    } finally {
      project.cleanup()
    }
  })
})

describe("resolved-document read errors are distinguished (#176)", () => {
  it("reports invalid JSON as invalid, not as unreadable", async () => {
    // "could not read" sends someone to check permissions and paths when the
    // real problem is malformed JSON.
    const project = createSyntheticProject()
    try {
      writeFileSync(
        join(project.root, project.config.paths.resolvedTokensFile),
        "{ not json",
      )
      const result = await censusTokens(project.config, { root: project.root })
      expect(
        result.diagnostics.some(d => d.code === "resolved-tokens-file-invalid"),
      ).toBe(true)
      expect(
        result.diagnostics.some(
          d => d.code === "resolved-tokens-file-unreadable",
        ),
      ).toBe(false)
    } finally {
      project.cleanup()
    }
  })
})

describe("no suggestion when the check could not be performed (#176)", () => {
  // A suggestion is confident advice, trustworthy only when the alias was
  // judged against the document the parser resolves. When the declared
  // document is unusable the engine KNOWS it could not check — and the
  // suggestion it would print is the build-breaking advice
  // `docs/spikes/terrazzo-fit.md` retracts.
  //
  // Not a corner case: the missing-file message itself calls absence normal
  // ("usually a build artifact"), so any CI job auditing before the token
  // build lands here.
  const authored = {
    "system/light": {
      color: {
        border: { $type: "color", $value: "#111111" },
        focus: { $type: "color", $value: "{system.color.border}" },
      },
    },
  }

  it("keeps the suggestion when NO resolved document is declared", () => {
    // The control: with the field unset the engine judged the only document
    // there is, so the advice stands.
    const project = createSyntheticProject({
      tokens: authored,
      paths: { resolvedTokensFile: "" },
    })
    try {
      return censusTokens(project.config, { root: project.root }).then(r => {
        const alias = r.diagnostics.find(d => d.code === "unresolvable-alias")
        expect(alias).toBeDefined()
        expect(alias.suggestions).toBeDefined()
        expect(alias.message).toContain("did you mean")
      })
    } finally {
      project.cleanup()
    }
  })

  it("drops it when the declared document is MISSING", async () => {
    const project = createSyntheticProject({ tokens: authored })
    try {
      rmSync(join(project.root, project.config.paths.resolvedTokensFile))
      const r = await censusTokens(project.config, { root: project.root })
      const alias = r.diagnostics.find(d => d.code === "unresolvable-alias")
      expect(alias).toBeDefined() // the alias may genuinely be broken
      expect(alias.suggestions).toBeUndefined()
      expect(alias.message).not.toContain("did you mean")
    } finally {
      project.cleanup()
    }
  })

  it("drops it when the declared document is INVALID", async () => {
    const project = createSyntheticProject({ tokens: authored })
    try {
      writeFileSync(
        join(project.root, project.config.paths.resolvedTokensFile),
        "{ not json",
      )
      const r = await censusTokens(project.config, { root: project.root })
      const alias = r.diagnostics.find(d => d.code === "unresolvable-alias")
      expect(alias.suggestions).toBeUndefined()
      expect(alias.message).not.toContain("did you mean")
    } finally {
      project.cleanup()
    }
  })

  it("drops it on the lint surface too", async () => {
    const project = createSyntheticProject({ tokens: authored })
    try {
      rmSync(join(project.root, project.config.paths.resolvedTokensFile))
      const r = await censusTokenLint(project.config, {
        root: project.root,
        rules: { "core/valid-color": "error" },
      })
      const alias = r.diagnostics.find(d => d.code === "unresolvable-alias")
      expect(alias).toBeDefined()
      expect(alias.message).not.toContain("did you mean")
    } finally {
      project.cleanup()
    }
  })
})

describe("suggestions are re-validated against the parsed document (#176)", () => {
  // The asymmetry the last review found: the three DEGRADED branches drop the
  // suggestion because the engine could not check, while the HEALTHY branch
  // kept suggestions computed against the AUTHORED file. `suggestAliasTargets`
  // can only ever produce mode-qualified siblings, which on a project with a
  // folding prep step is exactly the build-breaking advice being retracted.
  //
  // A suggestion only EXISTS when the mode-qualified candidate resolves in the
  // authored document, so both fixtures below declare it there; they differ in
  // whether the PARSED document has it too.
  const authored = {
    "system/light": {
      color: {
        missing: { $type: "color", $value: "#222222" },
        // Bare form: unresolvable in the authored document, which is what
        // produces the diagnostic and its mode-qualified suggestion.
        focus: { $type: "color", $value: "{system.color.missing}" },
      },
    },
  }

  it("drops a suggestion that does not resolve in the parsed document either", async () => {
    const project = createSyntheticProject({ tokens: authored })
    try {
      // Parsed document has neither the alias target nor the candidate.
      writeFileSync(
        join(project.root, project.config.paths.resolvedTokensFile),
        JSON.stringify({ unrelated: {} }),
      )
      const result = await censusTokens(project.config, { root: project.root })
      const alias = result.diagnostics.find(
        d => d.code === "unresolvable-alias",
      )
      expect(alias).toBeDefined()
      expect(alias.suggestions).toBeUndefined()
      expect(alias.message).not.toContain("did you mean")
    } finally {
      project.cleanup()
    }
  })

  it("keeps a suggestion that DOES resolve in the parsed document", async () => {
    // The control: re-validation must not become blanket suppression on the
    // healthy branch either.
    const project = createSyntheticProject({ tokens: authored })
    try {
      // The candidate resolves here; the alias target itself still does not,
      // so the diagnostic survives rather than being reclassified.
      writeFileSync(
        join(project.root, project.config.paths.resolvedTokensFile),
        JSON.stringify({
          "system/light": {
            color: { missing: { $type: "color", $value: "#222222" } },
          },
        }),
      )
      const result = await censusTokens(project.config, { root: project.root })
      const alias = result.diagnostics.find(
        d => d.code === "unresolvable-alias",
      )
      expect(alias).toBeDefined()
      expect(alias.suggestions).toEqual(["system/light.color.missing"])
      expect(alias.message).toContain("did you mean")
    } finally {
      project.cleanup()
    }
  })
})

describe("sources/code — censusTokens applies a color's opacity extension (#517)", () => {
  const OPACITY_DOC = {
    base: {
      color: { black: { $type: "color", $value: "#000000" } },
      opacity: {
        90: { $type: "number", $value: 90 },
        impossible: { $type: "number", $value: 900 },
      },
    },
    system: {
      opacity: { scrim: { $type: "number", $value: "{base.opacity.90}" } },
      color: {
        scrim: {
          $type: "color",
          $value: "{base.color.black}",
          $extensions: { "acme.opacity": "{system.opacity.scrim}" },
        },
        half: {
          $type: "color",
          $value: "#FF0000",
          $extensions: { "acme.opacity": 50 },
        },
        broken: {
          $type: "color",
          $value: "#00FF00",
          $extensions: { "acme.opacity": "{nope.missing}" },
        },
        impossible: {
          $type: "color",
          $value: "#0000FF",
          $extensions: { "acme.opacity": "{base.opacity.impossible}" },
        },
      },
    },
  }

  async function census(conventions) {
    const root = mkdtempSync(join(tmpdir(), "design-delta-opacity-"))
    try {
      writeFileSync(join(root, "tokens.json"), JSON.stringify(OPACITY_DOC))
      return await censusTokens(
        { paths: { tokensFile: "tokens.json" }, conventions },
        { root },
      )
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }

  const byId = result =>
    Object.fromEntries(result.tokens.map(token => [token.id, token]))

  it("multiplies the referenced opacity into the color's alpha, keeping the color alias", async () => {
    const result = await census({
      opacityExtension: "acme.opacity",
      opacityScale: 100,
    })
    const tokens = byId(result)
    // The same string the design tool reports for the same pair.
    expect(tokens["system.color.scrim"].cssValue).toBe("#000000e6")
    expect(tokens["system.color.scrim"].aliasOf).toBe("base.color.black")
    // The opacity token is recorded as referenced by this one — nothing else
    // in the document points at it.
    expect(tokens["system.color.scrim"].opacityOf).toBe("system.opacity.scrim")
    // A literal opacity needs no alias, and records no reference.
    expect(tokens["system.color.half"].cssValue).toBe("#ff000080")
    expect(tokens["system.color.half"].opacityOf).toBeUndefined()
  })

  it("with no opacityExtension configured, the same document censuses untouched", async () => {
    const tokens = byId(await census({}))
    expect(tokens["system.color.scrim"].cssValue).toBe("#000")
    expect(tokens["system.color.half"].cssValue).toBe("#f00")
    expect(tokens["system.color.scrim"].opacityOf).toBeUndefined()
  })

  it("an unresolvable or out-of-scale opacity applies nothing and says so", async () => {
    const result = await census({
      opacityExtension: "acme.opacity",
      opacityScale: 100,
    })
    const tokens = byId(result)
    // Censused at its own alpha — never at a guessed one.
    expect(tokens["system.color.broken"].cssValue).toBe("#0f0")
    expect(tokens["system.color.impossible"].cssValue).toBe("#00f")
    const opacityDiagnostics = result.diagnostics.filter(
      d => d.code === "opacity-extension-unresolved",
    )
    expect(opacityDiagnostics.map(d => d.tokenId).sort()).toEqual([
      "system.color.broken",
      "system.color.impossible",
    ])
    expect(opacityDiagnostics[0].message).toContain("acme.opacity")
    expect(opacityDiagnostics.every(d => d.file === "tokens.json")).toBe(true)
  })

  it("nothing leaks into the census entry: the diagnostic is reported, not carried", async () => {
    const result = await census({
      opacityExtension: "acme.opacity",
      opacityScale: 100,
    })
    expect(result.tokens.some(token => "opacityDiagnostic" in token)).toBe(
      false,
    )
  })
})

describe("sources/code — censusTokens applies the opacity extension to every mode (#649)", () => {
  const MODE_DOC = {
    acme: {
      neutral: {
        100: { $type: "color", $value: "#e7e1d5" },
        900: { $type: "color", $value: "#0f0f0f" },
      },
      opacity: { 10: { $type: "number", $value: 10 } },
      border: {
        alpha: {
          $type: "color",
          $value: "{acme.neutral.100}",
          $extensions: {
            "acme.opacity": "{acme.opacity.10}",
            mode: { dark: "{acme.neutral.100}", light: "{acme.neutral.900}" },
          },
        },
      },
    },
  }

  async function census(conventions) {
    const root = mkdtempSync(join(tmpdir(), "design-delta-opacity-modes-"))
    try {
      writeFileSync(join(root, "tokens.json"), JSON.stringify(MODE_DOC))
      const result = await censusTokens(
        { paths: { tokensFile: "tokens.json" }, conventions },
        { root },
      )
      return result.tokens.find(token => token.id === "acme.border.alpha")
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }

  it("censuses each mode's CSS value at the default value's alpha", async () => {
    const token = await census({
      opacityExtension: "acme.opacity",
      opacityScale: 100,
    })
    expect(token.cssValue).toBe("#e7e1d51a")
    expect(token.modeCssValues).toEqual({
      dark: "#e7e1d51a",
      light: "#0f0f0f1a",
    })
  })

  it("with no opacityExtension configured, every mode censuses opaque", async () => {
    const token = await census({})
    expect(token.modeCssValues).toEqual({ dark: "#e7e1d5", light: "#0f0f0f" })
  })
})
