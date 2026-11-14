/**
 * rules-reference.test.js — binds `docs/rules.md` to the rule registries it is
 * generated from, and binds those registries to the package's public surface.
 *
 * `docs/rules.md` is written by `scripts/generate-rules-reference.mjs`, and the
 * `schema` CI job runs that script's `--check` flag, so a stale doc already
 * fails there. What `--check` structurally CANNOT catch is a registry the
 * generator never knew about: the script spreads a hand-written list of
 * exported `*Rules` arrays, so a sixth module registering a seventh surface
 * would generate a doc that is "current" and silently missing every rule in it.
 * `--check` would be green, `npm test` would be green, and the rule reference
 * would be a lie.
 *
 * So the chain is asserted in both directions here:
 *
 *   every `export const RULES` under src/  →  reachable from src/index.mjs
 *   every rule reachable from src/index.mjs  →  documented in docs/rules.md
 *
 * with the middle link found by SHAPE (any exported array of rule descriptors),
 * never by the generator's own list — asking the generator what it renders and
 * then checking it rendered that would be circular.
 *
 * Follows `docs-parity.test.js` and `layering.test.js`: a cross-cutting rule
 * enforced as a test rather than as bespoke CI tooling, negative controls
 * included.
 */

import { readdirSync, readFileSync, statSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import * as index from "../src/index.mjs"
import {
  SEVERITIES,
  SEVERITY_DESCRIPTIONS,
  SURFACES,
  SURFACE_DESCRIPTIONS,
} from "../src/core/findings.mjs"
import { ruleArraysOf } from "./helpers/rule-arrays.mjs"

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const SRC = join(ROOT, "src")
const DOC = join(ROOT, "docs", "rules.md")

const doc = readFileSync(DOC, "utf8")

function walk(dir) {
  let out = []
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) out = out.concat(walk(full))
    else if (name.endsWith(".mjs")) out.push(full)
  }
  return out
}

const exportedRules = ruleArraysOf(index).flat()
const exportedIds = [...new Set(exportedRules.map(rule => rule.id))].sort()

// Every registry under src/ is named exactly `RULES` (not `FOO_RULES` or
// anything else) — load-bearing for this scrape, which finds a registry by
// that literal export name rather than by shape. A module naming its
// registry differently and not re-exporting it from src/index.mjs would
// escape both directions of the chain this test checks.
const registryFiles = walk(SRC).filter(file =>
  readFileSync(file, "utf8").includes("export const RULES"),
)

/**
 * The `Rule` column of every rule table in the doc — rows look like
 * "| `tokens/var-unresolved` | error | A component uses…|". The severity column
 * is captured too, so a default that changed in the registry without the doc
 * being regenerated is caught by value and not only by presence.
 */
function rulesDocumented(markdown) {
  return [
    ...markdown.matchAll(/^\|\s*`([a-z]+\/[a-z-]+)`\s*\|\s*([a-z]+)\s*\|/gm),
  ].map(match => ({ id: match[1], defaultSeverity: match[2] }))
}

/**
 * A tracker issue cited by number, in every form it is written: `issue #400`,
 * `(#640)`, `(issues #401, #402)`. Text that lands in a consumer's
 * `docs/rules.md` and reports reads such a number as the consumer's own issue
 * and points nowhere; the history belongs in a code comment, which a consumer
 * never reads. A `#` followed by digits and then a hex letter is a colour
 * (`#1a2b3c`), and `&#123;` is an HTML entity — neither is a citation.
 */
const TRACKER_CITATION = /(?<![&\w])#\d+(?![0-9a-fA-F])/g

/** The lines of `markdown` that cite a tracker issue by number. */
function linesCitingIssues(markdown) {
  return markdown
    .split("\n")
    .filter(line => line.match(TRACKER_CITATION) !== null)
}

