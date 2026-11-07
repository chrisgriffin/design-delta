/**
 * spec-scaffold.test.js — `src/spec/scaffold.mjs` (issue #540): the pure
 * contract-drafting logic `design-delta scaffold` composes.
 *
 * `__tests__/cli-scaffold.test.js` already drives this module, but only end to
 * end: it stands up a synthetic project and runs the command, so it answers
 * "does scaffold write a usable contract" and not "does the anatomy builder
 * refuse the right things". Five of the module's six exports were never named
 * in any test. A pure builder reachable only through a command is one nobody
 * writes an edge case for, which is how #351 (a content child written into
 * `children`) and #431 (a divergent-roots component drafting no `anatomy` at
 * all) both reached the tree.
 *
 * Every input here is a literal: no project on disk, no `runScaffold`, no fs.
 * The structural-census vocabulary the literals use — `element`, `component`,
 * `text`, `expression`, `unknown`, `unresolved`, `children`,
 * `childrenResolved`, `attributes` — is `docs/framework-adapter-contract.md`'s
 * and names no framework, so a case reads the same way the module does.
 *
 * What this module is FOR is refusing to guess: a value it cannot read off the
 * census is written as a `_scaffold: {todo: "…"}` marker a human can grep,
 * never as a plausible-looking invention. So the refusals are asserted as
 * carefully as the happy paths, on the substring that carries the meaning
 * rather than the whole sentence — a reworded message is not a regression.
 */

import { CONTRACT_SCHEMA_VERSION } from "../src/spec/contracts.mjs"
import {
  SCAFFOLD_ATTRIBUTES,
  buildScaffoldAnatomy,
  buildScaffoldAnatomyVariants,
  buildScaffoldContract,
  draftStyleProperty,
  draftStyleProps,
} from "../src/spec/scaffold.mjs"

// A component's declared props, as `buildScaffoldAnatomy` wants them.
const props = (...names) => new Set(names)

// ---------------------------------------------------------------------------
// SCAFFOLD_ATTRIBUTES
// ---------------------------------------------------------------------------

