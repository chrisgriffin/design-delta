/**
 * modules-components.test.js — `src/modules/components.mjs`, the props/API
 * parity checker (ADR-001 D1/D5/D13, issue #98).
 *
 * PURE input: every case here hand-builds its `contracts`/`codeCensus`
 * fixtures in memory (the exact shapes `spec/contracts.mjs`/
 * the framework adapter produce) rather than touching fs — that is the whole
 * point of the layering guard (`__tests__/layering.test.js`'s "modules never
 * import sources").
 */

import {
  runComponentsCheck,
  runBindingFilesCheck,
} from "../src/modules/components.mjs"
import { hashJson } from "../src/core/state.mjs"

function contract(
  id,
  { path = `${id}.tsx`, props = {}, hasSource = true } = {},
) {
  return {
    id,
    file: `${id}.contract.json`,
    contract: {
      id,
      title: id,
      ...(hasSource ? { sources: { code: { path } } } : {}),
      props,
    },
  }
}

function census(components) {
  return { ok: true, components }
}

function findingIds(findings) {
  return findings.map(f => f.ruleId).sort()
}

// ---------------------------------------------------------------------------
// Every rule, firing.
// ---------------------------------------------------------------------------

describe("runComponentsCheck — each rule firing", () => {
  it("components/prop-missing: contract declares it, code lacks it", () => {
    const contracts = [
      contract("field", {
        props: { label: { type: "string", required: true } },
      }),
    ]
    const codeCensus = census([{ file: "field.tsx", props: [] }])
    const findings = runComponentsCheck(contracts, codeCensus, {})
    expect(findings).toEqual([
      expect.objectContaining({
        ruleId: "components/prop-missing",
        surface: "components",
        side: "code",
        entity: "field",
        severity: "error",
        data: { prop: "label", type: "string" },
      }),
    ])
  })

  it("components/prop-unexpected: code has it, contract does not declare it", () => {
    const contracts = [contract("field", { props: {} })]
    const codeCensus = census([
      {
        file: "field.tsx",
        props: [{ name: "label", type: "string", required: true }],
      },
    ])
    const findings = runComponentsCheck(contracts, codeCensus, {})
    expect(findings).toEqual([
      expect.objectContaining({
        ruleId: "components/prop-unexpected",
        entity: "field",
        severity: "warn",
        data: { prop: "label" },
      }),
    ])
  })

  it("components/prop-type-mismatch", () => {
    const contracts = [
      contract("field", {
        props: { label: { type: "string", required: true } },
      }),
    ]
    const codeCensus = census([
      {
        file: "field.tsx",
        props: [{ name: "label", type: "number", required: true }],
      },
    ])
    const findings = runComponentsCheck(contracts, codeCensus, {})
    expect(findings).toEqual([
      expect.objectContaining({
        ruleId: "components/prop-type-mismatch",
        entity: "field",
        data: { prop: "label", contractType: "string", codeType: "number" },
      }),
    ])
  })

  it("components/prop-type-unresolved: an unreadable code type declines the comparison", () => {
    // `unknown` is the extractor reporting that it could not resolve the
    // prop's type at all. It must never be compared: "we could not look" is
    // not "we looked and it is wrong", and treating it as a type produced a
    // confident error-severity mismatch against a prop whose real type
    // agreed with the contract perfectly.
    const contracts = [
      contract("field", {
        props: { label: { type: "enum", values: ["a", "b"], required: false } },
      }),
    ]
    const codeCensus = census([
      {
        file: "field.tsx",
        props: [{ name: "label", type: "unknown", required: false }],
      },
    ])
    const findings = runComponentsCheck(contracts, codeCensus, {})
    expect(findings).toEqual([
      expect.objectContaining({
        ruleId: "components/prop-type-unresolved",
        severity: "review",
        entity: "field",
        data: { prop: "label", contractType: "enum" },
      }),
    ])
  })

  it("components/enum-values-mismatch reports added and removed separately, exact + case-sensitive", () => {
    const contracts = [
      contract("badge", {
        props: {
          size: { type: "enum", values: ["sm", "lg"], required: true },
        },
      }),
    ]
    const codeCensus = census([
      {
        file: "badge.tsx",
        props: [
          {
            name: "size",
            type: "enum",
            values: ["sm", "md", "SM"],
            required: true,
          },
        ],
      },
    ])
    const findings = runComponentsCheck(contracts, codeCensus, {})
    expect(findings).toEqual([
      expect.objectContaining({
        ruleId: "components/enum-values-mismatch",
        entity: "badge",
        data: {
          prop: "size",
          // "SM" is NOT the same value as "sm" — case-sensitive, never folded.
          added: ["SM", "md"],
          removed: ["lg"],
        },
      }),
    ])
  })

  it("components/prop-default-mismatch", () => {
    const contracts = [
      contract("badge", {
        props: { size: { type: "string", default: "sm", required: true } },
      }),
    ]
    const codeCensus = census([
      {
        file: "badge.tsx",
        props: [
          { name: "size", type: "string", default: "md", required: true },
        ],
      },
    ])
    const findings = runComponentsCheck(contracts, codeCensus, {})
    expect(findings).toEqual([
      expect.objectContaining({
        ruleId: "components/prop-default-mismatch",
        entity: "badge",
        data: { prop: "size", contractDefault: "sm", codeDefault: "md" },
      }),
    ])
  })

  it("components/prop-optionality-mismatch", () => {
    const contracts = [
      contract("field", {
        props: { label: { type: "string", required: true } },
      }),
    ]
    const codeCensus = census([
      {
        file: "field.tsx",
        props: [{ name: "label", type: "string", required: false }],
      },
    ])
    const findings = runComponentsCheck(contracts, codeCensus, {})
    expect(findings).toEqual([
      expect.objectContaining({
        ruleId: "components/prop-optionality-mismatch",
        entity: "field",
        data: { prop: "label", contractRequired: true, codeRequired: false },
      }),
    ])
  })

  it("coverage/uncontracted-component: a code component with no contract at all", () => {
    const findings = runComponentsCheck(
      [],
      census([{ file: "orphan.tsx", props: [] }]),
      {},
    )
    expect(findings).toEqual([
      expect.objectContaining({
        ruleId: "coverage/uncontracted-component",
        surface: "coverage",
        side: "code",
        entity: "orphan.tsx",
        data: { path: "orphan.tsx" },
      }),
    ])
  })

  it("coverage/contract-only: a contract's code path has no matching component", () => {
    const contracts = [contract("field", { path: "field.tsx" })]
    const findings = runComponentsCheck(contracts, census([]), {})
    expect(findings).toEqual([
      expect.objectContaining({
        ruleId: "coverage/contract-only",
        surface: "coverage",
        side: "spec",
        entity: "field",
        data: { path: "field.tsx" },
      }),
    ])
  })

  it("components/unused-component: a contracted component's file has no usages in the census", () => {
    const contracts = [contract("field", { path: "field.tsx" })]
    const codeCensus = census([{ file: "field.tsx", props: [] }])
    const usageCensus = { usages: [] }
    const findings = runComponentsCheck(contracts, codeCensus, {}, usageCensus)
    expect(findings).toEqual([
      expect.objectContaining({
        ruleId: "components/unused-component",
        surface: "components",
        side: "code",
        severity: "review",
        entity: "field",
        data: { path: "field.tsx" },
      }),
    ])
  })
})

