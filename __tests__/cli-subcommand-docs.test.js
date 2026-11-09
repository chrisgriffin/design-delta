/**
 * cli-subcommand-docs.test.js (issue #511) — the subcommand inventory lives in
 * `SUBCOMMANDS` (src/cli/main.mjs), which is what `--help` renders from, and is
 * then re-stated by hand in two docs: the README's `## Usage` block and
 * `docs/cli.md`'s per-command sections. Nothing compared them, and the README
 * drifted three times — #274 (incomplete list), #471 (`mcp` undocumented), #505
 * (`query` undocumented) — each caught by a person reading it.
 *
 * Both inventories here are DERIVED, never written out: the expected names come
 * from `SUBCOMMANDS`, and each doc's names are scraped from that doc's own
 * structure. Add a subcommand and this test fails until both docs list it; no
 * line in this file needs editing either way.
 *
 * The scrape is structural, not a substring search, and that is the whole point.
 * Every command name is also an ordinary English word somewhere in these docs
 * ("mapping", "reported", "initial"), so `text.includes(name)` would pass even
 * with the command dropped from the list — vacuous exactly where the drift is.
 * So the README is read as its `design-delta <name>` listing lines and
 * `docs/cli.md` as its per-command headings, which is what "documented" means on
 * each surface.
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"

import { SUBCOMMANDS } from "../src/cli/main.mjs"

const ROOT = join(import.meta.dirname, "..")

const read = file => readFileSync(join(ROOT, file), "utf8")

/** The subcommand inventory itself — the one source of truth (ADR-001 D8). */
const NAMES = Object.keys(SUBCOMMANDS)

/**
 * The body of the README's `## Usage` section: everything up to the next
 * top-level heading. Throws rather than returning "" if the heading is gone,
 * so a renamed section fails loudly instead of yielding an empty inventory.
 *
 * @param {string} readme
 * @returns {string}
 */
function usageBlock(readme) {
  const match = readme.match(/^## Usage$\n([\s\S]*?)(?=^## )/m)
  if (!match) {
    throw new Error(
      "README.md: no `## Usage` section found — it was renamed or removed, so " +
        "nothing here checks the subcommand list any more",
    )
  }
  return match[1]
}

/**
 * The subcommands the README's Usage block lists, in the order it lists them:
 * the `design-delta <name>` lines of its shell block. `design-delta --help` and
 * any other flag line is not a subcommand and drops out.
 *
 * @param {string} readme
 * @returns {string[]}
 */
function readmeNames(readme) {
  return [...usageBlock(readme).matchAll(/^design-delta ([^\s#]+)/gm)]
    .map(([, name]) => name)
    .filter(name => /^[a-z][a-z-]*$/.test(name))
}

/**
 * The subcommands `docs/cli.md` documents: the leading code span of each of its
 * command headings (`## \`audit\` — …`, `## \`ingest <raw-file...>\` — …`).
 * Sub-headings that are flags (`### \`--staged\``) or field names
 * (`### \`isNew\``) fail the lowercase-word filter and drop out.
 *
 * @param {string} cliDoc
 * @returns {string[]}
 */
function cliDocNames(cliDoc) {
  return [...cliDoc.matchAll(/^#{2,3} `([^\s`]+)/gm)]
    .map(([, name]) => name)
    .filter(name => /^[a-z][a-z-]*$/.test(name))
}

// Each site is [the doc, how its own inventory is read, how one command's entry
// is written in it]. `listing` is used only to prove the failure path: it
// deletes a real entry and the scrape must then come up short.
const DOCS = [
  {
    file: "README.md",
    text: read("README.md"),
    scrape: readmeNames,
    listing: name => new RegExp(`^design-delta ${name}\\b.*$`, "m"),
  },
  {
    file: "docs/cli.md",
    text: read("docs/cli.md"),
    scrape: cliDocNames,
    listing: name => new RegExp(`^#{2,3} \`${name}\\b.*$`, "m"),
  },
]

describe("the docs list every CLI subcommand (issue #511)", () => {
  it("has an inventory to check, and a site list that covers both docs", () => {
    // Non-vacuity guards. An empty `NAMES` would satisfy every `it.each` below
    // by never running, and dropping a `DOCS` entry would leave that doc
    // silently unchecked while everything still passes.
    expect(NAMES.length).toBeGreaterThan(0)
    expect(DOCS.map(doc => doc.file)).toEqual(["README.md", "docs/cli.md"])
  })

  describe.each(DOCS)("$file", ({ text, scrape }) => {
    const listed = scrape(text)

    it.each(NAMES)("lists `design-delta %s`", name => {
      expect(listed).toContain(name)
    })
  })

  // The failure path: without this, a scrape that silently returned every
  // candidate name would pass everything above. `NAMES[0]` keeps even this
  // derived — no command name is written out here either.
  describe.each(DOCS)(
    "$file, with one entry deleted",
    ({ text, scrape, listing }) => {
      const [dropped] = NAMES
      const mutated = text.replace(listing(dropped), "")

      it("really deleted the entry", () => {
        expect(mutated).not.toBe(text)
      })

      it(`no longer lists \`${dropped}\`, and still lists the rest`, () => {
        const listed = scrape(mutated)
        expect(listed).not.toContain(dropped)
        expect(listed).toEqual(
          expect.arrayContaining(NAMES.filter(name => name !== dropped)),
        )
      })
    },
  )
})
