/**
 * providers-figma-normalize.test.js — `src/providers/figma/normalize.mjs`
 * (ADR-003 Phase 5.1): nodeId canonicalization and the raw → normalized
 * component census transform.
 *
 * The raw fixture shapes below are the REAL `list_file_components_for_
 * code_connect` response shape, confirmed live against a real Figma file
 * during this phase's own validation (docs/spikes/gather-determinism.md's
 * spike used the same tool) — not guessed at.
 */

import {
  censusComponentsFromRaw,
  censusTokensFromRaw,
  indexTokens,
  censusBindingsFromRaw,
  censusLayersFromRaw,
  componentProps,
  normalizeNodeId,
  nodeIdToUrlSegment,
  validateDesignComponents,
  validateDesignTokens,
} from "../src/providers/figma/normalize.mjs"
import { hashJson } from "../src/core/state.mjs"

describe("normalizeNodeId", () => {
  it("passes a colon-separated nodeId through unchanged", () => {
    expect(normalizeNodeId("41:250")).toBe("41:250")
  })

  it("canonicalizes a hyphen-separated nodeId to colon", () => {
    expect(normalizeNodeId("41-250")).toBe("41:250")
  })

  it("returns a non-matching string unchanged rather than guessing", () => {
    expect(normalizeNodeId("not-a-node-id")).toBe("not-a-node-id")
  })

  it("returns a non-string input unchanged (never throws)", () => {
    expect(normalizeNodeId(undefined)).toBeUndefined()
    expect(normalizeNodeId(null)).toBeNull()
  })
})

describe("nodeIdToUrlSegment", () => {
  it("converts a colon-separated nodeId to the hyphenated URL form", () => {
    expect(nodeIdToUrlSegment("41:250")).toBe("41-250")
  })

  it("is idempotent on an already-hyphenated nodeId", () => {
    expect(nodeIdToUrlSegment("41-250")).toBe("41-250")
  })
})

