/**
 * docs-parity.test.js — binds a doc that MIRRORS a module's value list, or
 * TEACHES a schema, to the source that owns it (issues #164, #366).
 *
 * `docs/framework-adapter-contract.md` introduces its decline-reason table as
 * "Every `reason` the adapter produces", which makes it the normative surface
 * a non-React adapter (ADR-001 D16) implements against. It drifted from
 * `src/sources/react/jsx.mjs` twice in one afternoon — once asserting the
 * exact belief the code had just inverted, once missing a whole new reason —
 * and NOTHING caught it. `npm test`, `prettier --check`, `check-schemas.mjs`
 * and `check-package.sh` were all green on a PR whose doc contradicted its own
 * source, because the `schema` job pairs only `docs/config-reference.md` with
 * `schema/config.schema.json`.
 *
 * WHY A DECLARED LIST RATHER THAN A SCRAPE: a reason reaches a component
 * through four different mechanisms in that module — a literal at a
 * `declinedResult` call, a `{reason}` from `resolveBranch`, a string from
 * `classifyMultiTree` passed through a variable, and a mutable
 * `declineRef.reason` assigned deep in the walker. Any regex over the source
 * misses some and over-matches others (`tagNameText` returns the literal
 * "unknown"; `classifyMultiTree` returns "intersectable", which is not a
 * reason at all). So the module DECLARES its lists and this test binds the doc
 * to them — the scrape below is a secondary check, deliberately used only as a
 * subset assertion where over-matching cannot cause a false failure.
 *
 * THE SECOND PAIR (#366) is a different failure of the same shape: a doc that
 * teaches a schema by example, where the example does not validate against it.
 * `docs/contract-authoring-guide.md` showed an 8-character `verifiedAgainst`
 * that the schema accepted and the staleness rule could never match, so the
 * example itself produced a finding no author could clear. A generated
 * reference cannot cover this — the guide is hand-written prose, and the
 * `checks` job only pairs `docs/config-reference.md` with its schema — so the
 * binding lives here instead.
 *
 * This follows `layering.test.js`: a cross-cutting rule enforced as a test
 * rather than as bespoke CI tooling, negative control included.
 */

import { readFileSync } from "node:fs"
import { join } from "node:path"

import {
  CENSUS_NODE_KINDS,
  DECLINE_REASONS,
} from "../src/sources/react/jsx.mjs"
import { DESIGN_MECHANISM_TYPES } from "../src/core/mechanisms.mjs"
import { SEVERITIES } from "../src/core/findings.mjs"
import * as rulesIndex from "../src/index.mjs"

const ROOT = process.cwd()
const DOC = join(ROOT, "docs/framework-adapter-contract.md")
const MODULE = join(ROOT, "src/sources/react/jsx.mjs")

const doc = readFileSync(DOC, "utf8")
const moduleSource = readFileSync(MODULE, "utf8")

/**
 * The body of one `## ` section, so a scan means what its name says. Both
 * parsers below were originally applied to the WHOLE document, which happened
 * to be correct only because it contains exactly one table: a second table
 * with a backticked lowercase first column would have failed the parity
 * assertion for an unrelated reason, and — since the header row is excluded
 * by the literal name "reason" — a differently-headed one would have read as
 * a documented reason.
 */
function section(markdown, heading) {
  const start = markdown.indexOf(`## ${heading}`)
  if (start === -1) return ""
  const next = markdown.indexOf("\n## ", start + 1)
  return markdown.slice(start, next === -1 ? undefined : next)
}

const STRUCTURAL_SECTION = "Structural (tree) census"

/**
 * The `reason` column of the decline-reason table. Rows look like
 * "| `dynamic-list`  | a `.map(...)` call appears …|", and the header row
 * ("| `reason` | when |") is excluded by name.
 */
function reasonsDocumented(markdown) {
  const rows = [...markdown.matchAll(/^\|\s*`([a-z-]+)`\s*\|/gm)].map(
    match => match[1],
  )
  return [...new Set(rows.filter(name => name !== "reason"))].sort()
}

/** The `kind` values in the StructuralNode block. */
function kindsDocumented(markdown) {
  const kinds = [...markdown.matchAll(/\{kind:\s*"([a-z]+)"/g)].map(
    match => match[1],
  )
  return [...new Set(kinds)].sort()
}

/**
 * Reason strings returned by `classifyMultiTree`, whose value reaches
 * `declinedResult` through a VARIABLE — the one mechanism the three literal
 * shapes below cannot see. Without this, a new classification string would
 * ship undeclared and undocumented with every other guard here still green.
 */
function classifierReturns(source) {
  const body = source.slice(
    source.indexOf("function classifyMultiTree"),
    source.indexOf("\n}", source.indexOf("function classifyMultiTree")),
  )
  return [...new Set([...body.matchAll(/"([a-z-]+)"/g)].map(m => m[1]))].sort()
}

/**
 * Reason literals findable in the module by their three unambiguous shapes.
 * Deliberately INCOMPLETE — see the docblock — so it is only ever asserted as
 * a subset, never as equality.
 */
function reasonsFoundInSource(source) {
  const patterns = [
    /declinedResult\([^,]+,\s*"([a-z-]+)"\)/g,
    /reason:\s*"([a-z-]+)"/g,
    /declineRef\.reason\s*=\s*declineRef\.reason\s*\|\|\s*"([a-z-]+)"/g,
  ]
  const found = patterns.flatMap(pattern =>
    [...source.matchAll(pattern)].map(match => match[1]),
  )
  return [...new Set(found)].sort()
}

const moduleDocblock = moduleSource.slice(0, moduleSource.indexOf("*/"))

/**
 * Source with block comments, line comments and the `DECLINE_REASONS`
 * declaration stripped — what is left is code that can actually run. Used to
 * ask whether a declared value is REACHABLE, a question prose mentioning it
 * cannot answer.
 */
function executableSource(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/export const DECLINE_REASONS = Object\.freeze\(\[[^\]]*\]\)/, "")
}

