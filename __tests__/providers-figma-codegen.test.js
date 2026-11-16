/**
 * providers-figma-codegen.test.js — `src/providers/figma/codegen.mjs`
 * (ADR-001 Phase 2d, issue #105; moved into the Figma provider in ADR-003
 * Phase 5.1): Code Connect generation from a contract.
 *
 * Every contract here is a small, self-contained, generically-named object
 * built inline (matching `spec-contracts.test.js`'s `BASE` convention) —
 * never a real design system's component. `buildCodeConnectModel` is pure
 * and doesn't itself schema-validate (that is `spec/contracts.mjs`'s job,
 * already covered in `spec-contracts.test.js`), so these fixtures only carry
 * the fields this module actually reads.
 */

import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import prettier from "prettier"
import ts from "typescript"

import {
  buildCodeConnectModel,
  comparableBindingSource,
  deriveImportPath,
  deriveOutputPath,
  DESIGN_TARGET_PLACEHOLDER,
  renderCodeConnect,
  bindingPath,
  bindingStatus,
} from "../src/providers/figma/codegen.mjs"
import { contractApiView } from "../src/spec/contracts.mjs"

// A render must be valid TSX — TypeScript's own parser is the judge, with
// syntax errors reported and the JSX left as-is (issue #453).
function tsxSyntaxErrors(source) {
  const { diagnostics } = ts.transpileModule(source, {
    reportDiagnostics: true,
    compilerOptions: { jsx: ts.JsxEmit.Preserve, module: ts.ModuleKind.ESNext },
    fileName: "binding.tsx",
  })
  return (diagnostics || []).map(d =>
    ts.flattenDiagnosticMessageText(d.messageText, "\n"),
  )
}

// Stand a hand-written example body into a render, the way an author would
// after the scaffold — the deleted `codegen --write` splice (#472), kept only
// as a fixture builder here. The shape is the renderer's own: the example
// arrow is the LAST field, closed by the same two-line suffix.
function spliceExampleBody(source, body) {
  return source.replace(
    /(example: \([^)]*\) => \()\n[\s\S]*?\n( {2}\),\n\}\))/,
    (_m, head, tail) => `${head}\n${body}\n${tail}`,
  )
}

// A minimal, valid-shaped contract every case mutates one way. `sources.design`
// is a real {fileKey, nodeId} address here — this provider's `sourceSchema`
// (ADR-003) — so that unrelated cases (prop mapping, the example directive)
// aren't ALSO carrying the unrelated "no sources.design declared" gap; see
// the "design connect target" cases below for the absent/malformed forms.
function baseContract(overrides = {}) {
  return {
    id: "widget",
    title: "Widget",
    sources: {
      code: { path: "components/widget/widget.tsx" },
      design: { fileKey: "TestFileKey000000000001", nodeId: "10:20" },
    },
    codegen: {
      exampleContent: "Widget content",
    },
    props: {
      label: { type: "string" },
    },
    ...overrides,
  }
}

// codeConnectSuffix has no engine default (ADR-003 Amendment 1) — every case
// below except the "no conventions.codeConnectSuffix configured" block itself
// needs a working one to exercise anything past that gate, the same way a
// real project would configure it once. `buildModel` supplies it, and the
// `apiView` this module can no longer compute itself (providers may import
// only core/, never spec/ — this call is `cli/commands/codegen.mjs`'s job in
// real use), so the ~40 call sites don't each have to. The gate block below
// calls the raw `buildCodeConnectModel` import directly, since testing the
// OMISSION is the point there.
const CODEGEN_CONFIG = { conventions: { codeConnectSuffix: ".figma.tsx" } }
function buildModel(contract, config = CODEGEN_CONFIG) {
  return buildCodeConnectModel(contract, config, contractApiView(contract))
}

// ---------------------------------------------------------------------------
// Path derivation
// ---------------------------------------------------------------------------

describe("deriveOutputPath / deriveImportPath", () => {
  it("swaps the source's extension for the configured suffix, alongside it", () => {
    expect(deriveOutputPath("components/widget/widget.tsx", ".figma.tsx")).toBe(
      "components/widget/widget.figma.tsx",
    )
  })

  it("honors a project's own codeConnectSuffix convention", () => {
    expect(deriveOutputPath("src/ui/badge/badge.tsx", ".cc.tsx")).toBe(
      "src/ui/badge/badge.cc.tsx",
    )
  })

  it("derives a same-directory relative import from the basename", () => {
    expect(deriveImportPath("components/widget/widget.tsx")).toBe("./widget")
  })

  it("strips .jsx/.ts extensions too", () => {
    expect(deriveImportPath("a/b/Thing.jsx")).toBe("./Thing")
    expect(deriveImportPath("a/b/Thing.ts")).toBe("./Thing")
  })
})

// ---------------------------------------------------------------------------
// buildCodeConnectModel — the "nothing to generate against" gate
// ---------------------------------------------------------------------------

describe("buildCodeConnectModel — no sources.code.path", () => {
  it("returns ok:false with a stated reason, never throws", () => {
    const model = buildModel(baseContract({ sources: {} }))
    expect(model.ok).toBe(false)
    expect(model.reason).toMatch(/sources\.code\.path/)
    expect(model.contractId).toBe("widget")
  })

  it("renderCodeConnect refuses to render an unbuildable model", () => {
    const model = buildModel(baseContract({ sources: {} }))
    expect(() => renderCodeConnect(model)).toThrow(/cannot render/)
  })
})

describe("buildCodeConnectModel — no conventions.codeConnectSuffix configured", () => {
  // codeConnectSuffix has no default (ADR-003 Amendment 1, matching
  // stylesSuffix's own pattern) — a project that never sets it must get a
  // stated skip, never an output path built from `undefined`.
  it("returns ok:false with a stated reason when config is entirely absent", () => {
    const model = buildCodeConnectModel(baseContract())
    expect(model.ok).toBe(false)
    expect(model.reason).toMatch(/codeConnectSuffix/)
    expect(model.contractId).toBe("widget")
  })

  it("returns ok:false when conventions is present but codeConnectSuffix isn't set", () => {
    const model = buildCodeConnectModel(baseContract(), { conventions: {} })
    expect(model.ok).toBe(false)
    expect(model.reason).toMatch(/codeConnectSuffix/)
  })

  it("renderCodeConnect refuses to render an unbuildable model", () => {
    const model = buildCodeConnectModel(baseContract())
    expect(() => renderCodeConnect(model)).toThrow(/cannot render/)
  })

  it("builds normally once codeConnectSuffix is configured", () => {
    const model = buildCodeConnectModel(baseContract(), {
      conventions: { codeConnectSuffix: ".figma.tsx" },
    })
    expect(model.ok).toBe(true)
    expect(model.outputPath).toBe("components/widget/widget.figma.tsx")
  })
})

// ---------------------------------------------------------------------------
// Prop mapping — types, exclusions, gaps
// ---------------------------------------------------------------------------

