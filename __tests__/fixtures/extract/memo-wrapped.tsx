// A component wrapped in `memo`, whose props type is its FIRST type argument
// (`memo<TProps>`) — the opposite position from `forwardRef<TRef, TProps>`.
// Pins that the two are not read from the same index.
import { memo } from "react"

export type MemoProps = {
  title: string
  count?: number
}

export const MemoCard = memo<MemoProps>(({ title, count = 0 }) => (
  <section data-count={count}>{title}</section>
))
