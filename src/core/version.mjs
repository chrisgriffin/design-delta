/**
 * version.mjs — the engine's own version, and a comparison over the
 * `MAJOR.MINOR.PATCH` form it is published under (issue #458).
 *
 * `ingest` stamps `packageVersion()` into a snapshot's `provenance`, and
 * `audit` compares it against the provider's `normalizationSince` to say when
 * a committed snapshot was normalized by an engine older than the rules that
 * read it — "which engine wrote this" was a blind spot before.
 */

import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

// Resolved from THIS module's own real location, never from the cwd of
// whatever project is being audited — the same convention as
// `core/config.mjs`'s `PACKAGE_ROOT`.
const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..")

/** @returns {string} the installed package's version, as `--version` prints it */
export function packageVersion() {
  return JSON.parse(readFileSync(join(PACKAGE_ROOT, "package.json"), "utf8"))
    .version
}

/**
 * Numeric compare of two `MAJOR.MINOR.PATCH` strings; a prerelease suffix is
 * ignored and a missing segment reads as 0. Not full semver on purpose — this
 * package is `0.x` and only ever publishes the plain three-part form.
 *
 * @param {string} a
 * @param {string} b
 * @returns {-1|0|1}
 */
export function compareVersions(a, b) {
  const parse = v =>
    String(v)
      .split("-")[0]
      .split(".")
      .map(n => Number.parseInt(n, 10) || 0)
  const [x, y] = [parse(a), parse(b)]
  for (let i = 0; i < 3; i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0)
    if (d !== 0) return d < 0 ? -1 : 1
  }
  return 0
}
