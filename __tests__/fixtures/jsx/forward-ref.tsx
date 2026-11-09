// A `forwardRef`-wrapped component: the declaration's initializer is a CALL,
// not an arrow, so a finder matching only arrows misses it entirely and the
// anatomy surface goes blind to the component (issue #134).
import { forwardRef } from "react"

export const ForwardRefBox = forwardRef<HTMLDivElement, { label: string }>(
  (props, ref) => (
    <div ref={ref}>
      <span>{props.label}</span>
    </div>
  ),
)