describe("SCAFFOLD_ATTRIBUTES", () => {
  test("is a frozen list, so no caller can widen what scaffold pins", () => {
    expect(Object.isFrozen(SCAFFOLD_ATTRIBUTES)).toBe(true)
    expect(SCAFFOLD_ATTRIBUTES).toContain("role")
    expect(SCAFFOLD_ATTRIBUTES).toContain("alt")
  })

  test("is what decides which attributes get drafted", () => {
    const anatomy = buildScaffoldAnatomy(
      {
        kind: "element",
        tag: "button",
        attributes: {
          "aria-label": "Close",
          className: "btn btn--lg",
          "data-testid": "close",
          onClick: "handleClick",
          role: "button",
          title: "Close this",
        },
      },
      props(),
    )

    // Listed names and any `aria-*` carry meaning to a user or to assistive
    // technology; `className`/`data-*`/handlers carry meaning to the
    // framework, and a contract pinning those would assert implementation.
    expect(anatomy.root.attributes).toEqual({
      "aria-label": "Close",
      role: "button",
      title: "Close this",
    })
  })

  test("skips a value the census could not resolve, without a todo", () => {
    // A contract that does not pin an attribute is a valid contract, so an
    // unresolved value is dropped rather than reported as unfinished work.
    const anatomy = buildScaffoldAnatomy(
      {
        kind: "element",
        tag: "img",
        attributes: { alt: { unresolved: true }, tabIndex: 0 },
      },
      props(),
    )

    expect(anatomy.root.attributes).toBeUndefined()
    expect(anatomy.root._scaffold).toBeUndefined()
  })

  test("omits the key entirely when nothing is draftable", () => {
    const anatomy = buildScaffoldAnatomy(
      { kind: "element", tag: "div", attributes: { className: "wrap" } },
      props(),
    )

    expect(Object.hasOwn(anatomy.root, "attributes")).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// buildScaffoldAnatomy
// ---------------------------------------------------------------------------

describe("buildScaffoldAnatomy", () => {
  test("drafts an element root with its structural children", () => {
    const anatomy = buildScaffoldAnatomy(
      {
        kind: "element",
        tag: "div",
        children: [
          { kind: "element", tag: "span", children: [] },
          { kind: "element", tag: "span", children: [] },
        ],
      },
      props(),
    )

    expect(anatomy.root).toEqual({
      type: "container",
      element: "div",
      children: ["span", "span2"],
    })
    expect(anatomy.span).toEqual({ type: "container", element: "span" })
    expect(anatomy.span2).toEqual({ type: "container", element: "span" })
  })

  test("names every node uniquely across the WHOLE map, not per sibling", () => {
    // `children` references nodes by bare string with no scoping, so two
    // subtrees both producing "label" would collide and one would win.
    const leaf = () => ({
      kind: "element",
      tag: "wrap",
      children: [{ kind: "element", tag: "label", children: [] }],
    })
    const anatomy = buildScaffoldAnatomy(
      { kind: "element", tag: "div", children: [leaf(), leaf()] },
      props(),
    )

    const names = Object.keys(anatomy)
    expect(new Set(names).size).toBe(names.length)
    expect(names).toEqual(
      expect.arrayContaining(["root", "wrap", "label", "wrap2", "label2"]),
    )
  })

  test("sanitizes a name to the schema's node pattern, and never reuses root", () => {
    const anatomy = buildScaffoldAnatomy(
      {
        kind: "element",
        tag: "div",
        children: [
          { kind: "component", name: "Foo.Bar" },
          { kind: "element", tag: "root", children: [] },
        ],
      },
      props(),
    )

    expect(anatomy.root.children).toEqual(["fooBar", "root2"])
  })

  test("treats a nested component as a delegated instance and stops there", () => {
    const anatomy = buildScaffoldAnatomy(
      {
        kind: "element",
        tag: "div",
        children: [
          {
            kind: "component",
            name: "Icon",
            children: [{ kind: "element", tag: "svg", children: [] }],
          },
        ],
      },
      props(),
    )

    expect(anatomy.icon).toEqual({
      type: "instance",
      instanceOf: "Icon",
      _scaffold: { todo: "confirm instanceOf names the right contract" },
    })
    // The instance's own contract owns its structure — the census's children
    // are deliberately not followed.
    expect(anatomy.svg).toBeUndefined()
  })

  test("makes a lone content child the parent's `content`, never a child node (#351)", () => {
    const anatomy = buildScaffoldAnatomy(
      {
        kind: "element",
        tag: "button",
        children: [{ kind: "text", value: "Save" }],
      },
      props(),
    )

    expect(anatomy.root).toEqual({
      type: "container",
      element: "button",
      content: "Save",
    })
    // `modules/anatomy.mjs` compares `children` against STRUCTURAL children
    // alone, so a content child listed there reports as absent — scaffold's
    // own output failing scaffold's own audit.
    expect(Object.hasOwn(anatomy.root, "children")).toBe(false)
  })

  test("binds a content expression that names a declared prop", () => {
    const anatomy = buildScaffoldAnatomy(
      {
        kind: "element",
        tag: "span",
        children: [{ kind: "expression", prop: "label" }],
      },
      props("label"),
    )

    expect(anatomy.root.content).toEqual({ $prop: "label" })
    expect(anatomy.root._scaffold).toBeUndefined()
  })

  test("refuses to bind an identifier that is not a declared prop", () => {
    // Writing `{$prop: "children"}` here produces a contract that
    // `contracts.mjs`'s own `unknown-content-prop` check then rejects.
    const anatomy = buildScaffoldAnatomy(
      {
        kind: "element",
        tag: "span",
        children: [{ kind: "expression", prop: "children" }],
      },
      props("label"),
    )

    expect(anatomy.root.content).toBeUndefined()
    expect(anatomy.root._scaffold.todo).toContain('binds "children"')
    expect(anatomy.root._scaffold.todo).toContain("not a declared prop")
  })

  test("refuses a content position whose expression the census could not classify", () => {
    const anatomy = buildScaffoldAnatomy(
      {
        kind: "element",
        tag: "span",
        children: [{ kind: "unknown" }],
      },
      props(),
    )

    expect(anatomy.root.content).toBeUndefined()
    expect(anatomy.root._scaffold.todo).toContain("could not be classified")
  })

  test("refuses a position rendering several content values", () => {
    // One node carries ONE `content`, so there is no honest single binding to
    // draft — picking one would present a guess as read from the code.
    const anatomy = buildScaffoldAnatomy(
      {
        kind: "element",
        tag: "span",
        children: [
          { kind: "text", value: "Hello " },
          { kind: "expression", prop: "name" },
        ],
      },
      props("name"),
    )

    expect(anatomy.root.content).toBeUndefined()
    expect(anatomy.root._scaffold.todo).toContain("renders 2 values")
  })

  // A content child becomes its parent's `content` and is never visited as a
  // node of its own, so the builder's own text/expression/unknown handling is
  // reached in exactly one place: a component whose ROOT renders content
  // directly. Without these, that whole arm of the walk is untested.
  test("drafts a root that renders text directly", () => {
    const anatomy = buildScaffoldAnatomy({ kind: "text", value: "Go" }, props())

    expect(anatomy.root).toEqual({ type: "text", content: "Go" })
  })

  test("binds a root expression that names a declared prop", () => {
    const anatomy = buildScaffoldAnatomy(
      { kind: "expression", prop: "label" },
      props("label"),
    )

    expect(anatomy.root).toEqual({ type: "text", content: { $prop: "label" } })
  })

  test("refuses a root expression that names no declared prop", () => {
    const anatomy = buildScaffoldAnatomy(
      { kind: "expression", prop: "children" },
      props("label"),
    )

    expect(anatomy.root.content).toBeUndefined()
    expect(anatomy.root._scaffold.todo).toContain('binds "children"')
  })

  test("refuses a root the census could not classify", () => {
    const anatomy = buildScaffoldAnatomy({ kind: "unknown" }, props())

    expect(anatomy.root.type).toBe("text")
    expect(anatomy.root.content).toBeUndefined()
    expect(anatomy.root._scaffold.todo).toContain("could not be classified")
  })

  test("marks an unresolved position as a container it did not read", () => {
    const anatomy = buildScaffoldAnatomy(
      {
        kind: "element",
        tag: "div",
        children: [
          {
            kind: "unresolved",
            children: [{ kind: "element", tag: "span", children: [] }],
          },
        ],
      },
      props(),
    )

    expect(anatomy.unresolved).toEqual({
      type: "container",
      _scaffold: {
        todo: "structure here could not be resolved from the code — fill in by hand",
      },
    })
    // The position exists; nothing inside it is guessed at.
    expect(anatomy.span).toBeUndefined()
  })

  test("says an unresolved child COUNT is unresolved, not empty", () => {
    // `children: []` alone would read as "renders nothing", which is a
    // different claim from "the branches disagreed about how many".
    const anatomy = buildScaffoldAnatomy(
      {
        kind: "element",
        tag: "div",
        childrenResolved: false,
        children: [{ kind: "element", tag: "span", children: [] }],
      },
      props(),
    )

    expect(anatomy.root.children).toEqual([])
    expect(anatomy.root._scaffold.todo).toContain("child count")
    expect(anatomy.span).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// buildScaffoldAnatomyVariants
// ---------------------------------------------------------------------------

describe("buildScaffoldAnatomyVariants", () => {
  const link = (tag, label = "Go") => ({
    kind: "element",
    tag,
    children: [{ kind: "text", value: label }],
  })

  test("returns null when there are not two branches to compare", () => {
    expect(buildScaffoldAnatomyVariants([link("button")], props())).toBeNull()
    expect(buildScaffoldAnatomyVariants([], props())).toBeNull()
    expect(buildScaffoldAnatomyVariants(undefined, props())).toBeNull()
  })

  test("drafts a base anatomy plus a $variants entry per further root (#431)", () => {
    const anatomy = buildScaffoldAnatomyVariants(
      [link("button"), link("a")],
      props(),
    )

    // First branch is the base; it is a plain anatomy, variant-free.
    expect(anatomy.root).toEqual({
      type: "container",
      element: "button",
      content: "Go",
    })

    const variants = anatomy.$variants
    expect(Object.keys(variants)).toEqual(["asA"])
    // `when` is free text a human writes (ADR-002 D4) — the engine is static,
    // so the condition that selects a branch cannot be read out of the code.
    expect(variants.asA.when).toContain("TODO")
    expect(variants.asA._scaffold.todo).toContain("documentation for a human")
    expect(variants.asA.root).toEqual({
      type: "container",
      element: "a",
      content: "Go",
    })
  })

  test("a variant carries only the nodes that DIFFER from the base (D3)", () => {
    const withIcon = tag => ({
      kind: "element",
      tag,
      children: [
        { kind: "component", name: "Icon" },
        { kind: "element", tag: "label", children: [] },
      ],
    })
    const anatomy = buildScaffoldAnatomyVariants(
      [withIcon("button"), withIcon("a")],
      props(),
    )

    // Only the root element differs; `icon` and `label` are drafted
    // identically in both branches and are inherited, never repeated.
    expect(Object.keys(anatomy.$variants.asA).sort()).toEqual([
      "_scaffold",
      "root",
      "when",
    ])
  })

  test("a single-root component drafts no $variants", () => {
    // Two branches rendering the SAME root cannot be told apart — variants are
    // identified by their root element alone — so the base anatomy is the whole
    // honest answer and no `$variants` key is written.
    const anatomy = buildScaffoldAnatomyVariants(
      [link("button"), link("button", "Send")],
      props(),
    )

    expect(anatomy.root.element).toBe("button")
    expect(Object.hasOwn(anatomy, "$variants")).toBe(false)
  })

  test("reports a branch it could not draft rather than dropping it", () => {
    const anatomy = buildScaffoldAnatomyVariants(
      [
        link("button"),
        link("a"),
        link("button", "Send"),
        { kind: "text", value: "bare" },
      ],
      props(),
    )

    expect(Object.keys(anatomy.$variants)).toEqual(["asA", "_scaffold"])
    // A second branch rooted at `button` would be ambiguous with the base, and
    // a text root has nothing to be told apart by at all. Both are named.
    expect(anatomy.$variants._scaffold.todo).toContain('"button"')
    expect(anatomy.$variants._scaffold.todo).toContain("an unnamed root")
  })

  test("keys a custom-component root by its name", () => {
    const anatomy = buildScaffoldAnatomyVariants(
      [link("button"), { kind: "component", name: "Link" }],
      props(),
    )

    expect(Object.keys(anatomy.$variants)).toEqual(["asLink"])
  })
})

// ---------------------------------------------------------------------------
// draftStyleProperty
// ---------------------------------------------------------------------------

// `draftStyleProperty` reads only `key`/`finestSlots`; `draftStyleProps` also
// reads `path`. Literal defs of exactly that shape keep each case's grammar
// visible in the case, and keep this suite about `spec/` — importing
// `modules/styles.mjs`'s `PROPERTY_DEFS` would let a `modules/` change fail a
// `spec/` test for reasons that have nothing to do with `spec/`.
const singleDef = (key, path) => ({ key, path, finestSlots: ["_value"] })
const EDGE_SLOTS = ["blockStart", "blockEnd", "inlineStart", "inlineEnd"]
const edgeDef = key => ({ key, path: [key], finestSlots: EDGE_SLOTS })

// The caller's var-name→token-id lookup, as a literal table.
const lookup =
  (table = {}) =>
  varName =>
    table[varName] || []

describe("draftStyleProperty", () => {
  test("drafts a literal as the schema's raw() escape hatch", () => {
    expect(
      draftStyleProperty(
        singleDef("background", ["background"]),
        { _value: { kind: "literal", value: "#fff" } },
        lookup(),
      ),
    ).toEqual({ value: "raw(#fff)", todo: null, tokenBindings: 0 })
  })

  test("drafts a var matching exactly one token as that binding (#261)", () => {
    expect(
      draftStyleProperty(
        singleDef("background", ["background"]),
        { _value: { kind: "var", varName: "color-surface" } },
        lookup({ "color-surface": ["color.surface"] }),
      ),
    ).toEqual({
      value: { token: "color.surface" },
      todo: null,
      tokenBindings: 1,
    })
  })

  test("leaves a var matching no token for a human", () => {
    const { value, todo, tokenBindings } = draftStyleProperty(
      singleDef("background", ["background"]),
      { _value: { kind: "var", varName: "brand-ink" } },
      lookup(),
    )

    expect(value).toBeUndefined()
    expect(tokenBindings).toBe(0)
    expect(todo).toContain("var(brand-ink)")
    expect(todo).toContain("is token-bound")
  })

  test("names every candidate when a var matches several tokens", () => {
    // Several tokens can legitimately share one CSS var (#191); guessing among
    // them is exactly the guess this module refuses everywhere else.
    const { value, todo } = draftStyleProperty(
      singleDef("background", ["background"]),
      { _value: { kind: "var", varName: "color-surface" } },
      lookup({ "color-surface": ["color.surface", "color.card"] }),
    )

    expect(value).toBeUndefined()
    expect(todo).toContain("matches multiple tokens")
    expect(todo).toContain("color.surface, color.card")
  })

  test("leaves a compound value for a human", () => {
    const { value, todo } = draftStyleProperty(
      singleDef("background", ["background"]),
      {
        _value: {
          kind: "compound",
          varNames: ["a"],
          raw: "1px solid var(--a)",
        },
      },
      lookup(),
    )

    expect(value).toBeUndefined()
    expect(todo).toContain("compound value")
  })

  test("reports nothing found as neither a value nor a todo", () => {
    expect(draftStyleProperty(edgeDef("padding"), {}, lookup())).toEqual({
      value: undefined,
      todo: null,
      tokenBindings: 0,
    })
  })

  test("keys a multi-slot grammar by its finest slots", () => {
    const { value, tokenBindings } = draftStyleProperty(
      edgeDef("padding"),
      {
        blockStart: { kind: "literal", value: "4px" },
        inlineEnd: { kind: "var", varName: "space-2" },
      },
      lookup({ "space-2": ["space.2"] }),
    )

    expect(value).toEqual({
      blockStart: "raw(4px)",
      inlineEnd: { token: "space.2" },
    })
    expect(tokenBindings).toBe(1)
  })

  test("is all-or-nothing: one unresolved slot discards the resolved ones", () => {
    // A partial grammar — one edge written as `raw()`, another silently absent
    // because it is token-bound — reads as "that edge has no styling", which is
    // a worse lie than writing nothing.
    const { value, todo } = draftStyleProperty(
      edgeDef("padding"),
      {
        blockStart: { kind: "literal", value: "4px" },
        inlineStart: { kind: "var", varName: "space-unmapped" },
      },
      lookup(),
    )

    expect(value).toBeUndefined()
    expect(todo).toContain("padding")
  })
})

// ---------------------------------------------------------------------------
// draftStyleProps
// ---------------------------------------------------------------------------

describe("draftStyleProps", () => {
  test("binds a resolvable var and leaves the unresolvable one marked", () => {
    // The `_scaffold: {todo: …}` marker itself is written by
    // `cli/commands/scaffold.mjs` from the `todos` this function returns —
    // `spec/` may not import `modules/`, so the todo text is as far as this
    // layer goes and is where the marker's content comes from.
    const defs = [
      singleDef("background", ["background"]),
      singleDef("color", ["color"]),
    ]
    const declared = {
      background: { _value: { kind: "var", varName: "color-surface" } },
      color: { _value: { kind: "var", varName: "brand-ink" } },
    }

    const {
      props: drafted,
      todos,
      tokenBindingCount,
    } = draftStyleProps(
      defs,
      def => declared[def.key],
      lookup({ "color-surface": ["color.surface"] }),
    )

    expect(drafted).toEqual({ background: { token: "color.surface" } })
    expect(Object.hasOwn(drafted, "color")).toBe(false)
    expect(todos).toHaveLength(1)
    expect(todos[0]).toContain("color (var(brand-ink))")
    expect(tokenBindingCount).toBe(1)
  })

  test("nests a grammar property under its schema path", () => {
    const { props: drafted } = draftStyleProps(
      [singleDef("border.width", ["border", "width"])],
      () => ({ _value: { kind: "literal", value: "1px" } }),
      lookup(),
    )

    expect(drafted).toEqual({ border: { width: "raw(1px)" } })
  })

  test("sums token bindings across every property", () => {
    const defs = [singleDef("background", ["background"]), edgeDef("padding")]
    const declared = {
      background: { _value: { kind: "var", varName: "color-surface" } },
      padding: {
        blockStart: { kind: "var", varName: "space-2" },
        blockEnd: { kind: "var", varName: "space-2" },
      },
    }

    const { todos, tokenBindingCount } = draftStyleProps(
      defs,
      def => declared[def.key],
      lookup({ "color-surface": ["color.surface"], "space-2": ["space.2"] }),
    )

    expect(todos).toEqual([])
    expect(tokenBindingCount).toBe(3)
  })

  test("skips a property the stylesheet does not declare at all", () => {
    const { props: drafted, todos } = draftStyleProps(
      [singleDef("background", ["background"])],
      () => ({}),
      lookup(),
    )

    expect(drafted).toEqual({})
    expect(todos).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// buildScaffoldContract
// ---------------------------------------------------------------------------

describe("buildScaffoldContract", () => {
  const base = {
    title: "Widget",
    id: "widget",
    codePath: "components/widget.tsx",
    props: [],
  }

  test("assembles a contract against the engine's own schema version", () => {
    const contract = buildScaffoldContract(base)

    expect(contract.$schema).toMatch(/contract\.schema\.json$/)
    expect(contract.schemaVersion).toBe(CONTRACT_SCHEMA_VERSION)
    expect(contract.id).toBe("widget")
    expect(contract.title).toBe("Widget")
    expect(contract.sources).toEqual({
      code: { path: "components/widget.tsx" },
    })
  })

  test("maps the census's props into the contract's prop vocabulary", () => {
    const contract = buildScaffoldContract({
      ...base,
      props: [
        {
          name: "size",
          type: "enum",
          values: ["sm", "lg"],
          default: "sm",
          required: false,
        },
        { name: "label", type: "string", required: true },
        { name: "disabled", type: "boolean", default: false },
      ],
    })

    expect(contract.props).toEqual({
      size: {
        type: "enum",
        values: ["sm", "lg"],
        default: "sm",
        required: false,
      },
      label: { type: "string", required: true },
      // `default: false` is a real default and survives; `required` is only
      // true when the census said exactly true, never merely truthy.
      disabled: { type: "boolean", default: false, required: false },
    })
  })

  test("records the style file whenever one censused cleanly", () => {
    const contract = buildScaffoldContract({
      ...base,
      stylesPath: "components/widget.module.css",
    })

    // Set independently of whether `styles` drafted any content, so a later
    // `audit --styles` reads the same file this scaffold run did.
    expect(contract.sources.code.styles).toBe("components/widget.module.css")
    expect(Object.hasOwn(contract, "styles")).toBe(false)
  })

  test("omits anatomy and styles entirely rather than placeholdering them", () => {
    const contract = buildScaffoldContract(base)

    expect(Object.hasOwn(contract, "anatomy")).toBe(false)
    expect(Object.hasOwn(contract, "styles")).toBe(false)
    // `sources.design` and `codegen` are omitted for the same reason: the
    // design provider already substitutes its own placeholder when
    // `sources.design` is absent, so a fake value here would be a second guess.
    expect(Object.hasOwn(contract.sources, "design")).toBe(false)
    expect(Object.hasOwn(contract, "codegen")).toBe(false)
  })

  test("carries an anatomy and a styles block through when given them", () => {
    const anatomy = buildScaffoldAnatomy(
      { kind: "element", tag: "div", children: [] },
      props(),
    )
    const styles = { base: { root: { background: "raw(#fff)" } } }
    const contract = buildScaffoldContract({ ...base, anatomy, styles })

    expect(contract.anatomy).toEqual({
      root: { type: "container", element: "div" },
    })
    expect(contract.styles).toEqual(styles)
  })
})
