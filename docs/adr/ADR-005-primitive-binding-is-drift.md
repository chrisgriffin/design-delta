---
status: accepted
date: 2026-10-26
---

# ADR-005: A component that binds a primitive where its contract declares a semantic token is drift, not agreement

## Context

`styles/design-binding-missing` reports a token a contract declares that no
variable the design component binds maps to. One case sits between the
tiers: the design component binds a primitive token, and the contract
declares the semantic token that aliases it. Both sides then resolve to the
same value, so the question is whether they agree.

The issue and pull request numbers below are in the engine's earlier,
privately developed source, where this history happened; they are not
issues in this repo.

- Issue #684 argued they do, treating a design file that holds only the
  primitive tier as a legitimate choice, and asked the engine to stop
  reporting the case.
- PR #685 built that: `buildAliasIndex` and `expandThroughAliases` in
  `src/modules/styles.mjs` walk up the census's alias edges from every bound
  token, and a declared token reached that way counted as bound.
- While PR #685 was still open, on 2026-10-26, the maintainer reversed its
  premise: primitives are not what components bind. Under that rule the
  finding #685 silenced was correct: the component bound the wrong tier, and
  the fix belongs in the design file, not the engine.
- About three and a half hours later the same evening, PR #685 was merged by
  mistake, and in a comment after the merge the maintainer chose the second
  option offered on #685: keep the finding, make its message more precise,
  in another PR.
- Issue #686 and PR #687 shipped that reversal. PR #687 wrote no record of
  why, which left an alias index in the rule that deliberately does not
  suppress anything, with nothing saying so.

## Decision

Components bind semantic tokens. A design component that binds a primitive
where its contract declares the semantic token aliasing it has bound the
wrong tier, and `styles/design-binding-missing` reports it. Decided by the
maintainer on 2026-10-26.

The alias walk exists only to diagnose: when a declared token is reached from
a bound token through one or more alias hops, the finding's message names the
bound token and says to bind the declared one, and `data.boundAliasTarget`
carries the bound token's id. A walk result never removes a finding.

What the decision leaves unchanged, each pinned by a test in
`__tests__/modules-styles.test.js`:

1. **The walk goes upward only.** A bound semantic token does not bind the
   primitive it aliases: "never walks downward: a bound semantic token does
   not bind the primitive it aliases".
2. **The three #492 skips.** A property the provider cannot express as a
   variable, a zero-valued token, and a `tokenMap` redirect are each skipped
   with a reason, never reported: the describe block "runDesignBindingsCheck
   — what the comparison cannot reach (#492)".
3. **The `tokenMap` skip-with-a-reason.** A redirect stays a skip even when
   the declared token aliases the redirect's target: "a tokenMap redirect
   stays a skip, even when the declared token aliases the redirect's target".
4. **The message for a token no alias chain reaches.** It keeps the original
   wording and carries no `boundAliasTarget`: "a declared token no chain
   reaches keeps the plain message".

## Consequences

- A proposal to resolve a declared binding through the alias chain, so that
  a bound primitive satisfies a declared semantic token, is a proposal to
  reverse this record. It needs the maintainer's decision, not a rule change.
- Fixing such a finding is a design-file change: bind the declared semantic
  variable. Neither the engine nor a project's config should absorb it.
- The rule's `description` points here, so `docs/rules.md` reaches this
  record; `docs/report-structure.md` describes the message and links here
  rather than restating the reason.
- Worth revisiting only if the tier model itself changes, for example if a
  design system deliberately lets components bind primitives.
