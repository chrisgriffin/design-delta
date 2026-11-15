/**
 * shipped-docs-citations.test.js — keeps tracker-issue citations out of the
 * schemas and reference docs this package ships.
 *
 * `schema/` and `docs/` are both in `package.json`'s `files`, so a consumer
 * reads them from `node_modules`, and a schema's descriptions show up in their
 * editor's hovers through `$schema`. A number like `(issue #413)` there came
 * from the tracker the engine was built in before it moved here: it reads as
 * an issue in this repo or in the consumer's own, and a link to it 404s.
 * `rules-reference.test.js` holds `docs/rules.md` to the same rule (#16).
 *
 * The docs about how THIS repo is run (its CI, releases, tests, layout) cite
 * this repo's own tracker on purpose and are left out, as are `docs/adr/` and
 * `docs/spikes/`, which are dated records.
 */

import { readdirSync, readFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..")

/** Docs about this repo's own process, not the engine a consumer runs. */
const REPO_PROCESS_DOCS = new Set([
  "architecture.md",
  "ci.md",
  "releasing.md",
  "testing.md",
])

/**
 * A tracker issue cited by number, in every form it is written: `issue #400`,
 * `(#640)`, `roadmap #216`, `retargeted by #417`. A `#` followed by digits and
 * then a hex letter is a colour (`#1a2b3c`), one in backticks is a colour
 * written as code (`#111111`), and `&#123;` is an HTML entity — none is a
 * citation.
 */
const TRACKER_CITATION = /(?<![&\w`])#\d+(?![0-9a-fA-F])/
/** A link to an issue or pull request on any GitHub tracker. */
const TRACKER_LINK = /github\.com\/[^/\s]+\/[^/\s]+\/(?:issues|pull)\/\d+/

/** The lines of `text` that cite a tracker issue. */
function linesCitingIssues(text) {
  return text
    .split("\n")
    .filter(line => TRACKER_CITATION.test(line) || TRACKER_LINK.test(line))
}

function shippedFiles() {
  const schemas = readdirSync(join(ROOT, "schema"))
    .filter(name => name.endsWith(".json"))
    .map(name => join("schema", name))
  const docs = readdirSync(join(ROOT, "docs"))
    .filter(name => name.endsWith(".md") && !REPO_PROCESS_DOCS.has(name))
    .map(name => join("docs", name))
  return [...schemas, ...docs]
}

describe("shipped schemas and reference docs", () => {
  it("#18 no shipped schema or reference doc cites a tracker issue", () => {
    const citing = shippedFiles().flatMap(file =>
      linesCitingIssues(readFileSync(join(ROOT, file), "utf8")).map(
        line => `${file}: ${line.trim()}`,
      ),
    )
    expect(citing).toEqual([])
  })

  it("covers every shipped schema and the consumer-facing docs", () => {
    const files = shippedFiles()
    expect(files).toEqual(
      expect.arrayContaining([
        "schema/config.schema.json",
        "schema/state.schema.json",
        "docs/cli.md",
        "docs/config-reference.md",
        "docs/rules.md",
      ]),
    )
    expect(files).not.toContain("docs/ci.md")
  })

  it("the citation check catches every form of a citation, and no colour", () => {
    for (const cited of [
      "A field (issue #400).",
      "A field (#123).",
      "Written by snapshot (roadmap #216).",
      "The bindings plan (issue #401, retargeted by #417).",
      "Shipped ([#627](https://github.com/acme/tool/issues/627)).",
      "See https://github.com/acme/tool/pull/278 for why.",
    ]) {
      expect(linesCitingIssues(cited)).toEqual([cited])
    }
    for (const clean of [
      "A colour of #1a2b3c is not a citation.",
      "Nor is #ff0000.",
      "Nor is `#111111` written as code.",
      "Nor is the entity &#123;.",
      "Nor is a heading anchor [Health](./report-structure.md#health-score).",
    ]) {
      expect(linesCitingIssues(clean)).toEqual([])
    }
  })
})
