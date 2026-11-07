/**
 * design-snapshot.mjs — read one of the two on-disk design snapshots
 * (ADR-001 D7) through the active provider's own validator. Shared by
 * `audit`, `lint` and, since issue #481, `snapshot`: the `state.json`
 * entity for a contract carries the design census's hash for it.
 */

import { existsSync, readFileSync } from "node:fs"

// Read + schema-validate a design-side snapshot (`design-components.json` /
// `design-tokens.json`, ADR-003 Phase 5.1/5.3), degrading like missing on
// EITHER failure (D7) — `existsSync` false, unparseable JSON, and a schema
// violation are three different causes for the exact same outcome: no
// snapshot to compare against. `reason` is set only for the latter two, so
// the caller can tell "never gathered" (silent) from "gathered but invalid"
// (a diagnostic) apart. `validate` is the provider's own validator for
// WHICH snapshot this is (`validateDesignComponents`/`validateDesignTokens`)
// — this function itself stays generic over that shape.
export function readDesignSnapshot(path, validate) {
  if (!existsSync(path)) return { present: false, snapshot: null }

  let raw
  try {
    raw = JSON.parse(readFileSync(path, "utf8"))
  } catch (err) {
    return {
      present: true,
      snapshot: null,
      reason: `${path} could not be parsed: ${err.message}`,
    }
  }

  const { valid, errors } = validate(raw)
  if (!valid) {
    return {
      present: true,
      snapshot: null,
      reason: `${path} failed schema validation: ${errors.join("; ")}`,
    }
  }

  return { present: true, snapshot: raw }
}