describe("censusComponentsFromRaw", () => {
  // The exact raw shape confirmed live against a real Figma file (this
  // phase's own validation) — a VARIANT property (Eyebrow/size), a BOOLEAN
  // and TEXT property (Chip), and a variant-less COMPONENT (no `properties`
  // at all is also valid — see the "bare COMPONENT" case below).
  const RAW_COMPONENT_SET = {
    name: "Eyebrow",
    nodeId: "41:250",
    type: "COMPONENT_SET",
    pageId: "1:37",
    pageName: "Eyebrow",
    hasVariants: true,
    properties: {
      size: {
        name: "size",
        type: "VARIANT",
        key: "size",
        variantOptions: ["lg", "sm"],
        defaultValue: "lg",
      },
    },
    childInstanceTags: [],
    instanceCount: 0,
    dependencies: [],
    assetKey: "578097e9b76869a67e572a1ce9729e49ec8a0b31",
  }

  const RAW_MIXED_PROPS = {
    name: "Chip",
    nodeId: "3100:0",
    type: "COMPONENT",
    pageId: "1:1",
    pageName: "Chip",
    hasVariants: false,
    properties: {
      icon: {
        name: "icon",
        type: "BOOLEAN",
        key: "icon#3100:0",
        defaultValue: false,
      },
      label: {
        name: "label",
        type: "TEXT",
        key: "label#4031:0",
        defaultValue: "Label",
      },
    },
    childInstanceTags: [],
    instanceCount: 5,
    dependencies: [],
    assetKey: "abc",
  }

  it("normalizes a COMPONENT_SET's VARIANT property into variantProperties", () => {
    const { components, skipped } = censusComponentsFromRaw("fileKeyA", [
      RAW_COMPONENT_SET,
    ])
    expect(skipped).toBe(0)
    expect(components).toEqual([
      expect.objectContaining({
        fileKey: "fileKeyA",
        nodeId: "41:250",
        name: "Eyebrow",
        type: "COMPONENT_SET",
        variantProperties: { size: ["lg", "sm"] },
      }),
    ])
    // propertyDefinitions is OMITTED, not an empty object, when nothing
    // non-variant exists — no null placeholder for "nothing here".
    expect(components[0].propertyDefinitions).toBeUndefined()
  })

  it("normalizes BOOLEAN/TEXT properties into propertyDefinitions, keyed by the raw `key`, carrying the human name alongside", () => {
    const { components } = censusComponentsFromRaw("fileKeyA", [
      RAW_MIXED_PROPS,
    ])
    expect(components[0].propertyDefinitions).toEqual({
      "icon#3100:0": { type: "BOOLEAN", name: "icon" },
      "label#4031:0": { type: "TEXT", name: "label" },
    })
    expect(components[0].variantProperties).toBeUndefined()
  })

  it("canonicalizes the raw nodeId to `:` form", () => {
    const { components } = censusComponentsFromRaw("fileKeyA", [
      { ...RAW_COMPONENT_SET, nodeId: "41-250" },
    ])
    expect(components[0].nodeId).toBe("41:250")
  })

  it("carries fileKey on the entry, not as a document-level field", () => {
    const { components } = censusComponentsFromRaw("acme123", [
      RAW_COMPONENT_SET,
    ])
    expect(components[0].fileKey).toBe("acme123")
  })

  it("skips a raw entry whose type isn't a census unit (a variant child, e.g.)", () => {
    const { components, skipped } = censusComponentsFromRaw("fileKeyA", [
      { ...RAW_COMPONENT_SET, type: "INSTANCE" },
    ])
    expect(components).toEqual([])
    expect(skipped).toBe(1)
  })

  it("skips a raw entry missing nodeId or name, never throws", () => {
    const { components, skipped } = censusComponentsFromRaw("fileKeyA", [
      { type: "COMPONENT_SET", nodeId: "1:1" }, // no name
      { type: "COMPONENT_SET", name: "NoNodeId" }, // no nodeId
    ])
    expect(components).toEqual([])
    expect(skipped).toBe(2)
  })

  it("skips a null or non-object property value in `properties`, never throws", () => {
    // A raw file is agent-written input on disk — a malformed `properties`
    // entry (`{"Size": null}`) must degrade like any other bad data, not
    // crash `ingest` with an unhandled TypeError.
    const { components } = censusComponentsFromRaw("fileKeyA", [
      {
        name: "Field",
        nodeId: "1:1",
        type: "COMPONENT",
        properties: { Size: null, Variant: "not an object" },
      },
    ])
    expect(components).toHaveLength(1)
    expect(components[0].propertyDefinitions).toBeUndefined()
    expect(components[0].variantProperties).toBeUndefined()
  })

  it("a bare COMPONENT with no `properties` at all normalizes cleanly", () => {
    const { components } = censusComponentsFromRaw("fileKeyA", [
      {
        name: "Icon",
        nodeId: "5:5",
        type: "COMPONENT",
        pageId: "1:1",
        pageName: "Icons",
        hasVariants: false,
        childInstanceTags: [],
        instanceCount: 0,
        dependencies: [],
        assetKey: "x",
      },
    ])
    expect(components).toHaveLength(1)
    expect(components[0].variantProperties).toBeUndefined()
    expect(components[0].propertyDefinitions).toBeUndefined()
  })

  it("a non-array payload is reported as payloadValid:false, never a silent empty census", () => {
    // A different case from a genuinely empty file: `payloadValid` lets the
    // caller (`ingest`) tell "checked, nothing there" apart from "couldn't
    // check this at all."
    expect(censusComponentsFromRaw("fileKeyA", null)).toEqual({
      components: [],
      skipped: 0,
      payloadValid: false,
    })
    expect(censusComponentsFromRaw("fileKeyA", undefined)).toEqual({
      components: [],
      skipped: 0,
      payloadValid: false,
    })
    expect(censusComponentsFromRaw("fileKeyA", { not: "an array" })).toEqual({
      components: [],
      skipped: 0,
      payloadValid: false,
    })
  })

  it("a valid, empty array payload is payloadValid:true — genuinely 'checked, nothing there'", () => {
    expect(censusComponentsFromRaw("fileKeyA", [])).toEqual({
      components: [],
      skipped: 0,
      payloadValid: true,
    })
  })

  it("says what kind of census unit each entry is, in the engine's own vocabulary (#658)", () => {
    const { components } = censusComponentsFromRaw("fileKeyA", [
      RAW_COMPONENT_SET,
      RAW_MIXED_PROPS,
    ])
    expect(components.map(c => [c.name, c.unit])).toEqual([
      ["Eyebrow", "variant-set"],
      ["Chip", "component"],
    ])
  })

  it("`unit` sits outside treeHash, so adding it moved no existing hash (#658)", () => {
    const [component] = censusComponentsFromRaw("fileKeyA", [
      RAW_COMPONENT_SET,
    ]).components
    const { unit, treeHash, ...record } = component
    expect(unit).toBe("variant-set")
    expect(treeHash).toBe(hashJson(record))
  })

  it("treeHash is deterministic across two runs over the same raw entry", () => {
    const a = censusComponentsFromRaw("fileKeyA", [RAW_COMPONENT_SET])
    const b = censusComponentsFromRaw("fileKeyA", [RAW_COMPONENT_SET])
    expect(a.components[0].treeHash).toBe(b.components[0].treeHash)
  })

  it("treeHash differs when the normalized record differs", () => {
    const a = censusComponentsFromRaw("fileKeyA", [RAW_COMPONENT_SET])
    const b = censusComponentsFromRaw("fileKeyB", [RAW_COMPONENT_SET])
    expect(a.components[0].treeHash).not.toBe(b.components[0].treeHash)
  })

  describe("componentProps (ADR-003 Phase 5.2)", () => {
    it("reduces a VARIANT property into an enum prop, and BOOLEAN/TEXT/SLOT into their contract-vocabulary equivalents", () => {
      const { components } = censusComponentsFromRaw("fileKeyA", [
        RAW_COMPONENT_SET,
      ])
      expect(componentProps(components[0])).toEqual([
        { name: "size", type: "enum", values: ["lg", "sm"] },
      ])
    })

    it("reduces propertyDefinitions by NAME, not the provider's opaque key", () => {
      const { components } = censusComponentsFromRaw("fileKeyA", [
        RAW_MIXED_PROPS,
      ])
      expect(componentProps(components[0])).toEqual([
        { name: "icon", type: "boolean" },
        { name: "label", type: "string" },
      ])
    })

    it("sorts by name, combining variant and non-variant props in one list", () => {
      const merged = componentProps({
        variantProperties: { size: ["sm", "lg"] },
        propertyDefinitions: {
          "icon#1": { type: "BOOLEAN", name: "icon" },
          "label#2": { type: "TEXT", name: "label" },
        },
      })
      expect(merged.map(p => p.name)).toEqual(["icon", "label", "size"])
    })

    it("returns an empty list for a component with neither field, never throws", () => {
      expect(componentProps({})).toEqual([])
      expect(componentProps(undefined)).toEqual([])
    })

    it("skips a propertyDefinitions entry with no name (a malformed/legacy record), rather than inventing one", () => {
      expect(
        componentProps({
          propertyDefinitions: { "x#1": { type: "TEXT" } },
        }),
      ).toEqual([])
    })

    it("skips a variantProperties entry whose value isn't an array, never throws", () => {
      // `variantProperties` is schema-typed as a bare `object` (schema/
      // design-components.schema.json), so a schema-valid snapshot can still
      // carry a non-array value here — degrade like any other malformed
      // entry, not a TypeError out of the `[...values]` spread.
      expect(componentProps({ variantProperties: { size: null } })).toEqual([])
    })
  })
})

