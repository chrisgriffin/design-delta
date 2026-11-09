/**
 * mechanisms.mjs — the ONE map from a contract's `design: {name, mechanism}`
 * marker (issue #439) to the type the design side carries when it models a
 * prop that way.
 *
 * Stated in the ENGINE's normalized type vocabulary, never a design tool's
 * own (D12): a provider has already reduced its property kinds to these
 * names, so this map holds for any provider rather than describing one.
 *
 * It lives here, alongside `census.mjs`'s structural/content split, for the
 * same reason that one does: TWO layers depend on the answer and must not
 * drift apart. `modules/components.mjs` compares the design side against the
 * implied type instead of the contract's own, and a provider generating a
 * design-to-code binding picks its mapping helper from it — and `providers`
 * may import only `core/`, never `modules/`, so a shared definition here is
 * the only place both can read one answer from. When only the checker knew
 * the translation, generation emitted an instance-swap binding against a
 * design property that is really a boolean — a binding the contract itself
 * declared to be wrong (issue #457).
 *
 * `schema/contract.schema.json`'s `designDeviation.mechanism` enum is the
 * same set — `docs-parity.test.js` binds the two, since a value the schema
 * accepts with no entry here would be accepted and then never checked, which
 * is the failure the marker exists to prevent.
 */

export const DESIGN_MECHANISM_TYPES = Object.freeze({
  toggle: "boolean",
  text: "string",
  instance: "slot",
})

/**
 * The type the design side carries for `entry.design`'s declared mechanism,
 * or `undefined` when the marker declares none (every other `design` shape
 * included — `"none"`/`"unverified"` and a bare rename carry no mechanism).
 *
 * @param {unknown} deviation a prop's `design` marker, in any of its shapes
 * @returns {string|undefined}
 */
export function designMechanismType(deviation) {
  if (!deviation || typeof deviation !== "object") return undefined
  // `hasOwn`, not a bare lookup: the vocabulary is closed, and an inherited
  // key ("toString") is not a member of it.
  return Object.hasOwn(DESIGN_MECHANISM_TYPES, deviation.mechanism)
    ? DESIGN_MECHANISM_TYPES[deviation.mechanism]
    : undefined
}
