/**
 * readme-layout.test.js (issue #541) — binds the README `## Layout` block to
 * the real `src/` tree. `layering.test.js` enforces the import direction
 * between layers, not that the README lists the layers that exist, so adding,
 * renaming or removing a directory left the contributor's first map quietly
 * wrong with the suite green.
 *
 * Covered: every top-level `src/<layer>/`, and every `src/sources/<framework>/`
 * and `src/providers/<name>/` — the two places a new adapter lands. Deeper
 * directories (e.g. `src/cli/commands/`) are an implementation detail the
 * block does not promise to list — and may list without failing.
 *
 * The block is read as the first code fence after the heading: a line starting
 * `src/<name>/` is a layer, a two-space-indented `<name>/` is nested under the layer
 * above it. An empty parse fails rather than comparing nothing to nothing.
 */
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

const ROOT = join(import.meta.dirname, "..")
const NESTED = ["sources", "providers"]

function listedInReadme() {
  const readme = readFileSync(join(ROOT, "README.md"), "utf8")
  const start = readme.indexOf("\n## Layout\n")
  if (start === -1) return []
  const fence = readme.slice(start).match(/```[^\n]*\n([\s\S]*?)```/)
  if (!fence) return []
  const listed = []
  let parent = null
  for (const line of fence[1].split("\n")) {
    const top = line.match(/^src\/([\w-]+)\//)
    // Exactly one level (two spaces) in; a deeper line is not a direct child.
    const nested = line.match(/^ {2}([\w-]+)\//)
    if (top) listed.push(`src/${(parent = top[1])}/`)
    // Only sources/ and providers/ children are compared; an indented line
    // under any other layer (e.g. `commands/` under `src/cli/`), or deeper
    // than one level, is allowed prose, not a claim this test can check.
    else if (nested && NESTED.includes(parent))
      listed.push(`src/${parent}/${nested[1]}/`)
  }
  return listed
}

function dirs(rel) {
  return readdirSync(join(ROOT, rel), { withFileTypes: true })
    .filter(e => e.isDirectory())
    .map(e => `${rel}/${e.name}/`)
}

function onDisk() {
  const layers = dirs("src")
  return [
    ...layers,
    ...NESTED.flatMap(layer =>
      layers.includes(`src/${layer}/`) ? dirs(`src/${layer}`) : [],
    ),
  ]
}

describe("the README Layout block matches src/ (issue #541)", () => {
  const listed = listedInReadme()
  const actual = onDisk()

  it("parses directory entries out of the README `## Layout` block", () => {
    // Without this, a moved heading or fence yields [] and the unlisted-check
    // below would be the only thing failing — for the wrong reason.
    expect(listed.length).toBeGreaterThan(0)
  })

  it("every directory the README lists exists under src/", () => {
    const gone = listed
      .filter(d => !actual.includes(d))
      .map(d => `README.md lists ${d}, but it does not exist`)
    expect(gone).toEqual([])
  })

  it("every src/ layer, framework adapter and provider is listed in the README", () => {
    const unlisted = actual
      .filter(d => !listed.includes(d))
      .map(d => `${d} exists, but README.md's ## Layout block does not list it`)
    expect(unlisted).toEqual([])
  })
})
