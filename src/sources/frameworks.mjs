// The one place a UI framework is selected (issue #117, Chris 2026-08-29).
//
// `core/` and `modules/` never name a framework (ADR-001 D16,
// __tests__/layering.test.js); `sources/<framework>/` is the only layer that
// may. Until now the CLI commands imported `sources/react/*` directly, so
// "which framework is this project in" was a hardcoded import, not a config
// value. This registry resolves `code.framework` from the project's config to
// an adapter object; a CLI command asks for the adapter and never names a
// framework itself.
//
// The adapter shape is exactly what the React adapter already produces — see
// docs/framework-adapter-contract.md. Shipped against one adapter on purpose:
// the interface is the current React surface, not a guess at a second
// framework's needs. A second adapter registers here and supplies its own
// file conventions; nothing in core/ changes.

import * as react from "./react/adapter.mjs"

/** @type {Record<string, typeof react>} */
export const FRAMEWORKS = { react }

export const DEFAULT_FRAMEWORK = "react"

/**
 * The adapter for this project's `code.framework` (default `react`). An
 * unknown name is a config error, named loudly with the known adapters —
 * never a silent fall-through to React.
 *
 * @param {object} [config] the project's (unresolved) config
 */
export function resolveFramework(config) {
  const name =
    (config && config.code && config.code.framework) || DEFAULT_FRAMEWORK
  const adapter = FRAMEWORKS[name]
  if (!adapter) {
    throw new Error(
      `code.framework "${name}" is not a known framework adapter (known: ${Object.keys(FRAMEWORKS).join(", ")})`,
    )
  }
  return adapter
}