/** Kinds in the docblock's StructuralNode LIST — ` *   {kind: "x", …}`. */
function kindsListedInDocblock(docblock) {
  const kinds = [...docblock.matchAll(/^ \*\s+\{kind: "([a-z]+)"/gm)].map(
    match => match[1],
  )
  return [...new Set(kinds)].sort()
}

/** Reasons in the docblock's DECLINE REASONS list — ` *   - "x": …`. */
function reasonsListedInDocblock(docblock) {
  const reasons = [...docblock.matchAll(/^ \*\s+- "([a-z-]+)":/gm)].map(
    match => match[1],
  )
  return [...new Set(reasons)].sort()
}

describe("docs/framework-adapter-contract.md ↔ sources/react/jsx.mjs", () => {
  it("documents exactly the decline reasons the adapter declares", () => {
    expect(reasonsDocumented(section(doc, STRUCTURAL_SECTION))).toEqual(
      [...DECLINE_REASONS].sort(),
    )
  })

  it("documents exactly the census node kinds the adapter declares", () => {
    expect(kindsDocumented(section(doc, STRUCTURAL_SECTION))).toEqual(
      [...CENSUS_NODE_KINDS].sort(),
    )
  })

  it("lists every declared kind in the module's OWN docblock too", () => {
    // The module docblock is a third mirror, and it drifted exactly like the
    // external doc did: stage 2 of #156 added the `unresolved` kind and
    // updated `docs/framework-adapter-contract.md` and `modules/anatomy.mjs`,
    // but left this list at five kinds. A guard watching only the external doc
    // would have shipped that.
    //
    // Parses the LIST specifically (lines of the form ` *   {kind: "x"…}`),
    // not any mention of a kind. A substring check was the first attempt and
    // was VACUOUS: prose elsewhere in the same docblock mentions
    // `{kind: "unresolved"}`, so deleting the list entry still passed.
    expect(kindsListedInDocblock(moduleDocblock)).toEqual(
      [...CENSUS_NODE_KINDS].sort(),
    )
  })

  it("lists every declared reason in the module's OWN docblock too", () => {
    expect(reasonsListedInDocblock(moduleDocblock)).toEqual(
      [...DECLINE_REASONS].sort(),
    )
  })

  it("declares every reason the multi-tree classifier can return", () => {
    // `declinedResult(file, kind)` takes its reason from `classifyMultiTree`'s
    // return value, so that string never appears at a `declinedResult` call
    // and escapes the literal scrape entirely. "intersectable" is the one
    // return that is NOT a reason — it means the branches are reconcilable.
    for (const returned of classifierReturns(moduleSource)) {
      expect([...DECLINE_REASONS, "intersectable"]).toContain(returned)
    }
  })

  it("declares no reason the module can no longer produce", () => {
    // The gap this guard MISSED once: #165 made `.map()` children resolvable,
    // which left `dynamic-list` declared and documented but emitted by no code
    // path at all. Every name check stayed green, because a dead reason is
    // still a consistently-mirrored one. A declared value nothing can produce
    // is exactly the dishonest output this repo exists to prevent, so
    // reachability is now asserted too: each reason must appear in EXECUTABLE
    // source — comments stripped. The first version searched raw source below
    // the docblock, so a reason named only in a code comment read as
    // reachable, and the very commit retiring `dynamic-list` would have kept
    // it green, because its explanatory comment quotes the string.
    for (const reason of DECLINE_REASONS) {
      expect(executableSource(moduleSource)).toContain(`"${reason}"`)
    }
  })

  it("declares every reason the module's own source names", () => {
    // Subset, not equality: the scrape cannot see reasons that travel through
    // a variable. A literal it DOES find and the list does not know about is
    // still an unambiguous bug — a reason shipped without being declared, and
    // therefore without the doc being forced to mention it.
    for (const reason of reasonsFoundInSource(moduleSource)) {
      expect(DECLINE_REASONS).toContain(reason)
    }
  })
})

// ---------------------------------------------------------------------------
// The authoring guide's examples must satisfy the schema they teach (#366).
// ---------------------------------------------------------------------------

const GUIDE = join(ROOT, "docs/contract-authoring-guide.md")
const CONTRACT_SCHEMA = join(ROOT, "schema/contract.schema.json")

const guide = readFileSync(GUIDE, "utf8")
const contractSchema = JSON.parse(readFileSync(CONTRACT_SCHEMA, "utf8"))

/** Every `"verifiedAgainst": "…"` value written in a doc's JSON examples. */
function verifiedAgainstExamples(markdown) {
  return [...markdown.matchAll(/"verifiedAgainst":\s*"([^"]*)"/g)].map(
    match => match[1],
  )
}

