/**
 * lint-literal-and-dollar.test.js — `lint/tier-alias-missing` and
 * `lint/unknown-dollar-field` (#639).
 *
 * Both rules read the TOKEN census, so each fixture goes through the real
 * `censusTokens` before its check: `lint/unknown-dollar-field` in particular
 * only exists because the parser drops an unknown `$` key, so a hand-built
 * census here would test a shape the real one might never produce.
 *
 * Both are OPT-IN: they run only when `rules` names them. The tier names
 * (`quarry`/`forge`/`facade`) share no substring with any real project's.
 */

import { join } from "node:path"

import { run } from "../src/cli/main.mjs"
import {
  RULES,
  runTierAliasMissingCheck,
  runUnknownDollarFieldCheck,
} from "../src/modules/lint.mjs"
import { censusTokens } from "../src/sources/code.mjs"
import { createSyntheticProject } from "./helpers/synthetic-project.mjs"

const FIXTURES = join(process.cwd(), "__tests__", "fixtures")
const TIERS = ["quarry", "forge", "facade"]

async function census(file) {
  return censusTokens({ paths: { tokensFile: file } }, { root: FIXTURES })
}

describe("the registry", () => {
  it("registers both rules on the lint surface", () => {
    const ids = RULES.filter(r => r.surface === "lint").map(r => r.id)
    expect(ids).toEqual(
      expect.arrayContaining([
        "lint/tier-alias-missing",
        "lint/unknown-dollar-field",
      ]),
    )
  })
})

describe("lint/tier-alias-missing", () => {
  const enabled = {
    lint: { tiers: TIERS },
    rules: { "lint/tier-alias-missing": "warn" },
  }

  it("reports a token above the first tier that holds a literal", async () => {
    const tokens = await census("tokens-tier-alias-missing.json")
    expect(tokens.ok).toBe(true)
    const findings = runTierAliasMissingCheck(tokens, enabled)
    // `forge.color.bg` and `facade.gap` hold literals. `forge.color.fg`
    // aliases; `forge.edge` aliases a member; `quarry.*` is the primitive
    // tier; `loose.gap` sits in no configured tier.
    expect(findings.map(f => f.entity)).toEqual([
      "facade.gap",
      "forge.color.bg",
    ])
    expect(findings[0]).toEqual(
      expect.objectContaining({
        ruleId: "lint/tier-alias-missing",
        surface: "lint",
        side: "code",
        severity: "warn",
        data: { token: "facade.gap", tier: "facade" },
      }),
    )
  })

  it("is silent unless `rules` names it", async () => {
    const tokens = await census("tokens-tier-alias-missing.json")
    expect(
      runTierAliasMissingCheck(tokens, { lint: { tiers: TIERS } }),
    ).toEqual([])
    expect(
      runTierAliasMissingCheck(tokens, {
        ...enabled,
        rules: { "lint/tier-alias-missing": "off" },
      }),
    ).toEqual([])
  })

  it("is silent without at least two tiers", async () => {
    const tokens = await census("tokens-tier-alias-missing.json")
    const { rules } = enabled
    expect(runTierAliasMissingCheck(tokens, { rules })).toEqual([])
    expect(
      runTierAliasMissingCheck(tokens, { rules, lint: { tiers: ["forge"] } }),
    ).toEqual([])
  })

  it("takes the configured severity", async () => {
    const tokens = await census("tokens-tier-alias-missing.json")
    const findings = runTierAliasMissingCheck(tokens, {
      ...enabled,
      rules: { "lint/tier-alias-missing": "error" },
    })
    expect(findings.map(f => f.severity)).toEqual(["error", "error"])
  })
})

