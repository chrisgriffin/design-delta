/**
 * spec-contracts.test.js — `src/spec/contracts.mjs` (ADR-001 Phase 1, issue
 * #89): the contract loader, its schema + SEMANTIC validation, and the reduced
 * API view the checkers consume.
 *
 * The semantic rules are the point of this suite. A JSON Schema can say each
 * piece of a contract is well-formed; only these can say the pieces agree with
 * each other — `styles` naming an element `anatomy` never declared, a cycle in
 * the anatomy tree, an enum prop defaulting outside its own values. Each rule
 * gets its own case, driven end-to-end through `loadContract` against a real
 * file, because "does it reject" is only meaningful at the boundary a consumer
 * actually calls.
 *
 * Every fixture here is in-repo and generically named. The engine is
 * consumer-agnostic by charter (CLAUDE.md) and that applies to its tests as
 * much as to its defaults: a suite that reaches into a particular checkout, or
 * asserts a particular design system's component names, bakes one consumer
 * into the engine and can only ever pass on one machine.
 */

import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { basename, dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import { hashJson } from "../src/core/state.mjs"
import {
  CONTRACT_SCHEMA_FILE,
  CONTRACT_SCHEMA_VERSION,
  checkContractSemantics,
  contractApiView,
  findContractFiles,
  loadContract,
  loadContracts,
  stripCommentKeys,
} from "../src/spec/contracts.mjs"

const TEST_DIR = dirname(fileURLToPath(import.meta.url))
const FIXTURES = join(TEST_DIR, "fixtures", "contracts")
const VALID_DIR = join(FIXTURES, "valid")
const INVALID_DIR = join(FIXTURES, "invalid")

// A minimal, internally-consistent contract every semantic case mutates one
// way. Deliberately small: each case should differ from valid in exactly one
// respect, so a failure names one rule.
const BASE = Object.freeze({
  id: "widget",
  title: "Widget",
  props: {
    size: { type: "enum", values: ["sm", "lg"], default: "sm" },
    label: { type: "string" },
  },
  anatomy: {
    root: { type: "container", element: "div", children: ["label"] },
    label: { type: "text", content: { $prop: "label" } },
  },
  styles: {
    root: { base: { color: { token: "system.color.text.primary" } } },
  },
})

let workDir

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), "design-delta-contracts-"))
})

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true })
})

function writeFile(path, content) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
  return path
}

/** Serialize a contract object to a temp file and load it back. */
function loadInline(doc, { ext = ".contract.json", name = "widget" } = {}) {
  const body = JSON.stringify(doc, null, 2)
  return loadContract(writeFile(join(workDir, `${name}${ext}`), body))
}

/** Load a one-off mutation of BASE and return its diagnostic codes. */
function codesFor(mutate) {
  const doc = structuredClone(BASE)
  mutate(doc)
  const result = loadInline(doc)
  expect(result.ok).toBe(false)
  expect(result.contract).toBeNull()
  return result.diagnostics.map(d => d.code)
}

