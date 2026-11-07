/**
 * providers-figma-plan.test.js — `src/providers/figma/agent/plan.mjs`
 * (ADR-003 Phase 5.1 components + Phase 5.3 tokens): the gather PLANs
 * `design-delta gather`/`gather --tokens` print. Never touches the network
 * — this is the "gather is a planner, not a fetcher" mechanism itself, so
 * every case here is pure input/output.
 */

import {
  buildBindingsGatherPlan,
  buildGatherPlan,
  buildTokenGatherPlan,
} from "../src/providers/figma/agent/plan.mjs"

describe("buildGatherPlan", () => {
  it("names the confirmed-deterministic gather tool (the spike's own choice)", () => {
    const plan = buildGatherPlan(["abc"], "snap/raw")
    expect(plan.tool).toBe("list_file_components_for_code_connect")
    expect(plan.provider).toBe("figma")
  })

  it("one target per file key, args carrying the same key, output path under rawDir", () => {
    const plan = buildGatherPlan(["abc", "def"], "snap/raw")
    expect(plan.targets).toEqual([
      {
        fileKey: "abc",
        args: { fileKey: "abc" },
        outputPath: "snap/raw/abc.json",
      },
      {
        fileKey: "def",
        args: { fileKey: "def" },
        outputPath: "snap/raw/def.json",
      },
    ])
  })

  it("deduplicates repeated file keys", () => {
    const plan = buildGatherPlan(["abc", "abc", "abc"], "snap/raw")
    expect(plan.targets).toHaveLength(1)
  })

  it("sorts targets by file key, independent of input order", () => {
    const a = buildGatherPlan(["zzz", "aaa", "mmm"], "snap/raw")
    const b = buildGatherPlan(["mmm", "zzz", "aaa"], "snap/raw")
    expect(a.targets.map(t => t.fileKey)).toEqual(["aaa", "mmm", "zzz"])
    expect(a).toEqual(b)
  })

  it("the vacuous zero-file-keys plan is still well-formed", () => {
    const plan = buildGatherPlan([], "snap/raw")
    expect(plan.targets).toEqual([])
    expect(typeof plan.planHash).toBe("string")
  })

  it("planHash is deterministic for the same inputs, and changes when targets change", () => {
    const a = buildGatherPlan(["abc"], "snap/raw")
    const b = buildGatherPlan(["abc"], "snap/raw")
    const c = buildGatherPlan(["def"], "snap/raw")
    expect(a.planHash).toBe(b.planHash)
    expect(a.planHash).not.toBe(c.planHash)
  })
})

describe("buildTokenGatherPlan (ADR-003 Phase 5.3; file-level since #380)", () => {
  it("names the structured variables tool, unlike the component plan's tool", () => {
    const plan = buildTokenGatherPlan(["abc:1:1"], "snap/raw")
    expect(plan.tool).toBe("figma_get_variables")
    expect(plan.provider).toBe("figma")
  })

  it("plans TWO file-level targets per file key — variables and text styles — never one per node", () => {
    const plan = buildTokenGatherPlan(["abc:1:1", "abc:9:9"], "snap/raw")
    expect(plan.targets).toEqual([
      {
        fileKey: "abc",
        tool: "figma_get_variables",
        args: {
          fileUrl: "https://www.figma.com/design/abc",
          format: "full",
          verbosity: "full",
          resolveAliases: true,
        },
        outputPath: "snap/raw/abc-variables.json",
      },
      {
        fileKey: "abc",
        tool: "figma_get_text_styles",
        args: { fileUrl: "https://www.figma.com/design/abc" },
        outputPath: "snap/raw/abc-text-styles.json",
      },
    ])
  })

  it("sorts file keys, independent of input order", () => {
    const a = buildTokenGatherPlan(["zzz:1:1", "abc:1:1"], "snap/raw")
    const b = buildTokenGatherPlan(["abc:1:1", "zzz:1:1"], "snap/raw")
    expect(a.targets.map(t => t.fileKey)).toEqual(["abc", "abc", "zzz", "zzz"])
    expect(a).toEqual(b)
  })

  it("the vacuous zero-address plan is still well-formed", () => {
    const plan = buildTokenGatherPlan([], "snap/raw")
    expect(plan.targets).toEqual([])
    expect(typeof plan.planHash).toBe("string")
  })

  it("planHash is deterministic for the same inputs, and changes when targets change", () => {
    const a = buildTokenGatherPlan(["abc:1:1"], "snap/raw")
    const b = buildTokenGatherPlan(["abc:1:1"], "snap/raw")
    const c = buildTokenGatherPlan(["def:2:2"], "snap/raw")
    expect(a.planHash).toBe(b.planHash)
    expect(a.planHash).not.toBe(c.planHash)
  })
})

