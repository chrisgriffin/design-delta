/**
 * lint-token-id.test.js — a delegated `lint/token-rule` finding names the
 * TOKEN it was raised against, not the rule id (issue #636).
 *
 * End to end through the real `@terrazzo/parser` (`censusTokenLint`) and the
 * pure module (`runLintCheck`), because the token id is resolved in the one
 * place that holds both the token and the violation's source node. Generic
 * token names in a real temp tree.
 */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { runLintCheck } from "../src/modules/lint.mjs"
import { censusTokenLint } from "../src/sources/code.mjs"

let root

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "design-delta-lint-token-id-"))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

// Pretty-printed, so each token's line is fixed: `fast`'s `$value` is on
// line 6, `ok` (inherits `$type`, so `core/required-type` flags it) opens on
// line 8, `untyped` on line 15.
const TOKENS = {
  system: {
    duration: {
      $type: "duration",
      fast: { $value: "fast-ish" },
      ok: { $value: { value: 100, unit: "ms" } },
    },
    untyped: { $value: 4 },
  },
}

const config = { paths: { tokensFile: "tokens.json" } }
const rules = { "core/valid-duration": "error", "core/required-type": "error" }

async function lintFindings() {
  writeFileSync(join(root, "tokens.json"), JSON.stringify(TOKENS, null, 2))
  const census = await censusTokenLint(config, { root, rules })
  expect(census.delegated).toBe(true)
  return runLintCheck(census, config)
}

describe("lint/token-rule — names the token (#636)", () => {
  it("an invalid $value names its token in entity and data.token", async () => {
    const findings = await lintFindings()
    const duration = findings.filter(f => f.data.rule === "core/valid-duration")
    expect(duration).toHaveLength(1)
    expect(duration[0]).toMatchObject({
      ruleId: "lint/token-rule",
      entity: "system.duration.fast",
      data: {
        rule: "core/valid-duration",
        token: "system.duration.fast",
        // Unchanged: value, file and line still travel as before.
        value: "fast-ish",
        file: "tokens.json",
        line: 6,
      },
    })
  })

  it("a token with no $type names its token too", async () => {
    const findings = await lintFindings()
    const required = findings.filter(f => f.data.rule === "core/required-type")
    expect(
      required.map(f => [f.entity, f.data.token, f.data.file, f.data.line]),
    ).toEqual([
      ["system.duration.ok", "system.duration.ok", "tokens.json", 8],
      ["system.untyped", "system.untyped", "tokens.json", 15],
    ])
  })

  it("a violation traced to no token keeps the rule-id fallback and its position", () => {
    const findings = runLintCheck({
      ok: true,
      violations: [
        {
          ruleId: "core/valid-color",
          level: "error",
          message: "bad color",
          value: "#f00",
          file: "tokens.json",
          line: 3,
        },
      ],
    })
    expect(findings[0].entity).toBe("core/valid-color")
    expect(findings[0].data).toMatchObject({
      token: undefined,
      value: "#f00",
      file: "tokens.json",
      line: 3,
    })
  })
})
