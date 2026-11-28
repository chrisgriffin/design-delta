/**
 * piles.mjs — who can clear a finding (issue #62).
 *
 * A finding's `side` says where the engine attributes the drift, not who can
 * clear it: a token nothing uses is `side: "code"`, and no code change is the
 * right fix for it. This module is the ONE home of the table that sorts every
 * finding into exactly one pile by what would have to change to clear it. The
 * resolve skill and `design-delta decide` both read it; neither restates it.
 *
 *   code           code can clear it: the resolve skill's work
 *   contract       the contract's owner decides
 *   design         the design file's owner decides
 *   tokens-config  the token system's or the config's owner decides
 *   review         the engine reached no verdict, or the answer is a person's
 *
 * PRECEDENCE: a rule named in `PILE_RULES` wins over anything its `side`
 * would say. A rule the table does not name falls through to its side:
 * `design` to the design pile, `spec` to the contract pile, and a
 * `side: "code"` finding at `error` or `warn` on the `components`, `styles`
 * or `anatomy` surface to `code`. Everything else lands in `review`: a wrong
 * guess there costs a question, while a wrong guess the other way costs a
 * change nobody asked for.
 *
 * AN INVALID CONTRACT. Every finding about a component is a comparison
 * against its contract, so a code-side finding on a component whose contract
 * failed validation means nothing yet: it goes to `contract`, never `code`,
 * until the contract is fixed. The caller names those components.
 *
 * `coverage/contract-only` is either the contract's path being wrong or the
 * component never having been built, and the engine cannot tell which. It is
 * `contract` here, the cautious pile; an agent that reads the project and
 * finds the component was simply never built may work it as code.
 *
 * `core/`: pure, imports nothing.
 */

/** The five piles, in the order a report lists them. */
export const PILES = ["code", "contract", "design", "tokens-config", "review"]

/** The surfaces whose code-side error/warn findings code can clear. */
const CODE_SURFACES = new Set(["components", "styles", "anatomy"])

/**
 * Every rule whose pile is not decided by its `side` and severity alone.
 * `lint/*` findings are `tokens-config` as a family, below, except the lint
 * rules that read a contract or the design file, named here.
 */
export const PILE_RULES = {
  "tokens/var-unresolved": "code",

  "coverage/contract-only": "contract",
  "coverage/uncontracted-component": "contract",
  "coverage/unfinished-contract": "contract",
  "components/intent-unverified": "contract",
  "components/intent-stale": "contract",
  "lint/contract-name-case": "contract",
  "lint/contract-enum-invalid": "contract",

  "coverage/design-only": "design",
  "coverage/design-missing": "design",
  "styles/design-binding-missing": "design",
  "lint/design-name-invalid": "design",

  "tokens/token-unreferenced": "tokens-config",
  "tokens/token-unemitted": "tokens-config",
  "tokens/token-untracked": "tokens-config",
  "tokens/emitted-value-mismatch": "tokens-config",
  "coverage/stale-exemption": "tokens-config",

  "anatomy/coverage-partial": "review",
  "anatomy/coverage-declined": "review",
  "styles/element-unmapped": "review",
  "styles/variant-unmapped": "review",
  "components/prop-type-unresolved": "review",
  "anatomy/attribute-unresolved": "review",
  "components/unused-component": "review",
}

/**
 * Whether a finding is about one of the named components: its entity is the
 * contract `id`, `<id>.<element>`, or one of the contract files.
 */
function aboutInvalidContract(finding, invalidContracts) {
  const entity = finding.entity
  if (typeof entity !== "string") return false
  if (invalidContracts.files?.includes(entity)) return true
  return (invalidContracts.ids || []).some(
    id => entity === id || entity.startsWith(`${id}.`),
  )
}

/**
 * The pile one finding belongs in.
 *
 * @param {{ruleId: string, severity: string, surface: string, side: string, entity?: string}} finding
 * @param {object} [context]
 * @param {{ids?: string[], files?: string[]}} [context.invalidContracts] the
 *   components whose contract failed validation, by contract id and file
 * @returns {"code"|"contract"|"design"|"tokens-config"|"review"}
 */
export function pileOf(finding, { invalidContracts } = {}) {
  const pile = sidePileOf(finding)
  if (
    pile === "code" &&
    invalidContracts &&
    aboutInvalidContract(finding, invalidContracts)
  )
    return "contract"
  return pile
}

function sidePileOf(finding) {
  const named = PILE_RULES[finding.ruleId]
  if (named) return named
  if (finding.ruleId.startsWith("lint/")) return "tokens-config"
  if (finding.ruleId.startsWith("tokens/design-")) return "design"
  if (finding.side === "design") return "design"
  if (finding.side === "spec") return "contract"
  if (
    finding.side === "code" &&
    (finding.severity === "error" || finding.severity === "warn") &&
    CODE_SURFACES.has(finding.surface)
  )
    return "code"
  return "review"
}