describe("buildCodeConnectModel — prop mapping", () => {
  it("maps a string prop using the code name as the design name", () => {
    const model = buildModel(baseContract())
    expect(model.props).toEqual([
      { name: "label", designName: "label", kind: "string" },
    ])
  })

  it("maps a boolean prop", () => {
    const model = buildModel(
      baseContract({ props: { elevated: { type: "boolean" } } }),
    )
    expect(model.props).toEqual([
      { name: "elevated", designName: "elevated", kind: "boolean" },
    ])
  })

  it("maps an enum prop, preserving declared value order", () => {
    const model = buildModel(
      baseContract({
        props: { size: { type: "enum", values: ["lg", "sm"] } },
      }),
    )
    expect(model.props).toEqual([
      { name: "size", designName: "size", kind: "enum", values: ["lg", "sm"] },
    ])
  })

  it("maps a slot prop to a Code Connect instance", () => {
    const model = buildModel(
      baseContract({
        props: { adornment: { type: "slot", accepts: ["Icon"] } },
      }),
    )
    expect(model.props).toEqual([
      { name: "adornment", designName: "adornment", kind: "instance" },
    ])
  })

  it("excludes a design:none prop with NO gap — it is code-only by design", () => {
    const model = buildModel(
      baseContract({
        props: {
          label: { type: "string" },
          internalFlag: { type: "boolean", design: "none" },
        },
      }),
    )
    expect(model.props.map(p => p.name)).toEqual(["label"])
    expect(model.gaps.join(" ")).not.toMatch(/internalFlag/)
  })

  it("excludes a code:none prop with NO gap — a design-only axis has no code prop", () => {
    const model = buildModel(
      baseContract({
        props: {
          label: { type: "string" },
          state: { type: "enum", values: ["resting", "hover"], code: "none" },
        },
      }),
    )
    expect(model.props.map(p => p.name)).toEqual(["label"])
    expect(model.gaps.join(" ")).not.toMatch(/"state"/)
  })

  it("excludes a number-typed prop WITH a gap — no sensible Code Connect mapping", () => {
    const model = buildModel(
      baseContract({ props: { count: { type: "number" } } }),
    )
    expect(model.props).toEqual([])
    expect(model.gaps).toEqual([
      'prop "count": type "number" has no Code Connect mapping — excluded',
    ])
  })

  it("excludes a function-typed prop WITH a gap", () => {
    const model = buildModel(
      baseContract({ props: { onClick: { type: "function" } } }),
    )
    expect(model.props).toEqual([])
    expect(model.gaps).toEqual([
      'prop "onClick": type "function" has no Code Connect mapping — excluded',
    ])
  })

  it("applies a confirmed design:{name} rename with NO gap", () => {
    const model = buildModel(
      baseContract({
        props: {
          tone: {
            type: "enum",
            values: ["neutral", "danger"],
            design: { name: "Tone", reason: "casing differs in Figma" },
          },
        },
      }),
    )
    expect(model.props).toEqual([
      {
        name: "tone",
        designName: "Tone",
        kind: "enum",
        values: ["neutral", "danger"],
      },
    ])
    expect(model.gaps).toEqual([])
  })

  it("includes a design:unverified prop using the code name, WITH a gap", () => {
    const model = buildModel(
      baseContract({
        props: { adornment: { type: "slot", design: "unverified" } },
      }),
    )
    expect(model.props).toEqual([
      { name: "adornment", designName: "adornment", kind: "instance" },
    ])
    expect(model.gaps).toEqual([
      'prop "adornment": design mapping is unverified — generated using code name "adornment"; confirm the design property name before treating this as final',
    ])
  })

  it("includes a code:unverified prop, WITH a gap", () => {
    const model = buildModel(
      baseContract({
        props: { label: { type: "string", code: "unverified" } },
      }),
    )
    expect(model.props).toEqual([
      { name: "label", designName: "label", kind: "string" },
    ])
    expect(model.gaps).toEqual([
      'prop "label": code projection is unverified — confirm this prop exists on the component before treating this mapping as final',
    ])
  })

  it("orders props naturally by name regardless of authoring order", () => {
    const model = buildModel(
      baseContract({
        props: {
          zebra: { type: "string" },
          apple: { type: "string" },
          mango: { type: "string" },
        },
      }),
    )
    expect(model.props.map(p => p.name)).toEqual(["apple", "mango", "zebra"])
  })
})

// ---------------------------------------------------------------------------
// design: {name, mechanism} (issue #457) — the marker the type comparison
// already honors (#439), now honored by codegen too. The mechanism names the
// type the DESIGN side carries, so it, not the contract's own type, decides
// the Code Connect helper; a generated `figma.instance()` against a design
// property that is really a boolean is not a valid binding at all.
// ---------------------------------------------------------------------------

describe("buildCodeConnectModel — design mechanism (issue #457)", () => {
  const TOGGLE_GAP =
    'prop "adornment": design mechanism "toggle" maps to figma.boolean\'s true/false branches — the true branch\'s content is not derivable from the contract; replace the placeholder with what the toggle stands for'

  function mechanismModel(type, mechanism) {
    return buildModel(
      baseContract({
        props: {
          adornment: { type, design: { name: "hasAdornment", mechanism } },
        },
      }),
    )
  }

  // The three code types a mechanism marker realistically sits on. The
  // mechanism wins over every one of them — that is the whole point of the
  // marker, and `boolean`/`string` are here so "it only fixed slots" fails.
  for (const type of ["slot", "string", "boolean"]) {
    it(`toggle on a ${type}-typed prop maps to a boolean, WITH the true-branch gap`, () => {
      const model = mechanismModel(type, "toggle")
      expect(model.props).toEqual([
        {
          name: "adornment",
          designName: "hasAdornment",
          kind: "boolean",
          mechanism: "toggle",
        },
      ])
      expect(model.gaps).toEqual([TOGGLE_GAP])
    })

    it(`text on a ${type}-typed prop maps to a string, with NO gap`, () => {
      const model = mechanismModel(type, "text")
      expect(model.props).toEqual([
        {
          name: "adornment",
          designName: "hasAdornment",
          kind: "string",
          mechanism: "text",
        },
      ])
      expect(model.gaps).toEqual([])
    })

    it(`instance on a ${type}-typed prop maps to an instance, with NO gap`, () => {
      const model = mechanismModel(type, "instance")
      expect(model.props).toEqual([
        {
          name: "adornment",
          designName: "hasAdornment",
          kind: "instance",
          mechanism: "instance",
        },
      ])
      expect(model.gaps).toEqual([])
    })
  }

  it("renders a toggle as figma.boolean's two branches, the true one a gap", () => {
    const source = renderCodeConnect(mechanismModel("slot", "toggle"))
    expect(source).toContain(
      [
        '    adornment: figma.boolean("hasAdornment", {',
        "      true: undefined /* GAP: replace with what this toggle stands for */,",
        "      false: undefined,",
        "    }),",
      ].join("\n"),
    )
  })

  it("a toggle render is still valid TSX", () => {
    expect(
      tsxSyntaxErrors(renderCodeConnect(mechanismModel("slot", "toggle"))),
    ).toEqual([])
  })

  // Issue #485: a toggle that names the slot it gates derives its true
  // branch, so there is nothing left for an author to fill in.
  it("a toggle with gates renders the gated slot as the true branch, with NO gap", () => {
    const model = buildModel(
      baseContract({
        props: {
          adornment: {
            type: "slot",
            design: {
              name: "hasAdornment",
              mechanism: "toggle",
              gates: "Adornment",
            },
          },
        },
      }),
    )
    expect(model.props).toEqual([
      {
        name: "adornment",
        designName: "hasAdornment",
        kind: "boolean",
        mechanism: "toggle",
        gates: "Adornment",
      },
    ])
    expect(model.gaps).toEqual([])
    const source = renderCodeConnect(model)
    expect(source).toContain(
      [
        '    adornment: figma.boolean("hasAdornment", {',
        '      true: figma.instance("Adornment"),',
        "      false: undefined,",
        "    }),",
      ].join("\n"),
    )
    expect(tsxSyntaxErrors(source)).toEqual([])
  })

  it("gates on a mechanism other than toggle changes nothing", () => {
    const model = buildModel(
      baseContract({
        props: {
          adornment: {
            type: "slot",
            design: { name: "Label", mechanism: "text", gates: "Adornment" },
          },
        },
      }),
    )
    expect(model.props).toEqual([
      {
        name: "adornment",
        designName: "Label",
        kind: "string",
        mechanism: "text",
      },
    ])
  })

  it("renders text as figma.string and instance as figma.instance", () => {
    expect(renderCodeConnect(mechanismModel("slot", "text"))).toContain(
      '    adornment: figma.string("hasAdornment"),',
    )
    expect(renderCodeConnect(mechanismModel("string", "instance"))).toContain(
      '    adornment: figma.instance("hasAdornment"),',
    )
  })

  it("a rename WITHOUT a mechanism is untouched — no marker, no branches", () => {
    const model = buildModel(
      baseContract({
        props: {
          adornment: {
            type: "boolean",
            design: { name: "hasAdornment", reason: "casing differs" },
          },
        },
      }),
    )
    expect(model.props).toEqual([
      { name: "adornment", designName: "hasAdornment", kind: "boolean" },
    ])
    expect(model.gaps).toEqual([])
    expect(renderCodeConnect(model)).toContain(
      '    adornment: figma.boolean("hasAdornment"),',
    )
  })

  // The vocabulary is closed: only a real member redirects the mapping. An
  // inherited key is not a member, and a schema-invalid one is not either —
  // both fall back to the contract's own type rather than mapping through
  // whatever the lookup happened to return.
  it("a mechanism outside the closed vocabulary falls back to the code type", () => {
    for (const mechanism of ["toString", "swatch"]) {
      const model = buildModel(
        baseContract({
          props: {
            adornment: {
              type: "slot",
              design: { name: "hasAdornment", mechanism },
            },
          },
        }),
      )
      expect(model.props).toEqual([
        { name: "adornment", designName: "hasAdornment", kind: "instance" },
      ])
      expect(model.gaps).toEqual([])
    }
  })
})

