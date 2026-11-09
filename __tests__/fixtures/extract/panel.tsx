// Exercises the `interface … extends …` shape (as opposed to widget.tsx's
// `type … = {…} & …`): a local, first-party base interface is included, and
// an extended node_modules interface is excluded — the same intersection-arm
// rule, walked through a heritage clause instead of an `&`.
import type { ThirdPartyAttrs } from "third-party-attrs"

interface BaseProps {
  id: string
}

export interface PanelProps extends BaseProps, ThirdPartyAttrs {
  title: string
}

export function Panel({ id, title }: PanelProps) {
  return null
}
