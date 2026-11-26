/**
 * styles-shorthand-single-var.test.js — issue #38: a shorthand whose whole
 * value is one `var()` is compared with the contract like its longhand, while
 * a multi-part shorthand, or one several properties share, stays uncompared.
 *
 * Declarations are built through the census's own classifier, so each case
 * reads as the CSS a stylesheet would actually contain.
 */

import {
  PROPERTY_DEFS,
  resolveCssFinest,
  runStylesCheck,
} from "../src/modules/styles.mjs"
import { classifyDeclarationValue } from "../src/sources/styles.mjs"

const PREFIX = "--acme-"
const config = { conventions: { cssVarPrefix: PREFIX } }

function audit(base, declarations) {
  const contracts = [
    {
      id: "widget",
      file: "widget.contract.json",
      contract: {
        id: "widget",
        title: "widget",
        sources: { code: { styles: "widget.scss" } },
        anatomy: { root: { type: "container" } },
        styles: { root: { base } },
      },
    },
  ]
  const census = {
    files: [
      {
        file: "widget.scss",
        selectors: [
          {
            selector: ".widget",
            parent: null,
            declarations: Object.entries(declarations).map(
              ([property, value]) => ({
                property,
                ...classifyDeclarationValue(value),
              }),
            ),
          },
        ],
      },
    ],
  }
  return runStylesCheck(contracts, census, config).map(f => ({
    ruleId: f.ruleId,
    entity: f.entity,
    property: f.data?.property,
  }))
}

describe("#38 a single-var shorthand is compared like its longhand", () => {
  const bg = { background: { token: "acme.color.bg" } }

  it("#38 `background: var(--wrong)` is a token-mismatch, as `background-color` is", () => {
    const expected = [
      {
        ruleId: "styles/token-mismatch",
        entity: "widget.root",
        property: "background",
      },
    ]
    expect(
      audit(bg, { "background-color": "var(--acme-color-wrong)" }),
    ).toEqual(expected)
    expect(audit(bg, { background: "var(--acme-color-wrong)" })).toEqual(
      expected,
    )
  })

  it("#38 `background: var(--right)` matches", () => {
    expect(audit(bg, { background: "var(--acme-color-bg)" })).toEqual([])
  })

  it("#38 a var() fallback is still one var(): compared, not skipped", () => {
    expect(
      audit(bg, { background: "var(--acme-color-wrong, #fff)" }).map(
        f => f.ruleId,
      ),
    ).toEqual(["styles/token-mismatch"])
  })

  it("#38 `background: var(--x)` the contract does not declare is binding-unexpected, as the longhand is", () => {
    const expected = [
      {
        ruleId: "styles/binding-unexpected",
        entity: "widget.root",
        property: "background",
      },
    ]
    expect(audit({}, { "background-color": "var(--acme-color-bg)" })).toEqual(
      expected,
    )
    expect(audit({}, { background: "var(--acme-color-bg)" })).toEqual(expected)
  })

  it("#38 scaffold's resolution sees the shorthand's var as a var", () => {
    const def = PROPERTY_DEFS.find(d => d.key === "background")
    const declarations = new Map([
      [
        "background",
        {
          property: "background",
          ...classifyDeclarationValue("var(--acme-color-bg)"),
        },
      ],
    ])
    expect(
      resolveCssFinest(
        declarations,
        def.finestSlots,
        def.fallbacks,
        def.cssNames,
        def.shorthands,
      )._value,
    ).toEqual(
      expect.objectContaining({ kind: "var", varName: "--acme-color-bg" }),
    )
  })
})

describe("#38 a multi-part or shared shorthand stays uncompared", () => {
  const border = {
    border: {
      width: { token: "acme.border.thin" },
      color: { token: "acme.color.border" },
    },
  }

  it("#38 `border: 1px solid var(--wrong)` raises nothing", () => {
    expect(
      audit(border, { border: "1px solid var(--acme-color-wrong)" }),
    ).toEqual([])
  })

  it("#38 `border-top: var(--w) solid var(--c)` raises nothing", () => {
    expect(
      audit(border, {
        "border-top": "var(--acme-border-wrong) solid var(--acme-color-wrong)",
      }),
    ).toEqual([])
  })

  it("#38 `border: var(--x)` raises nothing: one var, but border carries several properties", () => {
    expect(audit(border, { border: "var(--acme-color-border)" })).toEqual([])
    expect(audit({}, { border: "var(--acme-color-border)" })).toEqual([])
  })

  it("#38 `background: var(--a) var(--b)` (two parts) raises nothing", () => {
    expect(
      audit(
        { background: { token: "acme.color.bg" } },
        { background: "var(--acme-image) var(--acme-color-wrong)" },
      ),
    ).toEqual([])
  })
})