// ---------------------------------------------------------------------------
// coverage/design-only / coverage/design-missing (ADR-003 Phase 5.1) — the
// design-side twins of coverage/uncontracted-component / coverage/contract-
// only. `designMatchKey` is the CALLER's job to attach (the active
// provider's `designAddress`) — these fixtures set it directly, standing in
// for what `cli/commands/audit.mjs` would compute in real use.
// ---------------------------------------------------------------------------

function designCensus(entries) {
  return { entries }
}

function contractWithDesign(id, { designMatchKey, ...overrides } = {}) {
  const base = contract(id, overrides)
  return {
    ...base,
    contract: {
      ...base.contract,
      sources: {
        ...base.contract.sources,
        design: { fileKey: "acme000000000000000001", nodeId: "1:1" },
      },
    },
    designMatchKey,
  }
}

describe("runComponentsCheck — coverage/design-only / coverage/design-missing", () => {
  it("coverage/design-missing: sources.design declared but the match key doesn't resolve", () => {
    const contracts = [
      contractWithDesign("field", { designMatchKey: "acme:1:1" }),
    ]
    const findings = runComponentsCheck(
      contracts,
      census([{ file: "field.tsx", props: [] }]),
      {},
      undefined,
      designCensus([{ matchKey: "acme:2:2", name: "OtherField" }]),
    )
    expect(
      findings.filter(f => f.ruleId === "coverage/design-missing"),
    ).toEqual([
      expect.objectContaining({
        ruleId: "coverage/design-missing",
        surface: "coverage",
        side: "spec",
        entity: "field",
      }),
    ])
  })

  it("coverage/design-missing: fires the same way when designMatchKey is null (malformed address)", () => {
    const contracts = [contractWithDesign("field", { designMatchKey: null })]
    const findings = runComponentsCheck(
      contracts,
      census([{ file: "field.tsx", props: [] }]),
      {},
      undefined,
      designCensus([]),
    )
    expect(findingIds(findings)).toContain("coverage/design-missing")
  })

  it("coverage/design-missing does NOT fire when no designCensus is given at all", () => {
    // No snapshot gathered yet — "missing" can't be claimed about something
    // never looked at (the same convention a missing tokens.json follows).
    const contracts = [contractWithDesign("field", { designMatchKey: null })]
    const findings = runComponentsCheck(
      contracts,
      census([{ file: "field.tsx", props: [] }]),
      {},
    )
    expect(findingIds(findings)).not.toContain("coverage/design-missing")
  })

  it("coverage/design-only: a design component has no contract referencing it", () => {
    const findings = runComponentsCheck(
      [],
      census([]),
      {},
      undefined,
      designCensus([{ matchKey: "acme:1:1", name: "Eyebrow" }]),
    )
    expect(findings).toEqual([
      expect.objectContaining({
        ruleId: "coverage/design-only",
        surface: "coverage",
        side: "design",
        entity: "acme:1:1",
        data: { name: "Eyebrow" },
      }),
    ])
  })

  it("a resolving match produces neither design-only nor design-missing", () => {
    const contracts = [
      contractWithDesign("field", { designMatchKey: "acme:1:1" }),
    ]
    const findings = runComponentsCheck(
      contracts,
      census([{ file: "field.tsx", props: [] }]),
      {},
      undefined,
      designCensus([{ matchKey: "acme:1:1", name: "Field" }]),
    )
    expect(findingIds(findings)).not.toContain("coverage/design-only")
    expect(findingIds(findings)).not.toContain("coverage/design-missing")
  })

  it("neither rule fires when sources.design is absent, even with a designCensus given", () => {
    const contracts = [contract("field")]
    const findings = runComponentsCheck(
      contracts,
      census([{ file: "field.tsx", props: [] }]),
      {},
      undefined,
      designCensus([{ matchKey: "acme:1:1", name: "Field" }]),
    )
    expect(findingIds(findings)).not.toContain("coverage/design-missing")
    // The census entry itself is still unmatched, so design-only still fires
    // for IT — absence of a contract's design block doesn't hide an
    // otherwise-real design-only component.
    expect(findingIds(findings)).toContain("coverage/design-only")
  })
})

// ---------------------------------------------------------------------------
// Design-side prop parity (ADR-003 Phase 5.2) — same rule ids as the
// code-side loop, `side: "design"`, driven by `props` on a MATCHED
// `designCensus` entry (the shape `providers/figma/index.mjs`'s
// `componentProps` produces). `entries[].props` stands in for what
// `cli/commands/audit.mjs` computes in real use, same as `matchKey` above.
// ---------------------------------------------------------------------------

function matchedDesignCensus(props) {
  return designCensus([{ matchKey: "acme:1:1", name: "Field", props }])
}