describe("buildBindingsGatherPlan (issue #401, retargeted in #417)", () => {
  // Issue #417: the deep-component tool resolves ZERO names when the bound
  // variables are library imports — every real consumer's shape, measured
  // live twice. The plan targets in-plugin resolution instead: ONE
  // `figma_execute` per addressed FILE, carrying that file's node ids.
  it("plans one in-plugin execute target per FILE, carrying that file's node ids", () => {
    const plan = buildBindingsGatherPlan(
      ["zzz:3:4", "abc:1:2", "abc:1:2", "abc:5:6"],
      "snap/raw",
    )
    expect(plan.provider).toBe("figma")
    expect(plan.tool).toBe("figma_execute")
    expect(plan.targets).toHaveLength(2)
    expect(plan.targets.map(target => target.fileKey)).toEqual(["abc", "zzz"])
    expect(plan.targets[0]).toMatchObject({
      fileKey: "abc",
      nodeIds: ["1:2", "5:6"],
      tool: "figma_execute",
      fileUrl: "https://www.figma.com/design/abc",
      outputPath: "snap/raw/abc-bindings.json",
    })
    expect(plan.targets[1]).toMatchObject({
      fileKey: "zzz",
      nodeIds: ["3:4"],
      outputPath: "snap/raw/zzz-bindings.json",
    })
    expect(typeof plan.planHash).toBe("string")
  })

  it("no target names the deep-component tool that cannot resolve library names", () => {
    const plan = buildBindingsGatherPlan(["abc:1:2"], "snap/raw")
    expect(JSON.stringify(plan)).not.toContain(
      "figma_get_component_for_development_deep",
    )
  })

  it("each target's script carries its own node ids and resolves each bound id in-plugin", () => {
    const plan = buildBindingsGatherPlan(["abc:1:2", "abc:5:6"], "snap/raw")
    const { code } = plan.targets[0].args
    expect(typeof code).toBe("string")
    // The node ids the script iterates are the target's own, not every
    // address in the plan — one call per file, scoped to that file.
    expect(code).toContain('["1:2","5:6"]')
    // The measured difference: names come from resolving each bound id
    // inside the plugin, and an id that will not resolve is reported as
    // unresolved rather than passed off as a name.
    expect(code).toContain("figma.variables.getVariableByIdAsync")
    expect(code).toContain("unresolved")
    // `variantCombinations` (#403) still comes off the same pass.
    expect(code).toContain("COMPONENT_SET")
  })

  // Issue #462: the same walk returns its SHAPE, not only its size — the
  // tree `censusLayers` reads, which #417 dropped, leaving the design side of
  // the anatomy surface with no gather path at all. RUN, not grepped: the
  // script is a string this repo cannot typecheck, and the shape it returns
  // is the contract `ingest --bindings` merges.
  it("the script returns the layer tree it walks, and stops the tree at an INSTANCE", async () => {
    const { code } = buildBindingsGatherPlan(["abc:1:2"], "snap/raw").targets[0]
      .args
    const figma = {
      getNodeByIdAsync: async () => ({
        name: "Card",
        type: "COMPONENT",
        boundVariables: {},
        children: [
          {
            name: "Title",
            type: "TEXT",
            boundVariables: { fills: [{ id: "v1" }] },
          },
          {
            name: "Icon",
            type: "INSTANCE",
            boundVariables: {},
            // Walked for what it BINDS, but not returned as tree: an
            // instance's subtree is another component's contract.
            children: [
              {
                name: "Inner",
                type: "VECTOR",
                boundVariables: { fills: [{ id: "v2" }] },
              },
            ],
          },
        ],
      }),
      variables: {
        getVariableByIdAsync: async id => ({
          name: id === "v1" ? "fg/default" : "fg/muted",
        }),
      },
    }
    const AsyncFunction = Object.getPrototypeOf(
      async function () {},
    ).constructor
    const out = await new AsyncFunction("figma", code)(figma)

    expect(out["1:2"].layers).toEqual({
      name: "Card",
      type: "COMPONENT",
      children: [
        { name: "Title", type: "TEXT" },
        { name: "Icon", type: "INSTANCE" },
      ],
    })
    // What the walk already reported is unchanged — including the variable
    // bound INSIDE the instance, which the component still binds.
    expect(out["1:2"].usedVars).toEqual(["fg/default", "fg/muted"])
    expect(out["1:2"].nodes).toBe(4)
  })

  it("is deterministic — same addresses in any order, same planHash", () => {
    const a = buildBindingsGatherPlan(["a:1:2", "b:3:4"], "raw")
    const b = buildBindingsGatherPlan(["b:3:4", "a:1:2"], "raw")
    expect(a.planHash).toBe(b.planHash)
  })
})