/** Every key in a nested structure, flattened — used to prove `_` stripping. */
function allKeys(value, out = []) {
  if (Array.isArray(value)) {
    for (const item of value) allKeys(item, out)
  } else if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      out.push(key)
      allKeys(child, out)
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// The happy path
// ---------------------------------------------------------------------------

describe("loadContract — a valid contract", () => {
  it("loads the JSON fixture with no diagnostics", () => {
    const result = loadContract(join(VALID_DIR, "sample-button.contract.json"))
    expect(result.diagnostics).toEqual([])
    expect(result.ok).toBe(true)
    expect(result.contract.id).toBe("sample-button")
    expect(result.contract.title).toBe("SampleButton")
  })

  it("loads a nested contract with no diagnostics", () => {
    const result = loadContract(
      join(VALID_DIR, "nested", "sample-card.contract.json"),
    )
    expect(result.diagnostics).toEqual([])
    expect(result.ok).toBe(true)
    expect(result.contract.id).toBe("sample-card")
  })

  it("keeps the design source opaque, whatever shape it has (D12)", () => {
    // The core schema must never learn one design tool's addressing vocabulary,
    // so any object at all has to survive here.
    const doc = structuredClone(BASE)
    doc.sources = {
      code: { path: "components/widget/widget.tsx" },
      design: { whatever: { a: 1 }, nested: ["anything"] },
    }
    const result = loadInline(doc)
    expect(result.ok).toBe(true)
    expect(result.contract.sources.design).toEqual({
      whatever: { a: 1 },
      nested: ["anything"],
    })
  })
})

// ---------------------------------------------------------------------------
// `_` comment keys: validated, then stripped
// ---------------------------------------------------------------------------

describe("`^_` comment keys", () => {
  it("are present in the fixture on disk but absent from the loaded contract", () => {
    const file = join(VALID_DIR, "sample-button.contract.json")
    expect(readFileSync(file, "utf8")).toContain('"_note"')

    const { contract } = loadContract(file)
    expect(allKeys(contract).filter(key => key.startsWith("_"))).toEqual([])
  })

  it("survive validation — a contract carrying them is still valid", () => {
    const doc = structuredClone(BASE)
    doc._why = "top level"
    doc.anatomy.root._why = "on an anatomy node"
    doc.styles.root._why = "on an element's styles"
    doc.props.size._why = "on a prop"
    const result = loadInline(doc)
    expect(result.diagnostics).toEqual([])
    expect(result.ok).toBe(true)
  })

  it("stripCommentKeys never mutates its argument", () => {
    const input = {
      keep: 1,
      _drop: 2,
      nested: { _drop: 3, keep: [{ _drop: 4 }] },
    }
    const output = stripCommentKeys(input)
    expect(output).toEqual({ keep: 1, nested: { keep: [{}] } })
    expect(input._drop).toBe(2)
  })
})

// ---------------------------------------------------------------------------
// `_scaffold` markers survive the stripping, on the RESULT (issue #350)
// ---------------------------------------------------------------------------

describe("`_scaffold` markers", () => {
  it("are reported as JSON Pointers even though the loaded contract has none", () => {
    const doc = structuredClone(BASE)
    doc.props.size._scaffold = { todo: "confirm the values" }
    doc.anatomy.root._scaffold = { todo: "confirm the element" }

    const result = loadInline(doc)
    expect(result.ok).toBe(true)
    expect(result.scaffoldMarkers).toEqual([
      "/anatomy/root/_scaffold",
      "/props/size/_scaffold",
    ])
    // The contract itself is stripped, as always — the markers are a
    // SEPARATE channel precisely because it is.
    expect(allKeys(result.contract).filter(k => k.startsWith("_"))).toEqual([])
  })

  it("are an empty list for a contract that carries none", () => {
    expect(loadInline(structuredClone(BASE)).scaffoldMarkers).toEqual([])
  })

  it("ride along on every loadContracts entry", () => {
    const doc = structuredClone(BASE)
    doc.props.label._scaffold = { todo: "confirm the type" }
    writeFile(
      join(workDir, "contracts", "widget.contract.json"),
      JSON.stringify(doc, null, 2),
    )
    const { contracts } = loadContracts(
      { paths: { contractsDir: join(workDir, "contracts") } },
      { root: workDir },
    )
    expect(contracts).toHaveLength(1)
    expect(contracts[0].scaffoldMarkers).toEqual(["/props/label/_scaffold"])
  })
})

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Schema validation
// ---------------------------------------------------------------------------

describe("schema validation", () => {
  it("resolves the schema from the PACKAGE root, not the cwd", () => {
    // The engine ships inside a consumer's node_modules; a cwd-relative path
    // would only ever resolve when the audited project happened to BE this repo.
    expect(
      CONTRACT_SCHEMA_FILE.endsWith(join("schema", "contract.schema.json")),
    ).toBe(true)
    expect(JSON.parse(readFileSync(CONTRACT_SCHEMA_FILE, "utf8")).title).toBe(
      "design-delta component contract",
    )
  })

  it("rejects a missing required field with a named diagnostic", () => {
    const doc = structuredClone(BASE)
    delete doc.title
    const result = loadInline(doc)
    expect(result.ok).toBe(false)
    expect(result.diagnostics[0].code).toBe("schema-violation")
    expect(result.diagnostics[0].message).toContain("title")
  })

  it("rejects an unknown key and says which keys are allowed", () => {
    const doc = structuredClone(BASE)
    doc.notAThing = true
    const [diagnostic] = loadInline(doc).diagnostics
    expect(diagnostic.code).toBe("schema-violation")
    expect(diagnostic.message).toContain("unknown key 'notAThing'")
    expect(diagnostic.message).toContain("allowed:")
  })

  it("rejects a non-enum prop that declares `values`, naming the key", () => {
    const doc = structuredClone(BASE)
    doc.props.label = { type: "string", values: ["a"] }
    const messages = loadInline(doc).diagnostics.map(d => d.message)
    expect(messages.some(m => m.includes("'values'"))).toBe(true)
  })

  it("accepts a design deviation carrying a mechanism, with or without a reason (issue #439)", () => {
    const doc = structuredClone(BASE)
    doc.props.label.design = {
      name: "Label",
      mechanism: "text",
    }
    doc.props.size.design = {
      name: "Size",
      mechanism: "toggle",
      reason: "the design side hides the region with a boolean",
    }
    expect(loadInline(doc).ok).toBe(true)
  })

  it("rejects a mechanism outside the closed vocabulary", () => {
    const doc = structuredClone(BASE)
    doc.props.label.design = { name: "Label", mechanism: "swatch" }
    const result = loadInline(doc)
    expect(result.ok).toBe(false)
    expect(result.diagnostics[0].code).toBe("schema-violation")
  })

  it("still requires a reason on a rename that declares no mechanism", () => {
    const doc = structuredClone(BASE)
    doc.props.label.design = { name: "Label" }
    expect(loadInline(doc).ok).toBe(false)
  })

  it("accepts gates on a toggle, and nowhere else (issue #485)", () => {
    const withGates = design => {
      const doc = structuredClone(BASE)
      doc.props.label = { type: "slot", design }
      return loadInline(doc).ok
    }
    expect(
      withGates({ name: "hasLabel", mechanism: "toggle", gates: "label" }),
    ).toBe(true)
    expect(
      withGates({ name: "Label", mechanism: "text", gates: "label" }),
    ).toBe(false)
    expect(
      withGates({ name: "Label", reason: "renamed", gates: "label" }),
    ).toBe(false)
    expect(
      withGates({ name: "hasLabel", mechanism: "toggle", gates: "" }),
    ).toBe(false)
  })

  // Issue #503: `gates` names a design SLOT, and codegen renders the toggle's
  // true branch as `figma.instance(<gates>)`. On a `string`- or `boolean`-typed
  // code prop that hands a component instance to a prop that takes neither, so
  // the pairing is refused at load rather than bound wrongly.
  it("rejects gates on a prop whose type is not slot (issue #503)", () => {
    const gated = type => {
      const doc = structuredClone(BASE)
      doc.props.label = {
        type,
        design: { name: "hasLabel", mechanism: "toggle", gates: "label" },
      }
      return loadInline(doc)
    }
    expect(gated("slot").ok).toBe(true)
    for (const type of ["string", "boolean"]) {
      const result = gated(type)
      expect(result.ok).toBe(false)
      expect(result.diagnostics[0].code).toBe("schema-violation")
      expect(result.diagnostics[0].path).toBe("props.label.type")
    }
  })

  it("rejects an id that is not kebab-case", () => {
    const doc = structuredClone(BASE)
    doc.id = "Widget_Thing"
    const [diagnostic] = loadInline(doc).diagnostics
    expect(diagnostic.code).toBe("schema-violation")
    expect(diagnostic.path).toBe("id")
  })

  it("does not run the semantic checks on a schema-invalid document", () => {
    // Otherwise one structural mistake reports twice, in two vocabularies.
    const doc = structuredClone(BASE)
    doc.id = "Widget_Thing"
    doc.styles.ghost = { base: { color: { token: "system.color.text.a" } } }
    const codes = new Set(loadInline(doc).diagnostics.map(d => d.code))
    expect([...codes]).toEqual(["schema-violation"])
  })
})

// ---------------------------------------------------------------------------
// Semantic validation — one case per rule
// ---------------------------------------------------------------------------

describe("schemaVersion — the contract-schema version gate (#365)", () => {
  it("the engine's version is the schema's own top-level `version`", () => {
    expect(CONTRACT_SCHEMA_VERSION).toBe(
      JSON.parse(readFileSync(CONTRACT_SCHEMA_FILE, "utf8")).version,
    )
    expect(Number.isInteger(CONTRACT_SCHEMA_VERSION)).toBe(true)
  })

  it("absent means current — an unannotated contract loads unchanged", () => {
    expect(loadInline(structuredClone(BASE)).ok).toBe(true)
  })

  it("the current version is accepted and kept on the loaded contract", () => {
    const result = loadInline({
      ...BASE,
      schemaVersion: CONTRACT_SCHEMA_VERSION,
    })
    expect(result.ok).toBe(true)
    expect(result.contract.schemaVersion).toBe(CONTRACT_SCHEMA_VERSION)
  })

  it("a NEWER version is refused before validation, naming both versions", () => {
    // The extra key would otherwise surface as "unknown key" — the wrong
    // diagnosis for "upgrade the engine".
    const result = loadInline({
      ...BASE,
      schemaVersion: CONTRACT_SCHEMA_VERSION + 1,
      fieldFromTheFuture: true,
    })
    expect(result.ok).toBe(false)
    expect(result.diagnostics).toHaveLength(1)
    expect(result.diagnostics[0]).toEqual(
      expect.objectContaining({
        code: "contract-schema-newer",
        contractId: "widget",
        path: "schemaVersion",
      }),
    )
    expect(result.diagnostics[0].message).toContain(
      `v${CONTRACT_SCHEMA_VERSION + 1}`,
    )
    expect(result.diagnostics[0].message).toContain(
      `reads v${CONTRACT_SCHEMA_VERSION}`,
    )
  })

  it("an OLDER version that still validates says nothing — the change was additive", () => {
    // v0 never existed; it stands in for "any earlier version" here.
    expect(loadInline({ ...BASE, schemaVersion: 0 }).ok).toBe(true)
  })

  it("an OLDER version that no longer validates is stale, not malformed — said once, alongside the errors", () => {
    const result = loadInline({ ...BASE, schemaVersion: 0, notAThing: true })
    expect(result.ok).toBe(false)
    const codes = result.diagnostics.map(d => d.code)
    expect(codes.filter(c => c === "contract-schema-outdated")).toHaveLength(1)
    expect(codes).toContain("schema-violation")
    const outdated = result.diagnostics.find(
      d => d.code === "contract-schema-outdated",
    )
    expect(outdated.message).toContain("v0")
    expect(outdated.message).toContain(`reads v${CONTRACT_SCHEMA_VERSION}`)
  })

  it("a non-integer version falls through to the schema's own type error", () => {
    const codes = codesFor(doc => {
      doc.schemaVersion = "1"
    })
    expect(codes).toEqual(["schema-violation"])
  })
})

// ---------------------------------------------------------------------------
// intent.verifiedAgainst (#366) — the schema may only accept what the rule can
// actually match.
// ---------------------------------------------------------------------------

describe("intent.verifiedAgainst — the full digest, nothing shorter", () => {
  // The pattern first shipped as `^[0-9a-f]{8,64}$`, which accepted any
  // truncated prefix. `modules/components.mjs` compares `verifiedAgainst` to
  // `hashJson(component.props)` — a full sha256 — by strict equality, so every
  // accepted value shorter than 64 was permanently `components/intent-stale`:
  // valid to the schema, unclearable by the author, and the authoring guide's
  // own example was one. A schema that admits a value no rule can ever satisfy
  // is exactly the dishonest output this engine exists to avoid, so the
  // narrower pattern is the guard and this is what pins it.
  const withVerifiedAgainst = value => {
    const doc = structuredClone(BASE)
    doc.intent = {
      usedFor: "one primary action per view",
      verifiedAgainst: value,
    }
    return doc
  }
  const fullHash = hashJson([{ name: "label", type: "string", required: true }])

  it("accepts a full 64-character digest", () => {
    expect(fullHash).toHaveLength(64)
    expect(loadInline(withVerifiedAgainst(fullHash)).ok).toBe(true)
  })

  it("rejects a truncated prefix, which the staleness check could never match", () => {
    for (const short of [fullHash.slice(0, 8), fullHash.slice(0, 40), "abc"]) {
      const result = loadInline(withVerifiedAgainst(short))
      expect(result.ok).toBe(false)
      expect(result.diagnostics.map(d => d.code)).toContain("schema-violation")
    }
  })

  it("rejects a non-hex or over-long value", () => {
    for (const bad of [
      fullHash.toUpperCase(),
      `${fullHash}0`,
      `${fullHash.slice(0, 63)}z`,
    ]) {
      expect(loadInline(withVerifiedAgainst(bad)).ok).toBe(false)
    }
  })

  it("an intent block with no verifiedAgainst is still valid — that is a finding, not a schema error", () => {
    const doc = structuredClone(BASE)
    doc.intent = { usedFor: "one primary action per view" }
    expect(loadInline(doc).ok).toBe(true)
  })
})

describe("semantic validation — cross-references JSON Schema cannot express", () => {
  it("every styles key names an element declared in anatomy", () => {
    const doc = structuredClone(BASE)
    doc.styles.ghost = { base: { color: { token: "system.color.text.a" } } }
    const result = loadInline(doc)
    const [diagnostic] = result.diagnostics.filter(
      d => d.code === "unknown-style-element",
    )
    expect(diagnostic.path).toBe("styles.ghost")
    expect(diagnostic.contractId).toBe("widget")
    expect(diagnostic.message).toContain('"ghost"')
    expect(diagnostic.message).toContain("label, root")
  })

  it("every child name exists in anatomy", () => {
    const codes = codesFor(doc => doc.anatomy.root.children.push("ghost"))
    expect(codes).toContain("unknown-anatomy-child")
  })

  it("names the offending child by index", () => {
    const doc = structuredClone(BASE)
    doc.anatomy.root.children.push("ghost")
    const [diagnostic] = loadInline(doc).diagnostics.filter(
      d => d.code === "unknown-anatomy-child",
    )
    expect(diagnostic.path).toBe("anatomy.root.children[1]")
  })

  it("rejects a cycle in the anatomy tree", () => {
    const doc = structuredClone(BASE)
    doc.anatomy.label.children = ["root"]
    const result = loadInline(doc)
    const [diagnostic] = result.diagnostics.filter(
      d => d.code === "anatomy-cycle",
    )
    expect(diagnostic.message).toContain("label -> root -> label")
  })

  it("rejects a self-referencing node", () => {
    const codes = codesFor(doc => {
      doc.anatomy.label.children = ["label"]
    })
    expect(codes).toContain("anatomy-cycle")
  })

  it("reports one cycle once, not once per entry point", () => {
    const doc = structuredClone(BASE)
    doc.anatomy.label.children = ["root"]
    const cycles = loadInline(doc).diagnostics.filter(
      d => d.code === "anatomy-cycle",
    )
    expect(cycles).toHaveLength(1)
  })

  it("rejects a node unreachable from root", () => {
    const doc = structuredClone(BASE)
    doc.anatomy.stray = { type: "text" }
    const [diagnostic] = loadInline(doc).diagnostics.filter(
      d => d.code === "unreachable-anatomy-node",
    )
    expect(diagnostic.path).toBe("anatomy.stray")
    expect(diagnostic.message).toContain("unreachable")
  })

  it("rejects an anatomy with no root at all", () => {
    const doc = structuredClone(BASE)
    doc.anatomy = { header: { type: "container" } }
    doc.styles = {
      header: { base: { color: { token: "system.color.text.a" } } },
    }
    const codes = loadInline(doc).diagnostics.map(d => d.code)
    expect(codes).toContain("missing-anatomy-root")
    // …and does NOT then also report every node as unreachable, which would be
    // one mistake reported N+1 times.
    expect(codes).not.toContain("unreachable-anatomy-node")
  })

  it("every content {$prop: X} names a declared prop", () => {
    const doc = structuredClone(BASE)
    doc.anatomy.label.content = { $prop: "ghost" }
    const [diagnostic] = loadInline(doc).diagnostics.filter(
      d => d.code === "unknown-content-prop",
    )
    expect(diagnostic.path).toBe("anatomy.label.content.$prop")
    expect(diagnostic.message).toContain("label, size")
  })

  it("accepts a literal string content, which binds no prop", () => {
    const doc = structuredClone(BASE)
    doc.anatomy.label.content = "Submit"
    expect(loadInline(doc).ok).toBe(true)
  })

  it("every presentIf names a declared prop", () => {
    const doc = structuredClone(BASE)
    doc.anatomy.label.presentIf = "ghost"
    const [diagnostic] = loadInline(doc).diagnostics.filter(
      d => d.code === "unknown-present-if-prop",
    )
    expect(diagnostic.path).toBe("anatomy.label.presentIf")
  })

  it("an enum prop's default is one of its own values", () => {
    const doc = structuredClone(BASE)
    doc.props.size.default = "xl"
    const [diagnostic] = loadInline(doc).diagnostics.filter(
      d => d.code === "invalid-prop-default",
    )
    expect(diagnostic.path).toBe("props.size.default")
    expect(diagnostic.message).toContain('"xl"')
    expect(diagnostic.message).toContain('"sm", "lg"')
  })

  it("treats an explicit null default as 'no default', not a violation", () => {
    const doc = structuredClone(BASE)
    doc.props.size.default = null
    doc.props.size.nullable = true
    expect(loadInline(doc).ok).toBe(true)
  })

  it("a style variant's `when` names a declared prop", () => {
    const doc = structuredClone(BASE)
    doc.styles.root.variants = [
      { when: { ghost: "x" }, color: { token: "system.color.text.a" } },
    ]
    const [diagnostic] = loadInline(doc).diagnostics.filter(
      d => d.code === "unknown-variant-prop",
    )
    expect(diagnostic.path).toBe("styles.root.variants[0].when.ghost")
  })

  it("a style variant's `when` value is one of that enum prop's values", () => {
    const doc = structuredClone(BASE)
    doc.styles.root.variants = [
      { when: { size: "xl" }, color: { token: "system.color.text.a" } },
    ]
    const [diagnostic] = loadInline(doc).diagnostics.filter(
      d => d.code === "invalid-variant-value",
    )
    expect(diagnostic.path).toBe("styles.root.variants[0].when.size")
    expect(diagnostic.message).toContain('"sm", "lg"')
  })

  it("an invalidVariantCombinations entry names a declared enum prop (#403)", () => {
    const doc = structuredClone(BASE)
    doc.invalidVariantCombinations = [{ size: "sm", ghost: true }]
    const [diagnostic] = loadInline(doc).diagnostics.filter(
      d => d.code === "unknown-variant-prop",
    )
    expect(diagnostic.path).toBe("invalidVariantCombinations[0].ghost")
  })

  it("an invalidVariantCombinations value is one of that prop's own values (#403)", () => {
    const doc = structuredClone(BASE)
    doc.invalidVariantCombinations = [{ size: "xl" }]
    const [diagnostic] = loadInline(doc).diagnostics.filter(
      d => d.code === "invalid-variant-value",
    )
    expect(diagnostic.path).toBe("invalidVariantCombinations[0].size")
    expect(diagnostic.message).toContain('"sm", "lg"')
  })

  it("accepts an invalidVariantCombinations entry that names declared enum values (#403)", () => {
    const doc = structuredClone(BASE)
    doc.invalidVariantCombinations = [{ size: "sm" }]
    expect(loadInline(doc).ok).toBe(true)
  })

  it("does not value-check a `when` on a non-enum prop, which declares no set", () => {
    const doc = structuredClone(BASE)
    doc.props.elevated = { type: "boolean", default: false }
    doc.styles.root.variants = [
      { when: { elevated: true }, color: { token: "system.color.text.a" } },
    ]
    expect(loadInline(doc).ok).toBe(true)
  })

  it("every instanceOf '#/subcomponents/X' resolves to a declared subcomponent", () => {
    const doc = structuredClone(BASE)
    doc.anatomy.label = {
      type: "instance",
      instanceOf: "#/subcomponents/Missing",
    }
    const [diagnostic] = loadInline(doc).diagnostics.filter(
      d => d.code === "unknown-subcomponent",
    )
    expect(diagnostic.path).toBe("anatomy.label.instanceOf")
    expect(diagnostic.message).toContain("Missing")
  })

  it("accepts an instanceOf naming an ordinary component (not a pointer)", () => {
    const doc = structuredClone(BASE)
    doc.anatomy.label = { type: "instance", instanceOf: "SomeOtherComponent" }
    expect(loadInline(doc).ok).toBe(true)
  })

  it("applies the same rules inside a subcomponent, path-prefixed", () => {
    const doc = structuredClone(BASE)
    doc.subcomponents = {
      Inner: {
        title: "Inner",
        anatomy: { root: { type: "container", children: ["ghost"] } },
        sources: { code: { path: "components/widget/inner.tsx" } },
      },
    }
    const [diagnostic] = loadInline(doc).diagnostics.filter(
      d => d.code === "unknown-anatomy-child",
    )
    expect(diagnostic.path).toBe("subcomponents.Inner.anatomy.root.children[0]")
  })

  it("reports every violation in one pass, not just the first", () => {
    const result = loadContract(
      join(INVALID_DIR, "broken-anatomy.contract.json"),
    )
    expect(result.ok).toBe(false)
    expect(new Set(result.diagnostics.map(d => d.code))).toEqual(
      new Set([
        "unknown-anatomy-child",
        "unknown-content-prop",
        "unknown-style-element",
        "unreachable-anatomy-node",
      ]),
    )
  })

  it("checkContractSemantics is pure and directly callable", () => {
    const doc = structuredClone(BASE)
    doc.styles.ghost = { base: { color: { token: "system.color.text.a" } } }
    const before = JSON.stringify(doc)
    const diagnostics = checkContractSemantics(doc, { file: "x.contract.json" })
    expect(diagnostics.map(d => d.code)).toEqual(["unknown-style-element"])
    expect(diagnostics[0].file).toBe("x.contract.json")
    expect(JSON.stringify(doc)).toBe(before)
  })
})

// ---------------------------------------------------------------------------
// `anatomy.$variants` — the second sigil in the node map (ADR-002)
//
// `^_` is the first, and it means "comment, discard". `$variants` is the
// mirror image: a key that is not a node and MUST survive loading, because a
// later stage reads it. Both are safe in a map of node names for the same
// reason — the schema constrains a node name to `^[A-Za-z][A-Za-z0-9]*$`, so
// neither sigil can collide with one.
// ---------------------------------------------------------------------------

/** BASE plus a `$variants` block, the ADR's own `button` example in shape. */
function withVariants(variants) {
  const doc = structuredClone(BASE)
  doc.anatomy.$variants = variants
  return doc
}

const AS_LINK = {
  when: "href is set",
  root: { type: "container", element: "a" },
}

describe("anatomy.$variants (ADR-002 D2/D3/D4)", () => {
  it("accepts an optional partial-override variant alongside the node map", () => {
    const result = loadInline(withVariants({ asLink: AS_LINK }))
    expect(result.diagnostics).toEqual([])
    expect(result.ok).toBe(true)
  })

  it("every existing contract still validates — the block is optional", () => {
    expect(loadInline(structuredClone(BASE)).diagnostics).toEqual([])
    expect(
      loadContract(join(VALID_DIR, "sample-button.contract.json")).diagnostics,
    ).toEqual([])
  })

  it("survives loading, unlike a `^_` comment key", () => {
    const doc = withVariants({ asLink: { ...AS_LINK, _why: "documentary" } })
    const { contract } = loadInline(doc)
    expect(contract.anatomy.$variants.asLink).toEqual({
      when: "href is set",
      root: { type: "container", element: "a" },
    })
  })

  it("is not read as an anatomy node — no unreachable/cycle/style diagnostics", () => {
    const codes = loadInline(withVariants({ asLink: AS_LINK })).diagnostics.map(
      d => d.code,
    )
    expect(codes).not.toContain("unreachable-anatomy-node")
    expect(codes).not.toContain("unknown-style-element")
  })

  it("still rejects any OTHER `$`-prefixed key in anatomy", () => {
    const doc = structuredClone(BASE)
    doc.anatomy.$somethingElse = { type: "container" }
    const [diagnostic] = loadInline(doc).diagnostics
    expect(diagnostic.code).toBe("schema-violation")
    expect(diagnostic.message).toContain("unknown key '$somethingElse'")
  })

  it("rejects a variant name that is not a plain node-style name", () => {
    const codes = loadInline(
      withVariants({ "as-link": AS_LINK }),
    ).diagnostics.map(d => d.code)
    expect(codes).toContain("schema-violation")
  })

  it("rejects a structured `when` — it is a human note, never a predicate (D4)", () => {
    const doc = withVariants({
      asLink: {
        when: { prop: "href", equals: true },
        root: { type: "container" },
      },
    })
    const codes = loadInline(doc).diagnostics.map(d => d.code)
    expect(codes).toContain("schema-violation")
  })

  it("rejects two variants declaring the same root element, naming both", () => {
    const doc = withVariants({
      asAnchor: { root: { type: "container", element: "a" } },
      asLink: AS_LINK,
    })
    const result = loadInline(doc)
    expect(result.ok).toBe(false)
    const [diagnostic] = result.diagnostics.filter(
      d => d.code === "ambiguous-variant-root",
    )
    expect(diagnostic.path).toBe("anatomy.$variants")
    expect(diagnostic.contractId).toBe("widget")
    expect(diagnostic.message).toContain('"asAnchor"')
    expect(diagnostic.message).toContain('"asLink"')
    expect(diagnostic.message).toContain('"a"')
  })

  it("names every claimant when more than two collide", () => {
    const root = { type: "container", element: "a" }
    const doc = withVariants({ asA: { root }, asB: { root }, asC: { root } })
    const [diagnostic] = loadInline(doc).diagnostics.filter(
      d => d.code === "ambiguous-variant-root",
    )
    expect(diagnostic.message).toContain('"asA", "asB" and "asC"')
  })

  it("rejects a variant that repeats the BASE anatomy's root element, naming both (#442)", () => {
    // BASE's root is a `div`. The match-time walker in `modules/anatomy.mjs`
    // would catch this too, but as a decline that reads "unresolvable", not
    // "your contract is ambiguous" — so the loader says it, by name.
    const doc = withVariants({
      asDiv: { root: { type: "container", element: "div" } },
      asLink: AS_LINK,
    })
    const result = loadInline(doc)
    expect(result.ok).toBe(false)
    const ambiguous = result.diagnostics.filter(
      d => d.code === "ambiguous-variant-root",
    )
    expect(ambiguous).toHaveLength(1)
    expect(ambiguous[0].path).toBe("anatomy.$variants.asDiv")
    expect(ambiguous[0].message).toContain('"asDiv"')
    expect(ambiguous[0].message).toContain("base anatomy")
    expect(ambiguous[0].message).toContain('"div"')
  })

  it("accepts two variants whose roots differ — that is the point", () => {
    const doc = withVariants({
      asLink: AS_LINK,
      asSpan: { root: { type: "container", element: "span" } },
    })
    expect(loadInline(doc).diagnostics).toEqual([])
  })

  it("says nothing about a variant that overrides no root at all", () => {
    const doc = withVariants({
      loud: { label: { type: "text", content: { $prop: "label" } } },
      quiet: { label: { type: "text", content: { $prop: "label" } } },
    })
    expect(loadInline(doc).diagnostics).toEqual([])
  })

  it("rejects an anatomy that is variants only — there is no base tree to override", () => {
    const doc = structuredClone(BASE)
    doc.anatomy = { $variants: { asLink: AS_LINK } }
    delete doc.styles
    const codes = loadInline(doc).diagnostics.map(d => d.code)
    expect(codes).toContain("missing-anatomy-root")
  })

  // --- the semantic checks reach INSIDE a variant (issue #430) --------------
  //
  // A variant resolves to its own full node set (ADR-002 D3), so every node it
  // declares answers to the same rules a base node does, and every node ANY
  // branch renders is a node the rest of the contract may legitimately name.

  it("reports a variant node's unknown children, at the variant's own path", () => {
    const doc = withVariants({
      asLink: {
        when: "href is set",
        root: {
          type: "container",
          element: "a",
          children: ["labell", "ghost"],
        },
      },
    })
    const diagnostics = loadInline(doc).diagnostics.filter(
      d => d.code === "unknown-anatomy-child",
    )
    expect(diagnostics.map(d => d.path)).toEqual([
      "anatomy.$variants.asLink.root.children[0]",
      "anatomy.$variants.asLink.root.children[1]",
    ])
    expect(diagnostics[0].message).toContain('"labell"')
    expect(diagnostics[1].message).toContain('"ghost"')
  })

  it("reports a variant node's undeclared content prop", () => {
    const doc = withVariants({
      asLink: {
        when: "href is set",
        root: { type: "container", element: "a" },
        label: { type: "text", content: { $prop: "ghost" } },
      },
    })
    const [diagnostic] = loadInline(doc).diagnostics.filter(
      d => d.code === "unknown-content-prop",
    )
    expect(diagnostic.path).toBe("anatomy.$variants.asLink.label.content.$prop")
  })

  it("reports a variant node's undeclared presentIf prop and subcomponent", () => {
    const doc = withVariants({
      asLink: {
        root: { type: "container", element: "a" },
        icon: {
          type: "container",
          presentIf: "ghost",
          instanceOf: "#/subcomponents/Missing",
        },
      },
    })
    const paths = Object.fromEntries(
      loadInline(doc)
        .diagnostics.filter(d =>
          ["unknown-present-if-prop", "unknown-subcomponent"].includes(d.code),
        )
        .map(d => [d.code, d.path]),
    )
    expect(paths).toEqual({
      "unknown-present-if-prop": "anatomy.$variants.asLink.icon.presentIf",
      "unknown-subcomponent": "anatomy.$variants.asLink.icon.instanceOf",
    })
  })

  it("lets styles target a node only a variant declares", () => {
    const doc = withVariants({
      asLink: {
        root: { type: "container", element: "a", children: ["icon"] },
        icon: { type: "text" },
      },
    })
    doc.styles.icon = { base: { color: { token: "system.color.text.a" } } }
    expect(loadInline(doc).diagnostics).toEqual([])
  })

  it("lets a base node list a child only a variant declares", () => {
    const doc = withVariants({
      asLink: {
        root: { type: "container", element: "a" },
        icon: { type: "text" },
      },
    })
    doc.anatomy.root.children.push("icon")
    expect(loadInline(doc).diagnostics).toEqual([])
  })

  it("never treats `when` as a node (D4)", () => {
    const doc = withVariants({ asLink: AS_LINK })
    doc.styles.when = { base: { color: { token: "system.color.text.a" } } }
    const [diagnostic] = loadInline(doc).diagnostics.filter(
      d => d.code === "unknown-style-element",
    )
    expect(diagnostic.path).toBe("styles.when")
    expect(diagnostic.message).not.toContain("when,")
  })

  it("checks a subcomponent's anatomy the same way it always did", () => {
    // `$variants` is a top-level-anatomy affordance only (ADR-002 plan step 2);
    // a subcomponent still gets the plain node map, and says so.
    const doc = structuredClone(BASE)
    doc.subcomponents = {
      Inner: {
        title: "Inner",
        anatomy: {
          root: { type: "container" },
          $variants: { asLink: AS_LINK },
        },
      },
    }
    const codes = loadInline(doc).diagnostics.map(d => d.code)
    expect(codes).toContain("schema-violation")
  })
})

// ---------------------------------------------------------------------------
// Degrading, never throwing
// ---------------------------------------------------------------------------

describe("loadContract — bad input degrades to ok:false and never throws", () => {
  it("a missing file", () => {
    const result = loadContract(join(workDir, "nope.contract.json"))
    expect(result.ok).toBe(false)
    expect(result.contract).toBeNull()
    expect(result.diagnostics[0].code).toBe("missing-contract-file")
  })

  it("malformed JSON", () => {
    const file = writeFile(join(workDir, "bad.contract.json"), "{ id: ")
    const result = loadContract(file)
    expect(result.ok).toBe(false)
    expect(result.diagnostics[0].code).toBe("invalid-json")
  })

  it("a document that is not an object", () => {
    const file = writeFile(join(workDir, "list.contract.json"), "[1, 2]")
    const result = loadContract(file)
    expect(result.ok).toBe(false)
    expect(result.diagnostics[0].code).toBe("invalid-contract-shape")
    expect(result.diagnostics[0].message).toContain("array")
  })

  it("an unreadable file", () => {
    const fs = {
      existsSync: () => true,
      readFileSync: () => {
        throw new Error("EACCES")
      },
    }
    const result = loadContract("anywhere.contract.json", { fs })
    expect(result.ok).toBe(false)
    expect(result.diagnostics[0].code).toBe("read-error")
  })

  it("labels diagnostics with the caller's label, not the raw path", () => {
    const result = loadContract(join(workDir, "nope.contract.json"), {
      label: "contracts/nope.contract.json",
    })
    expect(result.diagnostics[0].file).toBe("contracts/nope.contract.json")
  })
})

// ---------------------------------------------------------------------------
// Discovery + the whole set
// ---------------------------------------------------------------------------

describe("findContractFiles", () => {
  it("finds contracts recursively, in sorted order", () => {
    const { files } = findContractFiles(
      { paths: { contractsDir: VALID_DIR } },
      {},
    )
    expect(files).toEqual([
      join(VALID_DIR, "nested", "sample-card.contract.json"),
      join(VALID_DIR, "sample-button.contract.json"),
    ])
  })

  it("treats a missing directory as zero contracts, not a crash", () => {
    const { files } = findContractFiles({
      paths: { contractsDir: join(workDir, "not-there") },
    })
    expect(files).toEqual([])
  })

  it("derives the .json extension from the configured contractSuffix base", () => {
    writeFile(join(workDir, "a.spec.json"), JSON.stringify(BASE))
    writeFile(join(workDir, "c.contract.json"), JSON.stringify(BASE))
    const { files } = findContractFiles({
      paths: { contractsDir: workDir },
      conventions: { contractSuffix: ".spec.json" },
    })
    expect(files.map(f => basename(f))).toEqual(["a.spec.json"])
  })

  it("resolves a relative contractsDir against the given root", () => {
    writeFile(join(workDir, "specs", "a.contract.json"), JSON.stringify(BASE))
    const { files } = findContractFiles(
      { paths: { contractsDir: "specs" } },
      { root: workDir },
    )
    expect(files).toEqual([join(workDir, "specs", "a.contract.json")])
  })
})

describe("loadContracts", () => {
  it("loads a clean set, sorted by id", () => {
    const result = loadContracts({ paths: { contractsDir: VALID_DIR } })
    expect(result.diagnostics).toEqual([])
    expect(result.ok).toBe(true)
    expect(result.contracts.map(e => e.id)).toEqual([
      "sample-button",
      "sample-card",
    ])
  })

  it("labels each entry with a project-relative, forward-slashed file", () => {
    const result = loadContracts(
      { paths: { contractsDir: "valid" } },
      { root: FIXTURES },
    )
    expect(result.contracts.map(e => e.file)).toEqual([
      "valid/sample-button.contract.json",
      "valid/nested/sample-card.contract.json",
    ])
  })

  it("one bad file never aborts the set", () => {
    writeFile(
      join(workDir, "good.contract.json"),
      JSON.stringify({ ...BASE, id: "good" }),
    )
    writeFile(join(workDir, "bad.contract.json"), "{ not json")
    const result = loadContracts({ paths: { contractsDir: workDir } })
    expect(result.ok).toBe(false)
    expect(result.contracts.map(e => e.id)).toEqual(["good"])
    expect(result.diagnostics.map(d => d.code)).toEqual(["invalid-json"])
  })

  it("reports a duplicate id against every file that claims it", () => {
    writeFile(join(workDir, "a.contract.json"), JSON.stringify(BASE))
    writeFile(join(workDir, "b.contract.json"), JSON.stringify(BASE))
    const result = loadContracts({ paths: { contractsDir: workDir } })
    const duplicates = result.diagnostics.filter(
      d => d.code === "duplicate-contract-id",
    )
    expect(duplicates).toHaveLength(2)
    expect(duplicates[0].contractId).toBe("widget")
    expect(duplicates[0].message).toContain("2 files")
  })

  it("is deterministic — the same tree loads byte-identically twice", () => {
    const once = loadContracts({ paths: { contractsDir: FIXTURES } })
    const twice = loadContracts({ paths: { contractsDir: FIXTURES } })
    expect(JSON.stringify(twice)).toBe(JSON.stringify(once))
  })

  it("sorts diagnostics by file, then by in-document path", () => {
    const result = loadContracts(
      { paths: { contractsDir: "invalid" } },
      { root: FIXTURES },
    )
    expect(result.diagnostics.map(d => `${d.file} ${d.path}`)).toEqual([
      "invalid/broken-anatomy.contract.json anatomy.orphan",
      "invalid/broken-anatomy.contract.json anatomy.orphan.content.$prop",
      "invalid/broken-anatomy.contract.json anatomy.root.children[0]",
      "invalid/broken-anatomy.contract.json styles.nowhere",
      "invalid/broken-props.contract.json props.size.default",
      "invalid/broken-props.contract.json styles.root.variants[0].when.tone",
    ])
  })

  it("narrates progress on the injected bus without touching any stream", () => {
    const events = []
    const record = kind => (task, detail) => events.push([kind, task, detail])
    loadContracts(
      { paths: { contractsDir: VALID_DIR } },
      {
        onProgress: {
          start: record("start"),
          update: record("update"),
          done: record("done"),
          skip: record("skip"),
        },
      },
    )
    expect(events[0][0]).toBe("start")
    expect(events.filter(e => e[0] === "update")).toHaveLength(2)
    expect(events.at(-1)).toEqual(["done", "contracts", "2 contract(s)"])
  })

  it("reports a failing set through skip, not done", () => {
    const events = []
    loadContracts(
      { paths: { contractsDir: INVALID_DIR } },
      { onProgress: { skip: (task, reason) => events.push([task, reason]) } },
    )
    expect(events).toHaveLength(1)
    expect(events[0][0]).toBe("contracts")
  })
})

// ---------------------------------------------------------------------------
// The reduced API view
// ---------------------------------------------------------------------------

describe("contractApiView", () => {
  const { contract } = loadContract(
    join(VALID_DIR, "sample-button.contract.json"),
  )
  const view = contractApiView(contract)

  it("is keyed by prop name, in sorted order", () => {
    expect(Object.keys(view)).toEqual(["adornment", "label", "size", "state"])
  })

  it("carries exactly the fields the props/API checker consumes", () => {
    expect(view.size).toEqual({
      type: "enum",
      values: ["sm", "lg"],
      default: "sm",
      required: false,
    })
    expect(view.state).toEqual({
      type: "enum",
      values: ["resting", "hover"],
      default: "resting",
      required: true,
      code: "none",
    })
    expect(view.adornment).toEqual({
      type: "slot",
      required: false,
      design: "unverified",
    })
  })

  it("defaults `required` to true, matching the schema's own default", () => {
    expect(view.label).toEqual({ type: "string", required: true })
  })

  it("omits absent optional fields rather than setting them undefined", () => {
    expect(Object.keys(view.label)).toEqual(["type", "required"])
  })

  it("copies `values` rather than aliasing the contract's array", () => {
    view.size.values.push("xl")
    expect(contract.props.size.values).toEqual(["sm", "lg"])
  })

  it("is empty for a contract that declares no props", () => {
    expect(contractApiView({ id: "x", title: "X" })).toEqual({})
  })
})
