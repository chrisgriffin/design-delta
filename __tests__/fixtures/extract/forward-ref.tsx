// A component wrapped in `forwardRef` — the near-universal design-system shape
// for anything that forwards a ref to a DOM node. Three things differ from an
// unwrapped component, and all three have to work at once:
//
//   1. the declaration's initializer is a CALL, not an arrow;
//   2. the props parameter carries NO type annotation — the type is the
//      SECOND type argument (`forwardRef<TRef, TProps>`);
//   3. the destructuring, and therefore every default, lives in the BODY
//      rather than the parameter.
import { forwardRef } from "react"

export type ForwardRefProps = {
  label: string
  size?: "sm" | "md" | "lg"
  disabled?: boolean
}

export const ForwardRefBox = forwardRef<HTMLDivElement, ForwardRefProps>(
  (props, ref) => {
    const { label, size = "md", disabled = false } = props
    return (
      <div ref={ref} data-size={size} data-disabled={disabled}>
        {label}
      </div>
    )
  },
)