// The script the plan ships runs inside Figma's plugin sandbox, so nothing in
// the engine's own run ever executes it — which is exactly how a collector
// that silently skipped a whole class of binding could ship green (#468). Run
// it here against a stubbed plugin API instead: the script is a plain string,
// and the two globals it touches (`figma.getNodeByIdAsync`,
// `figma.variables.getVariableByIdAsync`) are small enough to fake honestly.
const AsyncFunction = async function () {}.constructor

async function runBindingsScript({ nodeIds, nodes, variables }) {
  const [target] = buildBindingsGatherPlan(
    nodeIds.map(id => `KEY:${id}`),
    "raw",
  ).targets
  const figma = {
    getNodeByIdAsync: async id => nodes[id] ?? null,
    variables: {
      getVariableByIdAsync: async id =>
        variables[id] ? { name: variables[id] } : null,
    },
  }
  return new AsyncFunction("figma", target.args.code)(figma)
}

describe("the bindings script itself (issues #417, #468)", () => {
  it("collects a variable bound through a componentProperties MAP", async () => {
    // `boundVariables.componentProperties` is `{[propertyName]: alias}` — a
    // map with no `id` of its own. A collector that recognized only arrays
    // and `{id}` objects dropped every one of these, and dropped it silently.
    const out = await runBindingsScript({
      nodeIds: ["1:2"],
      nodes: {
        "1:2": {
          name: "Field",
          type: "COMPONENT",
          boundVariables: {
            componentProperties: {
              label: { type: "VARIABLE_ALIAS", id: "VariableID:1" },
              tone: { type: "VARIABLE_ALIAS", id: "VariableID:2" },
            },
          },
        },
      },
      variables: { "VariableID:1": "text/label", "VariableID:2": "color/tone" },
    })
    expect(out["1:2"].usedVars).toEqual(["color/tone", "text/label"])
    expect(out["1:2"].unresolved).toEqual([])
  })

  it("collects through an alias, an array of aliases, and nested children", async () => {
    const out = await runBindingsScript({
      nodeIds: ["1:2"],
      nodes: {
        "1:2": {
          name: "Field",
          type: "COMPONENT",
          boundVariables: { itemSpacing: { id: "VariableID:1" } },
          children: [
            {
              name: "bg",
              boundVariables: { fills: [{ id: "VariableID:2" }] },
            },
          ],
        },
      },
      variables: { "VariableID:1": "space/sm", "VariableID:2": "color/bg" },
    })
    expect(out["1:2"].usedVars).toEqual(["color/bg", "space/sm"])
    expect(out["1:2"].nodes).toBe(2)
  })

  it("walks HIDDEN nodes — a prop-toggled part still binds what it binds", async () => {
    const out = await runBindingsScript({
      nodeIds: ["1:2"],
      nodes: {
        "1:2": {
          name: "Field",
          type: "COMPONENT",
          boundVariables: {},
          children: [
            {
              name: "border",
              visible: false,
              boundVariables: { strokes: [{ id: "VariableID:1" }] },
            },
          ],
        },
      },
      variables: { "VariableID:1": "border/subtle" },
    })
    expect(out["1:2"].usedVars).toEqual(["border/subtle"])
  })

  it("reports an id it could not resolve as unresolved, never as a name", async () => {
    const out = await runBindingsScript({
      nodeIds: ["1:2"],
      nodes: {
        "1:2": {
          name: "Field",
          type: "COMPONENT",
          boundVariables: { fills: [{ id: "VariableID:missing" }] },
        },
      },
      variables: {},
    })
    expect(out["1:2"].usedVars).toEqual([])
    expect(out["1:2"].unresolved).toEqual(["VariableID:missing"])
  })

  it("returns a COMPONENT_SET's variant children, and nothing for a plain component", async () => {
    const out = await runBindingsScript({
      nodeIds: ["1:2", "3:4"],
      nodes: {
        "1:2": {
          name: "Field",
          type: "COMPONENT_SET",
          boundVariables: {},
          children: [{ name: "tone=neutral" }, { name: "tone=danger" }],
        },
        "3:4": { name: "Icon", type: "COMPONENT", boundVariables: {} },
      },
      variables: {},
    })
    expect(out["1:2"].variantChildren).toEqual(["tone=neutral", "tone=danger"])
    expect(out["3:4"].variantChildren).toBeUndefined()
  })

  it("reports a node it could not find rather than failing the whole call", async () => {
    const out = await runBindingsScript({
      nodeIds: ["1:2", "9:9"],
      nodes: {
        "1:2": { name: "Field", type: "COMPONENT", boundVariables: {} },
      },
      variables: {},
    })
    expect(out["9:9"]).toEqual({ error: "not found" })
    expect(out["1:2"].usedVars).toEqual([])
  })
})
