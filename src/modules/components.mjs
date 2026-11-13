/**
 * components.mjs — the props/API parity check (ADR-001 D1/D5/D13, Phase 1,
 * issue #98): the FIRST checker in the engine that emits real findings.
 *
 * PURE: `runComponentsCheck(contracts, codeCensus, config) => findings[]`.
 * Never touches fs or network — `spec/contracts.mjs` loads the contracts and
 * the framework adapter builds the code census; this module only ever
 * compares the two already-loaded values in memory. That is what the
 * layering guard (`__tests__/layering.test.js`) means by "modules never
 * import sources": a checker that can reach the filesystem itself cannot be
 * driven by injected fixture data, which is how every domain module here is
 * hardened one module at a time (ADR-001's working method).
 *
 * D1's model: the contract is the ONE fixed point. This module compares
 * spec↔code AND (ADR-003 Phase 5.2, once a `designCensus` is given) spec↔design
 * — it never guesses a "direction" for a disagreement, the reconcile
 * machinery D1 explicitly deletes, and `side` is a FIELD on the finding
 * (D5), never a distinct rule id: a contract prop absent from either side is
 * `components/prop-missing`, present unexpectedly on either side is
 * `components/prop-unexpected`, full stop, no waiver vocabulary.
 *
 * DEVIATION MARKERS (what keeps findings honest, per the contract schema's
 * own `codeDeviation`/`designDeviation` docs) — the two sides are NOT quite
 * symmetric, because `designDeviation` is a strict superset of `codeDeviation`:
 *   - a prop's `code: "none"` / `design: "none"` asserts it must NOT appear
 *     on that side — presence is a finding (reported via `components/prop-
 *     unexpected`, the same rule id an undeclared prop uses, since both mean
 *     "this side has something the contract does not sanction"), absence is
 *     correct and silent.
 *   - a prop's `code: "unverified"` / `design: "unverified"` suppresses
 *     EVERY finding for that prop on that side ONLY — no presence check, no
 *     type/enum comparison. (Code-side, this module additionally treats
 *     `code: "unverified"` as invisible on the code side; the design side of
 *     the SAME prop, if any, is unaffected and vice versa — the two markers
 *     are independent, per-side facts, not a single "ignore everywhere"
 *     switch.)
 *   - a prop's `design: {name, reason}` records a genuine RENAME: the
 *     design-side comparison looks the prop up under `name` instead of the
 *     contract's own key. `codeDeviation` has no equivalent shape — a code
 *     prop is always looked up under the contract's own key.
 *   - `components/prop-default-mismatch`/`prop-optionality-mismatch` are
 *     CODE-ONLY: the active provider's `componentProps` never carries
 *     `default`/`required` for a design prop (see that function's own
 *     docblock for why), so those two rules structurally never fire with
 *     `side: "design"` — not a special case here, a consequence of the input
 *     shape. Likewise `components/prop-type-unresolved` — a design provider's
 *     own type vocabulary always resolves to a known contract type or is
 *     skipped, never "unknown".
 *
 * ENUM PARITY is EXACT and case-sensitive (ADR-001 D1's carried-forward
 * lesson: `Size`/`SM` vs `size`/`sm` is drift, never a near-match) — compared
 * by `${typeof value}:${value}` keys so a string `"5"` and a number `5` are
 * never treated as equal, and added/removed values are reported separately.
 * The ONE exception is at the design boundary (D1 amendment, #297): a numeric
 * contract enum accepts its exact string forms from design, because a design
 * tool's variant options are strings by construction — see
 * `coerceNumericDesignValues`.
 *
 * COVERAGE (D1): entities that exist on one side with nothing to compare
 * against on the other produce inventory-fact findings, not per-prop deltas —
 * `coverage/uncontracted-component` (a code component with no contract at
 * all) and `coverage/contract-only` (a contract naming a code path where no
 * component was found). A DELIBERATE naming decision, worth recording: the
 * ADR's illustrative list is `coverage/uncontracted-component` /
 * `coverage/design-only` / `coverage/code-only`, but through Phase 1
 * `design-only` had no meaning yet (no design side, D13) and a THIRD id
 * meaning exactly the same thing as `uncontracted-component` would just be
 * the same finding under two names — worse for a config author turning one
 * off and being surprised the other still fires. So this module registered
 * exactly the two ids whose conditions actually differed.
 *
 * DESIGN-SIDE COVERAGE (ADR-003 Phase 5.1, `designCensus`): the symmetric
 * pair now that a design side exists — `coverage/design-only` (a real
 * design-tool component with no contract addressing it) and `coverage/
 * design-missing` (a contract's `sources.design` doesn't resolve against the
 * census — NOT `coverage/spec-only`, which would collide in meaning with the
 * already-shipped `coverage/contract-only`). Both are OMITTED entirely
 * unless a caller passes `designCensus` — a project with no design side
 * configured never sees them, the same "surface skips, it doesn't fail the
 * run" convention `modules/tokens.mjs` documents for a missing snapshot.
 *
 * This module still never learns a design tool's addressing vocabulary
 * (D12): `contract.sources.design`'s presence/absence is a checkable fact
 * (the schema's own words) this module may read directly, same as
 * `sources.code.path`, but its SHAPE is not — matching happens entirely
 * through `designMatchKey`, an opaque string the CALLER (`cli/commands/
 * audit.mjs`, which may import both `spec/` and `providers/`) resolves via
 * the active provider's `designAddress`/`componentAddress` and attaches to
 * each contract entry and each `designCensus.entries[]` item before this
 * function ever sees them — matching (and therefore identity, for
 * exemption stability across a rename) is by address, never by name
 * (ADR-003). `entity` follows each rule's own existing sibling: `coverage/
 * design-missing` reports the CONTRACT id, matching `coverage/contract-
 * only`; `coverage/design-only` reports the match key itself, matching
 * `coverage/uncontracted-component`'s file-path entity — there is no
 * design-tool display name to report instead on either side.
 *
 * DESIGN-SIDE PROP PARITY (ADR-003 Phase 5.2, `checkDesignProps`): once a
 * contract's design address RESOLVES (a `designCensus` entry matches), its
 * props are compared exactly the same way the code-side loop below compares
 * — same rule ids, same enum-as-a-set semantics — driven by
 * `designCensus.entries[].props`, which the CALLER reduces (via the active
 * provider's `componentProps`) into the SAME `{name, type, values?}` shape a
 * code component's `props` already carries. This module never learns HOW
 * that reduction happened — any one provider's own raw property vocabulary
 * (D12) — it only ever compares two already-normalized prop lists, same as
 * the code side.
 *
 * USAGE (issue #223): `components/unused-component` flags a contracted
 * component whose file `sources/code.mjs`'s `censusComponentUsage` never saw
 * imported by another file — the component-side equivalent of `tokens/token-
 * unreferenced`. It reads the injected `usageCensus` param, never the
 * filesystem itself (still pure), and shares that rule's `review` severity
 * for the same reason: the usage census only scans `paths.componentsDir`, so
 * it can prove "unused within the tree", never "unused, full stop".
 *
 * A contract with NO `sources.code.path` at all (an aspirational/draft
 * component nobody has built yet) is skipped entirely by this check — silent,
 * not a `contract-only` finding — since declaring no code source is not the
 * same claim as declaring one that turned out to be wrong.
 *
 * SCAFFOLD DRAFTS (issue #262): `coverage/unfinished-contract` flags a
 * contract that still carries any `_scaffold` key — the marker
 * `spec/scaffold.mjs`/`cli/commands/scaffold.mjs` write for a slot they could
 * not draft with confidence and left for a human. The contract schema
 * permits `^_`-prefixed keys at every level precisely so a half-drafted
 * contract still validates, which means nothing else in the engine ever
 * notices a marker was left behind — this is the one check that reads them.
 * Evaluated for EVERY loaded contract, independent of `sources.code.path`
 * (a draft with no code source yet can still carry markers elsewhere, e.g. in
 * `anatomy`) and of the code census, so unlike `contract-only` it is a pure
 * spec-side fact.
 *
 * The marker paths arrive on the loader's entry (`scaffoldMarkers`), NOT from
 * walking `contract`: `loadContract` strips every `^_` key before returning,
 * so a walk of the loaded contract is guaranteed to come up empty — which is
 * exactly what made this rule unreachable through the CLI until #350.
 */

