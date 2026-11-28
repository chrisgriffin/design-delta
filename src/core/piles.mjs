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
 * would say. Only an unnamed rule falls through to its side, and that
 * fall-through is never `code`: a wrong guess there costs a question, while a
 * wrong guess the other way costs a change nobody asked for.
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
 * `lint/*` findings are `tokens-config` as a family, below.
 */
export const PILE_RULES = {
  "tokens/var-unresolved": "code",

  "coverage/contract-only": "contract",
  "coverage/uncontracted-component": "contract",
  "coverage/unfinished-contract": "contract",
  "components/intent-unverified": "contract",
  "components/intent-stale": "contract",

  "coverage/design-only": "design",
  "coverage/design-missing": "design",
  "styles/design-binding-missing": "design",

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
 * The pile one finding belongs in.
 *
 * @param {{ruleId: string, severity: string, surface: string, side: string}} finding
 * @returns {"code"|"contract"|"design"|"tokens-config"|"review"}
 */
export function pileOf(finding) {
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
