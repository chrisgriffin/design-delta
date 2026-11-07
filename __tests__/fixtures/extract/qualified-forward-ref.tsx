// The `React.`-QUALIFIED form of `forwardRef` — the ordinary spelling in a
// codebase that does `import * as React`. `hoc.mjs` accepts it deliberately,
// resolving the callee through `ts.isPropertyAccessExpression` rather than as a
// plain identifier, and issue #577 found that branch wholly unexercised.
//
// Everything the bare form has to get right applies here too, and the props
// type is still the SECOND type argument. The ref type (`HTMLDivElement`)
// shares no prop names with the interface below, so reading the wrong index
// yields a visibly different census rather than a subtly wrong one.
import * as React from "react"

export interface QualifiedForwardRefProps {
  caption: string
  variant?: "solid" | "outline"
  readOnly?: boolean
}

export const QualifiedForwardRefBox = React.forwardRef<
  HTMLDivElement,
  QualifiedForwardRefProps
>((props, ref) => {
  const { caption, variant = "solid", readOnly = false } = props
  return (
    <div ref={ref} data-variant={variant} data-read-only={readOnly}>
      {caption}
    </div>
  )
})
