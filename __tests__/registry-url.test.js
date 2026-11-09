/**
 * registry-url.test.js (issue #506) — the registry this package publishes to is
 * written in three separate files, and until this test nothing compared them:
 * `package.json`'s `publishConfig.registry`, create-github-release.yml's
 * `npm_registry_url` input, and publish.yml's setup-node `registry-url`.
 *
 * Move one alone and the release publishes to the wrong registry, or fails at
 * publish time — on the one code path no PR exercises, with no test, lint or CI
 * check saying so first. The assertion is three-way: it compares the parsed
 * values to EACH OTHER, never to a URL literal here, so changing all three
 * together stays green and this file needs no edit when the registry moves.
 *
 * Text walk, matching ci-workflow.test.js and workflow-timeouts.test.js: no YAML
 * parser in this repo's dependency tree. Each extractor anchors on the key at
 * the start of a line (so a `#` comment mentioning the same URL in prose — both
 * workflows have one — cannot match) and insists on exactly one hit, so a
 * renamed or duplicated key fails loudly instead of yielding `undefined` and
 * making the comparison vacuously true.
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"

const ROOT = join(import.meta.dirname, "..")

const read = file => readFileSync(join(ROOT, file), "utf8")

/** The one value of `key` in `text`, as a YAML scalar on its own line. */
function yamlValue(file, key) {
  const text = read(file)
  const hits = [
    ...text.matchAll(
      new RegExp(`^[ \\t]*${key}:[ \\t]*["']?([^"'\\s#]+)["']?[ \\t]*$`, "gm"),
    ),
  ]
  if (hits.length !== 1) {
    throw new Error(
      `${file}: expected exactly one \`${key}:\` line, found ${hits.length} — ` +
        `the key was renamed, removed or duplicated, so nothing here compares it any more`,
    )
  }
  return hits[0][1]
}

// Each site is [file, how to read the registry URL out of it]. The order is the
// order CLAUDE.md § Architecture's coupling row lists them.
const SITES = [
  {
    file: "package.json",
    url: JSON.parse(read("package.json")).publishConfig?.registry,
  },
  {
    file: ".github/workflows/create-github-release.yml",
    url: yamlValue(
      ".github/workflows/create-github-release.yml",
      "npm_registry_url",
    ),
  },
  {
    file: ".github/workflows/publish.yml",
    url: yamlValue(".github/workflows/publish.yml", "registry-url"),
  },
]

describe("the three registry URLs agree (issue #506)", () => {
  it("reads a registry URL out of each of the three files", () => {
    // Two different guards. The length pins the site LIST: drop an entry and
    // the equality below still passes over what is left, silently no longer
    // covering that file. The loop is the `undefined` guard, and it is
    // `package.json` it is there for — `publishConfig?.registry` yields
    // `undefined` when the key moves, where `yamlValue` throws outright, and
    // undefined values would satisfy the equality below by being equal.
    expect(SITES).toHaveLength(3)
    for (const { file, url } of SITES) {
      expect(`${file}: ${url}`).toMatch(/: https:\/\/\S+$/)
    }
  })

  it("all three name the same registry — move one alone and this fails, naming it", () => {
    const [reference] = SITES
    const disagreeing = SITES.filter(s => s.url !== reference.url).map(
      s =>
        `${s.file} publishes to ${s.url}, but ${reference.file} publishes to ${reference.url}`,
    )
    expect(disagreeing).toEqual([])
  })
})