import {
  compareEntities,
  makeFinding,
  sortFindings,
} from "../core/findings.mjs"
import { createRegistry, resolveRuleConfig } from "../core/rules.mjs"
import { resolveConfig } from "../core/config.mjs"
import { DESIGN_MECHANISM_TYPES } from "../core/mechanisms.mjs"
import { contractApiView } from "../spec/contracts.mjs"
import { hashJson } from "../core/state.mjs"

// ---------------------------------------------------------------------------
// The rule registry for this module (ADR-001 D5's "one registry" — each
// domain module builds its own from the shared `core/rules.mjs` primitives;
// the CLI/report layer merges module registries where it needs a combined
// view, not this module).
// ---------------------------------------------------------------------------

export const RULES = [
  {
    id: "components/prop-missing",
    surface: "components",
    defaultSeverity: "error",
    description:
      "A contract declares a prop the compared side (code, or design once ADR-003 Phase 5.2's parity runs) does not have.",
  },
  {
    id: "components/prop-unexpected",
    surface: "components",
    defaultSeverity: "warn",
    description:
      'The compared side (code or design) has a prop the contract does not declare, or one the contract explicitly forbids via a `"none"` deviation marker.',
  },
  {
    id: "components/prop-type-mismatch",
    surface: "components",
    defaultSeverity: "error",
    description:
      "A shared prop's type disagrees between the contract and the compared side (code or design). For a prop whose `design` marker declares a `mechanism`, the design side is compared against the type that mechanism implies instead, so the finding means the declared translation stopped being true.",
  },
  {
    id: "components/prop-type-unresolved",
    surface: "components",
    defaultSeverity: "review",
    description:
      "A prop's type could not be resolved in code, so the contract's declared type was neither confirmed nor contradicted. Code-only: the design provider's own type vocabulary always resolves or is skipped, never \"unknown\".",
  },
  {
    id: "components/enum-values-mismatch",
    surface: "components",
    defaultSeverity: "error",
    description:
      "A shared enum prop's values disagree between the contract and the compared side (code or design) — exact and case-sensitive (ADR-001 D1). One boundary exception: when every contract value is a number, a design value that is its exact string form (\"2\" for 2) matches, because a design tool's variant options can only ever be strings.",
  },
  {
    id: "components/variant-combinations-mismatch",
    surface: "components",
    // `review` until adjudicated against a real project (issue #403): no
    // contract has ever exercised `invalidVariantCombinations`, so nothing
    // yet measures how often a design set legitimately omits a combination
    // the contract implies.
    defaultSeverity: "review",
    description:
      "A contract declaring `invalidVariantCombinations` disagrees with the design component set about which variant COMBINATIONS exist — the design publishes one the contract forbids, or lacks one the contract implies (the product of its enum props' values, minus the forbidden ones). Requires a bindings gather (`gather --bindings` + `ingest --bindings`); a design entry without `variantCombinations` is skipped silently, never reported.",
  },
  {
    id: "components/binding-file-missing",
    surface: "components",
    defaultSeverity: "warn",
    description:
      "The contract renders a design-to-code binding file and none is committed at the derived path — the mapping a design tool reads to show this component's real code does not exist yet. Applies only to a contract that declares a design source: with no design node there is nothing to bind to, so no binding file is expected. Applicable only when the project configures a binding-file convention; requires an active design provider. The finding carries the rendered content the contract says the file holds, in `data.expected`, so a consumer can write it without the engine ever writing anything; where nothing was rendered the field is `null` rather than absent.",
  },
  {
    id: "components/binding-file-stale",
    surface: "components",
    defaultSeverity: "warn",
    description:
      "The committed design-to-code binding file differs from what the contract renders — the contract moved and the binding did not, so a design tool shows this component's code wrongly. Applies only to a contract that declares a design source, the same gate as `binding-file-missing`. The comparison is structural, not textual: both sides are parsed, so formatting, comments, semicolons, trailing commas and key quoting never count, imports an example body needs beyond the component's own are not drift, what an author put in a toggle's true/false branch is example content and not drift, and a hand-authored example body is neutralized before comparing and is never itself drift. The finding carries the rendered content the contract says the file holds, in `data.expected`, so a consumer can diff against what was actually compared; where nothing was rendered the field is `null` rather than absent.",
  },
  {
    id: "components/binding-file-compare-unreliable",
    surface: "components",
    // `review` is the engine's own word for "could not reach a verdict, never
    // gating" (`core/findings.mjs`). `warn` would claim a confidence the
    // comparison explicitly does not have here.
    defaultSeverity: "review",
    description:
      "The committed design-to-code binding file differs from what the contract renders as text, but the provider could not compare the two, so the difference is NOT reported as drift. The comparison parses both sides, and the parser is an optional peer dependency: without it installed there is nothing to compare with. `data.ceiling` names why, in the provider's words, and how to fix it; `data.expected` still carries what the contract says the file holds. A file identical to the render still reads as a match with no parser at all.",
  },
  {
    id: "components/prop-default-mismatch",
    surface: "components",
    defaultSeverity: "warn",
    description:
      "A shared prop's default value disagrees between contract and code.",
  },
  {
    id: "components/prop-optionality-mismatch",
    surface: "components",
    defaultSeverity: "error",
    description:
      "A shared prop's required/optional status disagrees between contract and code.",
  },
  {
    id: "coverage/uncontracted-component",
    surface: "coverage",
    defaultSeverity: "warn",
    description:
      "A code component has no contract referencing it at all — doubles as the authoring worklist (ADR-001 D1).",
  },
  {
    id: "coverage/contract-only",
    surface: "coverage",
    defaultSeverity: "warn",
    description:
      "A contract declares a code source path where no component was found.",
  },
  {
    id: "coverage/unfinished-contract",
    surface: "coverage",
    defaultSeverity: "warn",
    description:
      "A contract still carries one or more `_scaffold` markers left by scaffold authoring — a draft, not a finished contract.",
  },
  {
    id: "coverage/design-only",
    surface: "coverage",
    defaultSeverity: "warn",
    description:
      "A design-tool component has no contract addressing it at all (ADR-003 Phase 5.1) — the design-side twin of `coverage/uncontracted-component`. A component the provider marks private — one the design tool keeps out of its published library — is excluded, counted once in the run's diagnostics, and counted here only when `design.options.includePrivateComponents` is true.",
  },
  {
    id: "coverage/design-missing",
    surface: "coverage",
    defaultSeverity: "warn",
    description:
      "A contract declares `sources.design`, but it does not resolve against the design census (ADR-003 Phase 5.1) — the design-side twin of `coverage/contract-only`.",
  },
  {
    id: "components/intent-unverified",
    surface: "components",
    defaultSeverity: "review",
    description:
      "The contract carries `intent` text but no `intent.verifiedAgainst`, so nothing says which version of the code the text describes — the finding names the current code hash to record.",
  },
  {
    id: "components/intent-stale",
    surface: "components",
    defaultSeverity: "review",
    description:
      "The component's props have changed since `intent.verifiedAgainst` was recorded — the intent text may no longer describe what the component does; re-read it and update the hash.",
  },
  {
    id: "components/unused-component",
    surface: "components",
    // Matches `tokens/token-unreferenced`'s advisory tier (issue #223) — the
    // usage census only scans `paths.componentsDir`, so this can only ever
    // say "no OTHER component in that tree imports this one"; an app that
    // consumes it from outside the scanned tree is invisible to the census.
    defaultSeverity: "review",
    description:
      "A contracted component's code file is never imported by any other file under `paths.componentsDir`.",
  },
]

