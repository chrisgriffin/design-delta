/**
 * recommendations.mjs — the answers a decision offers, and the one it
 * recommends (issue #62).
 *
 * Fixed data, keyed by pile and overridden per rule: the same findings always
 * get the same recommendation, so a decision page is as deterministic as the
 * audit it comes from. A recommendation is a starting point an owner can
 * overrule in one click, never a decision made for them.
 *
 * The answers:
 *
 *   fix-code          change the code to match (the resolve skill does it)
 *   change-contract   change the contract (the resolve skill does it)
 *   change-design     change the design file (its owner does it)
 *   accept            correct by design: an `accepted` exemption
 *   waive             deliberately not fixed: a `waived` exemption
 *   track             a known gap, followed up in an issue: a `tracked` exemption
 *   remove-exemption  delete a stale exemption from the config
 *
 * `core/`: pure, imports nothing outside `core/`.
 */

export const ANSWERS = [
  "fix-code",
  "change-contract",
  "change-design",
  "accept",
  "waive",
  "track",
  "remove-exemption",
]

/** Answers recorded as an exemption, and the exemption `decision` each writes. */
export const EXEMPTION_ANSWERS = {
  accept: "accepted",
  waive: "waived",
  track: "tracked",
}

/** Answers recorded in the decisions file, for the resolve skill to act on. */
export const ACTION_ANSWERS = ["fix-code", "change-contract", "change-design"]

const PILE_DEFAULTS = {
  code: {
    options: ["fix-code", "change-contract", "accept", "waive", "track"],
    recommended: "fix-code",
    reason:
      "The contract is the source of truth and the code disagrees with it, so the code is the side to change.",
  },
  contract: {
    options: ["change-contract", "fix-code", "accept", "waive", "track"],
    recommended: "change-contract",
    reason:
      "This is a question about what the contract should say, and settling it in the contract settles it everywhere.",
  },
  design: {
    options: ["change-design", "change-contract", "accept", "waive", "track"],
    recommended: "change-design",
    reason:
      "The contract is the source of truth, so the design file is the side to bring in line unless the contract is what is wrong.",
  },
  "tokens-config": {
    options: ["fix-code", "accept", "waive", "track"],
    recommended: "fix-code",
    reason:
      "A rule the project turned on reports that the token files break its own convention, and fixing the token is the usual answer.",
  },
  review: {
    options: ["accept", "fix-code", "change-contract", "waive", "track"],
    recommended: "accept",
    reason:
      "The engine could not compare this. If a read by hand shows the code does what the contract says, accepting it records that.",
  },
}

const RULE_OVERRIDES = {
  "coverage/uncontracted-component": {
    options: ["change-contract", "accept", "waive", "track"],
    reason:
      "A component with no contract is never checked, so the usual answer is to write one for it.",
  },
  "coverage/contract-only": {
    reason:
      "The contract names a file where no component was found: point it at the right path, or choose fix-code to build the component.",
  },
  "coverage/design-only": {
    options: ["change-contract", "change-design", "accept", "waive", "track"],
    recommended: "change-contract",
    reason:
      "A design component with no contract is never checked, so the usual answer is to write a contract that names it.",
  },
  "coverage/design-missing": {
    recommended: "change-contract",
    reason:
      "The contract names a design component the design file does not have; usually the component was renamed and the contract should follow.",
  },
  // `remove-exemption` only: an exemption written under this rule could never
  // take effect, because `applyExemptions` reports stale exemptions after its
  // exemption pass, so nothing would ever match it.
  "coverage/stale-exemption": {
    options: ["remove-exemption"],
    recommended: "remove-exemption",
    reason:
      "The exemption no longer matches anything the rule reports, so it hides nothing and can go.",
  },
  "tokens/token-unreferenced": {
    recommended: "accept",
    reason:
      "A token nothing uses yet is usually kept on purpose, such as a step that keeps a scale complete; accept it unless it was meant to be used.",
  },
  "tokens/token-unemitted": {
    recommended: "accept",
    reason:
      "A token the build never emits is usually a tier that is never meant to reach a stylesheet; accept it unless it should be emitted.",
  },
  "tokens/emitted-value-mismatch": {
    reason:
      "The built stylesheet disagrees with the token file, so the build output is the side that is wrong.",
  },
  "tokens/token-untracked": {
    reason:
      "A custom property outside the token system is a value that escaped it; moving it into the tokens is the usual answer.",
  },
  "components/unused-component": {
    options: ["accept", "track", "waive", "fix-code"],
    recommended: "accept",
    reason:
      "A component nothing imports is new or no longer used. Accept it if it is new, or track its removal if not.",
  },
}

/**
 * The options and recommendation for a decision.
 *
 * @param {string} ruleId
 * @param {string} pile one of `core/piles.mjs`'s `PILES`
 * @returns {{options: string[], recommended: string, reason: string}}
 */
export function recommendationFor(ruleId, pile) {
  const base = PILE_DEFAULTS[pile] || PILE_DEFAULTS.review
  const override = RULE_OVERRIDES[ruleId] || {}
  const prefix = ruleId.startsWith("tokens/design-")
    ? {
        options: ["change-design", "fix-code", "accept", "waive", "track"],
        reason:
          "The token file is what the code ships, so the design variable is the side to bring in line unless the token is what is wrong.",
      }
    : {}
  const merged = { ...base, ...prefix, ...override }
  // An override that narrows the options without naming a recommendation
  // must still recommend one it offers.
  if (!merged.options.includes(merged.recommended))
    merged.recommended = merged.options[0]
  return merged
}

/** For tests: every table entry, so each can be checked against its options. */
export const RECOMMENDATION_TABLES = { PILE_DEFAULTS, RULE_OVERRIDES }
