/**
 * typescript.mjs — the lazy `typescript` load the Figma provider's binding
 * compare parses with (issue #609). `typescript` is an optional peer
 * (CLAUDE.md § Stack & layout), so it is required at call time, never
 * imported: a consumer without it still loads this provider, and
 * `bindingStatus` reports `compare-unreliable` instead of crashing. Its own module so a test can stub it for code that reaches the
 * provider through `audit`. `providers/` may import only `core/`, which is why
 * this does not reuse `sources/react/extract.mjs`'s loader.
 */

import { createRequire } from "node:module"

const requireFromHere = createRequire(import.meta.url)

/**
 * @param {string} [moduleName] overridable so a test can point at a module
 *   that cannot resolve
 * @returns {object|null} the module, or null when it is not installed
 */
export function loadTypeScript(moduleName = "typescript") {
  try {
    return requireFromHere(moduleName)
  } catch {
    return null
  }
}
