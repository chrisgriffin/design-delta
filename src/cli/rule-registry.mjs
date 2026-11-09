/**
 * rule-registry.mjs — the ONE registry spanning every rule in the engine
 * (issue #188), for CLI commands that need to validate a config's `rules`/
 * `exemptions` blocks against every id that could legitimately appear there —
 * not just the ids the surfaces THIS command happens to run would emit.
 *
 * `core/rules.mjs`'s `validateRuleIds`/`validateExemptionRuleIds` are pure
 * functions of an already-built registry; they do not know what a "module" is
 * (`core/` imports nothing outside `core/`, ADR-001 D4). Building the
 * REGISTRY they validate against — which means importing every domain
 * module's own `RULES` array — is therefore `cli/`'s job, the one layer
 * allowed to import `core`, `sources`, `spec`, and `modules` all at once.
 *
 * Deliberately NOT built from `src/index.mjs`'s exports (the way
 * `scripts/generate-rules-reference.mjs` does): `index.mjs` sits outside
 * every declared layer (`__tests__/layering.test.js`'s `layerOf` returns
 * `null` for it), so a `cli/` file importing it would fail the layering
 * guard. Each module's `RULES` is imported directly instead — the same
 * pattern `cli/commands/audit.mjs` already uses.
 *
 * A rule id is valid for `rules`/`exemptions` regardless of which surfaces
 * THIS run evaluates — `design-delta lint` accepting a `rules` entry for
 * `tokens/var-unresolved` is correct, not lenient, since the same config
 * file also drives `audit`. Scoping validity to "what this command runs"
 * would make a config valid under `lint` and invalid under `audit` for
 * identical content, which is not a distinction a consumer authoring ONE
 * config file should have to reason about.
 */

import { createRegistry } from "../core/rules.mjs"
import { RULES as componentRules } from "../modules/components.mjs"
import { RULES as tokenRules } from "../modules/tokens.mjs"
import { RULES as styleRules } from "../modules/styles.mjs"
import { RULES as anatomyRules } from "../modules/anatomy.mjs"
import { RULES as lintRules } from "../modules/lint.mjs"
import { RULES as exemptionRules } from "../core/exemptions.mjs"

/**
 * Build the full-engine rule registry. A fresh registry per call — cheap
 * (a handful of arrays merged, `createRegistry` is a plain loop) and it
 * keeps this module free of shared mutable state, consistent with every
 * other registry in the engine being built once per process at import time
 * from a literal `RULES` array, never mutated after.
 *
 * @returns {{get: Function, ids: Function, bySurface: Function}}
 */
export function buildFullRuleRegistry() {
  return createRegistry([
    ...componentRules,
    ...tokenRules,
    ...styleRules,
    ...anatomyRules,
    ...lintRules,
    ...exemptionRules,
  ])
}
