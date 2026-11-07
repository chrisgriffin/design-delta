/**
 * staged.mjs — the `--staged` file scope (issue #220): which files does
 * `git diff --staged --name-only` say this commit is about?
 *
 * Lives in `cli/` for the same reason `flags.mjs` does (ADR-001 D4): reading
 * argv and reading the index are both facts about HOW the tool was invoked,
 * not about the code being audited. `sources/` censuses a project; this
 * censuses the invocation. `cli/commands/dock.mjs` already establishes
 * `child_process` as a CLI-layer concern.
 *
 * `--relative` is load-bearing, not decoration: without it git prints paths
 * relative to the REPOSITORY root, and every other path in this engine
 * resolves against `process.cwd()` — a project that sits in a subdirectory of
 * its repo would have matched nothing at all. `--relative` also drops staged
 * files outside the project root, which is the same scoping every census here
 * already applies.
 *
 * A failure to read the index is an ERROR, never an empty scope. "Not a git
 * repository" and "nothing is staged" are different answers, and quietly
 * turning the first into the second would report a clean run over a scope
 * that was never established — the exact dishonest-output failure D8 exists
 * to prevent. An EMPTY staged list is a legitimate, clean, empty scope.
 */

import { execFileSync } from "node:child_process"
import { resolve } from "node:path"

/**
 * Resolve the staged-file scope for a run rooted at `root`.
 *
 * @param {string} [root] the project root (`process.cwd()` for a real run)
 * @returns {{includes: (path: string) => boolean, size: number} | {error: string}}
 *   `includes` accepts either an absolute path or one relative to `root` —
 *   the two shapes the censuses in this engine hand around — so a caller
 *   never has to normalize before asking.
 */
export function stagedFileScope(root = process.cwd()) {
  let stdout
  try {
    stdout = execFileSync(
      "git",
      ["diff", "--staged", "--name-only", "--relative"],
      { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    )
  } catch (err) {
    const detail = String(err?.stderr || err?.message || "")
      .split("\n")
      .map(line => line.trim())
      .filter(Boolean)[0]
    return {
      error: `--staged: could not read the staged file list${detail ? ` (${detail})` : ""}`,
    }
  }

  const files = new Set(
    stdout
      .split("\n")
      .map(line => line.trim())
      .filter(Boolean)
      .map(name => resolve(root, name)),
  )

  return { includes: path => files.has(resolve(root, path)), size: files.size }
}
