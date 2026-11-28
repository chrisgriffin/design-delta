/**
 * core-decisions-page.test.js — the page an owner answers on (issue #62):
 * self-contained, deterministic, safe to embed findings in, and labeled.
 */

import { buildDecisions } from "../src/core/decisions.mjs"
import { renderDecisionsPage } from "../src/core/decisions-page.mjs"

const findings = [
  {
    ruleId: "tokens/token-unreferenced",
    severity: "review",
    surface: "tokens",
    side: "code",
    entity: "brand.red",
    message:
      'nothing references "brand.red" </script><script>alert(1)</script>',
  },
  {
    ruleId: "coverage/design-only",
    severity: "warn",
    surface: "coverage",
    side: "design",
    entity: "Chip",
    message: "a design component with no contract",
  },
]

const render = (over = {}) =>
  renderDecisionsPage({
    ...buildDecisions({ findings }),
    mode: "static",
    snapshots: ["2026-11-01T00:00:00Z"],
    ...over,
  })

describe("renderDecisionsPage", () => {
  it("renders the same bytes for the same input", () => {
    expect(render()).toBe(render())
  })

  it("fetches nothing: no external script, style, font or image", () => {
    const html = render()
    expect(html).not.toMatch(/\b(src|href)=["']?(https?:)?\/\//i)
    expect(html).not.toMatch(/@import|url\(\s*["']?(https?:)?\/\//i)
    expect(html).not.toMatch(/<link\b/i)
  })

  it("escapes finding text so it cannot close a tag", () => {
    const html = render()
    expect(html).not.toContain("<script>alert(1)</script>")
    expect(html).toContain("&lt;/script&gt;")
    expect(html.match(/<script\b/g)).toHaveLength(2)
  })

  it("opens each decision on its recommended answer, marked as recommended", () => {
    const html = render()
    expect(html).toMatch(
      /value="accept" checked> Accept it: correct by design <span class="badge">Recommended<\/span>/,
    )
    expect(html).toMatch(/value="later"/)
  })

  it("opens an already-answered decision on Decide later, listing every answer on file", () => {
    const html = renderDecisionsPage({
      ...buildDecisions({
        findings: [
          { ...findings[0], message: "unused" },
          { ...findings[0], entity: "brand.blue", message: "unused" },
        ],
        previous: {
          version: 1,
          entries: [
            {
              id: "a",
              ruleId: "tokens/token-unreferenced",
              pile: "tokens-config",
              entities: ["brand.red"],
              answer: "fix-code",
              note: "use it in the badge",
            },
            {
              id: "b",
              ruleId: "tokens/token-unreferenced",
              pile: "tokens-config",
              entities: ["brand.blue"],
              answer: "change-contract",
            },
          ],
        },
      }),
      mode: "static",
    })
    expect(html).toMatch(/value="later" checked>/)
    expect(html).not.toMatch(/value="accept" checked>/)
    expect(html).toContain(
      '<strong>Fix the code</strong> for <code>brand.red</code>, "use it in the badge"',
    )
    expect(html).toContain(
      "<strong>Change the contract</strong> for <code>brand.blue</code>",
    )
  })

  it("labels every text control", () => {
    const html = render()
    const ids = [
      ...html.matchAll(/<(?:input type="text"|textarea) id="([^"]+)"/g),
    ].map(m => m[1])
    expect(ids.length).toBeGreaterThan(0)
    for (const id of ids) expect(html).toContain(`<label for="${id}">`)
  })

  it("says when the design snapshot was gathered, when a design decision is on the page", () => {
    expect(render()).toContain("2026-11-01T00:00:00Z")
  })

  it("embeds the token only in serve mode", () => {
    expect(render()).not.toContain("tok-123")
    expect(render({ mode: "serve", token: "tok-123" })).toContain(
      '"token":"tok-123"',
    )
  })

  it("says so when nothing is waiting", () => {
    const html = renderDecisionsPage({
      decisions: [],
      codeCount: 2,
      mode: "static",
    })
    expect(html).toContain("Nothing is waiting on you.")
    expect(html).toContain("2 more findings can be fixed in code")
  })
})