export const registry = createRegistry(RULES)

// ---------------------------------------------------------------------------
// Small, pure comparison helpers.
// ---------------------------------------------------------------------------

// Distinguishes a string "5" from a number 5 — required for D1's "never
// case-insensitive, never a near-match" exactness rule to also cover type.
function valueKey(value) {
  return `${typeof value}:${String(value)}`
}

function sortValues(values) {
  return [...values].sort((a, b) => {
    const sa = String(a)
    const sb = String(b)
    return sa < sb ? -1 : sa > sb ? 1 : 0
  })
}

// Added = present in code, not sanctioned by the contract. Removed = the
// contract expects it, code no longer has it. Reported separately per the
// issue's explicit instruction, since they are different repairs.
function diffEnumValues(contractValues, codeValues) {
  const contractSet = new Set(contractValues.map(valueKey))
  const codeSet = new Set(codeValues.map(valueKey))
  return {
    added: sortValues(
      codeValues.filter(value => !contractSet.has(valueKey(value))),
    ),
    removed: sortValues(
      contractValues.filter(value => !codeSet.has(valueKey(value))),
    ),
  }
}

function formatValues(values) {
  return values.map(value => JSON.stringify(value)).join(", ")
}

// The ONE sanctioned exception to D1's type-exact comparison, and only at the
// design boundary (ADR-001 D1 amendment, #297): a design tool's variant
// property values are strings by construction — there is no way to author a
// numeric variant option — so a contract whose enum is numeric (`[2, 3]`,
// matching a `2 | 3` code type) can never see anything but `"2"`/`"3"` from
// design. Reporting that as drift is a false finding about the tool, not the
// design. Applies ONLY when every contract value is a number, and a design
// string is coerced ONLY when it round-trips exactly (`"2"` → 2; `"02"`,
// `"2.0"`, `" 2"` stay strings and still mismatch). The code side is
// untouched: code can express a numeric union, so there exactness holds.
function coerceNumericDesignValues(contractValues, designValues) {
  if (
    contractValues.length === 0 ||
    !contractValues.every(value => typeof value === "number")
  )
    return designValues
  return designValues.map(value => {
    if (typeof value !== "string") return value
    const asNumber = Number(value)
    return Number.isFinite(asNumber) && String(asNumber) === value
      ? asNumber
      : value
  })
}

// ---------------------------------------------------------------------------
// Design-side prop parity (ADR-003 Phase 5.2).
// ---------------------------------------------------------------------------

// `design: {name, mechanism}`'s closed vocabulary (issue #439) → the type the
// design side carries. Defined in `core/mechanisms.mjs` because codegen needs
// the same answer and `providers` may not import `modules` (issue #457).

// The design slot a `toggle` names as the region it hides (issue #485), or
// undefined — only a toggle gates anything, which the schema also enforces.
function toggleGates(deviation) {
  if (!deviation || typeof deviation !== "object") return undefined
  if (deviation.mechanism !== "toggle") return undefined
  return typeof deviation.gates === "string" ? deviation.gates : undefined
}