describe("runComponentsCheck — design-side prop parity (ADR-003 Phase 5.2)", () => {
  it("components/prop-missing: contract declares it, design lacks it", () => {
    const contracts = [
      contractWithDesign("field", {
        designMatchKey: "acme:1:1",
        hasSource: false,
        props: { label: { type: "string", required: true } },
      }),
    ]
    const findings = runComponentsCheck(
      contracts,
      census([]),
      {},
      undefined,
      matchedDesignCensus([]),
    )
    expect(findings).toEqual([
      expect.objectContaining({
        ruleId: "components/prop-missing",
        side: "design",
        entity: "field",
        data: { prop: "label", type: "string" },
      }),
    ])
  })

  it("components/prop-unexpected: design has it, contract does not declare it", () => {
    const contracts = [
      contractWithDesign("field", {
        designMatchKey: "acme:1:1",
        hasSource: false,
      }),
    ]
    const findings = runComponentsCheck(
      contracts,
      census([]),
      {},
      undefined,
      matchedDesignCensus([{ name: "label", type: "string" }]),
    )
    expect(findings).toEqual([
      expect.objectContaining({
        ruleId: "components/prop-unexpected",
        side: "design",
        entity: "field",
        data: { prop: "label" },
      }),
    ])
  })

  it("components/prop-type-mismatch", () => {
    const contracts = [
      contractWithDesign("field", {
        designMatchKey: "acme:1:1",
        hasSource: false,
        props: { label: { type: "string", required: true } },
      }),
    ]
    const findings = runComponentsCheck(
      contracts,
      census([]),
      {},
      undefined,
      matchedDesignCensus([{ name: "label", type: "boolean" }]),
    )
    expect(findings).toEqual([
      expect.objectContaining({
        ruleId: "components/prop-type-mismatch",
        side: "design",
        entity: "field",
        data: { prop: "label", contractType: "string", designType: "boolean" },
      }),
    ])
  })

  it("components/enum-values-mismatch: a set comparison, order not compared", () => {
    const contracts = [
      contractWithDesign("field", {
        designMatchKey: "acme:1:1",
        hasSource: false,
        props: {
          tone: { type: "enum", values: ["danger", "neutral"], required: true },
        },
      }),
    ]
    const findings = runComponentsCheck(
      contracts,
      census([]),
      {},
      undefined,
      matchedDesignCensus([
        { name: "tone", type: "enum", values: ["neutral", "warning"] },
      ]),
    )
    expect(findings).toEqual([
      expect.objectContaining({
        ruleId: "components/enum-values-mismatch",
        side: "design",
        entity: "field",
        data: { prop: "tone", added: ["warning"], removed: ["danger"] },
      }),
    ])
  })

  it("a clean match (same name, type, and enum set) produces nothing", () => {
    const contracts = [
      contractWithDesign("field", {
        designMatchKey: "acme:1:1",
        hasSource: false,
        props: {
          tone: { type: "enum", values: ["danger", "neutral"], required: true },
          label: { type: "string", required: true },
        },
      }),
    ]
    const findings = runComponentsCheck(
      contracts,
      census([]),
      {},
      undefined,
      matchedDesignCensus([
        { name: "tone", type: "enum", values: ["neutral", "danger"] },
        { name: "label", type: "string" },
      ]),
    )
    expect(findings).toEqual([])
  })

  it("neither components/prop-default-mismatch nor components/prop-optionality-mismatch ever fire design-side — the input shape carries neither field", () => {
    const contracts = [
      contractWithDesign("field", {
        designMatchKey: "acme:1:1",
        hasSource: false,
        props: {
          label: { type: "string", default: "x", required: false },
        },
      }),
    ]
    const findings = runComponentsCheck(
      contracts,
      census([]),
      {},
      undefined,
      // A design prop object literally CANNOT carry `default`/`required` —
      // `componentProps` never produces them — so there is nothing to diff.
      matchedDesignCensus([{ name: "label", type: "string" }]),
    )
    expect(findings).toEqual([])
  })

  describe("numeric enums at the design boundary (ADR-001 D1 amendment, #297)", () => {
    function columns(values) {
      return [
        contractWithDesign("grid", {
          designMatchKey: "acme:1:1",
          hasSource: false,
          props: { columns: { type: "enum", values } },
        }),
      ]
    }
    function designColumns(values) {
      return matchedDesignCensus([{ name: "columns", type: "enum", values }])
    }

    it("a design tool's string forms of a numeric contract enum are parity, not drift", () => {
      const findings = runComponentsCheck(
        columns([2, 3]),
        census([]),
        {},
        undefined,
        designColumns(["2", "3"]),
      )
      expect(findings).toEqual([])
    })

    it("real drift on a numeric enum still reports, with the added value coerced to the contract's number type", () => {
      const findings = runComponentsCheck(
        columns([2, 3]),
        census([]),
        {},
        undefined,
        designColumns(["2", "4"]),
      )
      expect(findings).toEqual([
        expect.objectContaining({
          ruleId: "components/enum-values-mismatch",
          side: "design",
          data: { prop: "columns", added: [4], removed: [3] },
        }),
      ])
    })

    it("only an exact round-trip coerces — padded or decimal strings stay strings and mismatch", () => {
      const findings = runComponentsCheck(
        columns([2, 3]),
        census([]),
        {},
        undefined,
        designColumns(["02", "3.0"]),
      )
      expect(findings[0].data).toEqual({
        prop: "columns",
        added: ["02", "3.0"],
        removed: [2, 3],
      })
    })

    it("a string contract enum gets no coercion — exactness is unchanged", () => {
      const findings = runComponentsCheck(
        columns(["2", "3"]),
        census([]),
        {},
        undefined,
        designColumns(["2", "3"]),
      )
      expect(findings).toEqual([])
    })

    it("a mixed-type contract enum gets no coercion", () => {
      const findings = runComponentsCheck(
        columns([2, "auto"]),
        census([]),
        {},
        undefined,
        designColumns(["2", "auto"]),
      )
      expect(findings[0].data).toEqual({
        prop: "columns",
        added: ["2"],
        removed: [2],
      })
    })

    it("the CODE side stays type-exact: a string union against a numeric contract is drift", () => {
      const findings = runComponentsCheck(
        [
          contract("grid", {
            path: "grid.tsx",
            props: {
              columns: { type: "enum", values: [2, 3], required: false },
            },
          }),
        ],
        census([
          {
            file: "grid.tsx",
            props: [
              {
                name: "columns",
                type: "enum",
                values: ["2", "3"],
                required: false,
              },
            ],
          },
        ]),
        {},
      )
      expect(findingIds(findings)).toEqual(["components/enum-values-mismatch"])
      expect(findings[0].side).toBe("code")
    })
  })

  describe("deviation markers", () => {
    it('design: "none" — presence in design IS a finding', () => {
      const contracts = [
        contractWithDesign("field", {
          designMatchKey: "acme:1:1",
          hasSource: false,
          props: { internalOnly: { type: "string", design: "none" } },
        }),
      ]
      const findings = runComponentsCheck(
        contracts,
        census([]),
        {},
        undefined,
        matchedDesignCensus([{ name: "internalOnly", type: "string" }]),
      )
      expect(findings).toEqual([
        expect.objectContaining({
          ruleId: "components/prop-unexpected",
          side: "design",
          entity: "field",
          data: {
            prop: "internalOnly",
            reason: 'contract declares design: "none"',
          },
        }),
      ])
    })

    it('design: "none" — absence in design is correct and SILENT', () => {
      const contracts = [
        contractWithDesign("field", {
          designMatchKey: "acme:1:1",
          hasSource: false,
          props: { internalOnly: { type: "string", design: "none" } },
        }),
      ]
      const findings = runComponentsCheck(
        contracts,
        census([]),
        {},
        undefined,
        matchedDesignCensus([]),
      )
      expect(findings).toEqual([])
    })

    it('design: "unverified" — suppresses every finding for that prop, both directions', () => {
      const contracts = [
        contractWithDesign("field", {
          designMatchKey: "acme:1:1",
          hasSource: false,
          props: { adornment: { type: "slot", design: "unverified" } },
        }),
      ]
      // Missing entirely on the design side — would be prop-missing otherwise.
      expect(
        runComponentsCheck(
          contracts,
          census([]),
          {},
          undefined,
          matchedDesignCensus([]),
        ),
      ).toEqual([])
      // Present but a totally different shape — still nothing.
      expect(
        runComponentsCheck(
          contracts,
          census([]),
          {},
          undefined,
          matchedDesignCensus([{ name: "adornment", type: "boolean" }]),
        ),
      ).toEqual([])
    })

    it("design: {name, reason} — a rename is looked up under the NEW identity", () => {
      const contracts = [
        contractWithDesign("field", {
          designMatchKey: "acme:1:1",
          hasSource: false,
          props: {
            children: {
              type: "string",
              design: { name: "Label", reason: "design models it as Label" },
            },
          },
        }),
      ]
      // The design census carries "Label", not "children" — a clean match.
      expect(
        runComponentsCheck(
          contracts,
          census([]),
          {},
          undefined,
          matchedDesignCensus([{ name: "Label", type: "string" }]),
        ),
      ).toEqual([])
      // A census carrying "children" instead (the UN-renamed identity) is a
      // miss under the new name, AND an unmatched extra under its own.
      const findings = runComponentsCheck(
        contracts,
        census([]),
        {},
        undefined,
        matchedDesignCensus([{ name: "children", type: "string" }]),
      )
      expect(findingIds(findings)).toEqual([
        "components/prop-missing",
        "components/prop-unexpected",
      ])
    })

    it("design: {name, mechanism} — the MECHANISM's implied type is what the design side is compared against (issue #439)", () => {
      // The three shapes #439 was filed for, in one contract: a slot the
      // design side hides with a boolean beside it, a slot it models as a
      // text string, and a URL string it models as a swappable instance.
      const contracts = [
        contractWithDesign("field", {
          designMatchKey: "acme:1:1",
          hasSource: false,
          props: {
            topSlot: {
              type: "slot",
              required: false,
              design: {
                name: "hasTopSlot",
                mechanism: "toggle",
                reason: "a design slot always occupies space",
              },
            },
            children: {
              type: "slot",
              design: { name: "Label", mechanism: "text" },
            },
            src: {
              type: "string",
              design: { name: "Content", mechanism: "instance" },
            },
          },
        }),
      ]
      expect(
        runComponentsCheck(
          contracts,
          census([]),
          {},
          undefined,
          matchedDesignCensus([
            { name: "Content", type: "slot" },
            { name: "Label", type: "string" },
            { name: "hasTopSlot", type: "boolean" },
          ]),
        ),
      ).toEqual([])
    })

    it("design: {name, mechanism} — a marker that stopped being true still fires, naming the mechanism", () => {
      const contracts = [
        contractWithDesign("field", {
          designMatchKey: "acme:1:1",
          hasSource: false,
          props: {
            topSlot: {
              type: "slot",
              design: {
                name: "hasTopSlot",
                mechanism: "toggle",
                reason: "a design slot always occupies space",
              },
            },
          },
        }),
      ]
      const findings = runComponentsCheck(
        contracts,
        census([]),
        {},
        undefined,
        // The design side re-modelled it as text — the declared translation
        // is no longer the translation.
        matchedDesignCensus([{ name: "hasTopSlot", type: "string" }]),
      )
      expect(findings).toEqual([
        expect.objectContaining({
          ruleId: "components/prop-type-mismatch",
          side: "design",
          entity: "field",
          data: {
            prop: "topSlot",
            contractType: "slot",
            designType: "string",
            mechanism: "toggle",
            expectedDesignType: "boolean",
          },
        }),
      ])
      expect(findings[0].message).toContain("toggle")
    })

    it("design: {name, mechanism} — still checks the design prop EXISTS under its name", () => {
      const contracts = [
        contractWithDesign("field", {
          designMatchKey: "acme:1:1",
          hasSource: false,
          props: {
            children: {
              type: "slot",
              design: { name: "Label", mechanism: "text" },
            },
          },
        }),
      ]
      expect(
        findingIds(
          runComponentsCheck(
            contracts,
            census([]),
            {},
            undefined,
            matchedDesignCensus([]),
          ),
        ),
      ).toEqual(["components/prop-missing"])
    })

    describe("design: {mechanism: toggle, gates} (issue #485)", () => {
      const gatedContracts = () => [
        contractWithDesign("field", {
          designMatchKey: "acme:1:1",
          hasSource: false,
          props: {
            eyebrow: {
              type: "slot",
              required: false,
              design: {
                name: "hasEyebrow",
                mechanism: "toggle",
                gates: "eyebrow",
              },
            },
          },
        }),
      ]
      const check = designProps =>
        runComponentsCheck(
          gatedContracts(),
          census([]),
          {},
          undefined,
          matchedDesignCensus(designProps),
        )

      it("the gated slot is accounted for, not an unexpected extra", () => {
        expect(
          check([
            { name: "eyebrow", type: "slot" },
            { name: "hasEyebrow", type: "boolean" },
          ]),
        ).toEqual([])
      })

      it("a gated slot the design component lacks is prop-missing, naming it", () => {
        const findings = check([{ name: "hasEyebrow", type: "boolean" }])
        expect(findingIds(findings)).toEqual(["components/prop-missing"])
        expect(findings[0].data).toEqual({
          prop: "eyebrow",
          type: "slot",
          gates: "eyebrow",
        })
      })

      it("a gated property that is not a slot is prop-type-mismatch", () => {
        const findings = check([
          { name: "eyebrow", type: "string" },
          { name: "hasEyebrow", type: "boolean" },
        ])
        expect(findings).toEqual([
          expect.objectContaining({
            ruleId: "components/prop-type-mismatch",
            side: "design",
            data: {
              prop: "eyebrow",
              contractType: "slot",
              designType: "string",
              mechanism: "toggle",
              gates: "eyebrow",
              expectedDesignType: "slot",
            },
          }),
        ])
      })
    })

    it('code: "none" (design-only axis) — no design marker means design is checked normally, the mirror-image idiom', () => {
      const contracts = [
        contractWithDesign("field", {
          designMatchKey: "acme:1:1",
          hasSource: false,
          props: {
            state: {
              type: "enum",
              values: ["resting", "hover"],
              code: "none",
            },
          },
        }),
      ]
      // Design has the matching variant — clean, since `code: "none"` says
      // nothing about the design side at all.
      expect(
        runComponentsCheck(
          contracts,
          census([]),
          {},
          undefined,
          matchedDesignCensus([
            { name: "state", type: "enum", values: ["resting", "hover"] },
          ]),
        ),
      ).toEqual([])
      // Design missing it entirely is a genuine components/prop-missing.
      const findings = runComponentsCheck(
        contracts,
        census([]),
        {},
        undefined,
        matchedDesignCensus([]),
      )
      expect(findingIds(findings)).toEqual(["components/prop-missing"])
    })

    it("a `code` marker is ignored entirely by the design-side check, and vice versa", () => {
      // `code: "unverified"` suppresses the CODE side only — the design side
      // of the same prop, with no `design` marker, is still checked normally.
      const contracts = [
        contractWithDesign("field", {
          designMatchKey: "acme:1:1",
          props: { label: { type: "string", code: "unverified" } },
        }),
      ]
      const findings = runComponentsCheck(
        contracts,
        census([{ file: "field.tsx", props: [] }]),
        {},
        undefined,
        matchedDesignCensus([]),
      )
      expect(findingIds(findings)).toEqual(["components/prop-missing"])
      expect(findings[0].side).toBe("design")
    })
  })
})

