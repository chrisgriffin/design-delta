/**
 * sources-extract.test.js — `src/sources/react/extract.mjs`, the TypeScript
 * compiler API-backed prop census (ADR-001 D10/D13, issue #98).
 *
 * The three cases in the first `describe` block are REGRESSION PINS: they
 * are exactly the three behaviors `docs/spikes/prop-extraction.md` measured
 * against `react-docgen-typescript` and rejected it over. If any of them ever
 * regresses, this suite is what catches it before a real contract does.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  extractComponent,
  extractComponents,
  findComponentFiles,
  loadTypeScript,
} from "../src/sources/react/extract.mjs"

const FIXTURES = join(process.cwd(), "__tests__", "fixtures", "extract")
const WIDGET = join(FIXTURES, "widget.tsx")
const DEFAULT_EXPORTED = join(FIXTURES, "default-exported-const.tsx")
const KINDS = join(FIXTURES, "kinds.tsx")
const PANEL = join(FIXTURES, "panel.tsx")
const NO_PROPS = join(FIXTURES, "no-props.tsx")

function propByName(component, name) {
  return component.props.find(prop => prop.name === name)
}

// ---------------------------------------------------------------------------
// The three spike findings, pinned.
// ---------------------------------------------------------------------------

describe("extractComponent — the spike's three disqualifying findings, pinned", () => {
  it("extracts `children` when declared first-party (the disqualifying bug)", () => {
    const { ok, component } = extractComponent(WIDGET)
    expect(ok).toBe(true)
    const children = propByName(component, "children")
    expect(children).toEqual({
      name: "children",
      type: "string",
      required: true,
    })
  })

  it("an optional enum prop's values never include `undefined`", () => {
    const { component } = extractComponent(WIDGET)
    const size = propByName(component, "size")
    expect(size.type).toBe("enum")
    expect(size.values).toEqual(["sm", "md", "lg"])
    expect(size.values).not.toContain(undefined)
    expect(size.required).toBe(false)
    expect(size.default).toBe("sm")
  })

  it("includes a first-party intersection arm, excludes a node_modules arm", () => {
    const { component } = extractComponent(WIDGET)
    // First-party: declared in ./shared/shared-props.ts, a project file.
    expect(propByName(component, "variant")).toEqual({
      name: "variant",
      type: "enum",
      values: ["a", "b"],
      required: true,
    })
    // node_modules: declared in third-party-attrs, must not appear at all.
    expect(propByName(component, "onClick")).toBeUndefined()
    expect(propByName(component, "style")).toBeUndefined()
  })

  it("props are sorted by name", () => {
    const { component } = extractComponent(WIDGET)
    expect(component.props.map(prop => prop.name)).toEqual([
      "children",
      "label",
      "size",
      "variant",
    ])
  })
})

// ---------------------------------------------------------------------------
// Type classification + destructuring defaults across every scalar category.
// ---------------------------------------------------------------------------

describe("extractComponent — type classification and defaults", () => {
  it("maps boolean/number/string/function to the contract vocabulary", () => {
    const { ok, component } = extractComponent(KINDS)
    expect(ok).toBe(true)
    expect(component.props).toEqual([
      { name: "active", type: "boolean", required: false, default: false },
      { name: "count", type: "number", required: false, default: 0 },
      { name: "name", type: "string", required: true },
      { name: "onSelect", type: "function", required: false },
    ])
  })

  it("reads defaults from the destructuring pattern, not the type", () => {
    const { component } = extractComponent(KINDS)
    expect(propByName(component, "active").default).toBe(false)
    expect(propByName(component, "count").default).toBe(0)
    // No destructuring default -> no `default` key at all (never `undefined`).
    expect(propByName(component, "name")).not.toHaveProperty("default")
  })
})

// ---------------------------------------------------------------------------
// `interface … extends …` — the other shape D2's contracts imply components
// may use, alongside `type X = {…} & …`.
// ---------------------------------------------------------------------------

describe("extractComponent — interface + heritage clauses", () => {
  it("walks a local extended interface (first-party) and excludes a node_modules one", () => {
    const { ok, component } = extractComponent(PANEL)
    expect(ok).toBe(true)
    expect(component.props).toEqual([
      { name: "id", type: "string", required: true },
      { name: "title", type: "string", required: true },
    ])
  })
})

// ---------------------------------------------------------------------------
// Degradation — never throws.
// ---------------------------------------------------------------------------

describe("extractComponent — a discriminated union as an intersection arm (#381)", () => {
  it("takes the union of the members' keys: discriminant as enum, exclusive props optional, never-typed props optional", () => {
    const { ok, component } = extractComponent(
      join(FIXTURES, "discriminated-union.tsx"),
    )
    expect(ok).toBe(true)
    const byName = Object.fromEntries(component.props.map(p => [p.name, p]))
    expect(byName.variant).toEqual({
      name: "variant",
      type: "enum",
      values: ["icon", "text"],
      required: true,
    })
    expect(byName.icon).toEqual({ name: "icon", type: "slot", required: false })
    expect(byName.text).toEqual({
      name: "text",
      type: "string",
      required: false,
    })
    expect(byName.size).toEqual(
      expect.objectContaining({
        type: "enum",
        values: ["sm", "md", "lg"],
        required: false,
      }),
    )
    // The third-party `Omit<HTMLAttributes…>` arm is still excluded.
    expect(Object.keys(byName).sort()).toEqual([
      "className",
      "icon",
      "size",
      "text",
      "variant",
    ])
  })

  it("skips the whole union when any member is not first-party walkable — never half-read", () => {
    const { ok, component } = extractComponent(
      join(FIXTURES, "union-unwalkable.tsx"),
    )
    expect(ok).toBe(true)
    expect(component.props.map(p => p.name)).toEqual(["size"])
  })
})

describe("extractComponent — never throws", () => {
  it("degrades to ok:false with a clear diagnostic when typescript cannot load", () => {
    const result = extractComponent(WIDGET, {
      tsModuleName: "definitely-not-a-real-module-xyz",
    })
    expect(result.ok).toBe(false)
    expect(result.component).toBeNull()
    expect(result.diagnostics).toEqual([
      expect.objectContaining({ code: "typescript-not-installed" }),
    ])
    expect(result.diagnostics[0].message).toMatch(/install typescript/)
  })

  it("degrades to ok:false when the file does not exist", () => {
    const result = extractComponent(join(FIXTURES, "does-not-exist.tsx"))
    expect(result.ok).toBe(false)
    expect(result.diagnostics[0].code).toBe("missing-component-file")
  })

  it("degrades to ok:false when the props parameter carries no type", () => {
    const result = extractComponent(UNTYPED_PROPS)
    expect(result.ok).toBe(false)
    expect(result.diagnostics[0].code).toBe("untyped-props-parameter")
  })

  it("labels diagnostics/components with the given `label`, not the real path", () => {
    const result = extractComponent(UNTYPED_PROPS, {
      label: "components/untyped-props.tsx",
    })
    expect(result.diagnostics[0].file).toBe("components/untyped-props.tsx")
  })
})

// ---------------------------------------------------------------------------
// Determinism.
// ---------------------------------------------------------------------------

describe("extractComponent — determinism", () => {
  it("the same file extracts byte-identically twice", () => {
    const a = JSON.stringify(extractComponent(WIDGET))
    const b = JSON.stringify(extractComponent(WIDGET))
    expect(a).toBe(b)
  })
})

// ---------------------------------------------------------------------------
// extractComponents — the whole-set entry point.
// ---------------------------------------------------------------------------

describe("extractComponents", () => {
  it("extracts every file, sorted by file, regardless of input order", () => {
    const { ok, components, diagnostics } = extractComponents([
      PANEL,
      WIDGET,
      KINDS,
    ])
    expect(ok).toBe(true)
    expect(diagnostics).toEqual([])
    expect(components.map(c => c.file)).toEqual(
      [KINDS, PANEL, WIDGET].slice().sort(),
    )
  })

  it("one bad file contributes a diagnostic without aborting the rest", () => {
    const { ok, components, diagnostics } = extractComponents([
      WIDGET,
      UNTYPED_PROPS,
    ])
    expect(ok).toBe(false)
    expect(components.map(c => c.file)).toEqual([WIDGET])
    expect(diagnostics).toEqual([
      expect.objectContaining({
        code: "untyped-props-parameter",
        file: UNTYPED_PROPS,
      }),
    ])
  })

  it("relabels each component relative to `root` when given", () => {
    const { components } = extractComponents([WIDGET], {
      root: process.cwd(),
    })
    expect(components[0].file).toBe("__tests__/fixtures/extract/widget.tsx")
  })

  it("degrades to ok:false, skipped:true when typescript cannot load — never one diagnostic per file", () => {
    const result = extractComponents([WIDGET, KINDS, PANEL], {
      tsModuleName: "definitely-not-a-real-module-xyz",
    })
    expect(result.ok).toBe(false)
    expect(result.skipped).toBe(true)
    expect(result.components).toEqual([])
    expect(result.diagnostics).toHaveLength(1)
    expect(result.diagnostics[0].code).toBe("typescript-not-installed")
  })

  it("is deterministic — the same file set extracts to byte-identical JSON twice", () => {
    const a = JSON.stringify(extractComponents([WIDGET, KINDS, PANEL]))
    const b = JSON.stringify(extractComponents([KINDS, PANEL, WIDGET]))
    expect(a).toBe(b)
  })
})

// ---------------------------------------------------------------------------
// loadTypeScript — the lazy-load primitive itself.
// ---------------------------------------------------------------------------

describe("loadTypeScript", () => {
  it("returns the real module by default", () => {
    const ts = loadTypeScript()
    expect(typeof ts.createProgram).toBe("function")
  })

  it("returns null, never throws, for an unresolvable module name", () => {
    expect(() =>
      loadTypeScript("definitely-not-a-real-module-xyz"),
    ).not.toThrow()
    expect(loadTypeScript("definitely-not-a-real-module-xyz")).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// findComponentFiles — discovery under paths.componentsDir.
// ---------------------------------------------------------------------------

describe("findComponentFiles", () => {
  it("finds every .tsx file, excluding conventions.nonComponentFileSuffixes", () => {
    const { dir, files } = findComponentFiles(
      { paths: { componentsDir: "__tests__/fixtures/extract" } },
      { root: process.cwd() },
    )
    expect(dir).toBe(FIXTURES)
    expect(files).toEqual(
      [
        join(FIXTURES, "barrel.tsx"),
        DEFAULT_EXPORTED,
        join(FIXTURES, "destructured-props.tsx"),
        join(FIXTURES, "discriminated-union.tsx"),
        join(FIXTURES, "forward-ref.tsx"),
        KINDS,
        join(FIXTURES, "memo-wrapped.tsx"),
        join(FIXTURES, "non-destructured-props.tsx"),
        NO_PROPS,
        PANEL,
        join(FIXTURES, "qualified-forward-ref.tsx"),
        join(FIXTURES, "qualified-memo.tsx"),
        join(FIXTURES, "union-unwalkable.tsx"),
        join(FIXTURES, "untyped-props.tsx"),
        WIDGET,
      ]
        .slice()
        .sort(),
    )
    // .stories.tsx is excluded by the DEFAULT nonComponentFileSuffixes.
    expect(files).not.toContain(join(FIXTURES, "widget.stories.tsx"))
  })

  it("an empty/missing componentsDir yields zero files, never a crash", () => {
    const { files } = findComponentFiles(
      { paths: { componentsDir: "__tests__/fixtures/does-not-exist" } },
      { root: process.cwd() },
    )
    expect(files).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// How a component is exported — measured, not assumed.
// ---------------------------------------------------------------------------

describe("extractComponent — component discovery", () => {
  it("follows `export default X` back to a `const X = …` declaration", () => {
    // The dominant real-world shape, and originally unhandled here even after
    // it was fixed in sources/react/jsx.mjs. Measured across a real design system:
    // of 100 components ZERO use `export function X` and 55 use this form, so
    // props extraction read just 16 of 100 files — the props/API check, the
    // engine's flagship, was blind to 84% of the codebase while reporting
    // confidently on the rest.
    const result = extractComponent(
      join(FIXTURES, "default-exported-const.tsx"),
    )
    expect(result.ok).toBe(true)
    const names = result.component.props.map(p => p.name).sort()
    expect(names).toEqual(["label", "size"])
    expect(result.component.props.find(p => p.name === "size").default).toBe(
      "lg",
    )
  })
})

// ---------------------------------------------------------------------------
// Path-aliased types — the bug a real contract found, pinned.
// ---------------------------------------------------------------------------

describe("extractComponent — path-aliased imported types", () => {
  // A whole temp project, not a lone .tsx fixture: the bug lives in how the
  // TypeScript PROGRAM is configured, so a fixture that does not carry its own
  // tsconfig could not reproduce it. The alias prefix and directory names here
  // deliberately match no real project's, per the synthetic-project rule.
  function aliasProject(tsconfig) {
    const root = mkdtempSync(join(tmpdir(), "design-delta-alias-"))
    mkdirSync(join(root, "kit", "shade"), { recursive: true })
    mkdirSync(join(root, "kit", "tile"), { recursive: true })
    writeFileSync(
      join(root, "kit", "shade", "shade.ts"),
      'export type Shade = "pale" | "deep"\n',
    )
    writeFileSync(
      join(root, "kit", "tile", "tile.tsx"),
      [
        'import type { Shade } from "~kit/shade/shade"',
        "",
        "export type TileProps = {",
        "  shade?: Shade",
        "}",
        "",
        "const Tile = ({ shade }: TileProps) => <div>{shade}</div>",
        "",
        "export default Tile",
        "",
      ].join("\n"),
    )
    if (tsconfig) writeFileSync(join(root, "tsconfig.json"), tsconfig)
    return root
  }

  const WITH_PATHS = JSON.stringify({
    compilerOptions: { paths: { "~kit/*": ["./kit/*"] } },
  })

  let root

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true })
    root = undefined
  })

  it("resolves an aliased type alias to its enum values", () => {
    // The finding that exposed this: a prop typed `Theme` — a two-member
    // string union one file away — was reported as a slot, because the engine
    // built its program with no `paths` and TypeScript handed back the error
    // type. Against a real design system this mislabeled 6 props outright and
    // left 107 sitting in "slot".
    root = aliasProject(WITH_PATHS)
    const result = extractComponent(join(root, "kit", "tile", "tile.tsx"), {
      root,
    })
    expect(result.ok).toBe(true)
    expect(propByName(result.component, "shade")).toMatchObject({
      type: "enum",
      values: ["pale", "deep"],
    })
  })

  it("reports an unresolvable type as `unknown` rather than guessing a slot", () => {
    // No tsconfig, so the alias cannot resolve by construction. The honest
    // answer is "could not resolve", NOT the classifier's fallback: "slot" is
    // a claim about shape, and asserting it here is what turned an unreadable
    // type into a confident, wrong finding.
    root = aliasProject(null)
    const result = extractComponent(join(root, "kit", "tile", "tile.tsx"), {
      root,
    })
    expect(result.ok).toBe(true)
    expect(propByName(result.component, "shade").type).toBe("unknown")
  })

  it("resolves aliases relative to the tsconfig, not the current directory", () => {
    // `paths` entries are relative ("./kit/*") and TypeScript resolves them
    // against `baseUrl` — defaulting to process.cwd() when unset. The engine
    // runs from its own directory, so without pinning baseUrl to the
    // tsconfig's location every alias resolved into the WRONG TREE and the
    // fix above silently did nothing.
    root = aliasProject(WITH_PATHS)
    expect(root).not.toBe(process.cwd())
    const result = extractComponent(join(root, "kit", "tile", "tile.tsx"), {
      root,
    })
    expect(propByName(result.component, "shade").type).toBe("enum")
  })
})

// ---------------------------------------------------------------------------
// "No component here" vs. "component here, props unreadable" (issue #132).
//
// These two failures were reported with the SAME code and both dropped the
// file from the census entirely, so a component whose props could not be read
// vanished from the contract worklist: measured on a real design system, 21 of
// 100 discovered files were confirmed components that `coverage/uncontracted-
// component` never mentioned, while `verify` exited 0 reporting a complete
// worklist. Distinguishing them is what lets coverage include the first group
// without inventing a finding for the second.
// ---------------------------------------------------------------------------

const BARREL = join(FIXTURES, "barrel.tsx")
const UNTYPED_PROPS = join(FIXTURES, "untyped-props.tsx")

describe("extractComponent — component confirmed vs. absent", () => {
  it("reports no-component-found for a file that declares no component", () => {
    const result = extractComponent(BARREL)
    expect(result.ok).toBe(false)
    expect(result.componentConfirmed).toBe(false)
    expect(result.diagnostics[0].code).toBe("no-component-found")
  })

  it("confirms a component whose props parameter is untyped", () => {
    const result = extractComponent(UNTYPED_PROPS)
    expect(result.ok).toBe(false)
    expect(result.componentConfirmed).toBe(true)
    expect(result.diagnostics[0].code).toBe("untyped-props-parameter")
  })

  it("succeeds with zero props for a component that takes none", () => {
    // `export function NotAComponent() {}` — genuinely propless, which is a
    // complete answer about its API, not a failure to read the file, so it
    // censuses as a readable component with an empty prop list (issue #152).
    const result = extractComponent(NO_PROPS)
    expect(result.ok).toBe(true)
    expect(result.diagnostics).toEqual([])
    expect(result.component).toEqual({
      file: NO_PROPS,
      props: [],
      name: "NotAComponent",
      namedExport: true,
    })
  })
})

// ---------------------------------------------------------------------------
// Propless vs. untyped — three outcomes, not one (issues #152, #153).
//
// `no-props-type-found` used to cover BOTH of these plus the #154 shape, so a
// diagnostic reading "extraction failed" fired on components where nothing had
// failed. They are now three distinct answers, and the distinction between the
// two below is the one that matters most:
//
//   - propless — takes no parameter, so it HAS no props. Zero props is TRUE.
//   - untyped  — takes `({...props})`, so it accepts whatever the element it
//                spreads onto accepts. Zero props would be FALSE.
//
// THE TRAP this pins: collapsing them by reporting `props: []` for both is the
// tempting simplification, and it is exactly the false assertion this engine
// exists to avoid. A test asserting only "no diagnostic" would not catch it.
// ---------------------------------------------------------------------------

describe("propless vs. untyped components", () => {
  it("censuses a propless component as readable with no props", () => {
    const { ok, components, unreadableProps, diagnostics } = extractComponents([
      NO_PROPS,
    ])
    expect(ok).toBe(true)
    expect(diagnostics).toEqual([])
    // On the census as a real component, so coverage still expects a contract.
    expect(components).toEqual([
      { file: NO_PROPS, props: [], name: "NotAComponent", namedExport: true },
    ])
    expect(unreadableProps).toEqual([])
  })

  it("names the declaration the reported shape came from, not the last one seen", () => {
    // A file mixing BOTH unreadable shapes, which is the only thing that
    // separates "the first shape seen" from "the last declaration seen"
    // (issue #321). `shape` is the propless `Alpha`'s — the reported `props:
    // []` is an answer about `Alpha` — so `Alpha` is the name that belongs
    // beside it. A name tracked independently of the shape reports `Beta`,
    // the untyped declaration whose props were never read at all, and the
    // census then pairs one declaration's props with another's name.
    //
    // Written into a temp dir rather than `__tests__/fixtures/extract` on
    // purpose: that directory's contents are themselves pinned, file by file,
    // by the `findComponentFiles` suite above.
    const root = mkdtempSync(join(tmpdir(), "design-delta-mixed-shapes-"))
    try {
      const file = join(root, "mixed-shapes.tsx")
      writeFileSync(
        file,
        [
          "export function Alpha() {",
          "  return <div />",
          "}",
          "",
          "export function Beta({ ...rest }) {",
          "  return <div {...rest} />",
          "}",
          "",
        ].join("\n"),
      )
      const result = extractComponent(file)
      expect(result.ok).toBe(true)
      expect(result.diagnostics).toEqual([])
      expect(result.component).toEqual({
        file,
        props: [],
        name: "Alpha",
        namedExport: true,
      })
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it("keeps an untyped component unreadable rather than claiming zero props", () => {
    const { ok, components, unreadableProps } = extractComponents([
      UNTYPED_PROPS,
    ])
    expect(ok).toBe(false)
    // The assertion that matters: it must NOT appear as a zero-prop component.
    expect(components).toEqual([])
    expect(unreadableProps).toEqual([UNTYPED_PROPS])
  })

  it("gives the two shapes different diagnostic codes", () => {
    const propless = extractComponent(NO_PROPS)
    const untyped = extractComponent(UNTYPED_PROPS)
    expect(propless.diagnostics).toEqual([])
    expect(untyped.diagnostics.map(d => d.code)).toEqual([
      "untyped-props-parameter",
    ])
  })

  it("no longer emits `no-props-type-found` for any shape", () => {
    // The code is gone, not renamed for one case — every shape that reached it
    // now has its own answer. Pinned because a consumer reads these codes.
    for (const file of [NO_PROPS, UNTYPED_PROPS, BARREL, NON_DESTRUCTURED]) {
      const codes = extractComponent(file).diagnostics.map(d => d.code)
      expect(codes).not.toContain("no-props-type-found")
    }
  })

  it("words the untyped diagnostic as undeclared, not as a failed read", () => {
    // #153's actual complaint was the WORDING: it read as "the tool tried and
    // could not", when the truth is that the component never declared a type.
    const { message } = extractComponent(UNTYPED_PROPS).diagnostics[0]
    expect(message).toMatch(/no type annotation/)
    expect(message).toMatch(/undeclared/)
  })
})

describe("extractComponents — the unreadable-props census", () => {
  it("lists confirmed components whose props could not be read", () => {
    const census = extractComponents([WIDGET, UNTYPED_PROPS, BARREL])
    expect(census.components.map(c => c.file)).toEqual([WIDGET])
    expect(census.unreadableProps).toEqual([UNTYPED_PROPS])
  })

  it("never lists a file that declares no component", () => {
    const census = extractComponents([BARREL])
    expect(census.components).toEqual([])
    expect(census.unreadableProps).toEqual([])
  })

  it("relabels unreadable entries relative to `root`, like components", () => {
    const census = extractComponents([UNTYPED_PROPS], { root: FIXTURES })
    expect(census.unreadableProps).toEqual(["untyped-props.tsx"])
  })
})

// ---------------------------------------------------------------------------
// Non-destructured props parameters (issue #154).
//
// `(props: FooProps) => …` is as idiomatic as `({foo}: FooProps) => …`, but
// the extractor resolved the type node and then DISCARDED it, because it also
// required a destructuring pattern before returning. The pattern supplies only
// destructuring defaults; the props themselves come from the type. So a real,
// present, resolvable API was reported as unreadable.
//
// THE TRAP these pin: a test asserting only "some props were extracted" passes
// against a regression that reads the wrong count, and a hand-written expected
// list can drift from what the destructured path actually produces. The real
// contract is EQUIVALENCE — the two parameter shapes describe the same API and
// must census identically — so that is what is asserted, against a fixture pair
// built to differ in nothing but the parameter shape.
// ---------------------------------------------------------------------------

const NON_DESTRUCTURED = join(FIXTURES, "non-destructured-props.tsx")
const DESTRUCTURED = join(FIXTURES, "destructured-props.tsx")

describe("extractComponent — non-destructured props parameter (#154)", () => {
  it("reads the props type off a plain typed identifier parameter", () => {
    const result = extractComponent(NON_DESTRUCTURED)
    expect(result.ok).toBe(true)
    expect(result.diagnostics).toEqual([])
    expect(result.component.props).toEqual([
      { name: "label", type: "string", required: true },
      { name: "size", type: "enum", values: ["sm", "lg"], required: false },
    ])
  })

  it("censuses identically to the destructured form of the same type", () => {
    const plain = extractComponent(NON_DESTRUCTURED)
    const destructured = extractComponent(DESTRUCTURED)
    expect(plain.ok).toBe(true)
    expect(destructured.ok).toBe(true)
    expect(plain.component.props).toEqual(destructured.component.props)
  })

  it("does not report it as a confirmed-but-unreadable component", () => {
    const census = extractComponents([NON_DESTRUCTURED])
    expect(census.ok).toBe(true)
    expect(census.unreadableProps).toEqual([])
    expect(census.components.map(c => c.file)).toEqual([NON_DESTRUCTURED])
  })

  it("still reports a component whose parameter carries no type at all", () => {
    // Dropping the pattern requirement must never turn an untyped parameter
    // into a silent zero-prop answer — that would assert something false.
    const result = extractComponent(UNTYPED_PROPS)
    expect(result.ok).toBe(false)
    expect(result.componentConfirmed).toBe(true)
    expect(result.diagnostics[0].code).toBe("untyped-props-parameter")
  })
})

// ---------------------------------------------------------------------------
// Higher-order component wrappers (issue #134).
//
// `functionOfStatement` accepted only an arrow or function expression, so a
// component wrapped in `forwardRef`/`memo` — a CallExpression — was not found
// at all. It produced BOTH `no-component-found` and `no-props-type-found` on a
// component with an exported, explicitly typed props contract, then vanished
// from the coverage worklist with it (#132).
//
// THE TRAP these pin: the props type sits at a DIFFERENT type-argument index
// per wrapper. `forwardRef<TRef, TProps>` puts it SECOND; `memo<TProps>` puts
// it FIRST. Transposing them silently reads the wrong type — worse than
// reading nothing, because it reports confident findings against a type the
// component never declared. A test asserting only "a component was found"
// passes with them transposed, so these assert the actual props.
// ---------------------------------------------------------------------------

const FORWARD_REF = join(FIXTURES, "forward-ref.tsx")
const MEMO_WRAPPED = join(FIXTURES, "memo-wrapped.tsx")
// The same two wrappers written `React.forwardRef`/`React.memo` — a
// property-access callee, not an identifier. `hoc.mjs` accepts both on purpose
// and issue #577 found the qualified branch wholly unexercised: unresolved, the
// component is not recognised as a component at all and leaves the contract
// worklist with no diagnostic (the #132 failure). Asserted the same way as the
// bare form, by the actual props read, because the per-wrapper index still
// applies and "a component was found" passes with the two transposed.
const QUALIFIED_FORWARD_REF = join(FIXTURES, "qualified-forward-ref.tsx")
const QUALIFIED_MEMO = join(FIXTURES, "qualified-memo.tsx")

describe("extractComponent — forwardRef/memo-wrapped components", () => {
  it("reads forwardRef props from the SECOND type argument", () => {
    const { ok, component } = extractComponent(FORWARD_REF)
    expect(ok).toBe(true)
    expect(component.props.map(p => p.name)).toEqual([
      "disabled",
      "label",
      "size",
    ])
    // If the ref type (HTMLDivElement, arg 0) were read instead, none of these
    // would be present — that is the transposition this asserts against.
    expect(propByName(component, "label")).toEqual({
      name: "label",
      type: "string",
      required: true,
    })
  })

  it("reads defaults destructured in the BODY, not the parameter", () => {
    const { component } = extractComponent(FORWARD_REF)
    expect(propByName(component, "size").default).toBe("md")
    expect(propByName(component, "disabled").default).toBe(false)
    expect(propByName(component, "size").required).toBe(false)
  })

  it("reads memo props from the FIRST type argument", () => {
    const { ok, component } = extractComponent(MEMO_WRAPPED)
    expect(ok).toBe(true)
    expect(component.props.map(p => p.name)).toEqual(["count", "title"])
    expect(propByName(component, "title")).toEqual({
      name: "title",
      type: "string",
      required: true,
    })
    expect(propByName(component, "count").default).toBe(0)
  })

  it("reads React.forwardRef props from the SECOND type argument", () => {
    const { ok, component } = extractComponent(QUALIFIED_FORWARD_REF)
    expect(ok).toBe(true)
    expect(component.props.map(p => p.name)).toEqual([
      "caption",
      "readOnly",
      "variant",
    ])
    // The ref type argument (HTMLDivElement, arg 0) declares none of these, so
    // a transposed index reads a visibly different type rather than a subtly
    // wrong one.
    expect(propByName(component, "caption")).toEqual({
      name: "caption",
      type: "string",
      required: true,
    })
    expect(propByName(component, "variant")).toEqual({
      name: "variant",
      type: "enum",
      values: ["solid", "outline"],
      default: "solid",
      required: false,
    })
    expect(propByName(component, "readOnly")).toEqual({
      name: "readOnly",
      type: "boolean",
      default: false,
      required: false,
    })
  })

  it("reads React.memo props from the FIRST type argument", () => {
    const { ok, component } = extractComponent(QUALIFIED_MEMO)
    expect(ok).toBe(true)
    expect(component.props.map(p => p.name)).toEqual(["heading", "total"])
    expect(propByName(component, "heading")).toEqual({
      name: "heading",
      type: "string",
      required: true,
    })
    expect(propByName(component, "total")).toEqual({
      name: "total",
      type: "number",
      default: 0,
      required: false,
    })
  })

  it("counts a React.-qualified component as a confirmed component", () => {
    // The #132 consequence, on the qualified branch: an unreadable component
    // silently left the contract worklist. The index assertions above would
    // still pass if only ONE of the two forms resolved, so this asserts both
    // reach the census with nothing reported against them.
    const census = extractComponents([QUALIFIED_FORWARD_REF, QUALIFIED_MEMO])
    expect(census.components.map(c => c.file)).toEqual(
      [QUALIFIED_FORWARD_REF, QUALIFIED_MEMO].slice().sort(),
    )
    expect(census.diagnostics).toEqual([])
  })

  it("counts a wrapped component as a confirmed component", () => {
    // The #132 consequence: an unreadable component silently left the
    // contract worklist. A wrapped one must never be treated as "not a
    // component at all".
    const census = extractComponents([FORWARD_REF, MEMO_WRAPPED])
    expect(census.components.map(c => c.file)).toEqual(
      [FORWARD_REF, MEMO_WRAPPED].slice().sort(),
    )
    expect(census.diagnostics).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Issue #453 — export style. A binding file that default-imports a named
// export does not compile, so the census says which one a component is.
// ---------------------------------------------------------------------------

describe("extractComponent — namedExport (#453)", () => {
  function extractSource(lines) {
    const root = mkdtempSync(join(tmpdir(), "design-delta-export-style-"))
    try {
      const file = join(root, "component.tsx")
      writeFileSync(file, lines.join("\n") + "\n")
      return extractComponent(file)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }

  it("`export const X = (…) => …` is a named export", () => {
    const { component } = extractSource([
      "type Props = { label: string }",
      "export const Card = ({ label }: Props) => <div>{label}</div>",
    ])
    expect(component.name).toBe("Card")
    expect(component.namedExport).toBe(true)
  })

  it("`export default function X` is not", () => {
    const { component } = extractSource([
      "type Props = { label: string }",
      "export default function Card({ label }: Props) {",
      "  return <div>{label}</div>",
      "}",
    ])
    expect(component.namedExport).toBe(false)
  })

  it("`const X = …; export default X` is not (the fixture the default-export pass reads)", () => {
    const { ok, component } = extractComponent(DEFAULT_EXPORTED)
    expect(ok).toBe(true)
    expect(component.namedExport).toBe(false)
  })
})