// ---------------------------------------------------------------------------
// className / domPassthrough
// ---------------------------------------------------------------------------

describe("buildCodeConnectModel — className / domPassthrough", () => {
  it("defaults both to false/null when codegen omits them", () => {
    const model = buildModel(baseContract({ codegen: {} }))
    expect(model.className).toBe(false)
    expect(model.domPassthrough).toBe(null)
  })

  it("carries className: true and domPassthrough through to the model", () => {
    const model = buildModel(
      baseContract({
        codegen: { className: true, domPassthrough: "button" },
      }),
    )
    expect(model.className).toBe(true)
    expect(model.domPassthrough).toBe("button")
  })

  it("renders a header comment for each when set, omits it otherwise", () => {
    const withBoth = renderCodeConnect(
      buildModel(
        baseContract({
          codegen: {
            className: true,
            domPassthrough: "button",
            exampleContent: "x",
          },
        }),
      ),
    )
    expect(withBoth).toMatch(/Accepts a `className` passthrough/)
    expect(withBoth).toMatch(/Passes through native `<button>` props/)

    const withNeither = renderCodeConnect(
      buildModel(baseContract({ codegen: { exampleContent: "x" } })),
    )
    expect(withNeither).not.toMatch(/className/)
    expect(withNeither).not.toMatch(/Passes through native/)
  })
})

// ---------------------------------------------------------------------------
// The design connect target — a real Figma URL, resolved from
// {fileKey, nodeId} now that this module lives in the Figma provider
// (ADR-003 Phase 5.1).
// ---------------------------------------------------------------------------

describe("buildCodeConnectModel — design connect target", () => {
  it("is a placeholder + gap when sources.design is absent", () => {
    const model = buildModel(
      baseContract({
        sources: { code: { path: "components/widget/widget.tsx" } },
      }),
    )
    expect(model.designTarget).toBe(DESIGN_TARGET_PLACEHOLDER)
    expect(model.gaps.some(g => g.includes("no sources.design declared"))).toBe(
      true,
    )
  })

  it("is a placeholder + gap when sources.design doesn't match {fileKey, nodeId}", () => {
    const model = buildModel(
      baseContract({
        sources: {
          code: { path: "components/widget/widget.tsx" },
          design: { someProviderAddress: "opaque" },
        },
      }),
    )
    expect(model.designTarget).toBe(DESIGN_TARGET_PLACEHOLDER)
    expect(
      model.gaps.some(g =>
        g.includes("does not match this provider's sourceSchema"),
      ),
    ).toBe(true)
  })

  it("is a placeholder + gap when sources.design is a bare string (the retired escape hatch)", () => {
    // ADR-003: the validating project's own contracts never used this, and
    // the reason it existed — no provider could produce a real target —
    // stops being true once a provider exists.
    const model = buildModel(
      baseContract({
        sources: {
          code: { path: "components/widget/widget.tsx" },
          design: "https://example.test/design/widget",
        },
      }),
    )
    expect(model.designTarget).toBe(DESIGN_TARGET_PLACEHOLDER)
    expect(
      model.gaps.some(g =>
        g.includes("does not match this provider's sourceSchema"),
      ),
    ).toBe(true)
  })

  it("resolves {fileKey, nodeId} into a real Figma URL, with NO gap", () => {
    const model = buildModel(
      baseContract({
        sources: {
          code: { path: "components/widget/widget.tsx" },
          design: { fileKey: "abc123", nodeId: "10:20" },
        },
      }),
    )
    expect(model.designTarget).toBe(
      "https://www.figma.com/design/abc123?node-id=10-20",
    )
    expect(model.gaps.some(g => g.includes("sources.design"))).toBe(false)
  })

  it("accepts a hyphenated nodeId (what a Figma URL actually gives an author)", () => {
    const model = buildModel(
      baseContract({
        sources: {
          code: { path: "components/widget/widget.tsx" },
          design: { fileKey: "abc123", nodeId: "10-20" },
        },
      }),
    )
    expect(model.designTarget).toBe(
      "https://www.figma.com/design/abc123?node-id=10-20",
    )
  })
})

// ---------------------------------------------------------------------------
// The example child — codegen.exampleContent / codegen.example's three forms
// ---------------------------------------------------------------------------