describe("docs/contract-authoring-guide.md ↔ schema/contract.schema.json", () => {
  // The guide showed `"verifiedAgainst": "1421fc93"` — an 8-character prefix,
  // which the schema's original `{8,64}` pattern accepted and the staleness
  // check could never match. An author following the example verbatim earned a
  // permanent `components/intent-stale`, two lines below prose promising the
  // hash is "a paste, never a lookup". Nothing caught it: the guide is prose,
  // so no schema check reads it, and the suite had no case pairing the two.
  it("every verifiedAgainst example satisfies the schema's own pattern", () => {
    const pattern = new RegExp(
      contractSchema.properties.intent.properties.verifiedAgainst.pattern,
    )
    const examples = verifiedAgainstExamples(guide)
    expect(examples.length).toBeGreaterThan(0)
    for (const example of examples) expect(example).toMatch(pattern)
  })
})

// ---------------------------------------------------------------------------
// `design.mechanism`'s closed vocabulary (issue #439) lives in THREE places
// that cannot see each other: the schema's enum (what an author may write),
// `DESIGN_MECHANISM_TYPES` (what the checker compares against), and the
// guide's examples (what an author copies). A value in the schema with no
// entry in the map is accepted and then silently unchecked, which is exactly
// the "declared translation stops being true" case the marker exists to catch.
// ---------------------------------------------------------------------------

/** Every `"mechanism": "…"` value written in a doc's JSON examples. */
function mechanismExamples(markdown) {
  return [...markdown.matchAll(/"mechanism":\s*"([^"]*)"/g)].map(
    match => match[1],
  )
}

const schemaMechanisms = contractSchema.$defs.designDeviation.oneOf
  .map(branch => branch.properties?.mechanism?.enum)
  .find(Array.isArray)

describe("design.mechanism ↔ schema ↔ authoring guide (issue #439)", () => {
  it("the schema's vocabulary and the checker's implied types are the same set", () => {
    expect([...schemaMechanisms].sort()).toEqual(
      Object.keys(DESIGN_MECHANISM_TYPES).sort(),
    )
  })

  it("every mechanism the guide writes is one the schema accepts", () => {
    const examples = mechanismExamples(guide)
    expect(examples.length).toBeGreaterThan(0)
    for (const example of examples) expect(schemaMechanisms).toContain(example)
  })
})

// ---------------------------------------------------------------------------
// THE THIRD PAIR (#519): `action.yml`'s `inputs:` and the Inputs table in
// `docs/github-action.md`. That doc is how a consumer wires this action into
// their own workflow, so a drifted default sends them to a value the action
// does not have — and nothing read the doc at all: no test, and no script in
// `scripts/ci/` (`check-action.sh` runs the action's COMMANDS against the
// packed tarball, never its documentation).
//
// Text walk, matching `ci-workflow.test.js`'s own reasoning: no YAML parser
// in this repo's dependency tree, and `action.yml` is uniformly indented
// enough that an input-level key is unambiguous from the `runs:` steps below
// it.
// ---------------------------------------------------------------------------

const ACTION = readFileSync(join(ROOT, "action.yml"), "utf8")
const ACTION_DOC = readFileSync(join(ROOT, "docs/github-action.md"), "utf8")

// How the table spells "this input has no default" — `action.yml` writes the
// empty string, which is correct on both sides (issue #519's own note), so the
// comparison maps one to the other rather than "fixing" either file.
const UNSET = "_(unset)_"

/**
 * `{name: default}` for every key under `inputs:`, stopping at the next
 * top-level block (`runs:`). A `default:` may be quoted or bare; an input
 * with none at all is recorded as `undefined`, which the table then has to
 * spell `_(unset)_` too — an input whose default the action leaves out is
 * exactly as undocumented as one whose default is empty.
 */
