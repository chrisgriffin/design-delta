// The `React.`-qualified form of `memo`, whose props type is its FIRST type
// argument — the opposite position from `React.forwardRef<TRef, TProps>`. Pins
// that the qualified spelling is read from the same per-wrapper index as the
// bare one, not from a single shared position (issue #577).
import * as React from "react"

export interface QualifiedMemoProps {
  heading: string
  total?: number
}

export const QualifiedMemoPanel = React.memo<QualifiedMemoProps>(
  ({ heading, total = 0 }) => <article data-total={total}>{heading}</article>,
)
