/**
 * modules-token-folding.test.js — `tokenMapping.aliasFoldingRules`'s
 * interpreter (#569): the grammar a project writes its design→code naming in.
 */

import { foldDesignName } from "../src/modules/token-folding.mjs"

const rules = {
  groups: {
    color: [
      { when: { index: 0, endsWith: "-vivid" }, template: "vivid{0^~}.{1+}" },
      { when: { index: 1, equals: "vivid" }, template: "vivid{0^}.{2+}" },
    ],
    easing: [{ when: { index: 0, endsWith: "" }, template: "{0c}" }],
    size: [{ when: { index: 0, equals: "col" }, template: "column.{1}" }],
  },
}

describe("foldDesignName", () => {
  it("{n^~} strips the endsWith suffix, {n+} joins the rest", () => {
    expect(foldDesignName("color/blue-vivid/50", rules)).toBe(
      "color.vividBlue.50",
    )
  })

  it("the first matching rule wins, in order", () => {
    expect(foldDesignName("color/blue/vivid/600", rules)).toBe(
      "color.vividBlue.600",
    )
  })

  it("{nc} camel-cases with a lower-case first letter", () => {
    expect(foldDesignName("easing/out-cubic", rules)).toBe("easing.outCubic")
    expect(foldDesignName("easing/outQuart", rules)).toBe("easing.outQuart")
  })

  it("{n} is the segment as written; out of range renders empty", () => {
    expect(foldDesignName("size/col/10", rules)).toBe("size.column.10")
    expect(foldDesignName("size/col", rules)).toBe("size.column.")
  })

  it("returns null when no rule in the group matches, or the group has none", () => {
    expect(foldDesignName("color/neutral/900", rules)).toBeNull()
    expect(foldDesignName("radius/md", rules)).toBeNull()
    expect(foldDesignName("color/blue-vivid/50", undefined)).toBeNull()
  })

  it("skips a structurally invalid rule instead of throwing", () => {
    const broken = {
      groups: {
        color: [
          null,
          { when: { index: 0, endsWith: "-vivid" } },
          { when: { index: -1, equals: "x" }, template: "bad" },
          { when: { index: 0, endsWith: "-vivid" }, template: "ok.{1}" },
        ],
      },
    }
    expect(foldDesignName("color/blue-vivid/50", broken)).toBe("color.ok.50")
  })
})
