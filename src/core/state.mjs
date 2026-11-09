/**
 * state.mjs — the `state.json` schema + deterministic hashing (ADR-001 D6,
 * roadmap item #216, slice a of the original combined ticket).
 *
 * `core/`: imports nothing outside `core/` + Node builtins + ajv, same
 * boundary `config.mjs` holds — a persisted state file is a system boundary
 * a later run reads across, so its schema load/validate/hash path stands on
 * its own, independent of whatever census module eventually feeds it.
 *
 * `designHash` is omitted entirely from every entity, never written as
 * `null`: `cli/commands/snapshot.mjs` hashes the code census and the
 * contract and never reads the design census, so there is no design-side
 * hash to write yet (issue #481 carries the design snapshot's own
 * `treeHash` in) — and a null placeholder would be a guess this repo's own
 * conventions forbid. `verify`/`audit` never call anything here to WRITE —
 * only `cli/commands/snapshot.mjs` does; the audit path's read-only
 * guarantee is unchanged by this file's existence.
 */

import { existsSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { createHash } from "node:crypto"

import Ajv from "ajv/dist/2020.js"
import addFormats from "ajv-formats"

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..")

export const STATE_SCHEMA_FILE = join(
  PACKAGE_ROOT,
  "schema",
  "state.schema.json",
)

const STATE_SCHEMA = JSON.parse(readFileSync(STATE_SCHEMA_FILE, "utf8"))

const ajv = new Ajv({ allErrors: true, strict: false })
addFormats(ajv)
const runStateSchema = ajv.compile(STATE_SCHEMA)

/**
 * Schema-validate a `state.json` document.
 *
 * @param {unknown} state
 * @returns {{valid: boolean, errors: string[]}}
 */
export function validateState(state) {
  const valid = runStateSchema(state)
  if (valid) return { valid: true, errors: [] }
  const errors = (runStateSchema.errors || []).map(
    err => `${err.instancePath || "(root)"} ${err.message}`,
  )
  return { valid: false, errors }
}

/**
 * Read `state.json` at `path` if it exists — the read-only half of D6,
 * consumed by `audit`/`verify` (roadmap #243). An absent file is not an
 * error: it just means there is no prior run to compare against, so
 * `present` is `false` and `state` is `null` rather than either command
 * inventing a placeholder. A file that exists but fails to parse or
 * schema-validate is reported the same "surface skips, it doesn't fail the
 * run" way every other unreadable input in this engine is (`errors` carries
 * why) — `state` stays `null` either way, never a partially-trusted value.
 *
 * @param {string} path absolute path to the state file
 * @param {string} [label] display path for error messages (issue #133's
 *   relative-diagnostic-paths rule) — defaults to `path` when the caller has
 *   no separate relative form to offer
 * @returns {{present: boolean, state: object|null, errors: string[]}}
 */
export function readState(path, label = path) {
  if (!existsSync(path)) return { present: false, state: null, errors: [] }

  let raw
  try {
    raw = JSON.parse(readFileSync(path, "utf8"))
  } catch (err) {
    return {
      present: true,
      state: null,
      errors: [`${label} could not be parsed: ${err.message}`],
    }
  }

  const { valid, errors } = validateState(raw)
  if (!valid) return { present: true, state: null, errors }

  return { present: true, state: raw, errors: [] }
}

// Recursively sorts every plain object's keys so the same logical value
// always stringifies to the same bytes, regardless of the insertion order
// whatever upstream census/contract code happened to build it in — hashing
// `JSON.stringify` directly would make the hash an accident of construction
// order, not a property of the actual value.
function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value !== null && typeof value === "object") {
    const out = {}
    for (const key of Object.keys(value).sort())
      out[key] = canonicalize(value[key])
    return out
  }
  return value
}

/**
 * A deterministic hex digest of a JSON-serializable value: the same logical
 * value always hashes the same, independent of key insertion order.
 *
 * @param {unknown} value
 * @returns {string} a sha256 hex digest
 */
export function hashJson(value) {
  return createHash("sha256")
    .update(JSON.stringify(canonicalize(value)))
    .digest("hex")
}
