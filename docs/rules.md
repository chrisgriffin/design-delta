# Rule reference

Generated from the rule registries in [`src/index.mjs`](../src/index.mjs) — **do not hand-edit this file**, it is overwritten by `node scripts/generate-rules-reference.mjs` (checked in CI via the same script's `--check` flag).

Every finding this engine emits carries the id of the rule that raised it. There are 59 rules across 6 surfaces.

A rule's severity is a default, not a verdict: `rules["<id>"]` in the project's config overrides it, and `"off"` disables the rule outright. Per-entity waivers go in `exemptions` — see the [config reference](./config-reference.md).

## Severities

| Severity | Meaning |
| --- | --- |
| `error` | A definite contradiction: both sides were read successfully and they disagree. The only severity that fails a gated command's exit code (`lint`, `verify`, `audit --check`). |
| `warn` | Real drift the engine is confident about, which is not on its own a defect — an undeclared prop, a hardcoded value, a custom property outside the token system. Reported, never gating. |
| `review` | The engine could not reach a verdict, or the answer is a human's to give. Reported so an unanswered question is never mistaken for a clean result. Never gating. |

## Rules by surface

- [`tokens`](#tokens)
- [`components`](#components)
- [`styles`](#styles)
- [`anatomy`](#anatomy)
- [`lint`](#lint)
- [`coverage`](#coverage)

### `tokens`

The token layer itself — which tokens a contract declares, which custom properties the code declares, and which of them the code actually references. Answers whether the token system and the stylesheets know about the same set of values.

| Rule | Default severity | What it reports |
| --- | --- | --- |
| `tokens/code-token-undesigned` | review | A code token no design variable maps to, under a top-level group the design side covers (at least one design variable maps to a token in it). The code-only half of token parity; `design.options.codeOnlyGroups` scopes out groups that are code-only by design. |
| `tokens/design-mode-missing` | warn | A design variable and the code token it maps to share a mode vocabulary, but one side declares a mode the other has no counterpart for — a theme that exists in code with nothing in design, or the reverse. |
| `tokens/design-token-ambiguous` | review | A design variable's name matches more than one code token, so no identity was asserted and its value was not compared per-token — a coverage note; `design.options.tokenMap` resolves it for the project. |
| `tokens/design-token-map-unknown` | warn | A `design.options.tokenMap` entry names a code token id the code census does not have — a typo, or a token since renamed. The pairing is not made on that id: a single-id entry counts as design-only, and a per-mode entry compares only its known ids. A mode-scoped id is named with the collapsed id `tokenMap` takes, and a single-id entry lists the code tokens holding the variable's value in `data.sameValue`. |
| `tokens/design-token-mismatch` | error | A design variable maps to exactly one code token by name (ADR-003 Amendment 4's candidate rule, or an explicit `design.options.tokenMap` entry), and their resolved values differ — per mode, naming the mode, when both sides are mode-scoped and share a mode name; otherwise on the one folded value. This specific token is wrong on one side. |
| `tokens/design-token-unmatched` | review | A design variable matches no code token by name, but its value appears in code under another token — `data.sameValue` lists those tokens. The design-only half of token parity; `design.options.tokenMap` pairs it when one of them is the counterpart. |
| `tokens/design-value-untracked` | review | A design variable's resolved value does not match any code token's resolved value, anywhere in the project — a coverage signal, not a per-token identity match (matching is by value, never by name). |
| `tokens/emitted-value-mismatch` | warn | A token's var is declared in a stylesheet under `paths.styleRoots` with a value that matches none of the token's values, in any mode — the build's output disagrees with tokens.json. Colors, `rem` and `var()` references are compared after canonicalization; a font stack may append fallbacks. Raised only when `paths.styleRoots` is configured and every root exists; silent when either side keeps an unresolvable `var()`. |
| `tokens/token-unemitted` | review | No component references this token, no other token aliases it, and its var is declared nowhere in the scanned code — the build never emitted it. Raised only when `paths.styleRoots` is configured and every root exists; scoped by `tokens/token-unreferenced`'s `ignorePrefixes` and `ignoreSources`. |
| `tokens/token-unreferenced` | review | No component references this token and no other token aliases it. When `paths.styleRoots` is configured and the token's var is declared nowhere in the scanned code, `tokens/token-unemitted` reports it instead. |
| `tokens/token-untracked` | warn | A CSS custom property is declared in code with no token in the contract mapping to it — a hand-written value that escaped the token system. |
| `tokens/var-unresolved` | error | A component uses var(--x) for a custom property with no declaration anywhere in the scanned code and no token in the contract accounting for it — almost always a typo, and a real bug. |

### `components`

A component's public API: each prop's presence, type, enum values, default value, and required/optional status, compared between the contract and the code.

| Rule | Default severity | What it reports |
| --- | --- | --- |
| `components/binding-file-compare-unreliable` | review | The committed design-to-code binding file differs from what the contract renders as text, but the provider could not compare the two, so the difference is NOT reported as drift (issue #588). The comparison parses both sides (issue #609), and the parser is an optional peer dependency: without it installed there is nothing to compare with. `data.ceiling` names why, in the provider's words, and how to fix it; `data.expected` still carries what the contract says the file holds. A file identical to the render still reads as a match with no parser at all. |
| `components/binding-file-missing` | warn | The contract renders a design-to-code binding file and none is committed at the derived path (issue #400) — the mapping a design tool reads to show this component's real code does not exist yet. Applies only to a contract that declares a design source: with no design node there is nothing to bind to, so no binding file is expected (issue #448). Applicable only when the project configures a binding-file convention; requires an active design provider. The finding carries the rendered content the contract says the file holds, in `data.expected` (issue #579), so a consumer can write it without the engine ever writing anything; where nothing was rendered the field is `null` rather than absent. |
| `components/binding-file-stale` | warn | The committed design-to-code binding file differs from what the contract renders (issue #400) — the contract moved and the binding did not, so a design tool shows this component's code wrongly. Applies only to a contract that declares a design source, the same gate as `binding-file-missing` (issue #448). The comparison is structural, not textual: both sides are parsed (issue #609), so formatting, comments, semicolons, trailing commas and key quoting never count (issue #452), imports an example body needs beyond the component's own are not drift (issue #459), what an author put in a toggle's true/false branch is example content and not drift (issue #477), and a hand-authored example body is neutralized before comparing and is never itself drift. The finding carries the rendered content the contract says the file holds, in `data.expected` (issue #579), so a consumer can diff against what was actually compared; where nothing was rendered the field is `null` rather than absent. |
| `components/enum-values-mismatch` | error | A shared enum prop's values disagree between the contract and the compared side (code or design) — exact and case-sensitive (ADR-001 D1). One boundary exception: when every contract value is a number, a design value that is its exact string form ("2" for 2) matches, because a design tool's variant options can only ever be strings. |
| `components/intent-stale` | review | The component's props have changed since `intent.verifiedAgainst` was recorded — the intent text may no longer describe what the component does; re-read it and update the hash. |
| `components/intent-unverified` | review | The contract carries `intent` text but no `intent.verifiedAgainst`, so nothing says which version of the code the text describes — the finding names the current code hash to record. |
| `components/prop-default-mismatch` | warn | A shared prop's default value disagrees between contract and code. |
| `components/prop-missing` | error | A contract declares a prop the compared side (code, or design once ADR-003 Phase 5.2's parity runs) does not have. |
| `components/prop-optionality-mismatch` | error | A shared prop's required/optional status disagrees between contract and code. |
| `components/prop-type-mismatch` | error | A shared prop's type disagrees between the contract and the compared side (code or design). For a prop whose `design` marker declares a `mechanism`, the design side is compared against the type that mechanism implies instead, so the finding means the declared translation stopped being true. |
| `components/prop-type-unresolved` | review | A prop's type could not be resolved in code, so the contract's declared type was neither confirmed nor contradicted. Code-only: the design provider's own type vocabulary always resolves or is skipped, never "unknown". |
| `components/prop-unexpected` | warn | The compared side (code or design) has a prop the contract does not declare, or one the contract explicitly forbids via a `"none"` deviation marker. |
| `components/unused-component` | review | A contracted component's code file is never imported by any other file under `paths.componentsDir`. |
| `components/variant-combinations-mismatch` | review | A contract declaring `invalidVariantCombinations` disagrees with the design component set about which variant COMBINATIONS exist — the design publishes one the contract forbids, or lacks one the contract implies (the product of its enum props' values, minus the forbidden ones). Requires a bindings gather (`gather --bindings` + `ingest --bindings`); a design entry without `variantCombinations` is skipped silently, never reported. |

### `styles`

Where a component's styles get their values — whether each element/property pair binds the token the contract declares, binds a different one, or hardcodes a literal instead.

| Rule | Default severity | What it reports |
| --- | --- | --- |
| `styles/binding-missing` | error | The contract declares a token binding for this element/property that the stylesheet does not have. |
| `styles/binding-unexpected` | warn | The stylesheet binds a token for a property the contract does not declare at all for this element. |
| `styles/design-binding-missing` | review | The contract declares a token binding, and no variable the design component binds anywhere in its tree maps to that token — component-level coverage (issue #401): it says the design side never binds the token, not which element should. Element-level precision follows the design-side anatomy mapping (issue #402). Requires a bindings gather (`gather --bindings` + `ingest --bindings`); a snapshot without `usedVars` is skipped silently, never reported. Three declared bindings are never reported, each stated on the run's `skipped` channel with its reason (issue #492): one whose style property the active provider declares it cannot express as a node-level variable (see that provider's own `unbindableProperties`), one whose token resolves to zero (an unset value binds no variable), and one a `design.options.tokenMap` redirect sends to a different token than the contract names (out of reach by construction, whatever the design file does). |
| `styles/element-unmapped` | review | This anatomy element could not be confidently mapped to a stylesheet selector — a coverage note, never a style finding for its bindings. |
| `styles/raw-value` | warn | The contract declares a token binding for this element/property, but the stylesheet hardcodes a literal value instead. |
| `styles/token-mismatch` | error | Both sides bind a token for this element/property, but to different tokens. |
| `styles/variant-unmapped` | review | A declared style variant could not be confidently mapped to a stylesheet selector, so none of its bindings were checked — a coverage note, never a style finding. |

### `anatomy`

The structure a component renders — which nodes exist, at which positions, as which elements, with which content bound — compared against the anatomy the contract declares.

| Rule | Default severity | What it reports |
| --- | --- | --- |
| `anatomy/attribute-mismatch` | error | The contract declares a DOM attribute value for this node, and the code sets that attribute to a different literal. |
| `anatomy/attribute-missing` | error | The contract declares a DOM attribute for this node that the code does not set — and the adapter resolved the full attribute set, so nothing could be supplying it. |
| `anatomy/attribute-unresolved` | review | The contract declares a DOM attribute for this node, but its value in code is computed, or a spread makes the attribute set unknowable — neither confirmed nor contradicted. |
| `anatomy/content-unbound` | error | The contract binds this node's content to a literal or a prop the code does not render there. |
| `anatomy/coverage-declined` | review | This component's rendered markup could not be resolved to a single, unambiguous structure — no anatomy finding was attempted for it. |
| `anatomy/coverage-partial` | review | This component renders more than one tree; only the structure invariant across every branch was compared, and the positions where the branches disagreed were not checked. |
| `anatomy/element-mismatch` | error | The contract declares what this node is and the compared side has something else: code side, the DOM element the contract declares against the one the code renders; design side, the node type the contract declares against the design layer's own type, for every node below `root` (whose node is the component itself, never a layer). |
| `anatomy/node-missing` | error | The contract declares an anatomy node the compared side does not have: code side, nothing is rendered at the position the contract declares; design side, the design component carries no layer of that name under the parent's own layer — for a variant set, inside the variant it is compared through, the first by name. |
| `anatomy/node-unexpected` | warn | The compared side has a child the contract does not declare at all for this node: a structural (element or component) child code side, a layer design side. |
| `anatomy/variant-missing` | error | The contract declares an anatomy shape — the base tree, or one of its `$variants` — whose root element this component renders on no branch. |
| `anatomy/variant-unexpected` | error | The component renders a branch whose root element no declared anatomy shape claims: the contract does not describe that shape at all. |

### `lint`

Static best-practice checks that need no contract at all: token naming vocabularies, tier layering, ramp monotonicity, and a delegated token-lint rule set. Silent until a project configures it — the engine ships no starter opinions.

| Rule | Default severity | What it reports |
| --- | --- | --- |
| `lint/contract-enum-invalid` | warn | An enum prop's values are not all in the closed set `lint.contracts.enumVocabularies` declares for that prop name — the contract-side twin of `lint/vocabulary-invalid`, so `size: sm\|md\|lg` in one contract and `small\|medium\|large` in another is a finding, not a silent fork. |
| `lint/contract-name-case` | warn | A contract's prop or anatomy element name does not follow the case `lint.contracts.nameCase` configures — the contract schema only bounds the character set; which case a project uses is its own convention. |
| `lint/design-name-invalid` | warn | A design-side variable or component name does not match the pattern `lint.designNames` configures for its kind — the naming-convention half of what `tokens/design-token-ambiguous` can only report after the fact. |
| `lint/ramp-not-monotonic` | warn | A configured color ramp's perceptual lightness does not move monotonically as its numeric step increases — a step reverses the trend the rest of the ramp establishes. |
| `lint/tier-alias-inverted` | warn | A token aliases one in a HIGHER tier — the layering runs backwards, so a primitive's value now depends on a token built on top of it. |
| `lint/tier-alias-missing` | warn | A token in a tier above the first one `lint.tiers` lists holds a literal value rather than aliasing a lower tier — the inverse of `lint/tier-alias-inverted`. Opt-in: runs only when `rules` names it. |
| `lint/token-rule` | warn | A delegated token lint rule (@terrazzo/parser's `core/*` set) reported a violation. The specific rule id is in `data.rule`. |
| `lint/unknown-dollar-field` | warn | A token or group carries a `$`-prefixed key the DTCG format does not reserve there (`$tyep`, `$vaule`) — almost always a typo, which the parser otherwise drops silently. Opt-in: runs only when `rules` names it. |
| `lint/vocabulary-invalid` | warn | A token's leaf name is not in the closed set `lint.vocabularies` declares for its path — a canonical ordered scale (t-shirt sizes) and a closed state set (hover/active) are the same mechanism under different vocabularies. |

### `coverage`

What the run could NOT compare, and what it was told to skip: a component with no contract, a contract with no component, an exemption that no longer matches anything. A worklist rather than drift.

| Rule | Default severity | What it reports |
| --- | --- | --- |
| `coverage/contract-only` | warn | A contract declares a code source path where no component was found. |
| `coverage/design-missing` | warn | A contract declares `sources.design`, but it does not resolve against the design census (ADR-003 Phase 5.1) — the design-side twin of `coverage/contract-only`. |
| `coverage/design-only` | warn | A design-tool component has no contract addressing it at all (ADR-003 Phase 5.1) — the design-side twin of `coverage/uncontracted-component`. A component the provider marks private — one the design tool keeps out of its published library — is excluded (issue #460), counted once in the run's diagnostics, and counted here only when `design.options.includePrivateComponents` is true. |
| `coverage/stale-exemption` | review | An entity is exempted from a rule, but that rule reported nothing matching it — the exemption is stale, or the entity no longer exists. Exemptions are claims to re-verify, not permanent silence (ADR-001 D5). |
| `coverage/uncontracted-component` | warn | A code component has no contract referencing it at all — doubles as the authoring worklist (ADR-001 D1). |
| `coverage/unfinished-contract` | warn | A contract still carries one or more `_scaffold` markers left by scaffold authoring — a draft, not a finished contract. |