/**
 * The design-side mirror of the code-side prop loop below — same rule ids
 * (D5: side is a field, not a rule id), driven by each prop's `design`
 * deviation marker instead of `code`. `designProps` already arrives in the
 * SAME `{name, type, values?}` shape a code component's `props` carries (the
 * active provider's `componentProps` did that reduction, in `cli/commands/
 * audit.mjs`), so this is the SAME comparison, not a new one.
 *
 * `designDeviation` (`schema/contract.schema.json`) is a strict superset of
 * `codeDeviation`: `"none"`/`"unverified"` mean exactly what they mean
 * code-side, plus a third shape — `{name, reason}` — a genuine rename, where
 * the design-side lookup happens under the RENAMED identity rather than the
 * contract's own key. A prop with no `design` marker at all is looked up
 * under its own name, the same default a code prop with no `code` marker
 * gets.
 *
 * That third shape may also carry `mechanism` (issue #439): the prop exists
 * on both sides but is modelled a different way by construction — a slot the
 * design side hides with a boolean beside it, a slot it takes as a text
 * string, a URL it takes as a swappable instance. The type comparison then
 * runs against `DESIGN_MECHANISM_TYPES[mechanism]` instead of the contract's
 * own type. It is a REDIRECTION of the check, never a suppression of it: an
 * `exemption` would hide the prop from every report, and `"unverified"` would
 * stop the presence check too — the marker keeps both, so the day the design
 * side re-models the prop, the finding comes back.
 *
 * Never compares `default`/`required`: `componentProps` carries neither
 * field for a design prop (see its own docblock for why), so those two rules
 * simply never fire here — not a special case, a consequence of the input
 * shape.
 */
function checkDesignProps(id, apiView, designProps, emit) {
  const designPropsByName = new Map(designProps.map(prop => [prop.name, prop]))

  // Every design identity a contract prop ACCOUNTS FOR, independent of
  // whether the census actually has it — the design-side mirror of the
  // code-side sweep below, which checks `apiView`'s own keys directly rather
  // than a flag set only on a successful match. Built once, up front: a name
  // this set contains is never reported by the trailing "unexpected extra"
  // sweep, whether that's because it matched, because `design: "none"`
  // already reported it explicitly above, or because `design: "unverified"`
  // asserts nothing about it at all (any shape present there is exactly as
  // silent as one that's absent).
  const accountedFor = new Set()
  for (const name of Object.keys(apiView)) {
    const deviation = apiView[name].design
    const isRename =
      deviation !== null &&
      deviation !== undefined &&
      typeof deviation === "object"
    accountedFor.add(isRename ? deviation.name : name)
    // The slot a toggle gates (issue #485) is the same prop's other half on
    // the design side, not an undeclared extra.
    const gates = toggleGates(deviation)
    if (gates !== undefined) accountedFor.add(gates)
  }

  for (const name of Object.keys(apiView).sort(compareEntities)) {
    const propSpec = apiView[name]
    const deviation = propSpec.design

    if (deviation === "unverified") continue

    const isRename =
      deviation !== null &&
      deviation !== undefined &&
      typeof deviation === "object"
    const designName = isRename ? deviation.name : name
    const designProp = designPropsByName.get(designName)

    if (deviation === "none") {
      if (designProp) {
        emit("components/prop-unexpected", {
          side: "design",
          entity: id,
          message: `the design component for "${id}" has prop "${designName}", but the contract marks it design: "none" — it must not appear in design`,
          data: {
            prop: designName,
            reason: 'contract declares design: "none"',
          },
        })
      }
      continue
    }

    if (!designProp) {
      emit("components/prop-missing", {
        side: "design",
        entity: id,
        message: `contract "${id}" declares prop "${name}" (${propSpec.type}), which the design component does not have${
          isRename ? ` (looked for "${designName}")` : ""
        }`,
        data: { prop: name, type: propSpec.type },
      })
      continue
    }

    // A declared MECHANISM replaces the type comparison with the one the
    // translation implies (issue #439) — the contract's own type never
    // matches by construction, so comparing it would report a difference the
    // author already declared. What IS still checked: the prop exists under
    // its design name (above), and the design side really does model it the
    // declared way, so a marker that stops being true fires instead of
    // silently absolving the prop forever.
    const mechanism = isRename ? deviation.mechanism : undefined
    if (mechanism !== undefined) {
      const impliedType = DESIGN_MECHANISM_TYPES[mechanism]
      if (designProp.type !== impliedType) {
        emit("components/prop-type-mismatch", {
          side: "design",
          entity: id,
          message: `prop "${name}" declares design mechanism "${mechanism}", which the design side models as "${impliedType}", but "${designName}" is typed "${designProp.type}" in the design component`,
          data: {
            prop: name,
            contractType: propSpec.type,
            designType: designProp.type,
            mechanism,
            expectedDesignType: impliedType,
          },
        })
      }
      // The slot a toggle gates is checked the same way (issue #485): it has
      // to exist, and to be a slot, or the binding's true branch renders a
      // property the design component does not carry.
      const gates = toggleGates(deviation)
      const gated =
        gates === undefined ? undefined : designPropsByName.get(gates)
      if (gates !== undefined && !gated) {
        emit("components/prop-missing", {
          side: "design",
          entity: id,
          message: `prop "${name}" declares that design toggle "${designName}" gates slot "${gates}", which the design component does not have`,
          data: { prop: name, type: propSpec.type, gates },
        })
      } else if (gated && gated.type !== "slot") {
        emit("components/prop-type-mismatch", {
          side: "design",
          entity: id,
          message: `prop "${name}" declares that design toggle "${designName}" gates slot "${gates}", but "${gates}" is typed "${gated.type}" in the design component`,
          data: {
            prop: name,
            contractType: propSpec.type,
            designType: gated.type,
            mechanism,
            gates,
            expectedDesignType: "slot",
          },
        })
      }
      continue
    }

    if (propSpec.type !== designProp.type) {
      emit("components/prop-type-mismatch", {
        side: "design",
        entity: id,
        message: `prop "${name}" is typed "${propSpec.type}" in the contract but "${designProp.type}" in the design component`,
        data: {
          prop: name,
          contractType: propSpec.type,
          designType: designProp.type,
        },
      })
    } else if (propSpec.type === "enum") {
      const { added, removed } = diffEnumValues(
        propSpec.values || [],
        coerceNumericDesignValues(
          propSpec.values || [],
          designProp.values || [],
        ),
      )
      if (added.length > 0 || removed.length > 0) {
        const parts = []
        if (added.length) parts.push(`design adds ${formatValues(added)}`)
        if (removed.length)
          parts.push(
            `contract has ${formatValues(removed)} that design does not`,
          )
        emit("components/enum-values-mismatch", {
          side: "design",
          entity: id,
          message: `prop "${name}"'s enum values disagree with the contract — ${parts.join("; ")}`,
          data: { prop: name, added, removed },
        })
      }
    }
  }

  for (const prop of designProps) {
    if (accountedFor.has(prop.name)) continue
    emit("components/prop-unexpected", {
      side: "design",
      entity: id,
      message: `the design component for "${id}" has prop "${prop.name}", which the contract does not declare`,
      data: { prop: prop.name },
    })
  }
}