/** The `### \`<surface>\`` headings, in document order. */
function surfacesDocumented(markdown) {
  return [...markdown.matchAll(/^### `([a-z]+)`$/gm)].map(match => match[1])
}

describe("the rule vocabulary is fully described", () => {
  it("describes exactly the declared severities", () => {
    expect(Object.keys(SEVERITY_DESCRIPTIONS).sort()).toEqual(
      [...SEVERITIES].sort(),
    )
  })

  it("describes exactly the declared surfaces", () => {
    expect(Object.keys(SURFACE_DESCRIPTIONS).sort()).toEqual(
      [...SURFACES].sort(),
    )
  })

  it("#16 nothing in docs/rules.md cites a tracker issue", () => {
    // The generated doc, not the registries: it carries every rule
    // description and the surface and severity descriptions alike, so one
    // assertion covers every source the generator renders.
    expect(linesCitingIssues(doc)).toEqual([])
  })

  it("registers every rule against a declared surface and severity", () => {
    for (const rule of exportedRules) {
      expect(SURFACES).toContain(rule.surface)
      expect(SEVERITIES).toContain(rule.defaultSeverity)
    }
  })
})

describe("src/index.mjs ↔ the rule registries under src/", () => {
  it("finds registries to check (negative control)", () => {
    // Every assertion below is vacuous if the scrape finds nothing, which is
    // exactly how a guard ships green and useless (see layering.test.js).
    expect(registryFiles.length).toBeGreaterThan(0)
    expect(exportedIds.length).toBeGreaterThan(0)
  })

  it("exports every rule declared anywhere under src/", async () => {
    // The link the generator's `--check` cannot see: a registry that exists but
    // is not on the package's public surface is a registry the generator never
    // imports, so its rules would be missing from a doc that still reports
    // itself current.
    for (const file of registryFiles) {
      const declared = (await import(file)).RULES
      expect(Array.isArray(declared)).toBe(true)
      for (const rule of declared) {
        expect(exportedIds).toContain(rule.id)
      }
    }
  })
})

describe("docs/rules.md ↔ src/index.mjs", () => {
  it("documents exactly the rules the package exports", () => {
    expect(
      rulesDocumented(doc)
        .map(rule => rule.id)
        .sort(),
    ).toEqual(exportedIds)
  })

  it("documents each rule's actual default severity", () => {
    const bySeverity = Object.fromEntries(
      exportedRules.map(rule => [rule.id, rule.defaultSeverity]),
    )
    for (const documented of rulesDocumented(doc)) {
      expect(documented.defaultSeverity).toBe(bySeverity[documented.id])
    }
  })

  it("documents every surface that has rules, in the declared order", () => {
    const withRules = SURFACES.filter(surface =>
      exportedRules.some(rule => rule.surface === surface),
    )
    expect(surfacesDocumented(doc)).toEqual(withRules)
  })

  it("carries each surface's and each severity's declared description", () => {
    // The descriptions are prose the doc copies verbatim; a generator that
    // reworded or dropped one would still produce a well-formed table.
    for (const surface of surfacesDocumented(doc)) {
      expect(doc).toContain(SURFACE_DESCRIPTIONS[surface])
    }
    for (const severity of SEVERITIES) {
      expect(doc).toContain(SEVERITY_DESCRIPTIONS[severity])
    }
  })
})

// ---------------------------------------------------------------------------
// Negative controls — a parser that silently matches nothing would make every
// assertion above pass vacuously.
// ---------------------------------------------------------------------------

describe("the rules-reference guards actually fire", () => {
  it("the rule-row parser reads id and severity, and skips the header", () => {
    const table = [
      "| Rule | Default severity | What it reports |",
      "| --- | --- | --- |",
      "| `tokens/var-unresolved` | error | text |",
    ].join("\n")
    expect(rulesDocumented(table)).toEqual([
      { id: "tokens/var-unresolved", defaultSeverity: "error" },
    ])
  })

  it("the rule-row parser detects a doc missing an exported rule", () => {
    const table = "| `tokens/var-unresolved` | error | text |"
    expect(rulesDocumented(table).map(rule => rule.id)).not.toEqual(exportedIds)
  })

  it("the rule-row parser detects a doc naming an unexported rule", () => {
    const rows = [...exportedIds, "invented/rule"]
      .map(id => `| \`${id}\` | warn | text |`)
      .join("\n")
    expect(
      rulesDocumented(rows)
        .map(rule => rule.id)
        .sort(),
    ).not.toEqual(exportedIds)
  })

  it("the surface parser reads only headings, not prose naming a surface", () => {
    const markdown = ["### `tokens`", "", "prose about `styles` here"].join(
      "\n",
    )
    expect(surfacesDocumented(markdown)).toEqual(["tokens"])
  })

  it("the issue-citation check catches every form of a citation, and no colour", () => {
    for (const cited of [
      "A rule (#123).",
      "A rule (issue #400).",
      "A rule (issues #401, #402).",
      "See #7 for why.",
    ]) {
      expect(linesCitingIssues(cited)).toEqual([cited])
    }
    for (const clean of [
      "A colour of #1a2b3c is not a citation.",
      "Nor is #ff0000.",
      "Nor is the entity &#123;.",
      "### `tokens`",
    ]) {
      expect(linesCitingIssues(clean)).toEqual([])
    }
  })

  it("the descriptor shape test rejects a non-descriptor array", () => {
    expect(ruleArraysOf({ notRules: ["tokens", "components"] })).toEqual([])
    expect(
      ruleArraysOf({
        partial: [{ id: "a/b", surface: "tokens", defaultSeverity: "warn" }],
      }),
    ).toEqual([])
  })

  it("the descriptor shape test accepts a real registry", () => {
    expect(ruleArraysOf({ rules: index.tokensRules })).toEqual([
      index.tokensRules,
    ])
  })
})
