/**
 * coupled-files.test.js (issue #394) — CLAUDE.md § Architecture lists the
 * couplings no test can see. A row naming a file that no longer exists sends
 * whoever reads it to the wrong place; every backticked repo path in that
 * section must exist.
 */
import { readFileSync, existsSync, globSync } from "node:fs"
import { join } from "node:path"

const ROOT = join(import.meta.dirname, "..")
const md = readFileSync(join(ROOT, "CLAUDE.md"), "utf8")
const section = md.split("## Architecture")[1].split(/\n## /)[0]
const paths = [...section.matchAll(/`([^`\s]+)`/g)]
  .map(m => m[1])
  .filter(t => /[/.]/.test(t) && !/^(npm|gh|RemoteTrigger)\b/.test(t))

describe("CLAUDE.md § Architecture (issue #394)", () => {
  it("names real paths only", () => {
    expect(paths.length).toBeGreaterThan(5)
    const missing = paths.filter(p =>
      p.includes("*")
        ? globSync(p, { cwd: ROOT }).length === 0
        : !existsSync(join(ROOT, p)),
    )
    expect(missing).toEqual([])
  })
})