// ---------------------------------------------------------------------------
// Variant COMBINATIONS (issue #403) — the combination-level twin of
// `components/enum-values-mismatch`. That rule compares which VALUES a prop
// offers; this one compares which combinations of them exist, which is the
// only thing `invalidVariantCombinations` has ever been able to mean (#111:
// a component's code-side props are a type, never an enumeration of the
// combinations actually rendered — so this has always been a design-side
// check, and ADR-003 deferred it until a contract used the field).
//
// THE MATCHING SEMANTICS, pinned here and in `docs/contract-authoring-guide.md`
// (the two must agree — the guide is the authoring surface, this is the
// enforcement):
//   - An `invalidVariantCombinations` entry is a PARTIAL configuration: an AND
//     over only the props it names, every other prop irrelevant. So
//     `{size: "lg"}` forbids every combination with `size=lg` in it.
//   - Values match EXACTLY and case-sensitively (D1), type included — with the
//     same single design-boundary exception `enum-values-mismatch` makes
//     (#297): a numeric contract enum accepts a design value that is its exact
//     string form, because a design tool's variant options are strings by
//     construction.
//   - Only the contract's ENUM props participate, under their design-side
//     identity (a `design: {name}` rename is looked up under `name`). A prop
//     the contract excludes from the design side (`design: "none"`/
//     `"unverified"`) is not compared, so an entry naming it can never match
//     — its constraint is unverifiable there, and asserting it anyway would
//     invent a finding out of a prop the contract said not to look at.
//   - The IMPLIED set is the cartesian product of those props' contract
//     values, minus every combination an entry forbids.
// ---------------------------------------------------------------------------

// A combination as a comparison key: JSON with keys in a fixed order, so
// `{"size":"2"}` and `{"size":2}` stay distinct exactly as `valueKey` keeps
// them distinct for a single enum value.
function combinationKey(combination) {
  return JSON.stringify(combination)
}

// The props a combination is compared over, in `compareEntities` order: the
// contract's enum props that are actually compared design-side, each carrying
// the design-side name to read them under.
function comparedEnumProps(apiView) {
  const props = []
  for (const name of Object.keys(apiView).sort(compareEntities)) {
    const propSpec = apiView[name]
    if (propSpec.type !== "enum" || !Array.isArray(propSpec.values)) continue
    if (propSpec.values.length === 0) continue
    const deviation = propSpec.design
    if (deviation === "none" || deviation === "unverified") continue
    const isRename =
      deviation !== null &&
      deviation !== undefined &&
      typeof deviation === "object"
    props.push({
      name,
      designName: isRename ? deviation.name : name,
      values: propSpec.values,
    })
  }
  return props
}

// Every combination the contract's own enum values imply, in a deterministic
// order (first prop varies slowest).
function impliedCombinations(props) {
  let combinations = [{}]
  for (const prop of props) {
    combinations = combinations.flatMap(base =>
      prop.values.map(value => ({ ...base, [prop.name]: value })),
    )
  }
  return combinations
}

function formatCombinations(combinations) {
  const shown = combinations.slice(0, 5).map(combinationKey).join(", ")
  const rest = combinations.length - 5
  return rest > 0 ? `${shown}, +${rest} more` : shown
}

/**
 * Compare a matched design component set's published variant combinations
 * against the ones its contract implies and forbids. Emits at most one
 * finding per contract — one disagreement about a set's combination space,
 * reported the way `enum-values-mismatch` reports one prop's, with both
 * directions in `data` rather than split across two rule ids.
 *
 * SILENT, deliberately, in three cases — each of them "there is nothing to
 * compare", never "the two sides agree":
 *   - the contract declares no `invalidVariantCombinations` (ADR-003: the
 *     field becomes checkable when a contract uses it, and running the
 *     implied-set half against every contract with enum props would invent a
 *     finding class no project has been measured against),
 *   - the design entry carries no `variantCombinations` (the bindings gather
 *     has not run for it, or it is not a component set),
 *   - a design combination does not name every compared prop, so the two
 *     sides disagree about the prop set itself — which `components/prop-
 *     missing`/`prop-unexpected` already report, per prop.
 */
function checkVariantCombinations(id, contract, apiView, designEntry, emit) {
  const forbidden = (
    Array.isArray(contract?.invalidVariantCombinations)
      ? contract.invalidVariantCombinations
      : []
  ).filter(entry => entry && typeof entry === "object" && !Array.isArray(entry))
  const published = designEntry.variantCombinations
  if (forbidden.length === 0 || !Array.isArray(published)) return
  if (published.length === 0) return

  const props = comparedEnumProps(apiView)
  if (props.length === 0) return

  // Design → contract vocabulary: read each compared prop under its
  // design-side name, coerce at the numeric boundary, and drop every design
  // property the contract does not compare (a design-only variant prop is
  // already `components/prop-unexpected`, not this rule's to re-report).
  const seen = new Map()
  for (const combination of published) {
    if (!combination || typeof combination !== "object") return
    const projected = {}
    for (const prop of props) {
      const raw = combination[prop.designName]
      if (raw === undefined) return
      projected[prop.name] = coerceNumericDesignValues(prop.values, [raw])[0]
    }
    seen.set(combinationKey(projected), projected)
  }

  const isForbidden = combination =>
    forbidden.some(entry => {
      const named = Object.keys(entry)
      if (named.length === 0) return false
      return named.every(
        name =>
          Object.prototype.hasOwnProperty.call(combination, name) &&
          valueKey(combination[name]) === valueKey(entry[name]),
      )
    })

  const invalid = [...seen.keys()].sort(compareEntities).flatMap(key => {
    const combination = seen.get(key)
    return isForbidden(combination) ? [combination] : []
  })
  const missing = impliedCombinations(props).filter(
    combination =>
      !isForbidden(combination) && !seen.has(combinationKey(combination)),
  )
  if (invalid.length === 0 && missing.length === 0) return

  const parts = []
  if (invalid.length > 0)
    parts.push(
      `design publishes ${invalid.length} the contract marks invalid (${formatCombinations(invalid)})`,
    )
  if (missing.length > 0)
    parts.push(
      `the contract implies ${missing.length} the design does not have (${formatCombinations(missing)})`,
    )

  emit("components/variant-combinations-mismatch", {
    side: "design",
    entity: id,
    message: `the design component's variant combinations disagree with contract "${id}" — ${parts.join("; ")}`,
    data: { invalid, missing },
  })
}

