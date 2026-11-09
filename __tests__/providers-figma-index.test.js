/**
 * providers-figma-index.test.js — `src/providers/figma/index.mjs` (ADR-001
 * D12, ADR-003 Phase 5.1): the Figma provider's 5-member interface plus the
 * addressing helpers `cli/commands/audit.mjs`/`gather.mjs`/`ingest.mjs`
 * reach through the loaded provider object.
 */

import * as figmaProvider from "../src/providers/figma/index.mjs"

describe("the D12 interface — required members", () => {
  it("name is the provider's own config key", () => {
    expect(figmaProvider.name).toBe("figma")
  })

  it("capabilities declares both components and tokens", () => {
    expect(figmaProvider.capabilities.components).toBe(true)
    expect(figmaProvider.capabilities.tokens).toBe(true)
  })

  it("sourceSchema blesses exactly {fileKey, nodeId}", () => {
    expect(figmaProvider.sourceSchema.required.sort()).toEqual([
      "fileKey",
      "nodeId",
    ])
    expect(figmaProvider.sourceSchema.additionalProperties).toBe(false)
  })

  it("censusComponents delegates to the raw->normalized transform", () => {
    const result = figmaProvider.censusComponents({
      fileKey: "abc",
      payload: [
        {
          name: "Field",
          nodeId: "1:1",
          type: "COMPONENT",
          properties: {},
        },
      ],
    })
    expect(result.components).toEqual([
      expect.objectContaining({ fileKey: "abc", nodeId: "1:1", name: "Field" }),
    ])
  })

  it("censusComponents handles a missing ctx without throwing", () => {
    expect(figmaProvider.censusComponents(undefined)).toEqual({
      components: [],
      skipped: 0,
      payloadValid: false,
    })
  })

  it("censusTokens delegates to the raw->normalized transform", () => {
    const result = figmaProvider.censusTokens({
      payload: { "fg/default": "#181818", "inset/md": 16 },
    })
    expect(result).toEqual({
      tokens: [
        { name: "fg/default", kind: "variable", value: "#181818" },
        { name: "inset/md", kind: "variable", value: "16" },
      ],
      skipped: 0,
      payloadValid: true,
    })
  })

  it("censusTokens handles a missing ctx without throwing", () => {
    expect(figmaProvider.censusTokens(undefined)).toEqual({
      tokens: [],
      skipped: 0,
      payloadValid: false,
    })
  })
})

describe("buildTokenGatherPlan (re-exported from agent/plan.mjs)", () => {
  it("builds the file-level structured plan (#380): variables + text styles per file key", () => {
    const plan = figmaProvider.buildTokenGatherPlan(
      ["abc:1:1"],
      "snapshots/raw",
    )
    expect(plan.provider).toBe("figma")
    expect(plan.tool).toBe("figma_get_variables")
    expect(plan.targets.map(t => [t.tool, t.outputPath])).toEqual([
      ["figma_get_variables", "snapshots/raw/abc-variables.json"],
      ["figma_get_text_styles", "snapshots/raw/abc-text-styles.json"],
    ])
    expect(typeof plan.planHash).toBe("string")
  })
})

describe("validateDesignTokens (re-exported from normalize.mjs)", () => {
  it("is the same validator normalize.mjs exports", () => {
    expect(figmaProvider.validateDesignTokens({ tokens: [] })).toEqual({
      valid: true,
      errors: [],
    })
  })
})

describe("designAddress", () => {
  it("resolves a well-formed {fileKey, nodeId} to a colon-normalized match key", () => {
    expect(
      figmaProvider.designAddress({ fileKey: "abc", nodeId: "10:20" }),
    ).toBe("abc:10:20")
  })

  it("normalizes a hyphenated nodeId to the same key a colon one produces", () => {
    expect(
      figmaProvider.designAddress({ fileKey: "abc", nodeId: "10-20" }),
    ).toBe(figmaProvider.designAddress({ fileKey: "abc", nodeId: "10:20" }))
  })

  it("returns null for undefined (no sources.design declared)", () => {
    expect(figmaProvider.designAddress(undefined)).toBeNull()
  })

  it("returns null for a shape that isn't {fileKey, nodeId}", () => {
    expect(figmaProvider.designAddress({ someProviderAddress: "x" })).toBeNull()
    expect(
      figmaProvider.designAddress("https://example.test/design"),
    ).toBeNull()
    expect(
      figmaProvider.designAddress({ fileKey: "abc", nodeId: "not-a-node-id" }),
    ).toBeNull()
  })

  it("returns null for an extra key, matching sourceSchema's additionalProperties:false exactly", () => {
    expect(
      figmaProvider.designAddress({
        fileKey: "abc",
        nodeId: "10:20",
        extra: "not allowed",
      }),
    ).toBeNull()
  })
})

