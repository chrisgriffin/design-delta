/**
 * flags.mjs — the ONE flag parser + the ONE "was this module invoked
 * directly?" guard for the single `design-delta` bin (ADR-001 D4/D8).
 *
 * v1 shipped three flag parsers (one per engine family) and several
 * hand-rolled `isMain` variants scattered across its eleven sibling bins.
 * this collapses both to one implementation each, lifted verbatim from v1's
 * `src/lib/cli.mjs` (the proven, bug-fixed version) and re-homed here in
 * `cli/` rather than `core/` — `core/` is domain-agnostic and imports
 * nothing internal (ADR-001 D4); parsing argv and resolving `import.meta.url`
 * against `process.argv[1]` are both CLI-shell concerns that belong next to
 * `cli/main.mjs`, the one place they're used.
 *
 * This module imports only Node builtins — never `src/lib/` or any other v1
 * flat file (the strangler boundary enforced by `__tests__/layering.test.js`).
 */

import { realpathSync } from "node:fs"
import { pathToFileURL } from "node:url"

// `isMain(import.meta.url)` — true only when the calling module is the
// directly-invoked script. Safe when process.argv[1] is absent.
//
// Node realpath-resolves an ES module's `import.meta.url` (symlinks followed,
// unless `--preserve-symlinks`), but `process.argv[1]` is the path AS INVOKED.
// On macOS a spawned script under `os.tmpdir()` (`/var/folders/…`, a symlink to
// `/private/var/…`) makes the two URLs differ, so a raw comparison wrongly
// answers "no" and `main()` never runs. Realpath-resolve argv[1] first so the
// two sides are compared on the same (canonical) footing.
export function isMain(importMetaUrl) {
  if (!process.argv[1]) return false
  let argvPath = process.argv[1]
  try {
    argvPath = realpathSync(argvPath)
  } catch {
    // argv[1] may not name a real file (some embedders) — fall back to raw.
  }
  return importMetaUrl === pathToFileURL(argvPath).href
}

// `--fail-on-new-drift` → `failOnNewDrift`, `-o` → `o`. Strips every leading
// dash, then camelCases on the remaining internal dashes — the naming
// convention every hand-rolled `opts` object in this codebase already uses.
function flagKey(flag) {
  return flag
    .replace(/^-+/, "")
    .replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase())
}

/**
 * parseFlags(argv, spec) — the one flag parser every subcommand shares.
 *
 * `spec = { boolean: ["--json", ...], value: ["--snapshots", ...], positional: bool }`.
 *
 * - A token matching `spec.boolean` sets `opts.<camelCaseName>` to `true`.
 * - A token matching `spec.value` consumes the NEXT token as its value and
 *   sets `opts.<camelCaseName>` to it; a missing following value is an error.
 * - Any other token that starts with a dash is an unknown flag — an error,
 *   never silently ignored (this is the whole point: a typo'd flag must not
 *   run with defaults and look successful).
 * - A bare (non-dash) token is only accepted when `spec.positional` is
 *   truthy, in which case it's collected into `opts.positional` (in order,
 *   duplicates preserved) — for subcommands that take file paths / component
 *   names alongside their flags. Without `spec.positional` a bare token is
 *   also an unknown-argument error.
 *
 * Returns `{ opts, errors }` — pure, never prints or exits; `errors` is a
 * non-empty array of human-readable messages when anything didn't parse.
 * Callers print each error to stderr and exit before doing any work.
 */
export function parseFlags(argv, spec = {}) {
  const booleanSet = new Set(spec.boolean || [])
  const valueSet = new Set(spec.value || [])
  const opts = {}
  const positional = []
  const errors = []
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (booleanSet.has(arg)) {
      opts[flagKey(arg)] = true
      continue
    }
    if (valueSet.has(arg)) {
      const v = argv[i + 1]
      if (v === undefined) {
        errors.push(`"${arg}" requires a value.`)
      } else {
        opts[flagKey(arg)] = v
        i++
      }
      continue
    }
    if (arg.startsWith("-") && arg !== "-") {
      errors.push(`Unknown argument "${arg}".`)
      continue
    }
    if (spec.positional) {
      positional.push(arg)
    } else {
      errors.push(`Unknown argument "${arg}".`)
    }
  }
  if (spec.positional) opts.positional = positional
  return { opts, errors }
}