describe("validateDesignComponents", () => {
  it("validates a well-formed snapshot", () => {
    expect(
      validateDesignComponents({
        components: [
          {
            fileKey: "a",
            nodeId: "1:1",
            name: "Field",
            type: "COMPONENT_SET",
            treeHash: "x",
          },
        ],
      }),
    ).toEqual({ valid: true, errors: [] })
  })

  it("validates the vacuous empty-components snapshot", () => {
    expect(validateDesignComponents({ components: [] })).toEqual({
      valid: true,
      errors: [],
    })
  })

  it("rejects a component missing a required field", () => {
    const { valid, errors } = validateDesignComponents({
      components: [{ nodeId: "1:1", name: "Field", type: "COMPONENT" }],
    })
    expect(valid).toBe(false)
    expect(errors.length).toBeGreaterThan(0)
  })

  it("rejects a document missing `components` entirely", () => {
    expect(validateDesignComponents({}).valid).toBe(false)
  })
})

describe("censusTokensFromRaw (ADR-003 Phase 5.3)", () => {
  // The exact raw shape confirmed live against a real Figma node in this
  // phase's own validation — a flat name -> value map, values always
  // strings even for what are semantically numbers.
  const RAW_PAYLOAD = {
    "fg/inverse/default": "#181818",
    "inset/md": "16",
    "letterSpacing/normal": "0",
  }

  it("normalizes a flat name/value map into designToken records", () => {
    expect(censusTokensFromRaw(RAW_PAYLOAD)).toEqual({
      tokens: [
        { name: "fg/inverse/default", kind: "variable", value: "#181818" },
        { name: "inset/md", kind: "variable", value: "16" },
        { name: "letterSpacing/normal", kind: "variable", value: "0" },
      ],
      skipped: 0,
      payloadValid: true,
    })
  })

  it("coerces a number or boolean value to a string", () => {
    expect(
      censusTokensFromRaw({ "spacing/md": 16, "flag/example": true }),
    ).toEqual({
      tokens: [
        { name: "spacing/md", kind: "variable", value: "16" },
        { name: "flag/example", kind: "variable", value: "true" },
      ],
      skipped: 0,
      payloadValid: true,
    })
  })

  it("skips an entry whose value is an object/array — not this tool's documented shape — never throws", () => {
    expect(
      censusTokensFromRaw({ "fg/default": "#111", "weird/nested": { a: 1 } }),
    ).toEqual({
      tokens: [{ name: "fg/default", kind: "variable", value: "#111" }],
      skipped: 1,
      payloadValid: true,
    })
  })

  it("skips an entry whose value is an empty string — an absent value, not a value (issue #347)", () => {
    // A gradient paint style has no single scalar this flat shape can carry
    // and comes back "". Persisting it wrote a row asserting nothing, which
    // `tokens/design-value-untracked` then reported as a value mismatch.
    expect(
      censusTokensFromRaw({
        "fg/default": "#111",
        "gradient/rainbow/default/dark": "",
        "gradient/rainbow/default/light": "   ",
      }),
    ).toEqual({
      tokens: [{ name: "fg/default", kind: "variable", value: "#111" }],
      skipped: 2,
      payloadValid: true,
    })
  })

  it("a valid, empty object payload is payloadValid:true — genuinely 'checked, nothing there'", () => {
    expect(censusTokensFromRaw({})).toEqual({
      tokens: [],
      skipped: 0,
      payloadValid: true,
    })
  })

  it("a non-object payload (array, null, scalar) is reported as payloadValid:false, never a silent empty census", () => {
    expect(censusTokensFromRaw([])).toEqual({
      tokens: [],
      skipped: 0,
      payloadValid: false,
    })
    expect(censusTokensFromRaw(null)).toEqual({
      tokens: [],
      skipped: 0,
      payloadValid: false,
    })
    expect(censusTokensFromRaw("not an object")).toEqual({
      tokens: [],
      skipped: 0,
      payloadValid: false,
    })
  })
})