// ---------------------------------------------------------------------------
// coverage/unfinished-contract — draft contracts still carrying `_scaffold`.
// ---------------------------------------------------------------------------

describe("runComponentsCheck — coverage/unfinished-contract", () => {
  it("one finding per contract, naming every marker's JSON pointer path in deterministic order", () => {
    // Markers arrive on the ENTRY, from `loadContract` — the loaded
    // `contract` has had every `^_` key stripped, so a `_scaffold` key set
    // here would be invisible to the check, which is issue #350 exactly.
    const entry = contract("field", {
      path: "field.tsx",
      props: { label: { type: "string", required: true } },
    })
    entry.scaffoldMarkers = [
      "/anatomy/root/_scaffold",
      "/props/label/_scaffold",
    ]
    const contracts = [entry]
    const findings = runComponentsCheck(contracts, census([]), {})

    const unfinished = findings.filter(
      f => f.ruleId === "coverage/unfinished-contract",
    )
    expect(unfinished).toEqual([
      expect.objectContaining({
        ruleId: "coverage/unfinished-contract",
        surface: "coverage",
        side: "spec",
        entity: "field",
        data: {
          markers: ["/anatomy/root/_scaffold", "/props/label/_scaffold"],
        },
      }),
    ])
  })

  it("a _scaffold key left on the contract object itself is NOT read (#350)", () => {
    const entry = contract("field", {
      path: "field.tsx",
      props: { label: { type: "string", required: true } },
    })
    entry.contract.props.label._scaffold = { todo: "guess the type" }
    const findings = runComponentsCheck([entry], census([]), {})
    expect(
      findings.some(f => f.ruleId === "coverage/unfinished-contract"),
    ).toBe(false)
  })

  it("a contract with no _scaffold key emits nothing", () => {
    const contracts = [
      contract("field", {
        path: "field.tsx",
        props: { label: { type: "string", required: true } },
      }),
    ]
    const findings = runComponentsCheck(
      contracts,
      census([
        {
          file: "field.tsx",
          props: [{ name: "label", type: "string", required: true }],
        },
      ]),
      {},
    )
    expect(
      findings.filter(f => f.ruleId === "coverage/unfinished-contract"),
    ).toEqual([])
  })

  it("fires even on a draft contract with no sources.code.path", () => {
    const entry = contract("field", { hasSource: false })
    entry.scaffoldMarkers = ["/_scaffold"]
    const findings = runComponentsCheck([entry], census([]), {})
    expect(
      findings.filter(f => f.ruleId === "coverage/unfinished-contract"),
    ).toEqual([
      expect.objectContaining({
        ruleId: "coverage/unfinished-contract",
        entity: "field",
        data: { markers: ["/_scaffold"] },
      }),
    ])
  })

  it("honors a rules override, including 'off'", () => {
    const entry = contract("field", { path: "field.tsx" })
    entry.scaffoldMarkers = ["/_scaffold"]

    const warned = runComponentsCheck([entry], census([]), {
      rules: { "coverage/unfinished-contract": "warn" },
    })
    expect(
      warned.find(f => f.ruleId === "coverage/unfinished-contract").severity,
    ).toBe("warn")

    const off = runComponentsCheck([entry], census([]), {
      rules: { "coverage/unfinished-contract": "off" },
    })
    expect(
      off.filter(f => f.ruleId === "coverage/unfinished-contract"),
    ).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Every rule, NOT firing (clean parity).
// ---------------------------------------------------------------------------

describe("runComponentsCheck — clean parity produces no findings", () => {
  it("a component matching its contract exactly emits nothing", () => {
    const contracts = [
      contract("field", {
        props: {
          label: { type: "string", required: true },
          tone: {
            type: "enum",
            values: ["neutral", "danger"],
            default: "neutral",
            required: false,
          },
        },
      }),
    ]
    const codeCensus = census([
      {
        file: "field.tsx",
        props: [
          { name: "label", type: "string", required: true },
          {
            name: "tone",
            type: "enum",
            values: ["neutral", "danger"],
            default: "neutral",
            required: false,
          },
        ],
      },
    ])
    expect(runComponentsCheck(contracts, codeCensus, {})).toEqual([])
  })

  it("a contract with no sources.code.path is skipped silently (not coverage/contract-only)", () => {
    const contracts = [contract("draft", { hasSource: false })]
    expect(runComponentsCheck(contracts, census([]), {})).toEqual([])
  })

  it("components/unused-component does not fire for a component the usage census confirms is used", () => {
    const contracts = [contract("field", { path: "field.tsx" })]
    const codeCensus = census([{ file: "field.tsx", props: [] }])
    const usageCensus = {
      usages: [{ file: "field.tsx", usedBy: [{ file: "form.tsx", line: 3 }] }],
    }
    expect(runComponentsCheck(contracts, codeCensus, {}, usageCensus)).toEqual(
      [],
    )
  })

  it("components/unused-component is not evaluated at all when no usage census is passed", () => {
    const contracts = [contract("field", { path: "field.tsx" })]
    const codeCensus = census([{ file: "field.tsx", props: [] }])
    expect(runComponentsCheck(contracts, codeCensus, {})).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Deviation markers.
// ---------------------------------------------------------------------------

describe("runComponentsCheck — deviation markers", () => {
  it('code: "none" — presence in code IS a finding', () => {
    const contracts = [
      contract("button", {
        props: { state: { type: "string", code: "none" } },
      }),
    ]
    const codeCensus = census([
      {
        file: "button.tsx",
        props: [{ name: "state", type: "string", required: true }],
      },
    ])
    const findings = runComponentsCheck(contracts, codeCensus, {})
    expect(findings).toEqual([
      expect.objectContaining({
        ruleId: "components/prop-unexpected",
        entity: "button",
        data: { prop: "state", reason: 'contract declares code: "none"' },
      }),
    ])
  })

  it('code: "none" — absence in code is correct and SILENT', () => {
    const contracts = [
      contract("button", {
        props: { state: { type: "string", code: "none" } },
      }),
    ]
    const codeCensus = census([{ file: "button.tsx", props: [] }])
    expect(runComponentsCheck(contracts, codeCensus, {})).toEqual([])
  })

  it('code: "unverified" — suppresses EVERY finding for that prop, both directions', () => {
    const contracts = [
      contract("button", {
        props: {
          adornment: {
            type: "slot",
            required: true,
            default: "x",
            code: "unverified",
          },
        },
      }),
    ]
    // Missing entirely on the code side — would be prop-missing were it not unverified.
    expect(
      runComponentsCheck(
        contracts,
        census([{ file: "button.tsx", props: [] }]),
        {},
      ),
    ).toEqual([])
    // Present but with a totally different shape — still nothing.
    const mismatched = census([
      {
        file: "button.tsx",
        props: [
          { name: "adornment", type: "number", required: false, default: 9 },
        ],
      },
    ])
    expect(runComponentsCheck(contracts, mismatched, {})).toEqual([])
  })

  it("a `design` marker is ignored entirely by this checker", () => {
    const contracts = [
      contract("field", {
        props: {
          label: { type: "string", required: true, design: "unverified" },
        },
      }),
    ]
    const codeCensus = census([
      {
        file: "field.tsx",
        props: [{ name: "label", type: "string", required: true }],
      },
    ])
    expect(runComponentsCheck(contracts, codeCensus, {})).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Config: severity overrides via the one `rules` block.
// ---------------------------------------------------------------------------

describe("runComponentsCheck — config-driven severity", () => {
  it("honors a rules override, including 'off'", () => {
    const contracts = [
      contract("field", {
        props: { label: { type: "string", required: true } },
      }),
    ]
    const codeCensus = census([{ file: "field.tsx", props: [] }])

    const warned = runComponentsCheck(contracts, codeCensus, {
      rules: { "components/prop-missing": "warn" },
    })
    expect(warned[0].severity).toBe("warn")

    const off = runComponentsCheck(contracts, codeCensus, {
      rules: { "components/prop-missing": "off" },
    })
    expect(off).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Determinism.
// ---------------------------------------------------------------------------

describe("runComponentsCheck — determinism", () => {
  it("the same inputs produce byte-identical findings JSON twice, regardless of input order", () => {
    const contracts = [
      contract("zebra", {
        props: { label: { type: "string", required: true } },
      }),
      contract("alpha", {
        props: { label: { type: "string", required: true } },
      }),
    ]
    const codeCensus = census([
      { file: "zebra.tsx", props: [] },
      { file: "alpha.tsx", props: [] },
    ])
    const a = JSON.stringify(runComponentsCheck(contracts, codeCensus, {}))
    const b = JSON.stringify(
      runComponentsCheck([...contracts].reverse(), codeCensus, {}),
    )
    expect(a).toBe(b)
    // Sorted by entity (compareEntities), "alpha" before "zebra".
    expect(JSON.parse(a).map(f => f.entity)).toEqual(["alpha", "zebra"])
  })
})

// ---------------------------------------------------------------------------
// The synthetic project's deliberate drift.
// ---------------------------------------------------------------------------

describe("runComponentsCheck — sanity check against a hand-built badge/field pair", () => {
  it("finds exactly the badge size drift and nothing else, matching the synthetic project's design", () => {
    const contracts = [
      contract("field", {
        path: "src/ui/field/field.tsx",
        props: {
          tone: {
            type: "enum",
            values: ["neutral", "danger"],
            default: "neutral",
            required: false,
          },
          label: { type: "string", required: true },
        },
      }),
      contract("badge", {
        path: "src/ui/badge/badge.tsx",
        props: {
          size: {
            type: "enum",
            values: ["sm", "md", "lg"],
            default: "sm",
            required: false,
          },
          label: { type: "string", required: true },
        },
      }),
    ]
    const codeCensus = census([
      {
        file: "src/ui/field/field.tsx",
        props: [
          {
            name: "tone",
            type: "enum",
            values: ["neutral", "danger"],
            default: "neutral",
            required: false,
          },
          { name: "label", type: "string", required: true },
        ],
      },
      {
        file: "src/ui/badge/badge.tsx",
        props: [
          {
            name: "size",
            type: "enum",
            values: ["sm", "md"],
            default: "sm",
            required: false,
          },
          { name: "label", type: "string", required: true },
        ],
      },
    ])
    const findings = runComponentsCheck(contracts, codeCensus, {})
    expect(findingIds(findings)).toEqual(["components/enum-values-mismatch"])
    expect(findings[0]).toEqual(
      expect.objectContaining({
        entity: "badge",
        data: { prop: "size", added: [], removed: ["lg"] },
      }),
    )
  })
})

// ---------------------------------------------------------------------------
// A prop the contract accounts for in `codegen` is not "unexpected".
// ---------------------------------------------------------------------------

describe("runComponentsCheck — codegen-declared props", () => {
  it("does not report className as unexpected when codegen.className is true", () => {
    // `codegen.className: true` IS the contract declaring a className
    // passthrough, in the place the schema provides for it. Reporting it as
    // undeclared makes the contract contradict itself — and it fired on the
    // very first real contract authored against a real component.
    const contracts = [
      {
        id: "widget",
        file: "widget.contract.json",
        contract: {
          id: "widget",
          title: "Widget",
          sources: { code: { path: "widget.tsx" } },
          codegen: { className: true },
          props: { label: { type: "string" } },
        },
      },
    ]
    const census = {
      components: [
        {
          file: "widget.tsx",
          props: [
            { name: "label", type: "string", required: true },
            { name: "className", type: "string", required: false },
          ],
        },
      ],
      diagnostics: [],
    }
    const findings = runComponentsCheck(contracts, census, {})
    expect(
      findings.filter(f => f.ruleId === "components/prop-unexpected"),
    ).toEqual([])
  })

  it("still reports a genuinely undeclared prop as unexpected", () => {
    const contracts = [
      {
        id: "widget",
        file: "widget.contract.json",
        contract: {
          id: "widget",
          title: "Widget",
          sources: { code: { path: "widget.tsx" } },
          codegen: { className: true },
          props: { label: { type: "string" } },
        },
      },
    ]
    const census = {
      components: [
        {
          file: "widget.tsx",
          props: [
            { name: "label", type: "string", required: true },
            { name: "mystery", type: "string", required: false },
          ],
        },
      ],
      diagnostics: [],
    }
    const findings = runComponentsCheck(contracts, census, {})
    expect(
      findings
        .filter(f => f.ruleId === "components/prop-unexpected")
        .map(f => f.data.prop),
    ).toEqual(["mystery"])
  })
})

// ---------------------------------------------------------------------------
// The contract worklist must be COMPLETE (issue #132).
//
// Coverage used to iterate only the components whose props parsed, so a
// component the extractor could not read vanished from the worklist entirely
// — no prop findings (correct, nothing to compare) and no coverage finding
// (wrong, the engine knew the file was a component). Measured on a real design
// system: 21 of 100 discovered files absent from a worklist `verify` reported
// as complete. The dangerous finding is the one that is not there.
// ---------------------------------------------------------------------------

describe("coverage counts confirmed components whose props could not be read", () => {
  it("reports an unreadable-props component as uncontracted", () => {
    const findings = runComponentsCheck(
      [],
      { ok: true, components: [], unreadableProps: ["untyped.tsx"] },
      {},
    )
    expect(findings).toEqual([
      expect.objectContaining({
        ruleId: "coverage/uncontracted-component",
        entity: "untyped.tsx",
        data: { path: "untyped.tsx" },
      }),
    ])
  })

  it("stays silent when a contract already references it", () => {
    const contracts = [contract("untyped", { path: "untyped.tsx" })]
    const findings = runComponentsCheck(
      contracts,
      { ok: true, components: [], unreadableProps: ["untyped.tsx"] },
      {},
    )
    expect(
      findings.filter(f => f.ruleId === "coverage/uncontracted-component"),
    ).toEqual([])
  })

  it("never emits prop findings for one — it carries no prop list", () => {
    // The whole reason `unreadableProps` is separate from `components`: an
    // entry with no props would report every contracted prop as missing.
    const contracts = [
      contract(
        "untyped",
        { path: "untyped.tsx" },
        { label: { type: "string" } },
      ),
    ]
    const findings = runComponentsCheck(
      contracts,
      { ok: true, components: [], unreadableProps: ["untyped.tsx"] },
      {},
    )
    expect(findings.filter(f => f.ruleId.startsWith("components/"))).toEqual([])
  })

  it("reports both readable and unreadable components, sorted together", () => {
    const findings = runComponentsCheck(
      [],
      {
        ok: true,
        components: [{ file: "b.tsx", props: [] }],
        unreadableProps: ["a.tsx"],
      },
      {},
    )
    expect(findings.map(f => f.entity)).toEqual(["a.tsx", "b.tsx"])
  })
})

describe("a contracted component whose props are unreadable is still covered", () => {
  const unreadableCensus = {
    ok: true,
    components: [],
    unreadableProps: ["untyped.tsx"],
  }

  it("does not claim contract-only — the component IS there", () => {
    const findings = runComponentsCheck(
      [contract("untyped", { path: "untyped.tsx" })],
      unreadableCensus,
      {},
    )
    expect(findings.filter(f => f.ruleId === "coverage/contract-only")).toEqual(
      [],
    )
  })

  it("still claims contract-only when nothing at all is at that path", () => {
    const findings = runComponentsCheck(
      [contract("missing", { path: "missing.tsx" })],
      unreadableCensus,
      {},
    )
    expect(findingIds(findings)).toContain("coverage/contract-only")
  })
})

// ---------------------------------------------------------------------------
// Intent staleness (#366) — the one thing about prose that IS checkable.
// ---------------------------------------------------------------------------

describe("runComponentsCheck — intent-unverified / intent-stale (#366)", () => {
  const props = [{ name: "label", type: "string", required: true }]
  const codeHash = hashJson(props)
  const withIntent = (id, intent) => {
    const entry = contract(id, {
      props: { label: { type: "string" } },
    })
    entry.contract.intent = intent
    return entry
  }
  const intentOnly = findings =>
    findings.filter(f => f.ruleId.startsWith("components/intent-"))

  it("intent text with no verifiedAgainst is unverified, and the message names the current hash", () => {
    const findings = runComponentsCheck(
      [withIntent("widget", { usedFor: "short labels" })],
      census([{ file: "widget.tsx", name: "Widget", props }]),
    )
    expect(intentOnly(findings)).toEqual([
      expect.objectContaining({
        ruleId: "components/intent-unverified",
        severity: "review",
        side: "spec",
        entity: "widget",
        data: { current: codeHash },
      }),
    ])
    expect(intentOnly(findings)[0].message).toContain(codeHash)
  })

  it("a matching verifiedAgainst is silent", () => {
    const findings = runComponentsCheck(
      [withIntent("widget", { usedFor: "x", verifiedAgainst: codeHash })],
      census([{ file: "widget.tsx", name: "Widget", props }]),
    )
    expect(intentOnly(findings)).toEqual([])
  })

  it("a changed props census makes the intent stale, naming both hashes", () => {
    const changed = [
      ...props,
      { name: "size", type: "string", required: false },
    ]
    const findings = runComponentsCheck(
      [withIntent("widget", { usedFor: "x", verifiedAgainst: codeHash })],
      census([{ file: "widget.tsx", name: "Widget", props: changed }]),
    )
    expect(intentOnly(findings)).toEqual([
      expect.objectContaining({
        ruleId: "components/intent-stale",
        severity: "review",
        data: { verifiedAgainst: codeHash, current: hashJson(changed) },
      }),
    ])
  })

  it("the hash is snapshot's own codeHash — hashJson of the props census, key order irrelevant", () => {
    const reordered = [{ required: true, type: "string", name: "label" }]
    expect(hashJson(reordered)).toBe(codeHash)
  })

  it("no intent block checks nothing; a block of only _comments checks nothing", () => {
    const findings = runComponentsCheck(
      [
        contract("widget", { props: { label: { type: "string" } } }),
        withIntent("gadget", { _note: "todo" }),
      ],
      census([
        { file: "widget.tsx", name: "Widget", props },
        { file: "gadget.tsx", name: "Gadget", props },
      ]),
    )
    expect(intentOnly(findings)).toEqual([])
  })
})

describe("runBindingFilesCheck (issue #400)", () => {
  const entries = [
    {
      id: "chip",
      outputPath: "components/chip/chip.cc.tsx",
      status: "missing",
      expected: "CHIP EXPECTED CONTENT",
    },
    {
      id: "card",
      outputPath: "components/card/card.cc.tsx",
      status: "stale",
      expected: "CARD EXPECTED CONTENT",
    },
  ]

  it("maps missing and stale onto their rules, side code, path in data", () => {
    const findings = runBindingFilesCheck(entries, {})
    expect(findings.map(f => [f.ruleId, f.entity])).toEqual([
      ["components/binding-file-stale", "card"],
      ["components/binding-file-missing", "chip"],
    ])
    expect(findings.every(f => f.side === "code")).toBe(true)
    expect(findings[1].data).toEqual({
      path: "components/chip/chip.cc.tsx",
      status: "missing",
      expected: "CHIP EXPECTED CONTENT",
    })
  })

  // Issue #579 — the two halves of one complaint: the message named the
  // `codegen` command #400 deleted, and the finding withheld the content the
  // engine had already rendered to compare against.
  it("names no regenerate path — there is no command that could (issue #579)", () => {
    const findings = runBindingFilesCheck(entries, {})
    expect(findings).toHaveLength(2)
    for (const finding of findings) {
      expect(finding.message).not.toMatch(/regenerat/i)
      // Nor any other implied writer: the audit path only ever reports.
      expect(finding.message).not.toMatch(/\b(run|rebuild|re-run)\b/i)
    }
  })

  it("carries the expected content on the finding, both statuses (issue #579)", () => {
    const findings = runBindingFilesCheck(entries, {})
    const byRule = Object.fromEntries(findings.map(f => [f.ruleId, f]))
    expect(byRule["components/binding-file-missing"].data.expected).toBe(
      "CHIP EXPECTED CONTENT",
    )
    expect(byRule["components/binding-file-stale"].data.expected).toBe(
      "CARD EXPECTED CONTENT",
    )
    // The message points the reader at the field rather than at a command.
    for (const finding of findings) {
      expect(finding.message).toContain("data.expected")
    }
  })

  it("says so out loud when there is nothing to expect (issue #579)", () => {
    const findings = runBindingFilesCheck(
      entries.map(({ expected: _expected, ...entry }) => entry),
      {},
    )
    for (const finding of findings) {
      // Present and null — never omitted, which an older engine that never
      // emitted the field would be indistinguishable from.
      expect(finding.data).toHaveProperty("expected", null)
      expect(finding.message).toMatch(/no expected content/)
      expect(finding.message).not.toMatch(/regenerat/i)
    }
  })

  // Issue #588 — a difference the provider could not compare is not drift it
  // can assert, and the third status is how a consumer tells the two apart.
  // Since #609 the one cause is a missing parser.
  describe("compare-unreliable (issue #588)", () => {
    const unreliable = [
      {
        id: "badge",
        outputPath: "components/badge/badge.cc.tsx",
        status: "compare-unreliable",
        expected: "BADGE EXPECTED CONTENT",
        ceiling: [
          {
            id: "typescript-not-installed",
            detail: "the parser is not installed",
          },
        ],
      },
    ]

    it("maps onto its own rule at review severity, never stale", () => {
      const [finding] = runBindingFilesCheck(unreliable, {})
      expect(finding.ruleId).toBe("components/binding-file-compare-unreliable")
      expect(finding.severity).toBe("review")
      expect(finding.entity).toBe("badge")
      expect(finding.side).toBe("code")
    })

    it("says why the answer is untrustworthy, in the words it was given", () => {
      const [finding] = runBindingFilesCheck(unreliable, {})
      expect(finding.message).toContain("the parser is not installed")
      // It is an engine limit, and the message has to say so: the whole point
      // is that a consumer stops reading it as a defect in their repo.
      expect(finding.message).toMatch(/limit/i)
      expect(finding.message).not.toMatch(/regenerat/i)
    })

    it("carries the expected content and the triggers in data", () => {
      const [finding] = runBindingFilesCheck(unreliable, {})
      expect(finding.data).toEqual({
        path: "components/badge/badge.cc.tsx",
        status: "compare-unreliable",
        expected: "BADGE EXPECTED CONTENT",
        ceiling: [
          {
            id: "typescript-not-installed",
            detail: "the parser is not installed",
          },
        ],
      })
    })

    it("reports an empty ceiling rather than omitting the field", () => {
      const [finding] = runBindingFilesCheck(
        unreliable.map(({ ceiling: _ceiling, ...entry }) => entry),
        {},
      )
      expect(finding.data).toHaveProperty("ceiling", [])
      expect(finding.message).toMatch(/names no shape/)
    })

    it("can be turned off on its own, without touching stale", () => {
      const findings = runBindingFilesCheck([...entries, ...unreliable], {
        rules: { "components/binding-file-compare-unreliable": "off" },
      })
      expect(findings.map(f => f.ruleId)).toEqual([
        "components/binding-file-stale",
        "components/binding-file-missing",
      ])
    })
  })

  it("honours rules config per id, and an empty list is silence", () => {
    expect(runBindingFilesCheck([], {})).toEqual([])
    const findings = runBindingFilesCheck(entries, {
      rules: { "components/binding-file-stale": "off" },
    })
    expect(findings.map(f => f.ruleId)).toEqual([
      "components/binding-file-missing",
    ])
  })
})

// ---------------------------------------------------------------------------
// components/variant-combinations-mismatch (issue #403) — the combination-level
// twin of `components/enum-values-mismatch`: that rule compares which VALUES a
// prop offers, this one compares which COMBINATIONS of them the design set
// actually enumerates. Runs only for a contract that declares
// `invalidVariantCombinations` (ADR-003: the field becomes checkable when a
// contract uses it), and only against a design entry carrying
// `variantCombinations` (the bindings gather's merge).
// ---------------------------------------------------------------------------

function variantContract(invalidVariantCombinations, props) {
  const base = contractWithDesign("button", {
    designMatchKey: "acme:1:1",
    hasSource: false,
    props: props || {
      size: { type: "enum", values: ["sm", "lg"], required: false },
      variant: { type: "enum", values: ["solid", "ghost"], required: false },
    },
  })
  return [
    { ...base, contract: { ...base.contract, invalidVariantCombinations } },
  ]
}

function variantDesignCensus(variantCombinations, props) {
  return designCensus([
    {
      matchKey: "acme:1:1",
      name: "Button",
      props: props || [
        { name: "size", type: "enum", values: ["sm", "lg"] },
        { name: "variant", type: "enum", values: ["solid", "ghost"] },
      ],
      ...(variantCombinations ? { variantCombinations } : {}),
    },
  ])
}

function variantFindings(contracts, entries) {
  return runComponentsCheck(contracts, census([]), {}, undefined, entries)
}

describe("runComponentsCheck — components/variant-combinations-mismatch (#403)", () => {
  const full = [
    { size: "sm", variant: "solid" },
    { size: "sm", variant: "ghost" },
    { size: "lg", variant: "solid" },
    { size: "lg", variant: "ghost" },
  ]

  it("reports a combination the design has that the contract marks invalid", () => {
    const findings = variantFindings(
      variantContract([{ size: "lg", variant: "ghost" }]),
      variantDesignCensus(full),
    )
    expect(findings).toEqual([
      expect.objectContaining({
        ruleId: "components/variant-combinations-mismatch",
        surface: "components",
        side: "design",
        entity: "button",
        severity: "review",
        data: { invalid: [{ size: "lg", variant: "ghost" }], missing: [] },
      }),
    ])
    expect(findings[0].message).toContain("the contract marks invalid")
  })

  it("reports a combination the contract implies that the design lacks", () => {
    const findings = variantFindings(
      variantContract([{ size: "lg", variant: "ghost" }]),
      variantDesignCensus([
        { size: "sm", variant: "solid" },
        { size: "sm", variant: "ghost" },
      ]),
    )
    expect(findings).toEqual([
      expect.objectContaining({
        ruleId: "components/variant-combinations-mismatch",
        data: { invalid: [], missing: [{ size: "lg", variant: "solid" }] },
      }),
    ])
    expect(findings[0].message).toContain("does not have")
  })

  it("is silent when the design enumerates exactly the implied set", () => {
    expect(
      variantFindings(
        variantContract([{ size: "lg", variant: "ghost" }]),
        variantDesignCensus([
          { size: "sm", variant: "solid" },
          { size: "sm", variant: "ghost" },
          { size: "lg", variant: "solid" },
        ]),
      ),
    ).toEqual([])
  })

  it("matches PARTIALLY — an entry naming one prop forbids every combination containing it", () => {
    const findings = variantFindings(
      variantContract([{ variant: "ghost" }]),
      variantDesignCensus(full),
    )
    expect(findings[0].data).toEqual({
      invalid: [
        { size: "lg", variant: "ghost" },
        { size: "sm", variant: "ghost" },
      ],
      missing: [],
    })
  })

  it("matches EXACTLY and case-sensitively (D1) — Ghost is not ghost", () => {
    expect(
      variantFindings(
        variantContract([{ size: "lg", variant: "Ghost" }]),
        variantDesignCensus(full),
      ),
    ).toEqual([])
  })

  it("accepts a numeric contract value against its exact string form from design (#297's boundary rule)", () => {
    const findings = variantFindings(
      variantContract([{ size: 2 }], {
        size: { type: "enum", values: [2, 3], required: false },
      }),
      variantDesignCensus(
        [{ size: "2" }, { size: "3" }],
        [{ name: "size", type: "enum", values: ["2", "3"] }],
      ),
    )
    expect(findings[0].data).toEqual({ invalid: [{ size: 2 }], missing: [] })
  })

  it("does not run at all when the contract declares no invalidVariantCombinations", () => {
    expect(
      variantFindings(variantContract(undefined), variantDesignCensus([])),
    ).toEqual([])
  })

  it("does not run when the design entry carries no variantCombinations — not gathered is not empty", () => {
    expect(
      variantFindings(
        variantContract([{ size: "lg", variant: "ghost" }]),
        variantDesignCensus(undefined),
      ),
    ).toEqual([])
  })

  it("skips a prop the contract excludes from the design side, rather than guessing at it", () => {
    // `design: "unverified"` asserts nothing about `variant` in design, so a
    // combination entry naming it can never be matched there.
    const findings = variantFindings(
      variantContract([{ size: "lg", variant: "ghost" }], {
        size: { type: "enum", values: ["sm", "lg"], required: false },
        variant: {
          type: "enum",
          values: ["solid", "ghost"],
          required: false,
          design: "unverified",
        },
      }),
      variantDesignCensus([{ size: "sm" }, { size: "lg" }]),
    )
    expect(findings.map(f => f.ruleId)).toEqual([])
  })

  it("reads a renamed design prop under its design name", () => {
    const findings = variantFindings(
      variantContract([{ size: "lg" }], {
        size: {
          type: "enum",
          values: ["sm", "lg"],
          required: false,
          design: { name: "Size", reason: "design casing" },
        },
      }),
      variantDesignCensus(
        [{ Size: "sm" }, { Size: "lg" }],
        [{ name: "Size", type: "enum", values: ["sm", "lg"] }],
      ),
    )
    expect(findings.map(f => [f.ruleId, f.data])).toEqual([
      [
        "components/variant-combinations-mismatch",
        { invalid: [{ size: "lg" }], missing: [] },
      ],
    ])
  })

  it("is skipped when the two sides do not agree on which props a combination names", () => {
    // `state` is compared but no design combination carries it — the prop-level
    // rules already say so; asserting anything here would double-report.
    expect(
      variantFindings(
        variantContract([{ size: "lg" }], {
          size: { type: "enum", values: ["sm", "lg"], required: false },
          state: { type: "enum", values: ["rest", "hover"], required: false },
        }),
        variantDesignCensus(
          [{ size: "sm" }, { size: "lg" }],
          [
            { name: "size", type: "enum", values: ["sm", "lg"] },
            { name: "state", type: "enum", values: ["rest", "hover"] },
          ],
        ),
      ).map(f => f.ruleId),
    ).toEqual([])
  })

  it("honours a rules config turning it off", () => {
    expect(
      runComponentsCheck(
        variantContract([{ size: "lg", variant: "ghost" }]),
        census([]),
        { rules: { "components/variant-combinations-mismatch": "off" } },
        undefined,
        variantDesignCensus(full),
      ),
    ).toEqual([])
  })
})