describe("sourceFileKey", () => {
  it("resolves just the file key half of a well-formed address", () => {
    expect(
      figmaProvider.sourceFileKey({ fileKey: "abc", nodeId: "10:20" }),
    ).toBe("abc")
  })

  it("returns null when fileKey is missing or the source is unresolvable", () => {
    expect(figmaProvider.sourceFileKey(undefined)).toBeNull()
    expect(figmaProvider.sourceFileKey({ nodeId: "10:20" })).toBeNull()
    expect(figmaProvider.sourceFileKey("bare string")).toBeNull()
  })
})

describe("componentAddress", () => {
  it("produces the SAME match key designAddress produces for the equivalent contract address", () => {
    const component = { fileKey: "abc", nodeId: "10:20" }
    expect(figmaProvider.componentAddress(component)).toBe(
      figmaProvider.designAddress({ fileKey: "abc", nodeId: "10:20" }),
    )
  })
})

describe("buildGatherPlan (re-exported from agent/plan.mjs)", () => {
  it("builds a plan naming the confirmed-deterministic gather tool", () => {
    const plan = figmaProvider.buildGatherPlan(["abc"], "snapshots/raw")
    expect(plan.provider).toBe("figma")
    expect(plan.tool).toBe("list_file_components_for_code_connect")
    expect(plan.targets).toEqual([
      {
        fileKey: "abc",
        args: { fileKey: "abc" },
        outputPath: "snapshots/raw/abc.json",
      },
    ])
    expect(typeof plan.planHash).toBe("string")
  })
})

describe("validateDesignComponents (re-exported from normalize.mjs)", () => {
  it("is the same validator normalize.mjs exports", () => {
    expect(figmaProvider.validateDesignComponents({ components: [] })).toEqual({
      valid: true,
      errors: [],
    })
  })
})

describe("componentProps (re-exported from normalize.mjs, ADR-003 Phase 5.2)", () => {
  it("reduces a design census entry to the SAME {name, type, values?} shape a code component's props carries", () => {
    expect(
      figmaProvider.componentProps({
        variantProperties: { size: ["sm", "lg"] },
        propertyDefinitions: { "label#1:0": { type: "TEXT", name: "label" } },
      }),
    ).toEqual([
      { name: "label", type: "string" },
      { name: "size", type: "enum", values: ["sm", "lg"] },
    ])
  })
})

// ---------------------------------------------------------------------------
// ADR-003 Amendment 3's sixth member, built for Amendment 4 (#280).
// ---------------------------------------------------------------------------

describe("configSchema / validateDesignOptions — design.options", () => {
  it("accepts the three documented keys, and nothing else", () => {
    expect(
      figmaProvider.validateDesignOptions({
        tokenMap: { "fontWeight/bold": "base.fontWeight.bold", title: null },
        codeAuthoritativeGroups: ["system.print"],
        ignoreVariables: ["/^Gray /", "Special"],
        _comment: "documentary keys are fine",
      }),
    ).toEqual({ valid: true, errors: [] })
    const rejected = figmaProvider.validateDesignOptions({ tokenmap: {} })
    expect(rejected.valid).toBe(false)
    expect(rejected.errors.join(" ")).toMatch(/tokenmap|additional/)
  })

  it("an absent block is valid; a wrongly-typed value names its path", () => {
    expect(figmaProvider.validateDesignOptions(undefined).valid).toBe(true)
    const rejected = figmaProvider.validateDesignOptions({
      codeAuthoritativeGroups: "system.print",
    })
    expect(rejected.valid).toBe(false)
    expect(rejected.errors[0]).toContain("/codeAuthoritativeGroups")
  })

  it("configSchema is the same object validateDesignOptions enforces", () => {
    expect(Object.keys(figmaProvider.configSchema.properties).sort()).toEqual([
      "codeAuthoritativeGroups",
      "codeOnlyGroups",
      "ignoreVariables",
      "includePrivateComponents",
      "tokenMap",
      "units",
    ])
  })
})

describe("isPrivateComponent (issue #460)", () => {
  it("is the tool's own convention: a `.`- or `_`-prefixed name or path segment", () => {
    for (const name of [
      ".Header",
      "_helper",
      "Group / .Private",
      "Blocks / _internal / Thing",
      " .spaced",
    ]) {
      expect(figmaProvider.isPrivateComponent({ name })).toBe(true)
    }
    for (const name of ["Button", "Block / Contact", "a.b", "under_score"]) {
      expect(figmaProvider.isPrivateComponent({ name })).toBe(false)
    }
    expect(figmaProvider.isPrivateComponent({})).toBe(false)
  })
})

describe("censusUnit (issue #658)", () => {
  it("answers in the engine's own vocabulary from the entry's own type, so a snapshot from before `unit` existed answers the same way", () => {
    expect(figmaProvider.censusUnit({ type: "COMPONENT_SET" })).toBe(
      "variant-set",
    )
    expect(figmaProvider.censusUnit({ type: "COMPONENT" })).toBe("component")
    expect(figmaProvider.censusUnit({ type: "FRAME" })).toBeNull()
    expect(figmaProvider.censusUnit({})).toBeNull()
  })
})