describe("lint/unknown-dollar-field", () => {
  const enabled = { rules: { "lint/unknown-dollar-field": "warn" } }

  it("census: records every unreserved `$` key, on tokens and groups", async () => {
    const tokens = await census("tokens-unknown-dollar-field.json")
    expect(tokens.ok).toBe(true)
    // `$schema` at the root, `$type`/`$extensions` on a group, `$description`
    // and `$deprecated` on a token and `$root` are all reserved; nothing
    // inside `$extensions` is inspected.
    expect(tokens.dollarFields).toEqual([
      {
        path: "quarry",
        key: "$descripton",
        file: "tokens-unknown-dollar-field.json",
      },
      {
        path: "quarry.color.slate",
        key: "$vaule",
        file: "tokens-unknown-dollar-field.json",
      },
      {
        path: "quarry.size",
        key: "$tyep",
        file: "tokens-unknown-dollar-field.json",
      },
    ])
  })

  it("reports each key, naming the key and where it sits", async () => {
    const tokens = await census("tokens-unknown-dollar-field.json")
    const findings = runUnknownDollarFieldCheck(tokens, enabled)
    expect(findings.map(f => f.entity)).toEqual([
      "quarry.$descripton",
      "quarry.color.slate.$vaule",
      "quarry.size.$tyep",
    ])
    expect(findings[1]).toEqual(
      expect.objectContaining({
        ruleId: "lint/unknown-dollar-field",
        surface: "lint",
        side: "code",
        severity: "warn",
        data: {
          path: "quarry.color.slate",
          key: "$vaule",
          file: "tokens-unknown-dollar-field.json",
        },
      }),
    )
  })

  it("is silent unless `rules` names it", async () => {
    const tokens = await census("tokens-unknown-dollar-field.json")
    expect(runUnknownDollarFieldCheck(tokens, {})).toEqual([])
    expect(
      runUnknownDollarFieldCheck(tokens, {
        rules: { "lint/unknown-dollar-field": "off" },
      }),
    ).toEqual([])
  })

  it("reports a key on the document root under its own name", () => {
    const findings = runUnknownDollarFieldCheck(
      { ok: true, tokens: [], dollarFields: [{ path: "", key: "$foo" }] },
      enabled,
    )
    expect(findings.map(f => f.entity)).toEqual(["$foo"])
  })
})

// The CLI is where "opt-in" is decided, so the gate is pinned there too.
describe("design-delta lint — the opt-in gate", () => {
  function fakeStream() {
    const writes = []
    return { stream: { write: chunk => writes.push(chunk) }, writes }
  }

  async function lintJson(project) {
    const { stream: stdout, writes } = fakeStream()
    const { stream: stderr } = fakeStream()
    const cwd = process.cwd()
    process.chdir(project.root)
    try {
      await run(["--config", project.configPath, "lint", "--json"], {
        stdout,
        stderr,
      })
      return JSON.parse(writes.join(""))
    } finally {
      process.chdir(cwd)
    }
  }

  // The synthetic project's tokens all sit under one root, `acme`, so a
  // two-tier list with `acme` second makes every one of its literals a
  // finding — and one `$` typo gives the other rule something to say.
  const tokens = { acme: { $tyep: "color" } }
  const lint = { tiers: ["quarry", "acme"] }
  const ids = result =>
    [...new Set(result.findings.map(f => f.ruleId))].filter(
      id =>
        id === "lint/tier-alias-missing" || id === "lint/unknown-dollar-field",
    )

  it("says nothing when `rules` names neither rule", async () => {
    const project = createSyntheticProject({ tokens, lint })
    try {
      expect(ids(await lintJson(project))).toEqual([])
    } finally {
      project.cleanup()
    }
  })

  it("runs each rule once `rules` names it", async () => {
    const project = createSyntheticProject({
      tokens,
      lint,
      rules: {
        "lint/tier-alias-missing": "warn",
        "lint/unknown-dollar-field": "warn",
      },
    })
    try {
      expect(ids(await lintJson(project)).sort()).toEqual([
        "lint/tier-alias-missing",
        "lint/unknown-dollar-field",
      ])
    } finally {
      project.cleanup()
    }
  })
})