// ---------------------------------------------------------------------------
// The checker.
// ---------------------------------------------------------------------------

/**
 * Compare every loaded contract's declared props against the code-side prop
 * census and emit D5 findings. Pure — never reads fs/network, never mutates
 * its arguments.
 *
 * @param {Array<{id: string, file: string, contract: object, scaffoldMarkers?: string[], designMatchKey?: string|null}>} contracts
 *   `spec/contracts.mjs`'s `loadContracts(...).contracts` (only the entries
 *   that loaded cleanly — a caller decides what to do with load diagnostics,
 *   this checker only ever sees valid contracts). `designMatchKey` is the
 *   CALLER's job to attach (the active provider's `designAddress(contract
 *   .sources.design)`) — this module never interprets `sources.design`'s
 *   shape itself (D12); `null`/omitted means "declared but did not resolve
 *   to a valid address," distinct from `sources.design` being absent
 *   entirely, which this module DOES check directly (a checkable fact per
 *   the contract schema's own words, not an interpretation of shape).
 * @param {{components: Array<{file: string, props: object[]}>}} codeCensus
 *   the framework adapter's props-census result (only `.components`
 *   is read; `.ok`/`.diagnostics` are the caller's concern)
 * @param {object} [config] the project's (unresolved) config — this module
 *   resolves `rules` from it itself, exactly as every other layer does
 * @param {{usages: Array<{file: string, usedBy: object[]}>}} [usageCensus]
 *   `sources/code.mjs`'s `censusComponentUsage(...)` result — only `.usages`
 *   is read. OMITTED entirely (not merely empty) means `components/unused-
 *   component` is not evaluated at all — the same "a rule with nothing to
 *   compare stays silent" contract every other census-backed rule here
 *   follows, so a caller with no usage census (most of this file's own
 *   fixtures) does not see a rule it never gave input for.
 * @param {{entries: Array<{matchKey: string, name: string, props?: Array<{name: string, type: string, values?: string[]}>}>}} [designCensus]
 *   the active provider's normalized component census, already reduced to
 *   opaque match keys by the caller (`componentAddress` per entry) — same
 *   OMITTED-means-skip contract as `usageCensus`: no `designCensus` means
 *   `coverage/design-only`/`coverage/design-missing` are not evaluated at
 *   all, the same "surface skips, it doesn't fail the run" convention a
 *   missing snapshot follows everywhere else in this engine. `props`
 *   (ADR-003 Phase 5.2, the caller's `componentProps` reduction) drives
 *   `checkDesignProps` for a MATCHED entry; omitted/empty means the matched
 *   design component simply has no props to compare (a legitimate state, not
 *   a caller error).
 * @returns {object[]} findings, in `core/findings.mjs`'s deterministic order
 */