describe("censusTokensFromRaw — structured payloads (#380)", () => {
  const VARIABLES = {
    data: {
      variables: [
        {
          id: "VariableID:1",
          name: "color/blue/300",
          resolvedType: "COLOR",
          valuesByMode: { "5:0": { r: 0.611, g: 0.752, b: 1, a: 1 } },
          variableCollectionId: "VariableCollectionId:9",
        },
        {
          id: "VariableID:2",
          name: "fg/default",
          resolvedType: "COLOR",
          valuesByMode: {
            "5:0": { type: "VARIABLE_ALIAS", id: "VariableID:1" },
            "5:1": { r: 0, g: 0, b: 0, a: 0.5 },
          },
          resolvedValuesByMode: { Light: { value: "#9CC0FF" } },
          variableCollectionId: "VariableCollectionId:9",
        },
        {
          id: "VariableID:3",
          name: "inset/md",
          resolvedType: "FLOAT",
          valuesByMode: { "5:0": 16.000000238 },
          variableCollectionId: "VariableCollectionId:9",
        },
        {
          id: "VariableID:4",
          name: "",
          resolvedType: "STRING",
          valuesByMode: {},
        },
      ],
      variableCollections: [
        {
          id: "VariableCollectionId:9",
          name: "theme",
          defaultModeId: "5:0",
          modes: [
            { modeId: "5:0", name: "Light" },
            { modeId: "5:1", name: "Dark" },
          ],
        },
      ],
    },
  }

  it("figma_get_variables: typed per-mode values by mode NAME, hex colors, rounded floats, alias by name, collection", () => {
    const { tokens, skipped, payloadValid } = censusTokensFromRaw(VARIABLES, {
      tool: "figma_get_variables",
    })
    expect(payloadValid).toBe(true)
    expect(skipped).toBe(1) // the nameless one
    expect(tokens).toEqual([
      {
        name: "color/blue/300",
        kind: "variable",
        value: "#9CC0FF",
        resolvedType: "COLOR",
        values: { Light: "#9CC0FF" },
        collection: "theme",
      },
      {
        name: "fg/default",
        kind: "variable",
        value: "#9CC0FF", // the default mode, resolved through the alias
        resolvedType: "COLOR",
        values: { Light: "#9CC0FF", Dark: "#00000080" },
        collection: "theme",
        aliasOf: "color/blue/300",
      },
      {
        name: "inset/md",
        kind: "variable",
        value: "16",
        resolvedType: "FLOAT",
        values: { Light: 16 },
        collection: "theme",
      },
    ])
  })

  it("a TIMING variable is rendered in its unit, seconds — the engine never sees the type (#447)", () => {
    const { tokens } = censusTokensFromRaw(
      {
        data: {
          variables: [
            {
              id: "VariableID:7",
              name: "duration/fast",
              resolvedType: "TIMING",
              valuesByMode: { "5:0": 0.15000000596 },
              variableCollectionId: "VariableCollectionId:9",
            },
          ],
          variableCollections: VARIABLES.data.variableCollections,
        },
      },
      { tool: "figma_get_variables" },
    )
    expect(tokens).toEqual([
      {
        name: "duration/fast",
        kind: "variable",
        value: "0.15s",
        resolvedType: "TIMING",
        values: { Light: "0.15s" },
        collection: "theme",
      },
    ])
  })

  it("figma_get_text_styles: unit-bearing structure alongside a rendered value", () => {
    const { tokens, payloadValid } = censusTokensFromRaw(
      {
        data: {
          styles: [
            {
              name: "h1",
              fontSize: 72,
              fontFamily: "Spectrum Sans",
              fontStyle: "ExtraBold",
              letterSpacing: { unit: "PIXELS", value: -1.600000023841858 },
              lineHeight: { unit: "PIXELS", value: 80 },
              textCase: "ORIGINAL",
              textDecoration: "NONE",
            },
          ],
        },
      },
      { tool: "figma_get_text_styles" },
    )
    expect(payloadValid).toBe(true)
    expect(tokens).toEqual([
      {
        name: "h1",
        kind: "textStyle",
        value:
          'Font(family: "Spectrum Sans", style: ExtraBold, size: 72, lineHeight: 80px, letterSpacing: -1.6px)',
        style: {
          fontFamily: "Spectrum Sans",
          fontStyle: "ExtraBold",
          fontSize: 72,
          lineHeight: { value: 80, unit: "PIXELS" },
          letterSpacing: { value: -1.6, unit: "PIXELS" },
          textCase: "ORIGINAL",
          textDecoration: "NONE",
        },
      },
    ])
  })

  it("dispatches on the payload's own shape when the envelope names no tool; a legacy flat map still works", () => {
    expect(censusTokensFromRaw(VARIABLES).tokens.map(t => t.kind)).toEqual([
      "variable",
      "variable",
      "variable",
    ])
    expect(censusTokensFromRaw({ "fg/default": "#111" })).toEqual({
      tokens: [{ name: "fg/default", kind: "variable", value: "#111" }],
      skipped: 0,
      payloadValid: true,
    })
  })

  it("every structured record validates against the snapshot schema", () => {
    const { tokens } = censusTokensFromRaw(VARIABLES, {
      tool: "figma_get_variables",
    })
    expect(validateDesignTokens({ tokens })).toEqual({
      valid: true,
      errors: [],
    })
  })
})