describe("buildCodeConnectModel — the example directive", () => {
  it("exampleContent alone renders a text child, no gap", () => {
    const model = buildModel(
      baseContract({ codegen: { exampleContent: "Hello" } }),
    )
    expect(model.example).toEqual({ kind: "text", text: "Hello" })
    expect(model.gaps).toEqual([])
  })

  it("example: 'authored' — no gap, generator still emits everything else", () => {
    const model = buildModel(baseContract({ codegen: { example: "authored" } }))
    expect(model.example).toEqual({ kind: "authored", text: null })
    expect(model.gaps).toEqual([])
  })

  it("example: {selfClose: true} — no gap", () => {
    const model = buildModel(
      baseContract({ codegen: { example: { selfClose: true } } }),
    )
    expect(model.example).toEqual({ kind: "selfClose", text: null })
    expect(model.gaps).toEqual([])
  })

  it("example: {comment} — no gap, comment text preserved", () => {
    const model = buildModel(
      baseContract({ codegen: { example: { comment: "demo only" } } }),
    )
    expect(model.example).toEqual({ kind: "comment", text: "demo only" })
    expect(model.gaps).toEqual([])
  })

  it("neither exampleContent nor example — a gap, not a guess", () => {
    const model = buildModel(baseContract({ codegen: {} }))
    expect(model.example.kind).toBe("gap")
    expect(
      model.gaps.some(g =>
        g.includes("no codegen.exampleContent or codegen.example"),
      ),
    ).toBe(true)
  })

  it("both set at once — example wins, and the conflict itself is a gap", () => {
    const model = buildModel(
      baseContract({
        codegen: {
          exampleContent: "text form",
          example: { selfClose: true },
        },
      }),
    )
    expect(model.example.kind).toBe("selfClose")
    expect(model.gaps.some(g => g.includes("mutually exclusive"))).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Determinism
// ---------------------------------------------------------------------------

describe("determinism", () => {
  it("the same contract renders byte-identical output on every call", () => {
    const contract = baseContract({
      codegen: {
        className: true,
        domPassthrough: "button",
        example: { comment: "x" },
      },
      props: {
        zebra: { type: "string" },
        apple: { type: "enum", values: ["a", "b"] },
        mango: { type: "boolean" },
      },
    })
    const first = renderCodeConnect(buildModel(contract))
    const second = renderCodeConnect(buildModel(contract))
    expect(first).toBe(second)
  })
})

// ---------------------------------------------------------------------------
// renderCodeConnect — content shape
// ---------------------------------------------------------------------------

describe("renderCodeConnect", () => {
  it("emits the import, connect call, and props block for an enum/boolean mix", () => {
    const model = buildModel(
      baseContract({
        props: {
          size: { type: "enum", values: ["sm", "lg"] },
          disabled: { type: "boolean" },
        },
        codegen: { exampleContent: "x" },
      }),
    )
    const source = renderCodeConnect(model)
    expect(source).toContain('import Widget from "./widget"')
    expect(source).toContain(
      `figma.connect(Widget, ${JSON.stringify("https://www.figma.com/design/TestFileKey000000000001?node-id=10-20")}, {`,
    )
    expect(source).toContain('size: figma.enum("size", {')
    expect(source).toContain('"sm": "sm",')
    expect(source).toContain('"lg": "lg",')
    expect(source).toContain('disabled: figma.boolean("disabled"),')
  })

  it("omits the props block entirely when nothing is mapped", () => {
    const model = buildModel(
      baseContract({ props: {}, codegen: { exampleContent: "x" } }),
    )
    const source = renderCodeConnect(model)
    expect(source).not.toMatch(/props:\s*\{/)
  })

  it("renders each example kind distinctly", () => {
    const selfClose = renderCodeConnect(
      buildModel(baseContract({ codegen: { example: { selfClose: true } } })),
    )
    expect(selfClose).toMatch(/<Widget label=\{label\} \/>/)

    const withComment = renderCodeConnect(
      buildModel(baseContract({ codegen: { example: { comment: "note" } } })),
    )
    expect(withComment).toMatch(/\{\/\* note \*\/\}/)

    const withText = renderCodeConnect(
      buildModel(baseContract({ codegen: { exampleContent: "Hi" } })),
    )
    expect(withText).toMatch(/>Hi</)

    const gap = renderCodeConnect(buildModel(baseContract({ codegen: {} })))
    expect(gap).toMatch(/GAP: no example directive/)
  })

  it("never emits semicolons, matching the repo's own Prettier style", () => {
    const model = buildModel(
      baseContract({
        props: { size: { type: "enum", values: ["sm"] } },
        codegen: { exampleContent: "x", className: true },
      }),
    )
    const source = renderCodeConnect(model)
    const codeLines = source
      .split("\n")
      .filter(
        line => !line.trim().startsWith("*") && !line.trim().startsWith("/"),
      )
    for (const line of codeLines) expect(line).not.toMatch(/;\s*$/)
  })
})

// ---------------------------------------------------------------------------
// `children` is a CHILD, not an attribute.
// ---------------------------------------------------------------------------

describe("renderCodeConnect — children rendering", () => {
  const config = { conventions: { codeConnectSuffix: ".figma.tsx" } }
  const contractWith = (codegen, props) => ({
    id: "button",
    title: "Button",
    sources: { code: { path: "components/button/button.tsx" } },
    codegen,
    props,
  })
  const CHILDREN = {
    type: "string",
    design: { name: "Label", reason: "design models it as a Label property" },
  }

  it("renders a mapped `children` as the child, never as an attribute", () => {
    // `<Button children={children}>…</Button>` is invalid React — the
    // attribute and the child conflict and the child wins. `children` is the
    // one prop that is structurally a child in JSX.
    const model = buildModel(
      contractWith(
        {},
        { size: { type: "enum", values: ["sm"] }, children: CHILDREN },
      ),
      config,
    )
    const source = renderCodeConnect(model)
    expect(source).toContain("<Button size={size}>{children}</Button>")
    expect(source).not.toContain("children={children}")
  })

  it("reports a gap when exampleContent is set alongside a mapped children", () => {
    // The schema says exampleContent is for "when children are arbitrary
    // nodes rather than a modeled prop" — both set is a real contract
    // conflict, and silently emitting both produced invalid JSX.
    const model = buildModel(
      contractWith({ exampleContent: "Continue" }, { children: CHILDREN }),
      config,
    )
    expect(renderCodeConnect(model)).toContain("<Button>{children}</Button>")
    expect(model.gaps.some(g => /exampleContent/.test(g))).toBe(true)
  })

  // Issue #486: the `children` early return used to fire before the
  // directive was read, so a directive was dropped with no gap at all.
  for (const example of [{ selfClose: true }, { comment: "demo only" }]) {
    it(`reports a gap when example ${JSON.stringify(example)} is set alongside a mapped children`, () => {
      const model = buildModel(
        contractWith({ example }, { children: CHILDREN }),
        config,
      )
      expect(model.example.kind).toBe("prop")
      expect(renderCodeConnect(model)).toContain("<Button>{children}</Button>")
      expect(model.gaps.some(g => /codegen\.example is set/.test(g))).toBe(true)
    })
  }

  it("reports both conflicts when exampleContent and a directive are set alongside a mapped children", () => {
    const model = buildModel(
      contractWith(
        { exampleContent: "Continue", example: { selfClose: true } },
        { children: CHILDREN },
      ),
      config,
    )
    const gap = model.gaps.find(g => /exampleContent/.test(g))
    expect(gap).toMatch(/codegen\.example is set/)
  })

  it("honours example: 'authored' alongside a mapped children (#486)", () => {
    const contract = {
      ...contractWith({ example: "authored" }, { children: CHILDREN }),
      sources: {
        code: { path: "components/button/button.tsx" },
        design: { fileKey: "TestFileKey000000000001", nodeId: "10:20" },
      },
    }
    const model = buildModel(contract, config)
    expect(model.example).toEqual({ kind: "authored", text: null })
    expect(model.gaps).toEqual([])
    const generated = renderCodeConnect(model)
    expect(tsxSyntaxErrors(generated)).toEqual([])
    // The hand-written body is the author's, and is not drift.
    const committed = spliceExampleBody(
      generated,
      '    <Button href="/next">{children}</Button>',
    )
    expect(committed).not.toBe(generated)
    expect(
      bindingStatus(contract, config, contractApiView(contract), committed)
        .status,
    ).toBe("match")
  })

  it("still renders a literal text child when children is NOT a mapped prop", () => {
    const model = buildModel(
      contractWith(
        { exampleContent: "Continue" },
        { size: { type: "enum", values: ["sm"] } },
      ),
      config,
    )
    expect(renderCodeConnect(model)).toContain(
      "<Button size={size}>Continue</Button>",
    )
  })
})

// ---------------------------------------------------------------------------
// Issue #453 — what the renderer emits has to be valid TSX, name no dead
// command, and import a named export as a named export.
// ---------------------------------------------------------------------------

describe("renderCodeConnect — every example form parses as TSX (#453)", () => {
  const forms = {
    selfClose: { example: { selfClose: true } },
    comment: { example: { comment: "note" } },
    text: { exampleContent: "Hi" },
    authored: { example: "authored" },
    gap: {},
  }
  for (const [kind, codegen] of Object.entries(forms)) {
    it(`the ${kind} form is syntactically valid`, () => {
      const source = renderCodeConnect(buildModel(baseContract({ codegen })))
      expect(tsxSyntaxErrors(source)).toEqual([])
    })
  }

  it("a mapped `children` prop form is syntactically valid too", () => {
    const source = renderCodeConnect(
      buildModel(
        baseContract({
          props: { children: { type: "string" } },
          codegen: {},
        }),
      ),
    )
    expect(tsxSyntaxErrors(source)).toEqual([])
  })

  it("the authored and gap notes are children of the element, not siblings of it", () => {
    const authored = renderCodeConnect(
      buildModel(baseContract({ codegen: { example: "authored" } })),
    )
    expect(authored).toMatch(
      /<Widget label=\{label\}>\{\/\* AUTHORED — replace this scaffold by hand \*\/\}<\/Widget>/,
    )
    const gap = renderCodeConnect(buildModel(baseContract({ codegen: {} })))
    expect(gap).toMatch(
      /<Widget label=\{label\}>Widget content\{\/\* GAP: no example directive \*\/\}<\/Widget>/,
    )
  })

  it("the header names no regenerate command — `codegen` was deleted (#400)", () => {
    const source = renderCodeConnect(buildModel(baseContract()))
    expect(source).not.toMatch(/codegen --write/)
    expect(source).toContain("Source contract: widget")
  })

  it("imports a named export as `{ Name }`, a default export bare", () => {
    const contract = baseContract()
    const named = renderCodeConnect(
      buildCodeConnectModel(
        contract,
        CODEGEN_CONFIG,
        contractApiView(contract),
        {
          namedExport: true,
        },
      ),
    )
    expect(named).toContain('import { Widget } from "./widget"')
    const dflt = renderCodeConnect(buildModel(contract))
    expect(dflt).toContain('import Widget from "./widget"')
    // Unknown means a default import — the shape every render had before.
    expect(buildModel(contract).namedExport).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Issue #452 — the comparison is structural: a consumer's Prettier rewraps
// the render, and byte equality made every formatted binding read as stale.
// ---------------------------------------------------------------------------

describe("bindingStatus — structural comparison (#452)", () => {
  const config = { conventions: { codeConnectSuffix: ".figma.tsx" } }
  const contract = baseContract({
    props: {
      size: { type: "enum", values: ["sm", "lg"] },
      disabled: { type: "boolean" },
      label: { type: "string" },
    },
    codegen: { exampleContent: "Widget content" },
  })
  const apiView = contractApiView(contract)
  const render = () =>
    renderCodeConnect(buildCodeConnectModel(contract, config, apiView))

  it("a render is never Prettier-stable at 80 columns, and still matches once formatted", async () => {
    const generated = render()
    const formatted = await prettier.format(generated, {
      parser: "typescript",
      printWidth: 80,
      semi: true,
      trailingComma: "all",
    })
    // The premise: Prettier really does rewrite it (the long `figma.connect(`
    // line, semicolons, trailing commas, quoted keys).
    expect(formatted).not.toBe(generated)
    expect(formatted).toMatch(/figma\.connect\(\n/)
    expect(bindingStatus(contract, config, apiView, formatted).status).toBe(
      "match",
    )
  })

  it("a formatted file with one prop removed is still stale", async () => {
    const formatted = await prettier.format(render(), {
      parser: "typescript",
      printWidth: 80,
    })
    const dropped = formatted.replace(
      /\n\s*disabled: figma\.boolean\("disabled"\),?/,
      "",
    )
    expect(dropped).not.toBe(formatted)
    expect(bindingStatus(contract, config, apiView, dropped).status).toBe(
      "stale",
    )
  })

  // issue #456 — the renderer emits the props block in `apiView` order, and
  // each enum map in the contract's declared `values` order, then repeats
  // that same order in the example's destructure and attributes. A file
  // hand-authored in another order is the same file to Code Connect.
  const reordered = `import figma from "@figma/code-connect"

import Widget from "./widget"

figma.connect(
  Widget,
  "https://www.figma.com/design/TestFileKey000000000001?node-id=10-20",
  {
    props: {
      size: figma.enum("size", {
        lg: "lg",
        sm: "sm",
      }),
      label: figma.string("label"),
      disabled: figma.boolean("disabled"),
    },
    example: ({ size, label, disabled }) => (
      <Widget size={size} label={label} disabled={disabled}>
        Widget content
      </Widget>
    ),
  },
)
`

  it("a committed file with props and enum values reordered is a match", () => {
    // The premise: it really is a different file, not the render back again.
    expect(reordered).not.toBe(render())
    expect(bindingStatus(contract, config, apiView, reordered).status).toBe(
      "match",
    )
  })

  it("reordering does not hide a changed enum value", () => {
    const changed = reordered.replace('lg: "lg",', 'xl: "xl",')
    expect(changed).not.toBe(reordered)
    expect(bindingStatus(contract, config, apiView, changed).status).toBe(
      "stale",
    )
  })

  it("reordering does not hide a dropped prop", () => {
    const dropped = reordered.replace(
      /\n\s*disabled: figma\.boolean\("disabled"\),/,
      "",
    )
    expect(dropped).not.toBe(reordered)
    expect(bindingStatus(contract, config, apiView, dropped).status).toBe(
      "stale",
    )
  })

  it("an attribute run that is not all `name={name}` keeps its order", () => {
    // Fail closed: a spread's POSITION decides what it overrides, so sorting
    // around one could turn a real difference into a match.
    const binding = attrs =>
      comparableBindingSource(
        `figma.connect(W, "u", { example: () => <W ${attrs} /> })`,
        ts,
      )
    expect(binding("{...rest} a={a}")).not.toBe(binding("a={a} {...rest}"))
    // The control: the same run with no spread does sort.
    expect(binding("b={b} a={a}")).toBe(binding("a={a} b={b}"))
  })

  it("an authored body stays neutralized under the structural compare", async () => {
    const authored = baseContract({ codegen: { example: "authored" } })
    const view = contractApiView(authored)
    const generated = renderCodeConnect(
      buildCodeConnectModel(authored, config, view),
    )
    const edited = spliceExampleBody(generated, '    <Widget label="mine" />')
    const formatted = await prettier.format(edited, { parser: "typescript" })
    expect(bindingStatus(authored, config, view, formatted).status).toBe(
      "match",
    )
  })

  it("an extra import the example needs is not drift; the component's own import path still is (#459)", async () => {
    const withIcon = baseContract({ codegen: { example: "authored" } })
    const view = contractApiView(withIcon)
    const generated = renderCodeConnect(
      buildCodeConnectModel(withIcon, config, view),
    )
    // The committed file: an icon import the contract cannot know about,
    // wrapped the way Prettier wraps a long named list, and a body using it.
    const committed = spliceExampleBody(
      generated.replace(
        'import Widget from "./widget"',
        'import Widget from "./widget"\nimport {\n  IconGlyph,\n  IconArrow,\n} from "./icons"',
      ),
      '    <Widget label={label} icon={<IconGlyph tone="plain" />} />',
    )
    expect(bindingStatus(withIcon, config, view, committed).status).toBe(
      "match",
    )
    const formatted = await prettier.format(committed, { parser: "typescript" })
    expect(bindingStatus(withIcon, config, view, formatted).status).toBe(
      "match",
    )
    // The component's OWN import is still compared: a moved component is drift.
    const moved = committed.replace(
      'import Widget from "./widget"',
      'import Widget from "../widget/widget"',
    )
    expect(moved).not.toBe(committed)
    expect(bindingStatus(withIcon, config, view, moved).status).toBe("stale")
    // And so is a component whose export style the file gets wrong.
    const named = committed.replace(
      'import Widget from "./widget"',
      'import { Widget } from "./widget"',
    )
    expect(bindingStatus(withIcon, config, view, named).status).toBe("stale")
  })

  it("what an author put in a toggle's true branch is example content, not drift (#477)", async () => {
    const toggled = baseContract({
      props: {
        label: { type: "string" },
        iconAfter: {
          type: "slot",
          design: { name: "iconAfter", mechanism: "toggle" },
        },
      },
      codegen: { exampleContent: "Widget content" },
    })
    const view = contractApiView(toggled)
    const generated = renderCodeConnect(
      buildCodeConnectModel(toggled, config, view),
    )
    expect(generated).toMatch(/true: undefined/)
    // The author filled the true branch with the thing the toggle stands for.
    const filled = generated.replace(
      /true: undefined[^\n]*/,
      'true: <IconGlyph tone="plain" />,',
    )
    expect(filled).not.toBe(generated)
    expect(bindingStatus(toggled, config, view, filled).status).toBe("match")
    const formatted = await prettier.format(filled, { parser: "typescript" })
    expect(bindingStatus(toggled, config, view, formatted).status).toBe("match")
    // The branch KEYS still count: a file that drops the prop is stale …
    const dropped = filled.replace(
      /\n\s*iconAfter: figma\.boolean\([\s\S]*?\n\s*\}\),/,
      "",
    )
    expect(dropped).not.toBe(filled)
    expect(bindingStatus(toggled, config, view, dropped).status).toBe("stale")
    // … and so does a mapped instance in the branch, the one value a
    // contract can derive and a file can therefore get wrong.
    const instance = generated.replace(
      /true: undefined[^\n]*/,
      'true: figma.instance("Icon"),',
    )
    expect(bindingStatus(toggled, config, view, instance).status).toBe("stale")
  })

  it("a slot-plus-boolean pair declared with gates reads match, and a wrong slot still reads stale (#485)", async () => {
    const paired = baseContract({
      props: {
        label: { type: "string" },
        eyebrow: {
          type: "slot",
          required: false,
          design: { name: "hasEyebrow", mechanism: "toggle", gates: "eyebrow" },
        },
      },
      codegen: { exampleContent: "Widget content" },
    })
    const view = contractApiView(paired)
    const generated = renderCodeConnect(
      buildCodeConnectModel(paired, config, view),
    )
    // The committed shape a design tool's own optional-slot idiom produces,
    // formatted the way a consumer's Prettier writes it.
    const formatted = await prettier.format(generated, { parser: "typescript" })
    expect(formatted).toMatch(
      /eyebrow: figma\.boolean\("hasEyebrow", \{\s*true: figma\.instance\("eyebrow"\),\s*false: undefined,\s*\}\)/,
    )
    expect(bindingStatus(paired, config, view, formatted).status).toBe("match")
    // The derived branch is compared: another slot, or a placeholder, is drift.
    const otherSlot = formatted.replace(
      'figma.instance("eyebrow")',
      'figma.instance("TrailingContent")',
    )
    expect(otherSlot).not.toBe(formatted)
    expect(bindingStatus(paired, config, view, otherSlot).status).toBe("stale")
    const placeholder = formatted.replace(
      'figma.instance("eyebrow")',
      "undefined",
    )
    expect(bindingStatus(paired, config, view, placeholder).status).toBe(
      "stale",
    )
  })

  it("a literal the example needs to compile is not drift; what the contract derives still is (#487)", async () => {
    // `href` is required in code and the design symbol has no counterpart, so
    // the contract marks it `design: "none"` and the render omits it — the
    // committed file must supply a literal or the example does not type-check.
    const codeOnly = baseContract({
      props: {
        size: { type: "enum", values: ["sm", "lg"] },
        href: { type: "string", design: "none" },
      },
      codegen: { exampleContent: "Widget content" },
    })
    const view = contractApiView(codeOnly)
    const generated = renderCodeConnect(
      buildCodeConnectModel(codeOnly, config, view),
    )
    // The premise: the render maps `size` and omits `href` altogether.
    expect(generated).not.toMatch(/href/)
    const committed = generated.replace(
      "<Widget size={size}>",
      '<Widget href="/" size={size}>',
    )
    expect(committed).not.toBe(generated)
    expect(bindingStatus(codeOnly, config, view, committed).status).toBe(
      "match",
    )
    const formatted = await prettier.format(committed, {
      parser: "typescript",
      printWidth: 80,
    })
    expect(bindingStatus(codeOnly, config, view, formatted).status).toBe(
      "match",
    )
    // A MAPPED prop is still compared: a changed design name is drift …
    const renamed = committed.replace('figma.enum("size"', 'figma.enum("Size"')
    expect(renamed).not.toBe(committed)
    expect(bindingStatus(codeOnly, config, view, renamed).status).toBe("stale")
    // … as is a mapped attribute bound to the wrong identifier …
    const rebound = committed.replace("size={size}", "size={variant}")
    expect(rebound).not.toBe(committed)
    expect(bindingStatus(codeOnly, config, view, rebound).status).toBe("stale")
    // … and so is the element's content, which the contract does derive.
    const retitled = committed.replace("Widget content", "Other content")
    expect(retitled).not.toBe(committed)
    expect(bindingStatus(codeOnly, config, view, retitled).status).toBe("stale")
  })

  it("the literal survives Prettier putting every attribute on its own line (#487)", async () => {
    // The shape issue #487 was measured on: enough mapped props that Prettier
    // breaks the open tag across lines, and `children` mapped — which leaves
    // the contract no `codegen.example` escape hatch at all.
    const wrapped = baseContract({
      props: {
        href: { type: "string", design: "none" },
        children: { type: "slot" },
        iconAfter: { type: "slot" },
        iconBefore: { type: "slot" },
        mb: { type: "enum", values: ["none", "sm"] },
        size: { type: "enum", values: ["sm", "lg"] },
        theme: { type: "enum", values: ["light", "dark"] },
      },
      codegen: {},
    })
    const view = contractApiView(wrapped)
    const generated = renderCodeConnect(
      buildCodeConnectModel(wrapped, config, view),
    )
    const committed = await prettier.format(
      generated.replace("<Widget", '<Widget href="/"'),
      { parser: "typescript", printWidth: 80 },
    )
    // The premise: Prettier really did break the attributes onto their own
    // lines, so the literal is newline-separated rather than space-separated.
    expect(committed).toMatch(/<Widget\n\s+href="\/"\n/)
    expect(bindingStatus(wrapped, config, view, committed).status).toBe("match")
    // The mapped props around it are still compared.
    const renamed = committed.replace('figma.enum("size"', 'figma.enum("Size"')
    expect(renamed).not.toBe(committed)
    expect(bindingStatus(wrapped, config, view, renamed).status).toBe("stale")
  })

  it("an apostrophe in JSX text is prose, not a string delimiter (odd and even counts)", async () => {
    for (const exampleContent of ["Don't stop", "It's a widget's job"]) {
      const withText = baseContract({ codegen: { exampleContent } })
      const view = contractApiView(withText)
      const generated = renderCodeConnect(
        buildCodeConnectModel(withText, config, view),
      )
      const formatted = await prettier.format(generated, {
        parser: "typescript",
        printWidth: 80,
      })
      expect(bindingStatus(withText, config, view, formatted).status).toBe(
        "match",
      )
    }
  })
})

// ---------------------------------------------------------------------------
// The identifier guarantee codegen silently depends on.
// ---------------------------------------------------------------------------

describe("codegen's dependency on `title` being a valid identifier", () => {
  it("the contract schema constrains title to a PascalCase identifier", () => {
    // renderCodeConnect derives BOTH the import binding and the JSX element
    // name from `title`. A title like "Text Field" would emit
    // `import Text Field from …` — invalid TSX. Nothing in codegen validates
    // this; the guarantee lives one layer away in the schema, so pin it HERE.
    // If someone loosens that pattern, this fails rather than codegen quietly
    // generating broken files.
    const schema = JSON.parse(
      readFileSync(
        join(
          dirname(fileURLToPath(import.meta.url)),
          "..",
          "schema",
          "contract.schema.json",
        ),
        "utf8",
      ),
    )
    expect(schema.properties.title.pattern).toBe("^[A-Z][A-Za-z0-9]*$")
    expect(new RegExp(schema.properties.title.pattern).test("TextField")).toBe(
      true,
    )
    expect(new RegExp(schema.properties.title.pattern).test("Text Field")).toBe(
      false,
    )
  })
})

// ---------------------------------------------------------------------------
// bindingPath / bindingStatus (issue #400) — the deleted codegen command's
// compare semantics, now pure and read-only.
// ---------------------------------------------------------------------------

describe("bindingPath / bindingStatus (issue #400)", () => {
  const config = { conventions: { codeConnectSuffix: ".cc.tsx" } }
  const contract = {
    id: "chip",
    title: "Chip",
    sources: {
      code: { path: "components/chip/chip.tsx" },
      design: { fileKey: "abc", nodeId: "1:2" },
    },
    props: {},
  }

  it("derives the binding path from the code path and configured suffix, null when either is absent", () => {
    expect(bindingPath(contract, config)).toBe("components/chip/chip.cc.tsx")
    expect(bindingPath(contract, {})).toBeNull()
    expect(bindingPath({ id: "x" }, config)).toBeNull()
  })

  it("missing, match, and stale — against the contract's own render", () => {
    const missing = bindingStatus(contract, config, {}, null)
    expect(missing).toMatchObject({ applicable: true, status: "missing" })

    const generated = renderCodeConnect(
      buildCodeConnectModel(contract, config, {}),
    )
    expect(bindingStatus(contract, config, {}, generated).status).toBe("match")
    // A comment is formatting, never drift (#452) — the edit has to be code.
    expect(
      bindingStatus(contract, config, {}, generated + "\n// edited").status,
    ).toBe("match")
    expect(
      bindingStatus(
        contract,
        config,
        {},
        generated + "\nexport const edited = true\n",
      ).status,
    ).toBe("stale")
  })

  it("not applicable states a reason instead of guessing", () => {
    const result = bindingStatus({ id: "x" }, config, {}, null)
    expect(result.applicable).toBe(false)
    expect(result.reason).toContain("sources.code.path")
  })

  it("a contract with no design source has nothing to bind, so neither status applies (issue #448)", () => {
    const noDesign = {
      ...contract,
      sources: { code: { path: "components/chip/chip.tsx" } },
    }
    const missing = bindingStatus(noDesign, config, {}, null)
    expect(missing.applicable).toBe(false)
    expect(missing.reason).toContain("sources.design")

    // Stale is gated on the same call, so a committed file cannot report either.
    const generated = renderCodeConnect(
      buildCodeConnectModel(noDesign, config, {}),
    )
    expect(
      bindingStatus(noDesign, config, {}, generated + "\n// edited").applicable,
    ).toBe(false)

    // Regression: a contract that DOES declare a design node still reports missing.
    expect(bindingStatus(contract, config, {}, null)).toMatchObject({
      applicable: true,
      status: "missing",
    })
  })

  // Issue #579 — the render the comparison already performs is the only thing
  // that can tell a consumer what to write, and the audit path never writes.
  it("carries the rendered expected content on both applicable outcomes (issue #579)", () => {
    const generated = renderCodeConnect(
      buildCodeConnectModel(contract, config, {}),
    )

    // Missing: the consumer with no file is the one who needs it most, and the
    // branch returns before the comparison ever renders.
    expect(bindingStatus(contract, config, {}, null).expected).toBe(generated)

    // Stale: the same text the comparison was made against, not a re-render
    // with different inputs.
    const stale = bindingStatus(
      contract,
      config,
      {},
      generated + "\nexport const edited = true\n",
    )
    expect(stale.status).toBe("stale")
    expect(stale.expected).toBe(generated)

    // Match carries it too — one render, one shape, whatever the verdict.
    expect(bindingStatus(contract, config, {}, generated).expected).toBe(
      generated,
    )
  })

  it("a non-applicable outcome expects nothing, so it carries no content (issue #579)", () => {
    expect(bindingStatus({ id: "x" }, config, {}, null)).not.toHaveProperty(
      "expected",
    )
    const noDesign = {
      ...contract,
      sources: { code: { path: "components/chip/chip.tsx" } },
    }
    expect(bindingStatus(noDesign, config, {}, null)).not.toHaveProperty(
      "expected",
    )
  })

  it("an authored example body is neutralized, not drift", () => {
    const authored = {
      ...contract,
      codegen: { example: "authored" },
    }
    const generated = renderCodeConnect(
      buildCodeConnectModel(authored, config, {}),
    )
    const edited = generated.replace(
      /AUTHORED — replace this scaffold by hand/,
      "a hand-written body",
    )
    // The edit must be real, or this test compares identical inputs.
    expect(edited).not.toBe(generated)
    // Whatever the body says, the framing is what is compared.
    expect(bindingStatus(authored, config, {}, edited).status).toBe("match")
    // A framing change (outside the body) is still drift.
    expect(
      bindingStatus(
        authored,
        config,
        {},
        edited + "\nexport const trailing = true\n",
      ).status,
    ).toBe("stale")
  })
})

// ---------------------------------------------------------------------------
// The compare parses both sides (issue #609). The character scan it replaced
// had a declared ceiling — a quoted numeric key and a pair of apostrophes in
// element text — that #588 could only announce as `compare-unreliable`. Read
// as trees, both shapes compare like anything else; the one thing left that
// cannot be compared is a project with no `typescript` to parse with.
// ---------------------------------------------------------------------------

describe("bindingStatus — both sides parsed as TSX (#609)", () => {
  const config = CODEGEN_CONFIG
  const numeric = baseContract({
    props: { weight: { type: "enum", values: ["400", "700"] } },
  })
  const numericView = contractApiView(numeric)
  const renderNumeric = () =>
    renderCodeConnect(buildCodeConnectModel(numeric, config, numericView))

  it("quoted numeric key compares: a formatter-unquoted key is a match, a changed one is stale", async () => {
    const generated = renderNumeric()
    // The premise: the render really does emit the quoted numeric key.
    expect(generated).toContain('"400": "400"')
    const unquoted = generated.replace(/"(400|700)":/g, "$1:")
    expect(unquoted).not.toBe(generated)
    const status = bindingStatus(numeric, config, numericView, unquoted)
    expect(status.status).toBe("match")
    expect(status.ceiling).toBeUndefined()
    const formatted = await prettier.format(unquoted, { parser: "typescript" })
    expect(bindingStatus(numeric, config, numericView, formatted).status).toBe(
      "match",
    )
    // A real change to a numeric key, or to its value, is still drift.
    expect(
      bindingStatus(
        numeric,
        config,
        numericView,
        unquoted.replace("400:", "500:"),
      ).status,
    ).toBe("stale")
    expect(
      bindingStatus(
        numeric,
        config,
        numericView,
        generated.replace('"400": "400"', '"400": "regular"'),
      ).status,
    ).toBe("stale")
  })

  it("an apostrophe pair a formatter split across lines compares as the same text", () => {
    const contract = baseContract({
      codegen: { exampleContent: "Don't stop, won't go" },
    })
    const apiView = contractApiView(contract)
    const generated = renderCodeConnect(
      buildCodeConnectModel(contract, config, apiView),
    )
    const split = generated.replace(
      "Don't stop, won't go",
      "Don't stop,\n      won't go",
    )
    expect(split).not.toBe(generated)
    const status = bindingStatus(contract, config, apiView, split)
    expect(status.status).toBe("match")
    expect(status.ceiling).toBeUndefined()
    // The words themselves are still compared.
    expect(
      bindingStatus(
        contract,
        config,
        apiView,
        generated.replace("won't go", "will go"),
      ).status,
    ).toBe("stale")
  })

  it("an authored body's own prose never reaches the compare; its framing still does", () => {
    const contract = baseContract({ codegen: { example: "authored" } })
    const generated = renderCodeConnect(
      buildCodeConnectModel(contract, config, {}),
    )
    const prose = generated.replace(
      /\{\/\* AUTHORED — replace this scaffold by hand \*\/\}/,
      "Don't stop, won't go",
    )
    expect(prose).not.toBe(generated)
    expect(bindingStatus(contract, config, {}, prose).status).toBe("match")
    expect(
      bindingStatus(
        contract,
        config,
        {},
        prose + "\nexport const trailing = true\n",
      ).status,
    ).toBe("stale")
  })

  it("quote style and key quoting are formatting; a string's value is not", () => {
    const tsModule = ts
    const a = comparableBindingSource(
      'figma.connect(A, "https://x?node-id=1-2", {\n  props: { "size": figma.enum("size", { "sm": "sm", }), },\n});\n',
      tsModule,
    )
    const b = comparableBindingSource(
      "figma.connect(\n  A,\n  'https://x?node-id=1-2',\n  { props: { size: figma.enum(\"size\", { sm: 'sm' }) } },\n)",
      tsModule,
    )
    expect(a).toBe(b)
    expect(comparableBindingSource('x("a  b")', tsModule)).not.toBe(
      comparableBindingSource('x("a b")', tsModule),
    )
  })

  it("a comment between a trailing comma and the closing brace is formatting (#622)", () => {
    const binding = props =>
      comparableBindingSource(
        `figma.connect(A, "u", {\n  props: {\n${props}  },\n})\n`,
        ts,
      )
    const plain = binding('    multiline: figma.boolean("multiline"),\n')
    expect(
      binding('    multiline: figma.boolean("multiline"),\n    // a note\n'),
    ).toBe(plain)
    // The control: dropping the prop is still a difference.
    expect(binding("")).not.toBe(plain)
  })
})

describe("bindingStatus — without `typescript` installed (#609)", () => {
  const config = CODEGEN_CONFIG
  const contract = baseContract({
    props: { size: { type: "enum", values: ["sm", "lg"] } },
  })
  const apiView = contractApiView(contract)
  const generated = renderCodeConnect(
    buildCodeConnectModel(contract, config, apiView),
  )
  const absent = { tsModuleName: "definitely-not-a-real-module-xyz" }

  it("a binding that differs as text is compare-unreliable, saying how to fix it", () => {
    const status = bindingStatus(
      contract,
      config,
      apiView,
      generated + "\n// formatted\n",
      absent,
    )
    expect(status.status).toBe("compare-unreliable")
    expect(status.ceiling.map(t => t.id)).toEqual(["typescript-not-installed"])
    expect(status.ceiling[0].detail).toMatch(
      /npm install --save-dev typescript/,
    )
    // The finding still carries what the contract says the file holds.
    expect(status.expected).toBe(generated)
  })

  it("byte-identical text needs no parser, and a missing file needs no compare", () => {
    expect(
      bindingStatus(contract, config, apiView, generated, absent).status,
    ).toBe("match")
    expect(bindingStatus(contract, config, apiView, null, absent).status).toBe(
      "missing",
    )
  })

  it("the provider never imports `typescript` statically", () => {
    // Loaded at call time only (`typescript.mjs`), so a consumer without the
    // optional peer still loads the provider at all.
    const dir = join(
      dirname(fileURLToPath(import.meta.url)),
      "../src/providers/figma",
    )
    for (const file of ["codegen.mjs", "index.mjs", "typescript.mjs"])
      expect(readFileSync(join(dir, file), "utf8")).not.toMatch(
        /^import[^\n]*["']typescript["']/m,
      )
  })
})