export function runComponentsCheck(
  contracts,
  codeCensus,
  config = {},
  usageCensus,
  designCensus,
) {
  const { rules: rulesConfig } = resolveConfig(config)
  const findings = []
  const usedFiles = usageCensus
    ? new Set(
        (usageCensus.usages || [])
          .filter(entry => entry.usedBy?.length > 0)
          .map(entry => entry.file),
      )
    : null

  function emit(ruleId, { side, entity, message, data }) {
    const { severity } = resolveRuleConfig(ruleId, rulesConfig, registry)
    if (severity === "off") return
    findings.push(
      makeFinding({
        ruleId,
        severity,
        surface: registry.get(ruleId).surface,
        side,
        entity,
        message,
        ...(data ? { data } : {}),
      }),
    )
  }

  const componentsByFile = new Map()
  for (const component of codeCensus?.components || [])
    componentsByFile.set(component.file, component)
  // Files where a component was confirmed but its props could not be read.
  // "A component exists here" and "its API is readable" are separate facts:
  // treating the second as the first made `coverage/contract-only` claim "no
  // component was found there" about a file that plainly has one (issue #132).
  const unreadableProps = new Set(codeCensus?.unreadableProps || [])
  const matchedFiles = new Set()

  const designByMatchKey = designCensus
    ? new Map((designCensus.entries || []).map(e => [e.matchKey, e]))
    : null
  const matchedDesignKeys = new Set()

  const contractList = [...(contracts || [])].sort((a, b) =>
    compareEntities(a.id, b.id),
  )

  // The component file is confirmed to exist either way (a matched component
  // or a confirmed-but-unreadable-props one) — usage is independent of
  // whether its props parsed.
  function checkUsage(id, codePath) {
    if (!usedFiles) return
    if (usedFiles.has(codePath)) return
    emit("components/unused-component", {
      side: "code",
      entity: id,
      message: `component "${id}" at "${codePath}" is never imported by another file under the scanned component tree`,
      data: { path: codePath },
    })
  }

  for (const entry of contractList) {
    const { id, contract } = entry

    // Read off the loader's entry, never re-derived from `contract`: the
    // loaded contract has had every `^_` key stripped, so deriving markers
    // from it always finds none (issue #350).
    const scaffoldMarkers = entry.scaffoldMarkers || []
    if (scaffoldMarkers.length > 0) {
      emit("coverage/unfinished-contract", {
        side: "spec",
        entity: id,
        message: `contract "${id}" still carries _scaffold marker(s) at ${scaffoldMarkers.map(path => `"${path}"`).join(", ")}`,
        data: { markers: scaffoldMarkers },
      })
    }

    // Computed once, used by both the design-side check below and the
    // code-side loop further down — the same reduced view either side's
    // per-prop comparison reads.
    const apiView = contractApiView(contract)

    // Independent of the code-side check below — a design-first contract can
    // declare `sources.design` before it has any `sources.code.path` at all.
    if (designCensus && contract?.sources?.design !== undefined) {
      const matchKey = entry.designMatchKey
      const designEntry = matchKey ? designByMatchKey.get(matchKey) : undefined
      if (designEntry) {
        matchedDesignKeys.add(matchKey)
        checkDesignProps(id, apiView, designEntry.props || [], emit)
        checkVariantCombinations(id, contract, apiView, designEntry, emit)
      } else {
        emit("coverage/design-missing", {
          side: "spec",
          entity: id,
          message: `contract "${id}" declares a design address that does not resolve against the design census`,
        })
      }
    }

    const codePath = contract?.sources?.code?.path
    // No code source declared at all — an aspirational/draft contract with
    // nothing yet to compare against. Silent, not a finding (see docblock).
    if (!codePath) continue

    const component = componentsByFile.get(codePath)
    if (!component) {
      // The component is there, only its API is unreadable — the contract is
      // covered, and prop parity is skipped because there is nothing to
      // compare, not because the props disagree. The extractor's own
      // `untyped-props-parameter` diagnostic already states the gap.
      if (unreadableProps.has(codePath)) {
        matchedFiles.add(codePath)
        checkUsage(id, codePath)
        continue
      }
      emit("coverage/contract-only", {
        side: "spec",
        entity: id,
        message: `contract "${id}" declares its code at "${codePath}", but no component was found there`,
        data: { path: codePath },
      })
      continue
    }
    matchedFiles.add(codePath)
    checkUsage(id, codePath)

    // Intent staleness (issue #366). The text itself is prose no rule can
    // judge; what CAN be judged is whether the code it described is still
    // the code. The hash is `snapshot`'s own `codeHash` — the same
    // `hashJson` of the same props census — so the number the finding
    // names is the number state.json already carries.
    const intent = contract?.intent
    if (
      intent &&
      typeof intent === "object" &&
      Object.keys(intent).some(key => !key.startsWith("_"))
    ) {
      const current = hashJson(component.props)
      if (typeof intent.verifiedAgainst !== "string") {
        emit("components/intent-unverified", {
          side: "spec",
          entity: id,
          message: `contract "${id}" carries intent text with no intent.verifiedAgainst — once the text is reviewed against the current code, record "${current}"`,
          data: { current },
        })
      } else if (intent.verifiedAgainst !== current) {
        emit("components/intent-stale", {
          side: "spec",
          entity: id,
          message: `contract "${id}"'s intent text was verified against code hash "${intent.verifiedAgainst}", but the component's props now hash to "${current}" — re-read the text and update intent.verifiedAgainst`,
          data: { verifiedAgainst: intent.verifiedAgainst, current },
        })
      }
    }

    const codeProps = new Map(component.props.map(prop => [prop.name, prop]))

    for (const name of Object.keys(apiView).sort(compareEntities)) {
      const propSpec = apiView[name]
      // `code: "unverified"` — assert nothing, on either side, for this prop.
      if (propSpec.code === "unverified") continue

      const codeProp = codeProps.get(name)

      if (propSpec.code === "none") {
        if (codeProp) {
          emit("components/prop-unexpected", {
            side: "code",
            entity: id,
            message: `component "${id}" has prop "${name}", but the contract marks it code: "none" — it must not appear in code`,
            data: { prop: name, reason: 'contract declares code: "none"' },
          })
        }
        continue
      }

      if (!codeProp) {
        emit("components/prop-missing", {
          side: "code",
          entity: id,
          message: `contract "${id}" declares prop "${name}" (${propSpec.type}), which the code component does not have`,
          data: { prop: name, type: propSpec.type },
        })
        continue
      }

      // "unknown" is the extractor saying it could NOT resolve this prop's
      // type — a path alias it could not follow, a dependency that is not
      // installed. It is not a type, so it cannot disagree with one. Comparing
      // it would turn "we could not look" into "we looked and it is wrong",
      // which is exactly the false finding this engine exists to avoid; the
      // gap is reported at `review` instead, so it stays visible.
      if (codeProp.type === "unknown") {
        emit("components/prop-type-unresolved", {
          side: "code",
          entity: id,
          message: `prop "${name}" could not have its type resolved in code — the contract's "${propSpec.type}" is neither confirmed nor contradicted`,
          data: { prop: name, contractType: propSpec.type },
        })
      } else if (propSpec.type !== codeProp.type) {
        emit("components/prop-type-mismatch", {
          side: "code",
          entity: id,
          message: `prop "${name}" is typed "${propSpec.type}" in the contract but "${codeProp.type}" in code`,
          data: {
            prop: name,
            contractType: propSpec.type,
            codeType: codeProp.type,
          },
        })
      } else if (propSpec.type === "enum") {
        const { added, removed } = diffEnumValues(
          propSpec.values || [],
          codeProp.values || [],
        )
        if (added.length > 0 || removed.length > 0) {
          const parts = []
          if (added.length) parts.push(`code adds ${formatValues(added)}`)
          if (removed.length)
            parts.push(
              `contract has ${formatValues(removed)} that code does not`,
            )
          emit("components/enum-values-mismatch", {
            side: "code",
            entity: id,
            message: `prop "${name}"'s enum values disagree with the contract — ${parts.join("; ")}`,
            data: { prop: name, added, removed },
          })
        }
      }

      // BOTH sides must declare a default for this to fire. A contract
      // default with no default detected in code is deliberately SILENT:
      // code-side default detection reads literal destructuring defaults
      // (`{size = "md"}`) and cannot see one applied any other way — a
      // fallback inside the body, a defaultProps object, a value merged from
      // a hook. Reporting those as drift would be a false finding, and the
      // acceptance gate for this check is zero of them. The asymmetry is the
      // choice, not an oversight: this rule catches two defaults that
      // DISAGREE, never a default it merely failed to find.
      if (
        propSpec.default !== undefined &&
        codeProp.default !== undefined &&
        propSpec.default !== codeProp.default
      ) {
        emit("components/prop-default-mismatch", {
          side: "code",
          entity: id,
          message: `prop "${name}" defaults to ${JSON.stringify(propSpec.default)} in the contract but ${JSON.stringify(codeProp.default)} in code`,
          data: {
            prop: name,
            contractDefault: propSpec.default,
            codeDefault: codeProp.default,
          },
        })
      }

      if (propSpec.required !== codeProp.required) {
        emit("components/prop-optionality-mismatch", {
          side: "code",
          entity: id,
          message: `prop "${name}" is ${propSpec.required ? "required" : "optional"} in the contract but ${codeProp.required ? "required" : "optional"} in code`,
          data: {
            prop: name,
            contractRequired: propSpec.required,
            codeRequired: codeProp.required,
          },
        })
      }
    }

    // A prop the contract accounts for in `codegen` rather than in `props` is
    // NOT unexpected. `codegen.className: true` is the contract saying, in the
    // place the schema provides for it, that this component takes a className
    // passthrough — reporting it as undeclared makes the contract contradict
    // itself, and it fired on the very first real contract authored against a
    // real component.
    const codegenDeclared = new Set()
    if (contract.codegen?.className === true) codegenDeclared.add("className")

    for (const codeProp of component.props) {
      if (Object.prototype.hasOwnProperty.call(apiView, codeProp.name)) continue
      if (codegenDeclared.has(codeProp.name)) continue
      emit("components/prop-unexpected", {
        side: "code",
        entity: id,
        message: `component "${id}" has prop "${codeProp.name}", which the contract does not declare`,
        data: { prop: codeProp.name },
      })
    }
  }

  // EVERY confirmed component, not only the ones whose props parsed.
  //
  // Whether a contract references a file is independent of whether its props
  // could be read, so judging coverage by the props census alone silently
  // dropped a component the census could not parse from the contract worklist
  // — measured on a real design system, 21 of 100 discovered files, while
  // `verify` exited 0 reporting the worklist complete (issue #132). The
  // failure mode that matters for a report is the finding that is ABSENT.
  //
  // `unreadableProps` carries confirmed components only: a file that declares
  // no component at all (a re-export barrel) is in neither list, because
  // adding it would invent authoring work rather than surface it.
  const uncontractedFiles = [
    ...(codeCensus?.components || []).map(component => component.file),
    ...(codeCensus?.unreadableProps || []),
  ].sort(compareEntities)

  for (const file of uncontractedFiles) {
    if (matchedFiles.has(file)) continue
    emit("coverage/uncontracted-component", {
      side: "code",
      entity: file,
      message: `component at "${file}" has no contract referencing it`,
      data: { path: file },
    })
  }

  if (designCensus) {
    const designEntries = [...(designCensus.entries || [])].sort((a, b) =>
      compareEntities(a.matchKey, b.matchKey),
    )
    for (const designEntry of designEntries) {
      if (matchedDesignKeys.has(designEntry.matchKey)) continue
      // A component the provider marked private (issue #460) is not missing
      // a contract — it was never meant to have one. The CLI reports how many
      // were skipped, once, as a diagnostic.
      if (designEntry.private === true) continue
      emit("coverage/design-only", {
        side: "design",
        entity: designEntry.matchKey,
        message: `design component "${designEntry.name}" (${designEntry.matchKey}) has no contract referencing it`,
        data: { name: designEntry.name },
      })
    }
  }

  return sortFindings(findings)
}