describe("validateDesignTokens", () => {
  it("validates a well-formed snapshot", () => {
    expect(
      validateDesignTokens({
        tokens: [{ name: "fg/default", value: "#111111" }],
      }),
    ).toEqual({ valid: true, errors: [] })
  })

  it("validates the vacuous empty-tokens snapshot", () => {
    expect(validateDesignTokens({ tokens: [] })).toEqual({
      valid: true,
      errors: [],
    })
  })

  it("rejects a token missing a required field", () => {
    const { valid, errors } = validateDesignTokens({
      tokens: [{ name: "fg/default" }],
    })
    expect(valid).toBe(false)
    expect(errors.length).toBeGreaterThan(0)
  })

  it("rejects a document missing `tokens` entirely", () => {
    expect(validateDesignTokens({}).valid).toBe(false)
  })
})

describe("censusBindingsFromRaw (issue #401)", () => {
  it("collects bound variable names anywhere in the tree — strings, {name} objects, arrays — deduplicated and sorted", () => {
    const result = censusBindingsFromRaw({
      id: "1:2",
      name: "Badge",
      children: [
        {
          boundVariables: {
            fills: [{ name: "color/bg" }],
            gap: "space/md",
          },
          children: [
            { boundVariables: { fills: [{ name: "color/bg" }] } },
            { boundVariables: { strokes: [{ name: "color/border" }] } },
          ],
        },
      ],
    })
    expect(result).toEqual({
      usedVars: ["color/bg", "color/border", "space/md"],
      variantCombinations: [],
      payloadValid: true,
    })
  })

  it("accepts a wrapper carrying the node under component/node/tree", () => {
    const result = censusBindingsFromRaw({
      component: { id: "1:2", boundVariables: { fills: "color/fg" } },
    })
    expect(result.usedVars).toEqual(["color/fg"])
  })

  it("a payload that is not a node tree is payloadValid: false, never a silent empty census", () => {
    expect(censusBindingsFromRaw("nope")).toEqual({
      usedVars: [],
      variantCombinations: [],
      payloadValid: false,
    })
    expect(censusBindingsFromRaw({ rows: [1, 2] })).toEqual({
      usedVars: [],
      variantCombinations: [],
      payloadValid: false,
    })
  })

  it("never collects an opaque variable id as a name — unresolved library bindings yield an empty census, not garbage", () => {
    // Measured live (2026-08-30): a components file consuming a library
    // resolves zero names; every binding arrives as {id: "VariableID:…"}
    // or a bare "VariableID:…" string.
    expect(
      censusBindingsFromRaw({
        id: "1:2",
        children: [
          {
            boundVariables: {
              fills: [{ type: "VARIABLE_ALIAS", id: "VariableID:abc/440:246" }],
              itemSpacing: { id: "VariableID:def/569:55" },
              gap: "VariableID:raw/1:1",
            },
          },
        ],
      }),
    ).toEqual({ usedVars: [], variantCombinations: [], payloadValid: true })
  })

  it("a valid tree binding nothing is a valid, empty census", () => {
    expect(censusBindingsFromRaw({ id: "1:2", children: [] })).toEqual({
      usedVars: [],
      variantCombinations: [],
      payloadValid: true,
    })
  })
})

