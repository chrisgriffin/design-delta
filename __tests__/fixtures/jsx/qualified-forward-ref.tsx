// A `React.`-qualified `forwardRef` wrapper. `jsx.mjs` calls `unwrapHoc`
// independently of `extract.mjs`, so the anatomy side needs its own cover for
// the property-access callee: unresolved, this reader emits
// `no-component-found` and the component leaves the worklist silently (#577,
// the #132 failure shape).
import * as React from "react"

export const QualifiedForwardRefBox = React.forwardRef<
  HTMLDivElement,
  { caption: string }
>((props, ref) => (
  <div ref={ref}>
    <span>{props.caption}</span>
  </div>
))