function actionInputs(yaml) {
  const body = yaml.split(/\ninputs:\n/)[1]
  if (body === undefined) return {}
  const inputsBlock = body.split(/\n[a-z]/)[0]
  const parts = inputsBlock.split(/^ {2}([\w-]+):$/m).slice(1)
  const inputs = {}
  for (let i = 0; i < parts.length; i += 2) {
    // `[^\S\n]*`, never `\s*`: `\s` crosses the newline, so a bare
    // `default:` with no value on its own line would read the NEXT line as
    // the default (`required: false`). No input is written that way today —
    // this keeps a future one honest rather than confidently wrong.
    const match = /^ {4}default:[^\S\n]*(.*)$/m.exec(parts[i + 1])
    const raw = match ? match[1].trim() : undefined
    const value =
      raw === undefined ? undefined : raw.replace(/^["'](.*)["']$/, "$1")
    inputs[parts[i]] = value === "" || value === undefined ? UNSET : value
  }
  return inputs
}

/**
 * `{name: default}` from the Inputs table's first two columns. The header row
 * ("| Input | Default | …") is excluded by its un-backticked first cell, the
 * same way `reasonsDocumented` excludes its own.
 */
function documentedInputs(markdown) {
  const rows = [
    ...section(markdown, "Inputs").matchAll(
      /^\|\s*`([\w-]+)`\s*\|\s*(.+?)\s*\|/gm,
    ),
  ]
  const inputs = {}
  for (const [, name, rawDefault] of rows) {
    inputs[name] = rawDefault.replace(/^`(.*)`$/, "$1")
  }
  return inputs
}

describe("action.yml ↔ docs/github-action.md Inputs table (issue #519)", () => {
  const declared = actionInputs(ACTION)
  const documented = documentedInputs(ACTION_DOC)

  it("found inputs on both sides — an empty parse would make the rest vacuous", () => {
    expect(Object.keys(declared).length).toBeGreaterThan(0)
    expect(Object.keys(documented).length).toBeGreaterThan(0)
  })

  it("documents every input the action declares, and declares every one it documents", () => {
    expect(Object.keys(documented).sort()).toEqual(Object.keys(declared).sort())
  })

  it("every documented default is the action's own", () => {
    expect(documented).toEqual(declared)
  })
})

// ---------------------------------------------------------------------------
// THE FOURTH PAIR (#520): `docs/state-shape.md` and `schema/state.schema.json`.
// The doc teaches the on-disk state file field by field and is the only prose
// explanation of what `snapshot` writes and `movers` reads — and nothing bound
// it to the schema, so a field added to one silently left the other wrong.
//
// The doc's code blocks are pseudo-JSON, not JSON: `name: type, // comment`,
// with a trailing `?` marking optional. That shape is what makes a text parse
// honest here — it is a teaching document, and reading it as the reader does
// is the point.
// ---------------------------------------------------------------------------

const STATE_DOC = readFileSync(join(ROOT, "docs/state-shape.md"), "utf8")
const stateSchema = JSON.parse(
  readFileSync(join(ROOT, "schema/state.schema.json"), "utf8"),
)

/**
 * `{name: optional}` for every field named at the TOP level of a
 * "```"-fenced block — a nested block's own fields (`lastRunByScope`'s, say)
 * are read separately by their own indent, so a sub-key can never masquerade
 * as a top-level one.
 */
function documentedFields(markdown, heading, indent = 2) {
  const body = markdown.slice(markdown.indexOf(heading) + heading.length)
  const fence = body.indexOf("```")
  const block = body.slice(fence + 3, body.indexOf("```", fence + 3))
  const rows = [
    ...block.matchAll(new RegExp(`^ {${indent}}([\\w$]+)(\\??):`, "gm")),
  ]
  return Object.fromEntries(rows.map(([, name, mark]) => [name, mark === "?"]))
}

// What the schema says, in the same `{name: optional}` shape.
function schemaFields(node) {
  const required = new Set(node.required || [])
  return Object.fromEntries(
    Object.keys(node.properties || {}).map(name => [name, !required.has(name)]),
  )
}

// `$schema` is JSON Schema housekeeping, not part of the state a reader
// writes or reads — the doc deliberately does not teach it.
function withoutSchemaKey(fields) {
  const { $schema, ...rest } = fields
  return rest
}

describe("docs/state-shape.md ↔ schema/state.schema.json (issue #520)", () => {
  const documentTop = documentedFields(STATE_DOC, "## The document")
  const entityState = documentedFields(STATE_DOC, "### `EntityState`")
  const lastRunByScope = documentedFields(STATE_DOC, "## The document", 4)

  it("found fields on both sides — an empty parse would make the rest vacuous", () => {
    expect(Object.keys(documentTop).length).toBeGreaterThan(0)
    expect(Object.keys(entityState).length).toBeGreaterThan(0)
  })

  it("the document block teaches exactly the schema's top-level fields, and their optionality", () => {
    expect(documentTop).toEqual(withoutSchemaKey(schemaFields(stateSchema)))
  })

  it("the EntityState block teaches exactly $defs.entityState's fields, and their optionality", () => {
    expect(entityState).toEqual(schemaFields(stateSchema.$defs.entityState))
  })

  it("the lastRunByScope sub-keys are the schema's own", () => {
    expect(Object.keys(lastRunByScope).sort()).toEqual(
      Object.keys(stateSchema.properties.lastRunByScope.properties).sort(),
    )
  })
})

// ---------------------------------------------------------------------------
// THE FIFTH PAIR (#532): `docs/provider-contract.md` and the Figma provider.
// The doc is the normative surface a second design provider implements
// against (ADR-001 D12), and nothing read it — the provider had grown four
// exports the doc's own export list never named.
//
// A member is "named" in one of the three shapes the doc uses: a `###`
// heading, a "MAY also export `x`" sentence, or a row of the wiring table.
// Exports are read off the live module, so a new one with no doc fails here.
// ---------------------------------------------------------------------------

const PROVIDER_DOC = readFileSync(
  join(ROOT, "docs/provider-contract.md"),
  "utf8",
)
const figmaProvider = await import("../src/providers/figma/index.mjs")

/** Every provider member the doc names, sorted and deduplicated. */
function providerMembersDocumented(markdown) {
  const headings = [...markdown.matchAll(/^### (.+)$/gm)].flatMap(([, line]) =>
    [...line.matchAll(/`([A-Za-z]+)/g)].map(match => match[1]),
  )
  const prose = [...markdown.matchAll(/MAY also export `([A-Za-z]+)/g)].map(
    match => match[1],
  )
  const rows = [
    ...section(markdown, "The wiring members the CLI needs").matchAll(
      /^\|\s*`([A-Za-z]+)/gm,
    ),
  ].map(match => match[1])
  return [...new Set([...headings, ...prose, ...rows])].sort()
}

describe("docs/provider-contract.md ↔ providers/figma/index.mjs (issue #532)", () => {
  const documented = providerMembersDocumented(PROVIDER_DOC)

  it("found members on both sides — an empty parse would make the rest vacuous", () => {
    expect(documented.length).toBeGreaterThan(0)
    expect(Object.keys(figmaProvider).length).toBeGreaterThan(0)
  })

  it("documents exactly the members the provider exports", () => {
    expect(documented).toEqual(Object.keys(figmaProvider).sort())
  })
})

// ---------------------------------------------------------------------------
// THE SIXTH PAIR (#533): `docs/report-structure.md`'s § Severities and
// § Surfaces tables and the rule registry. That doc is what a consumer reads
// to interpret a report, and nothing compared either table against what rules
// actually declare — a rule on a seventh surface, or a retired one, would have
// left it silently wrong.
//
// The registry is found by SHAPE, as `rules-reference.test.js` does, so a
// newly exported registry is covered without this test being told about it.
// ---------------------------------------------------------------------------

const REPORT_DOC = readFileSync(join(ROOT, "docs/report-structure.md"), "utf8")

/**
 * The first column of the table under one heading, stopping at the next
 * heading of ANY level — `section` stops only at `## `, and both tables sit
 * under `### ` headings inside the same `## ` section. EVERY body row counts,
 * backticked or not: a row added without backticks must read as an extra, not
 * be skipped. The header row is the first row, and the delimiter row is all
 * dashes and colons; both are dropped by position and shape, never by name.
 */
function tableKeys(markdown, heading) {
  const start = markdown.indexOf(heading)
  if (start === -1) return []
  const next = markdown.indexOf("\n#", start + heading.length)
  const body = markdown.slice(start, next === -1 ? undefined : next)
  return [...body.matchAll(/^\|([^|\n]*)\|/gm)]
    .map(m => m[1].trim().replace(/^`(.*)`$/, "$1"))
    .filter(cell => !/^[\s:-]+$/.test(cell))
    .slice(1)
    .sort()
}

const registryRules = Object.values(rulesIndex)
  .filter(
    value =>
      Array.isArray(value) &&
      value.length > 0 &&
      value.every(rule => typeof rule?.id === "string" && rule.defaultSeverity),
  )
  .flat()

describe("docs/report-structure.md ↔ the rule registry (issue #533)", () => {
  const severities = tableKeys(REPORT_DOC, "### Severities")
  const surfaces = tableKeys(REPORT_DOC, "### Surfaces")

  it("found rows in both tables, and rules in the registry — an empty parse would make the rest vacuous", () => {
    expect(severities.length).toBeGreaterThan(0)
    expect(surfaces.length).toBeGreaterThan(0)
    expect(registryRules.length).toBeGreaterThan(0)
  })

  it("documents exactly the severities a finding can resolve to — never `off`", () => {
    // `off` is configurable but raises no finding, so it has no row here.
    expect(severities).toEqual([...SEVERITIES].sort())
    expect(severities).not.toContain("off")
  })

  it("documents exactly the surfaces the registry's rule ids declare", () => {
    const declared = [
      ...new Set(registryRules.map(rule => rule.id.split("/")[0])),
    ].sort()
    expect(surfaces).toEqual(declared)
  })
})

// ---------------------------------------------------------------------------
// THE SEVENTH PAIR (#534): `docs/deferred-rules.md` and the rule registry. That
// doc records what the engine deliberately does NOT check, and its rows cite
// rule ids to say what covers a gap instead — `token-unreferenced` for row 2,
// `element-unmapped` for row 4. A rename turns a "Shipped" row into a claim
// about an id that no longer exists, in the one doc whose job is to be trusted
// about scope, and `docs/rules.md` being generated does not help: that file is
// rewritten from the registry and never reads this one.
//
// Ids are read from WHOLE backticked spans, never from inside one. The
// § "recurring failure mode" table quotes code — `&[data-size="lg"]`,
// `border: 1px solid var(--x)` — containing hyphenated words that a substring
// match would read as rule ids. A bare id must carry a hyphen, which is what
// separates a check name from `review` (a severity) and from
// `invalidVariantCombinations` (a config field), with no ignore list to
// maintain.
// ---------------------------------------------------------------------------

const DEFERRED_DOC = readFileSync(join(ROOT, "docs/deferred-rules.md"), "utf8")

// `<surface>/<check-name>` — the shape `core/rules.mjs`'s `defineRule`
// enforces, so a prefixed span either is an id or is not one at all.
const PREFIXED_RULE_ID = /^[a-z][a-z0-9-]*\/[a-z][a-z0-9-]*$/
// A bare check name, hyphen required — see the header comment.
const BARE_RULE_ID = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)+$/

/**
 * The ids row 8 names in order to say they are NOT rules: general file/dir
 * hygiene, closed out of scope via issue #142 ("not a deferral — a
 * mission-scope boundary").
 *
 * ASSERTED, NOT WAIVED. A plain skip-list would silence exactly the failure
 * this pair exists for — a renamed-away id could be quietened by adding it
 * here. Each entry instead carries the doc's own claim: it must still be named
 * in the doc, and it must resolve to no rule. Ship one of them for real and
 * this fails, because the doc's scope boundary has become false.
 */
const DECLARED_OUT_OF_SCOPE = [
  "component/file-bundle",
  "component/line-budget",
  "lint/component-dir-case",
]

/**
 * `id → where the doc names it`, first mention winning. The location is the
 * table's own row number where there is one, so a failure reads as "row 8:
 * `x` matches no registered rule" rather than as a set difference the reader
 * then has to go find.
 */
function ruleIdsNamed(markdown) {
  const named = new Map()
  markdown.split("\n").forEach((line, index) => {
    const row = /^\|\s*(\d+)\s*\|/.exec(line)
    const where = row ? `row ${row[1]}` : `line ${index + 1}`
    for (const [, span] of line.matchAll(/`([^`\n]+)`/g))
      if (
        (PREFIXED_RULE_ID.test(span) || BARE_RULE_ID.test(span)) &&
        !named.has(span)
      )
        named.set(span, where)
  })
  return named
}

/**
 * Every registry id one doc id can mean: an exact match when it is prefixed, a
 * match on the id's suffix when it is bare. Takes the id list as an argument
 * so the ambiguous branch is testable — no two rules share a check name today,
 * and a branch that cannot be exercised is a branch nobody has checked.
 */
function resolveRuleId(id, ids) {
  return id.includes("/")
    ? ids.filter(candidate => candidate === id)
    : ids.filter(
        candidate => candidate.slice(candidate.indexOf("/") + 1) === id,
      )
}

/** One line per id the registry cannot account for — the failure message. */
function unresolvedIds(named, ids) {
  const problems = []
  for (const [id, where] of named) {
    if (DECLARED_OUT_OF_SCOPE.includes(id)) continue
    const matches = resolveRuleId(id, ids)
    if (matches.length === 0)
      problems.push(`${where}: \`${id}\` matches no registered rule`)
    else if (matches.length > 1)
      problems.push(
        `${where}: \`${id}\` is ambiguous (${matches.join(", ")}) — write it prefixed`,
      )
  }
  return problems
}

describe("docs/deferred-rules.md ↔ the rule registry (issue #534)", () => {
  const registryIds = registryRules.map(rule => rule.id)
  const named = ruleIdsNamed(DEFERRED_DOC)

  it("found ids on both sides — an empty parse would make the rest vacuous", () => {
    expect(named.size).toBeGreaterThan(0)
    expect(registryIds.length).toBeGreaterThan(0)
  })

  it("every rule id the doc names resolves to exactly one registered rule", () => {
    expect(unresolvedIds(named, registryIds)).toEqual([])
  })

  it("the ids the doc calls out of scope are named in it, and are really not rules", () => {
    for (const id of DECLARED_OUT_OF_SCOPE) {
      expect([...named.keys()]).toContain(id)
      expect(resolveRuleId(id, registryIds)).toEqual([])
    }
  })
})

// ---------------------------------------------------------------------------
// Negative controls — a guard that cannot fail is worth nothing.
//
// `layering.test.js` establishes this pattern in this repo: prove the matcher
// actually matches before trusting a green result. Both parsers are exercised
// against synthetic input, because a regex that silently found NOTHING would
// make every assertion above pass vacuously.
// ---------------------------------------------------------------------------

describe("docs-parity guards actually fire", () => {
  it("the verifiedAgainst scrape reads a JSON example, and would catch a short one", () => {
    const example = '  "verifiedAgainst": "1421fc93"'
    expect(verifiedAgainstExamples(example)).toEqual(["1421fc93"])
    expect("1421fc93").not.toMatch(
      new RegExp(
        contractSchema.properties.intent.properties.verifiedAgainst.pattern,
      ),
    )
  })

  it("the mechanism scrape reads a JSON example, and would catch an invented one", () => {
    expect(mechanismExamples('  "mechanism": "not-a-mechanism"')).toEqual([
      "not-a-mechanism",
    ])
    expect(schemaMechanisms).not.toContain("not-a-mechanism")
  })

  it("the reason parser reads a table row", () => {
    expect(
      reasonsDocumented("| `reason` | when |\n| `made-up-reason` | text |"),
    ).toEqual(["made-up-reason"])
  })

  it("the reason parser detects a doc missing a declared reason", () => {
    const desynced = "| `reason` | when |\n| `dynamic-list` | text |"
    expect(reasonsDocumented(desynced)).not.toEqual([...DECLINE_REASONS].sort())
  })

  it("the reason parser detects a doc naming an undeclared reason", () => {
    const rows = [...DECLINE_REASONS, "invented-reason"]
      .map(name => `| \`${name}\` | text |`)
      .join("\n")
    expect(reasonsDocumented(rows)).not.toEqual([...DECLINE_REASONS].sort())
  })

  it("the state-shape parser reads a pseudo-JSON block, optionality included", () => {
    const doc = [
      "## Block",
      "",
      "```",
      "{",
      "  entities: { ... },",
      "  lastRun: string,             // ISO 8601",
      "  lastRunByScope?: {",
      "    components?: string,",
      "  },",
      "}",
      "```",
    ].join("\n")
    expect(documentedFields(doc, "## Block")).toEqual({
      entities: false,
      lastRun: false,
      lastRunByScope: true,
    })
    expect(documentedFields(doc, "## Block", 4)).toEqual({ components: true })
  })

  it("the state-shape guard catches a doc missing a schema field", () => {
    const doc = [
      "## Block",
      "",
      "```",
      "{",
      "  entities: { ... },",
      "}",
      "```",
    ].join("\n")
    expect(documentedFields(doc, "## Block")).not.toEqual(
      withoutSchemaKey(schemaFields(stateSchema)),
    )
  })

  it("the state-shape guard catches a doc naming a field the schema does not have", () => {
    const doc = [
      "## Block",
      "",
      "```",
      "{",
      "  entities: { ... },",
      "  lastRun: string,",
      "  lastRunByScope?: { },",
      "  invented: string,",
      "}",
      "```",
    ].join("\n")
    expect(documentedFields(doc, "## Block")).not.toEqual(
      withoutSchemaKey(schemaFields(stateSchema)),
    )
  })

  it("the state-shape guard catches optionality that disagrees", () => {
    const doc = [
      "## Block",
      "",
      "```",
      "{",
      "  entities: { ... },",
      "  lastRun?: string,",
      "  lastRunByScope?: { },",
      "}",
      "```",
    ].join("\n")
    // `lastRun` is in the schema's `required` — a doc marking it optional is
    // the drift this guard exists for.
    expect(documentedFields(doc, "## Block")).not.toEqual(
      withoutSchemaKey(schemaFields(stateSchema)),
    )
  })

  it("the action-input parsers read their own files' shapes", () => {
    expect(
      actionInputs(
        '\ninputs:\n  fail-on:\n    required: false\n    default: "error"\nruns:\n  using: "composite"\n',
      ),
    ).toEqual({ "fail-on": "error" })
    expect(
      documentedInputs(
        "## Inputs\n\n| Input | Default | Meaning |\n| --- | --- | --- |\n| `fail-on` | `error` | text |\n",
      ),
    ).toEqual({ "fail-on": "error" })
  })

  it("a bare `default:` reads as unset, never as the next line's text", () => {
    expect(
      actionInputs(
        '\ninputs:\n  bare:\n    default:\n    required: false\nruns:\n  using: "composite"\n',
      ),
    ).toEqual({ bare: "_(unset)_" })
  })

  it("the action-input guard catches a documented input the action does not declare", () => {
    const extraRow =
      "## Inputs\n\n| Input | Default | Meaning |\n| --- | --- | --- |\n| `fail-on` | `error` | text |\n| `invented` | `x` | text |\n"
    expect(Object.keys(documentedInputs(extraRow)).sort()).not.toEqual(
      Object.keys(actionInputs(ACTION)).sort(),
    )
  })

  it("the action-input guard catches a wrong documented default", () => {
    const wrongDefault =
      "## Inputs\n\n| Input | Default | Meaning |\n| --- | --- | --- |\n| `fail-on` | `warn` | text |\n"
    expect(documentedInputs(wrongDefault)["fail-on"]).not.toBe(
      actionInputs(ACTION)["fail-on"],
    )
  })

  it("an empty default and the table's _(unset)_ read as the same thing", () => {
    expect(
      actionInputs(
        '\ninputs:\n  config-path:\n    required: false\n    default: ""\nruns:\n  using: "composite"\n',
      ),
    ).toEqual({ "config-path": "_(unset)_" })
    expect(
      documentedInputs(
        "## Inputs\n\n| Input | Default | Meaning |\n| --- | --- | --- |\n| `config-path` | _(unset)_ | text |\n",
      ),
    ).toEqual({ "config-path": "_(unset)_" })
  })

  it("the report-structure table parse reads one table, and reads nothing when the heading is missing", () => {
    const md = [
      "### Severities",
      "",
      "| Severity | Meaning |",
      "| --- | --- |",
      "| `error` | text |",
      "",
      "### Surfaces",
      "",
      "| Surface | About |",
      "| ------- | ----- |",
      "| `tokens` | text |",
      "| bare | a row written without backticks still counts |",
    ].join("\n")
    expect(tableKeys(md, "### Severities")).toEqual(["error"])
    expect(tableKeys(md, "### Surfaces")).toEqual(["bare", "tokens"])
    // An empty parse must fail the non-vacuous check, not pass it.
    expect(tableKeys("", "### Severities")).toHaveLength(0)
    expect(tableKeys(md, "### Severities")).not.toEqual([...SEVERITIES].sort())
  })

  it("the kind parser reads a StructuralNode line", () => {
    expect(kindsDocumented('{kind: "element", tag, children}')).toEqual([
      "element",
    ])
  })

  it("the source scrape finds the shapes it claims to", () => {
    const source = [
      'return declinedResult(file, "no-jsx-returned")',
      'return { reason: "fragment" }',
      'declineRef.reason = declineRef.reason || "dynamic-list"',
    ].join("\n")
    expect(reasonsFoundInSource(source)).toEqual([
      "dynamic-list",
      "fragment",
      "no-jsx-returned",
    ])
  })

  it("the docblock kind parser reads only LIST lines, not prose", () => {
    const docblock = [
      ' *   {kind: "element", tag, children}',
      ' * prose mentioning {kind: "unresolved"} without listing it',
    ].join("\n")
    expect(kindsListedInDocblock(docblock)).toEqual(["element"])
  })

  it("the docblock reason parser reads a list entry", () => {
    expect(
      reasonsListedInDocblock(' *   - "dynamic-list": a .map(...)'),
    ).toEqual(["dynamic-list"])
  })

  it("the section anchor isolates one section", () => {
    const md = "## A\n| `alpha` | x |\n\n## B\n| `beta` | y |"
    expect(reasonsDocumented(section(md, "A"))).toEqual(["alpha"])
    expect(reasonsDocumented(section(md, "B"))).toEqual(["beta"])
  })

  it("the classifier scan reads its return literals", () => {
    const source = [
      "function classifyMultiTree(ts, candidates) {",
      '  if (x) return "multiple-returns"',
      '  return y ? "divergent-roots" : "intersectable"',
      "}",
      'function other() { return "not-scanned" }',
    ].join("\n")
    expect(classifierReturns(source)).toEqual([
      "divergent-roots",
      "intersectable",
      "multiple-returns",
    ])
  })

  it("executableSource strips comments, so prose cannot fake reachability", () => {
    const source = [
      '/** docblock naming "ghost-reason" */',
      '// line comment naming "ghost-reason"',
      'const real = "live-reason"',
    ].join("\n")
    const stripped = executableSource(source)
    expect(stripped).not.toContain("ghost-reason")
    expect(stripped).toContain("live-reason")
  })

  it("the source scrape does not match non-reason string returns", () => {
    // `tagNameText` returns the literal "unknown" and `classifyMultiTree`
    // returns "intersectable" — neither is a decline reason, and matching them
    // would fail the subset assertion for no reason.
    const source = 'return "unknown"\nreturn "intersectable"'
    expect(reasonsFoundInSource(source)).toEqual([])
  })
  it("the provider-member parser reads all three of the doc's shapes", () => {
    const md = [
      "### `censusTokens(ctx)`",
      "### `configSchema` + `validateDesignOptions(options)`",
      "A provider MAY also export `isPrivateComponent(component) → boolean`.",
      "## The wiring members the CLI needs",
      "| Member | Contract |",
      "| `designAddress(source)` | text |",
    ].join("\n")
    expect(providerMembersDocumented(md)).toEqual([
      "censusTokens",
      "configSchema",
      "designAddress",
      "isPrivateComponent",
      "validateDesignOptions",
    ])
  })

  it("the provider-member guard catches a doc naming a member the provider lacks", () => {
    const invented = PROVIDER_DOC.replace(
      "| `censusLayers(ctx)`",
      "| `inventedMember(ctx)` | text |\n| `censusLayers(ctx)`",
    )
    expect(providerMembersDocumented(invented)).toContain("inventedMember")
    expect(providerMembersDocumented(invented)).not.toEqual(
      Object.keys(figmaProvider).sort(),
    )
  })

  it("the deferred-rules extractor reads both spellings, with the row that names each", () => {
    const md = [
      "| 2   | **Split `token-unreferenced`** back into two | text |",
      "| 8   | Lint rules | 4 live (`lint/token-rule`, `tier-alias-inverted`) |",
    ].join("\n")
    expect([...ruleIdsNamed(md)]).toEqual([
      ["token-unreferenced", "row 2"],
      ["lint/token-rule", "row 8"],
      ["tier-alias-inverted", "row 8"],
    ])
  })

  it("the deferred-rules extractor reads no id out of quoted code or a non-rule name", () => {
    // Every span here is in the real document: a severity, a config field, and
    // three code quotes from the § recurring-failure-mode table. Matching
    // inside a span would find `data-size` in the first of them.
    const md =
      '| 9 | `review` `invalidVariantCombinations` `&[data-size="lg"]` `border: 1px solid var(--x)` `.map()` |'
    expect([...ruleIdsNamed(md).keys()]).toEqual([])
  })

  it("the deferred-rules guard catches an invented id, naming it and its row", () => {
    const named = ruleIdsNamed(
      "| 5 | surfaced as `element-unmapped-invented` |",
    )
    const problems = unresolvedIds(
      named,
      registryRules.map(rule => rule.id),
    )
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain("element-unmapped-invented")
    expect(problems[0]).toContain("row 5")
  })

  it("the deferred-rules guard catches a bare name two rules could mean", () => {
    const problems = unresolvedIds(ruleIdsNamed("| 1 | `token-rule` |"), [
      "lint/token-rule",
      "tokens/token-rule",
    ])
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain("ambiguous")
  })

  it("the out-of-scope declaration is a claim that fails once such an id ships", () => {
    // The skip in `unresolvedIds` is only half of it: the block above also
    // asserts each declared id resolves to NOTHING, and this is that assertion
    // against a registry where one of them has shipped.
    expect(
      resolveRuleId("lint/component-dir-case", ["lint/component-dir-case"]),
    ).toEqual(["lint/component-dir-case"])
  })

  it("the provider-member guard catches a member removed from the doc", () => {
    const removed = PROVIDER_DOC.split("\n")
      .filter(line => !line.startsWith("| `bindingStatus("))
      .join("\n")
    expect(providerMembersDocumented(removed)).not.toContain("bindingStatus")
    expect(providerMembersDocumented(removed)).not.toEqual(
      Object.keys(figmaProvider).sort(),
    )
  })
})
