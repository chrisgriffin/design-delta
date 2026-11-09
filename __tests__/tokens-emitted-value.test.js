/**
 * tokens-emitted-value.test.js — `tokens/emitted-value-mismatch` (spec 024,
 * issue #627): every token's value against the value the build wrote into the
 * stylesheets under `paths.styleRoots`.
 *
 * Three layers, each at its own seam: `canonicalCssValue` directly, the rule
 * through `runTokensCheck` with hand-built censuses (the module is pure), the
 * `emitted` census through `censusCssVars` on a temp directory, and the whole
 * path through `audit` on the synthetic project.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { run } from "../src/cli/main.mjs"
import { censusCssVars, censusTokens } from "../src/sources/code.mjs"
import { canonicalCssValue, runTokensCheck } from "../src/modules/tokens.mjs"
import {
  createSyntheticProject,
  SYNTHETIC_PATHS,
} from "./helpers/synthetic-project.mjs"

const RULE = "tokens/emitted-value-mismatch"
const PREFIX = "--acme-"

// ---------------------------------------------------------------------------
// canonicalCssValue
// ---------------------------------------------------------------------------

describe("canonicalCssValue", () => {
  it("reduces a percent rgb() and the hex of the same color to one form", () => {
    expect(canonicalCssValue("rgb(90.588% 88.235% 83.529%)")).toBe(
      canonicalCssValue("#e7e1d5"),
    )
  })

  it("treats #rgb and #rrggbb as the same color, case-insensitively", () => {
    expect(canonicalCssValue("#FFF")).toBe(canonicalCssValue("#ffffff"))
  })

  it("keeps alpha, and an 8-bit alpha equals its decimal", () => {
    expect(canonicalCssValue("rgb(0% 0% 0% / 0.1)")).toBe(
      canonicalCssValue("#0000001a"),
    )
    expect(canonicalCssValue("rgb(0 0 0 / 0.5)")).not.toBe(
      canonicalCssValue("#000"),
    )
  })

  it("canonicalizes colors inside a larger value", () => {
    expect(canonicalCssValue("0px 4px 6px -2px rgb(0% 0% 0% / 0.2)")).toBe(
      canonicalCssValue("0 4px 6px -2px #0003"),
    )
  })

  it("reads rem as 16px and collapses whitespace", () => {
    expect(canonicalCssValue("1.5rem")).toBe(canonicalCssValue("24px"))
    expect(canonicalCssValue("a ,  b")).toBe(canonicalCssValue("a, b"))
  })

  it("leaves a different value different", () => {
    expect(canonicalCssValue("8px")).not.toBe(canonicalCssValue("12px"))
  })
})

// ---------------------------------------------------------------------------
// The rule, through runTokensCheck (pure, hand-built censuses).
// ---------------------------------------------------------------------------

function token(id, cssValue, $type = "color") {
  return { id, $type, cssValue }
}

function emitted(
  name,
  value,
  { file = "theme/tokens.css", selector = ":root" } = {},
) {
  return { name, value, file, selector }
}

function check(tokens, decls, { styleRoots = ["theme"], missing = [] } = {}) {
  return runTokensCheck(
    { ok: true, tokens },
    {
      ok: true,
      // Declared, so the var-centric rules stay quiet about them.
      vars: decls.map(d => ({
        name: d.name,
        declarations: [{ file: d.file, line: 1 }],
        usages: [{ file: "ui/x.css", line: 1 }],
      })),
      emitted: decls,
      missingStyleRoots: missing,
    },
    { conventions: { cssVarPrefix: PREFIX }, paths: { styleRoots } },
  ).filter(f => f.ruleId === RULE)
}

describe(`${RULE} — the check`, () => {
  it("is silent when both sides agree in different color syntaxes", () => {
    expect(
      check(
        [token("acme.color.bg", "#e7e1d5")],
        [emitted("--acme-color-bg", "rgb(90.588% 88.235% 83.529%)")],
      ),
    ).toEqual([])
  })

  it("raises exactly one finding naming var, file, selector, emitted and expected", () => {
    const findings = check(
      [token("acme.space.md", "8px", "dimension")],
      [emitted("--acme-space-md", "12px")],
    )
    expect(findings).toHaveLength(1)
    const [finding] = findings
    expect(finding.severity).toBe("warn")
    expect(finding.entity).toBe("--acme-space-md")
    expect(finding.message).toContain("theme/tokens.css")
    expect(finding.message).toContain("12px")
    expect(finding.message).toContain("8px")
    expect(finding.data).toMatchObject({
      var: "--acme-space-md",
      file: "theme/tokens.css",
      selector: ":root",
      emitted: "12px",
      expected: ["8px"],
      tokens: ["acme.space.md"],
    })
  })

  it("agreeing with any mode's value is silence", () => {
    const tokens = [
      token("acme/light.color.fg", "#111111"),
      token("acme/dark.color.fg", "#eeeeee"),
    ]
    expect(
      check(tokens, [
        emitted("--acme-color-fg", "#111"),
        emitted("--acme-color-fg", "#eee", { selector: '[data-theme="dark"]' }),
      ]),
    ).toEqual([])
  })

  it("agreeing with a token's $extensions.mode value is silence (#642)", () => {
    const tokens = [
      {
        ...token("acme.color.bg", "#0f0f0f"),
        modeCssValues: { light: "#f4efe5" },
      },
    ]
    expect(
      check(tokens, [
        emitted("--acme-color-bg", "#0f0f0f"),
        emitted("--acme-color-bg", "rgb(95.686% 93.725% 89.804%)", {
          selector: '[data-theme="light"]',
        }),
      ]),
    ).toEqual([])

    const findings = check(tokens, [emitted("--acme-color-bg", "#ff0000")])
    expect(findings).toHaveLength(1)
    expect(findings[0].data.expected).toEqual(["#0f0f0f", "#f4efe5"])
    expect(findings[0].message).toContain('"#0f0f0f" and "#f4efe5"')
  })

  it("resolves an emitted var() through the other emitted declarations", () => {
    const tokens = [
      token("acme.color.blue", "#0000ff"),
      token("acme.color.link", "#0000ff"),
    ]
    expect(
      check(tokens, [
        emitted("--acme-color-blue", "#00f"),
        emitted("--acme-color-link", "var(--acme-color-blue)"),
      ]),
    ).toEqual([])
    expect(
      check(
        [
          token("acme.color.red", "#ff0000"),
          token("acme.color.link", "#0000ff"),
        ],
        [
          emitted("--acme-color-red", "#f00"),
          emitted("--acme-color-link", "var(--acme-color-red)"),
        ],
      ).map(f => f.entity),
    ).toEqual(["--acme-color-link"])
  })

  it("is silent when a var() stays unresolvable on either side", () => {
    expect(
      check(
        [token("acme.color.link", "#0000ff")],
        [emitted("--acme-color-link", "var(--nowhere)")],
      ),
    ).toEqual([])
    expect(
      check(
        [
          token(
            "acme.gradient.hero",
            "linear-gradient(var(--nowhere), #fff)",
            "gradient",
          ),
        ],
        [emitted("--acme-gradient-hero", "linear-gradient(#000, #fff)")],
      ),
    ).toEqual([])
  })

  it("resolves a var() whose fallback is parenthesised, or is itself a var()", () => {
    const tokens = [
      token("acme.color.base", "#ffffff"),
      token("acme.color.bg", "#ffffff"),
    ]
    const base = emitted("--acme-color-base", "#fff")
    for (const value of [
      "var(--acme-color-base, rgb(0 0 0))",
      "var(--acme-color-base, var(--acme-color-other))",
    ]) {
      expect(check(tokens, [base, emitted("--acme-color-bg", value)])).toEqual(
        [],
      )
    }
    expect(
      check(
        [
          token("acme.color.base", "#000000"),
          token("acme.color.bg", "#ffffff"),
        ],
        [
          emitted("--acme-color-base", "#000"),
          emitted(
            "--acme-color-bg",
            "var(--acme-color-base, rgb(255 255 255))",
          ),
        ],
      ).map(f => f.entity),
    ).toEqual(["--acme-color-bg"])
  })

  it("resolves a var() whose name holds an underscore", () => {
    const tokens = [token("acme.color.bg", "#ffffff")]
    expect(
      check(tokens, [
        emitted("--acme_base", "#fff"),
        emitted("--acme-color-bg", "var(--acme_base)"),
      ]),
    ).toEqual([])
    expect(
      check(tokens, [
        emitted("--acme_base", "#000"),
        emitted("--acme-color-bg", "var(--acme_base)"),
      ]),
    ).toHaveLength(1)
  })

  it("is silent when a var() with a parenthesised fallback stays unresolvable", () => {
    const tokens = [token("acme.color.bg", "#ffffff")]
    for (const value of [
      "var(--undeclared, rgb(0 0 0))",
      "var(--undeclared, var(--also-undeclared))",
      "var(--unbalanced, rgb(0 0 0)",
    ]) {
      expect(check(tokens, [emitted("--acme-color-bg", value)])).toEqual([])
    }
  })

  it("accepts a font stack the build extended with fallbacks", () => {
    const tokens = [token("acme.font.body", '"Inter Sans"', "fontFamily")]
    expect(
      check(tokens, [
        emitted(
          "--acme-font-body",
          '"Inter Sans", "Inter Fallback", sans-serif',
        ),
      ]),
    ).toEqual([])
    expect(
      check(tokens, [emitted("--acme-font-body", '"Georgia", serif')]),
    ).toHaveLength(1)
  })

  it("is silent for a token with no string cssValue, or a var no token maps to", () => {
    expect(
      check(
        [{ id: "acme.type.body", $type: "typography" }],
        [emitted("--acme-type-body", "16px/1.5 serif")],
      ),
    ).toEqual([])
    expect(check([], [emitted("--acme-unknown", "1px")])).toEqual([])
  })

  it("raises nothing when styleRoots is unset or a root is missing", () => {
    const tokens = [token("acme.space.md", "8px", "dimension")]
    const decls = [emitted("--acme-space-md", "12px")]
    expect(check(tokens, decls, { styleRoots: [] })).toEqual([])
    expect(check(tokens, decls, { missing: ["theme"] })).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// The census: `emitted` comes from styleRoots only, unconditional first.
// ---------------------------------------------------------------------------

describe("censusCssVars — emitted declarations", () => {
  let root
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "dd-emitted-"))
    mkdirSync(join(root, "ui"))
    mkdirSync(join(root, "theme"))
    writeFileSync(join(root, "ui", "x.css"), ".x { --acme-local: 1px; }\n")
    writeFileSync(
      join(root, "theme", "tokens.css"),
      [
        ":root {",
        "  --acme-space-md: 8px;",
        "}",
        "@media (min-width: 900px) {",
        "  :root { --acme-space-md: 16px; }",
        "}",
        '[data-theme="dark"] { --acme-color-fg: #eee; }',
        "",
      ].join("\n"),
    )
  })
  afterEach(() => rmSync(root, { recursive: true, force: true }))

  const config = {
    conventions: { cssVarPrefix: PREFIX },
    paths: { componentsDir: "ui", styleRoots: ["theme"] },
  }

  it("lists unconditional styleRoots declarations, never componentsDir ones", () => {
    const { emitted: list } = censusCssVars(config, { root })
    expect(list).toEqual([
      {
        name: "--acme-space-md",
        value: "8px",
        file: "theme/tokens.css",
        selector: ":root",
      },
      {
        name: "--acme-color-fg",
        value: "#eee",
        file: "theme/tokens.css",
        selector: '[data-theme="dark"]',
      },
    ])
  })

  it("honours the include scope", () => {
    const { emitted: list } = censusCssVars(config, {
      root,
      include: () => false,
    })
    expect(list).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// The census and the rule together: a mode value resolved through its alias.
// ---------------------------------------------------------------------------

describe(`${RULE} — $extensions.mode values (#642)`, () => {
  let root
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "dd-emitted-mode-"))
    mkdirSync(join(root, "ui"))
    mkdirSync(join(root, "theme"))
    writeFileSync(
      join(root, "tokens.json"),
      JSON.stringify({
        acme: {
          color: {
            neutral: {
              50: {
                $type: "color",
                $value: {
                  colorSpace: "srgb",
                  components: [0.95686, 0.93725, 0.89804],
                },
              },
            },
            bg: {
              $type: "color",
              $value: "#0f0f0f",
              $extensions: {
                mode: { light: "{acme.color.neutral.50}" },
              },
            },
          },
        },
      }),
    )
  })
  afterEach(() => rmSync(root, { recursive: true, force: true }))

  const config = {
    conventions: { cssVarPrefix: PREFIX },
    paths: {
      tokensFile: "tokens.json",
      componentsDir: "ui",
      styleRoots: ["theme"],
    },
  }

  async function findings(lightValue) {
    writeFileSync(
      join(root, "theme", "tokens.css"),
      [
        ":root { --acme-color-bg: #0f0f0f; }",
        `[data-theme="light"] { --acme-color-bg: ${lightValue}; }`,
        "",
      ].join("\n"),
    )
    const tokenCensus = await censusTokens(config, { root })
    return runTokensCheck(
      tokenCensus,
      censusCssVars(config, { root }),
      config,
    ).filter(f => f.ruleId === RULE)
  }

  it("raises nothing for a light value emitted under a second selector", async () => {
    expect(await findings("rgb(95.686% 93.725% 89.804%)")).toEqual([])
  })

  it("still raises for a value that matches none of the modes", async () => {
    const list = await findings("rgb(100% 0% 0%)")
    expect(list).toHaveLength(1)
    expect(list[0].data.expected).toHaveLength(2)
  })
})

describe(`${RULE} — an opacity extension on a token with modes (#649)`, () => {
  let root
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "dd-emitted-opacity-mode-"))
    mkdirSync(join(root, "ui"))
    mkdirSync(join(root, "theme"))
    writeFileSync(
      join(root, "tokens.json"),
      JSON.stringify({
        acme: {
          neutral: {
            100: { $type: "color", $value: "#e7e1d5" },
            900: { $type: "color", $value: "#0f0f0f" },
          },
          opacity: { 10: { $type: "number", $value: 0.1 } },
          border: {
            alpha: {
              $type: "color",
              $value: "{acme.neutral.100}",
              $extensions: {
                "acme.opacity": "{acme.opacity.10}",
                mode: {
                  dark: "{acme.neutral.100}",
                  light: "{acme.neutral.900}",
                },
              },
            },
          },
        },
      }),
    )
  })
  afterEach(() => rmSync(root, { recursive: true, force: true }))

  const config = {
    conventions: { cssVarPrefix: PREFIX, opacityExtension: "acme.opacity" },
    paths: {
      tokensFile: "tokens.json",
      componentsDir: "ui",
      styleRoots: ["theme"],
    },
  }

  async function findings(lightValue) {
    writeFileSync(
      join(root, "theme", "tokens.css"),
      [
        ":root { --acme-border-alpha: #e7e1d51a; }",
        `[data-theme="light"] { --acme-border-alpha: ${lightValue}; }`,
        "",
      ].join("\n"),
    )
    const tokenCensus = await censusTokens(config, { root })
    return runTokensCheck(
      tokenCensus,
      censusCssVars(config, { root }),
      config,
    ).filter(f => f.ruleId === RULE)
  }

  it("raises nothing for a light value emitted with the opacity applied", async () => {
    expect(await findings("rgb(5.8824% 5.8824% 5.8824% / 0.1)")).toEqual([])
  })

  it("raises for a light value emitted opaque, which no mode expects", async () => {
    const list = await findings("#0f0f0f")
    expect(list).toHaveLength(1)
    expect(list[0].data.expected).not.toContain("#0f0f0f")
  })
})

// ---------------------------------------------------------------------------
// End to end through `audit`.
// ---------------------------------------------------------------------------

function fakeStream() {
  const writes = []
  return { stream: { write: chunk => writes.push(chunk) }, writes }
}

async function auditTokens(project) {
  const { stream: stdout, writes } = fakeStream()
  const { stream: stderr } = fakeStream()
  const originalCwd = process.cwd()
  process.chdir(project.root)
  try {
    await run(["audit", "--tokens", "--json", "--config", project.configPath], {
      stdout,
      stderr,
    })
  } finally {
    process.chdir(originalCwd)
  }
  return JSON.parse(writes.join("")).findings.filter(f => f.ruleId === RULE)
}

function withEmittedProject(css, fn) {
  const project = createSyntheticProject({
    tokens: {
      acme: { font: { body: { $type: "fontFamily", $value: ["Inter Sans"] } } },
    },
  })
  const dir = join(project.root, SYNTHETIC_PATHS.styleRoots[0])
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, "tokens.css"), css)
  return fn(project).finally(() => project.cleanup())
}

// The synthetic project's tokens, emitted the way a real build writes them:
// colors as percent rgb(), a font stack with fallbacks, a breakpoint override.
const AGREEING_CSS = `:root {
  --acme-color-fg: rgb(6.667% 6.667% 6.667%);
  --acme-color-bg: #FAFAFA;
  --acme-color-danger: rgb(69.02% 0% 12.549%);
  --acme-font-body: "Inter Sans", "Inter Sans Fallback", sans-serif;
}
@media (min-width: 900px) {
  :root { --acme-color-bg: #000; }
}
`

describe(`${RULE} — through audit`, () => {
  it("raises nothing when the emitted CSS agrees with the tokens", async () => {
    await withEmittedProject(AGREEING_CSS, async project => {
      expect(await auditTokens(project)).toEqual([])
    })
  })

  it("raises exactly one finding when one emitted value is changed", async () => {
    const drifted = AGREEING_CSS.replace(
      "rgb(69.02% 0% 12.549%)",
      "rgb(100% 0% 0%)",
    )
    await withEmittedProject(drifted, async project => {
      const findings = await auditTokens(project)
      expect(findings).toHaveLength(1)
      expect(findings[0].entity).toBe("--acme-color-danger")
      expect(findings[0].message).toContain(
        `${SYNTHETIC_PATHS.styleRoots[0]}/tokens.css`,
      )
      expect(findings[0].data.emitted).toBe("rgb(100% 0% 0%)")
      expect(findings[0].data.expected).toEqual(["#b00020"])
    })
  })
})
