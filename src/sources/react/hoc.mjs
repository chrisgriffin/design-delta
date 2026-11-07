/**
 * hoc.mjs — the one place that knows which React higher-order components wrap
 * a component, and where each puts the props type in its type arguments.
 *
 * Both readers in this adapter hit the same wall independently: a component
 * written `export const X = forwardRef<Ref, Props>((props, ref) => …)` is a
 * CALL, not an arrow, so a finder matching only arrows and function
 * expressions does not see it at all. `extract.mjs` reported it as having no
 * props AND no component; `jsx.mjs` reported no component, leaving anatomy
 * blind to it. It then vanished from the contract worklist too (issue #132).
 *
 * The two readers stay deliberately parallel — they want different things from
 * the node they find (a props parameter vs. a returned element tree, see
 * `extract.mjs`'s `findComponentPropsParam`) — but WHICH CALLS ARE WRAPPERS is
 * one fact, and two copies of it would drift the first time a third wrapper is
 * added. That is all this module holds.
 *
 * THE INDEX IS THE DANGEROUS PART. `forwardRef<TRef, TProps>` puts the props
 * type SECOND, because the ref type comes first; `memo<TProps>` puts it FIRST.
 * Reading the wrong one does not fail loudly — it silently extracts a
 * different type and then reports confident findings against props the
 * component never declared, which is strictly worse than extracting nothing.
 * `__tests__/sources-extract.test.js` pins each index by asserting the actual
 * props read, not merely that a component was found: a test that only checked
 * "something was found" passes with the two transposed.
 *
 * React vocabulary lives ONLY under `sources/react/` (ADR-001 D16), which is
 * why this file is here and not in `core/` or `modules/`.
 */

// Wrapper name -> the position of the props type in its type arguments.
const PROPS_TYPE_INDEX = new Map([
  ["forwardRef", 1],
  ["memo", 0],
])

/**
 * Unwrap `forwardRef(fn)` / `memo(fn)` and their `React.`-qualified forms.
 *
 * @param {object} ts the TypeScript module
 * @param {object} node the declaration's initializer
 * @returns {{fn: object, propsTypeNode: object|null}|null} the wrapped
 *   function plus the props type node the wrapper's type arguments name
 *   (null when the wrapper carries no type arguments — the inner parameter may
 *   still be annotated), or null when this is not a recognized wrapper call
 */
export function unwrapHoc(ts, node) {
  if (!node || !ts.isCallExpression(node)) return null

  const callee = node.expression
  const name = ts.isIdentifier(callee)
    ? callee.text
    : ts.isPropertyAccessExpression(callee)
      ? callee.name?.text
      : undefined
  if (!PROPS_TYPE_INDEX.has(name)) return null

  const inner = node.arguments?.[0]
  if (!inner || !(ts.isArrowFunction(inner) || ts.isFunctionExpression(inner)))
    return null

  return {
    fn: inner,
    propsTypeNode: node.typeArguments?.[PROPS_TYPE_INDEX.get(name)] || null,
  }
}
