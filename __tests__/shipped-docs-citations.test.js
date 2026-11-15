/**
 * shipped-docs-citations.test.js — keeps tracker-issue citations out of the
 * schemas and reference docs this package ships.
 *
 * `schema/` and `docs/` are both in `package.json`'s `files`, so a consumer
 * reads them from `node_modules`, and a schema's descriptions show up in their
 * editor's hovers through `$schema`. A number like `(issue #413)` there came
 * from the tracker the engine was built in before it moved here: it reads as
 * an issue in this repo or in the consumer's own, and a link to it 404s.
 * `rules-reference.test.js` holds `docs/rules.md` to the same rule (#16);
 * both import the one scan in `helpers/tracker-citations.mjs`.
 *
 * `docs/ci.md` is left out: it records this repo's CI history and cites this
 * repo's own tracker for it, an issue a reader here can open. So are
 * `docs/adr/` and `docs/spikes/`, which are dated records.
 */

import { readdirSync, readFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import { linesCitingIssues } from "./helpers/tracker-citations.mjs"

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..")

/** A shipped doc that cites this repo's own tracker on purpose. */
const OWN_TRACKER_DOCS = new Set(["ci.md"])

function shippedFiles() {
  const schemas = readdirSync(join(ROOT, "schema"))
    .filter(name => name.endsWith(".json"))
    .map(name => join("schema", name))
  const docs = readdirSync(join(ROOT, "docs"))
    .filter(name => name.endsWith(".md") && !OWN_TRACKER_DOCS.has(name))
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
        "docs/architecture.md",
        "docs/releasing.md",
        "docs/testing.md",
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
      "Ported from other-tool#640.",
      "Tracked in acme/tool#440.",
      "Fixed under issue#12.",
    ]) {
      expect(linesCitingIssues(cited)).toEqual([cited])
    }
    for (const clean of [
      "A colour of #1a2b3c is not a citation.",
      "Nor is #ff0000.",
      "Nor is `#111111` written as code.",
      "Nor is the entity &#123;.",
      "Nor is a heading anchor [Health](./report-structure.md#health-score).",
      "Nor is a numbered anchor [Overview](./cli.md#1-overview).",
      "Nor is the placeholder `owner/repo#12`.",
    ]) {
      expect(linesCitingIssues(clean)).toEqual([])
    }
  })
})