describe("censusLayersFromRaw (issue #402)", () => {
  it("normalizes a deep-component tree into the engine's own node-type vocabulary", () => {
    const result = censusLayersFromRaw({
      id: "1:2",
      name: "Badge",
      type: "COMPONENT",
      children: [
        { id: "1:3", name: "Label", type: "TEXT" },
        {
          id: "1:4",
          name: "Icon Left",
          type: "FRAME",
          children: [{ id: "1:5", name: "Glyph", type: "VECTOR" }],
        },
      ],
    })
    expect(result).toEqual({
      payloadValid: true,
      layers: {
        name: "Badge",
        type: "container",
        children: [
          { name: "Label", type: "text" },
          {
            name: "Icon Left",
            type: "container",
            children: [{ name: "Glyph", type: "vector" }],
          },
        ],
      },
    })
  })

  it("an INSTANCE stops the walk — its subtree belongs to another component's contract", () => {
    const { layers } = censusLayersFromRaw({
      name: "Field",
      type: "FRAME",
      children: [
        {
          name: "Icon",
          type: "INSTANCE",
          children: [{ name: "Glyph", type: "VECTOR" }],
        },
      ],
    })
    expect(layers.children).toEqual([
      { name: "Icon", type: "instance", childrenResolved: false },
    ])
  })

  it("a node reporting no `children` at all is NOT KNOWN, never `carries none`", () => {
    const { layers } = censusLayersFromRaw({ name: "Badge", type: "FRAME" })
    expect(layers).toEqual({
      name: "Badge",
      type: "container",
      childrenResolved: false,
    })
    expect(
      censusLayersFromRaw({ name: "Badge", type: "FRAME", children: [] })
        .layers,
    ).toEqual({ name: "Badge", type: "container", children: [] })
  })

  it("a type this provider has no engine-side equivalent for is carried unclassified, never guessed", () => {
    const { layers } = censusLayersFromRaw({
      name: "Badge",
      type: "FRAME",
      children: [{ name: "Slice", type: "SLICE" }],
    })
    // Unclassified says nothing about whether the node can hold layers, so
    // its absent child list is NOT KNOWN — never "carries none".
    expect(layers.children).toEqual([
      { name: "Slice", childrenResolved: false },
    ])
  })

  it("a child with no usable name is dropped, and the parent says so", () => {
    const { layers } = censusLayersFromRaw({
      name: "Badge",
      type: "FRAME",
      children: [{ name: "Label", type: "TEXT" }, { type: "TEXT" }],
    })
    expect(layers).toEqual({
      name: "Badge",
      type: "container",
      children: [{ name: "Label", type: "text" }],
      childrenResolved: false,
    })
  })

  it("accepts the same wrappers the bindings census does", () => {
    expect(
      censusLayersFromRaw({ component: { name: "Badge", type: "FRAME" } })
        .layers.name,
    ).toBe("Badge")
  })

  it("a payload that is not a node tree is payloadValid: false, never a silent empty census", () => {
    expect(censusLayersFromRaw("nope")).toEqual({
      layers: null,
      payloadValid: false,
    })
    expect(censusLayersFromRaw({ rows: [1, 2] })).toEqual({
      layers: null,
      payloadValid: false,
    })
  })

  it("a tree whose root has no name yields no census, but the payload was still read", () => {
    expect(censusLayersFromRaw({ id: "1:2", children: [] })).toEqual({
      layers: null,
      payloadValid: true,
    })
  })

  it("the normalized tree validates as part of a design-components.json document", () => {
    const { layers } = censusLayersFromRaw({
      name: "Badge",
      type: "COMPONENT",
      children: [{ name: "Label", type: "TEXT" }],
    })
    const { valid, errors } = validateDesignComponents({
      components: [
        {
          fileKey: "ACME",
          nodeId: "1:2",
          name: "Badge",
          type: "COMPONENT",
          treeHash: "h",
          layers,
        },
      ],
    })
    expect(errors).toEqual([])
    expect(valid).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Variant COMBINATIONS off the same deep payload (issue #403). A component
// set's variant children carry the canonical `Prop=Value, Prop2=Value2` name —
// the one place the gather surface says which combinations the set actually
// enumerates, as opposed to `variantProperties`, which only says which options
// each property offers.
// ---------------------------------------------------------------------------

describe("censusBindingsFromRaw — variantCombinations (issue #403)", () => {
  it("parses each direct child's canonical variant name, deduplicated and sorted", () => {
    const result = censusBindingsFromRaw({
      id: "1:2",
      name: "Button",
      type: "COMPONENT_SET",
      children: [
        { id: "1:4", name: "size=lg, variant=ghost" },
        { id: "1:3", name: "size=sm, variant=solid" },
        // Figma tolerates spaces around either separator, and inside a value.
        { id: "1:5", name: "size = md , variant = ghost solid" },
        // The same combination reached twice is one combination.
        { id: "1:6", name: "size=sm, variant=solid" },
      ],
    })
    expect(result.variantCombinations).toEqual([
      { size: "lg", variant: "ghost" },
      { size: "md", variant: "ghost solid" },
      { size: "sm", variant: "solid" },
    ])
  })

  it("ignores a child whose name is not a variant assignment at all", () => {
    const result = censusBindingsFromRaw({
      id: "1:2",
      children: [{ name: "Label" }, { name: "size=sm" }, { name: "=" }],
    })
    expect(result.variantCombinations).toEqual([{ size: "sm" }])
  })

  it("reads only DIRECT children — a nested layer named like a variant is not a combination of this set", () => {
    const result = censusBindingsFromRaw({
      id: "1:2",
      children: [
        { name: "size=sm", children: [{ name: "state=hover" }] },
        { name: "Icon" },
      ],
    })
    expect(result.variantCombinations).toEqual([{ size: "sm" }])
  })

  it("a variant-less component yields an empty list, never a guessed one", () => {
    expect(
      censusBindingsFromRaw({ id: "1:2", name: "Badge", children: [] })
        .variantCombinations,
    ).toEqual([])
  })
})

// The shapes below are the LIVE ones, read out of the two connected Figma
// files (2026-09-17): a color variable whose alias has its opacity bound to a
// FLOAT variable stores `{color, opacity}` per mode, resolves to `null` in the
// tool's own `resolvedValuesByMode`, and both halves alias variables in
// ANOTHER file — by `VariableID:<that variable's key>/<local part>`, where the
// local part is not the target's own id.
describe("censusTokensFromRaw — a color alias with a bound opacity (#517)", () => {
  const WEB = {
    data: {
      variables: [
        {
          id: "VariableID:503:3",
          name: "bg/scrim/default",
          key: "d7a2d6a5e95ba0a3c73dccad2180f8c2dfcbb213",
          resolvedType: "COLOR",
          valuesByMode: {
            "1:0": {
              color: {
                type: "VARIABLE_ALIAS",
                id: "VariableID:84b565bff05faca753d0366c5621c39a55fd2fd0/3312:466",
              },
              opacity: { type: "VARIABLE_ALIAS", id: "VariableID:1034:2901" },
            },
          },
          resolvedValuesByMode: { dark: { value: null } },
          variableCollectionId: "VariableCollectionId:1:2",
        },
        {
          id: "VariableID:1034:2901",
          name: "opacity/scrim",
          key: "09be25cda8b773882fb89a476e7e05a4ff463f9d",
          resolvedType: "FLOAT",
          valuesByMode: {
            "440:2": {
              type: "VARIABLE_ALIAS",
              id: "VariableID:82ca732192b29b454c7196383741a16b89281d75/3263:143",
            },
          },
          variableCollectionId: "VariableCollectionId:440:10",
        },
      ],
      variableCollections: [
        {
          id: "VariableCollectionId:1:2",
          name: "theme",
          defaultModeId: "1:0",
          modes: [{ modeId: "1:0", name: "dark" }],
        },
        {
          id: "VariableCollectionId:440:10",
          name: "static",
          defaultModeId: "440:2",
          modes: [{ modeId: "440:2", name: "Mode 1" }],
        },
      ],
    },
  }

  const GLOBAL = {
    data: {
      variables: [
        {
          id: "VariableID:3312:14",
          name: "color/black/100",
          key: "84b565bff05faca753d0366c5621c39a55fd2fd0",
          resolvedType: "COLOR",
          valuesByMode: { "1785:2": { r: 0, g: 0, b: 0, a: 1 } },
          variableCollectionId: "VariableCollectionId:1785:1296",
        },
        {
          id: "VariableID:2121:380",
          name: "opacity/90",
          key: "82ca732192b29b454c7196383741a16b89281d75",
          resolvedType: "FLOAT",
          valuesByMode: { "1785:2": 90 },
          variableCollectionId: "VariableCollectionId:1785:1296",
        },
      ],
      variableCollections: [
        {
          id: "VariableCollectionId:1785:1296",
          name: "base",
          defaultModeId: "1785:2",
          modes: [{ modeId: "1785:2", name: "Value" }],
        },
      ],
    },
  }

  it("resolves the pair through the cross-file index: rgba value, color alias kept", () => {
    const index = indexTokens([{ payload: GLOBAL }, { payload: WEB }])
    const { tokens, unresolved } = censusTokensFromRaw(WEB, {
      tool: "figma_get_variables",
      index,
    })
    expect(unresolved).toBeUndefined()
    const scrim = tokens.find(token => token.name === "bg/scrim/default")
    expect(scrim).toEqual({
      name: "bg/scrim/default",
      kind: "variable",
      value: "#000000E6",
      resolvedType: "COLOR",
      values: { dark: "#000000E6" },
      collection: "theme",
      aliasOf: "color/black/100",
    })
    // The opacity variable itself resolves through the same index — it
    // aliases the global file's `opacity/90`, which the tool leaves null too.
    expect(tokens.find(token => token.name === "opacity/scrim").value).toBe(
      "90",
    )
  })

  it("never writes #NANNANNAN: an unresolvable half is skipped with a stated reason", () => {
    const index = indexTokens([{ payload: WEB }])
    const { tokens, unresolved } = censusTokensFromRaw(WEB, {
      tool: "figma_get_variables",
      index,
    })
    expect(tokens.map(token => token.name)).not.toContain("bg/scrim/default")
    expect(unresolved).toEqual([
      {
        name: "bg/scrim/default",
        reason: expect.stringContaining(
          "gather every file this one subscribes to",
        ),
      },
    ])
    expect(JSON.stringify(tokens)).not.toContain("NAN")
  })

  it("an opacity outside 0-100 resolves nothing rather than an invented alpha", () => {
    const payload = JSON.parse(JSON.stringify(WEB))
    payload.data.variables[0].valuesByMode["1:0"].opacity = 900
    payload.data.variables[0].valuesByMode["1:0"].color = {
      r: 0,
      g: 0,
      b: 0,
      a: 1,
    }
    const { tokens, unresolved } = censusTokensFromRaw(payload, {
      tool: "figma_get_variables",
      index: indexTokens([{ payload }]),
    })
    expect(tokens.map(token => token.name)).not.toContain("bg/scrim/default")
    expect(unresolved).toHaveLength(1)
  })

  it("a bare local id never resolves against ANOTHER file's variable of the same id", () => {
    // Measured against a real project: variable ids are unique per FILE, so
    // indexing bare ids across files made `fontSize/26`'s local alias resolve
    // to an unrelated `borderWidth/2` in the other gathered file. Only the
    // `<key>/…` form a subscribed library alias carries crosses files.
    const fileA = {
      data: {
        variables: [
          {
            id: "VariableID:1:1",
            name: "fontSize/26",
            key: "aaaa",
            resolvedType: "FLOAT",
            valuesByMode: {
              "1:0": { type: "VARIABLE_ALIAS", id: "VariableID:9:9" },
            },
            variableCollectionId: "VariableCollectionId:1",
          },
        ],
        variableCollections: [
          {
            id: "VariableCollectionId:1",
            name: "base",
            defaultModeId: "1:0",
            modes: [{ modeId: "1:0", name: "Value" }],
          },
        ],
      },
    }
    const fileB = {
      data: {
        variables: [
          {
            id: "VariableID:9:9",
            name: "borderWidth/2",
            key: "bbbb",
            resolvedType: "FLOAT",
            valuesByMode: { "2:0": 2 },
            variableCollectionId: "VariableCollectionId:2",
          },
        ],
        variableCollections: [
          {
            id: "VariableCollectionId:2",
            name: "base",
            defaultModeId: "2:0",
            modes: [{ modeId: "2:0", name: "Value" }],
          },
        ],
      },
    }
    const { tokens } = censusTokensFromRaw(fileA, {
      tool: "figma_get_variables",
      index: indexTokens([{ payload: fileA }, { payload: fileB }]),
    })
    // Unresolved, exactly as before the index existed — never the other
    // file's unrelated variable.
    expect(tokens.map(token => token.name)).not.toContain("borderWidth/2")
    expect(tokens[0]?.aliasOf).not.toBe("borderWidth/2")
  })

  it("a literal color with a literal opacity needs no index at all", () => {
    const payload = JSON.parse(JSON.stringify(WEB))
    payload.data.variables[0].valuesByMode["1:0"] = {
      color: { r: 1, g: 0, b: 0, a: 1 },
      opacity: 50,
    }
    const { tokens } = censusTokensFromRaw(payload, {
      tool: "figma_get_variables",
    })
    expect(tokens.find(token => token.name === "bg/scrim/default").value).toBe(
      "#FF000080",
    )
  })
})