/**
 * Turn binding-file statuses into findings (issue #400). Pure — the CLI
 * derives each status through the active provider and the filesystem; this
 * only speaks the result. `match` and non-applicable entries never arrive.
 *
 * Each entry carries `expected`: the text the caller's provider rendered and
 * compared against, threaded through rather than re-derived here (issue #579),
 * because this layer cannot render one and the finding is a consumer's only
 * output — the audit path never writes. An entry with no `expected` reports
 * `data.expected: null` and says so in the message, so "nothing was rendered"
 * is never mistaken for "this engine does not carry it".
 *
 * A `compare-unreliable` entry (issue #588) is the provider saying the two
 * sides differ but it could not compare them (issue #609: its parser is not
 * installed). It gets
 * its own rule and its own message, built from the `ceiling` triggers the
 * provider supplies: this layer never names the shapes itself, because the
 * vocabulary that describes them belongs to the provider (ADR-001 D12/D16).
 *
 * @param {Array<{id: string, outputPath: string, status: "missing"|"stale"|"compare-unreliable", expected?: string|null, ceiling?: Array<{id: string, detail: string}>}>} entries
 * @param {object} [config]
 * @returns {object[]} findings
 */
export function runBindingFilesCheck(entries, config = {}) {
  const { rules: rulesConfig } = resolveConfig(config)
  const findings = []
  for (const { id, outputPath, status, expected, ceiling } of entries || []) {
    const ruleId =
      status === "missing"
        ? "components/binding-file-missing"
        : status === "compare-unreliable"
          ? "components/binding-file-compare-unreliable"
          : "components/binding-file-stale"
    const { severity } = resolveRuleConfig(ruleId, rulesConfig, registry)
    if (severity === "off") continue
    const content = typeof expected === "string" ? expected : null
    // No writer exists to point at: the `codegen` command and its `--write`
    // were deleted (issue #400), so the only honest instruction is "here is
    // what the contract says the file holds; decide which side is wrong".
    const remedy =
      content === null
        ? "this finding carries no expected content (`data.expected` is null): nothing was rendered for it"
        : status === "missing"
          ? "`data.expected` on this finding carries what the contract says it holds"
          : "`data.expected` on this finding carries what the contract says it holds; bring the file into line with it, or change the contract if the file is right"
    // The provider's own words for what its comparison could not read — this
    // layer has no vocabulary for the shapes and must not invent one.
    const triggers = Array.isArray(ceiling) ? ceiling : []
    const doubt =
      triggers.length > 0
        ? triggers
            .map(trigger => trigger?.detail)
            .filter(Boolean)
            .join("; ")
        : "the provider names no shape for it"
    findings.push(
      makeFinding({
        ruleId,
        severity,
        surface: "components",
        side: "code",
        entity: id,
        message:
          status === "missing"
            ? `contract "${id}" renders a design-to-code binding file, and none is committed at "${outputPath}" — ${remedy}`
            : status === "compare-unreliable"
              ? `the design-to-code binding file at "${outputPath}" differs from what contract "${id}" renders, but the comparison cannot be trusted here and the difference is not reported as drift: ${doubt}. This is a limit of what the engine could check here, not a defect found in this repo — ${remedy}`
              : `the design-to-code binding file at "${outputPath}" differs from what contract "${id}" renders — ${remedy}`,
        data: {
          path: outputPath,
          status,
          expected: content,
          ...(status === "compare-unreliable" ? { ceiling: triggers } : {}),
        },
      }),
    )
  }
  return sortFindings(findings)
}
