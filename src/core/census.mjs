/**
 * census.mjs — the ONE classification of a structural census node's `kind`
 * into "occupies a position in the element tree" (structural) versus
 * "is the content rendered inside a position" (content).
 *
 * The vocabulary itself is `docs/framework-adapter-contract.md`'s, and is
 * adapter-neutral by construction: `element`/`component`/`text`/`expression`/
 * `unknown`/`unresolved` say nothing about any framework (D16), so this
 * belongs in `core/` rather than in either layer that reads it.
 *
 * It lives here because TWO layers depend on the same split and must not
 * drift apart: `modules/anatomy.mjs` compares a contract's `children` list
 * against STRUCTURAL children only and its `content` against CONTENT
 * children, while `spec/scaffold.mjs` drafts the contract those rules are
 * then applied to. When only one side knew the split, scaffold wrote a
 * content child into `children` and the checker reported the node it had
 * just written as absent — an engine contradicting its own output (#351).
 * `spec` may not import `modules`, so a shared definition here is the only
 * place both can read one answer from.
 */

/**
 * Kinds that occupy a real position in the element tree. `unresolved` counts
 * as structural because the position exists — only its contents are unknown.
 */
export const STRUCTURAL_KINDS = new Set(["element", "component", "unresolved"])

/** Kinds that are content rendered INSIDE a position, not a position. */
export const CONTENT_KINDS = new Set(["text", "expression", "unknown"])

/**
 * @param {{kind: string}} node
 * @returns {boolean}
 */
export function isStructuralNode(node) {
  return STRUCTURAL_KINDS.has(node?.kind)
}

/**
 * @param {{kind: string}} node
 * @returns {boolean}
 */
export function isContentNode(node) {
  return CONTENT_KINDS.has(node?.kind)
}
