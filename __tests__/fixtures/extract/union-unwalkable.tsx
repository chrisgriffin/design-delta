// One union member is third-party, so the union's key set is unknown and
// the whole union is skipped — never half-read (issue #381).
import type { HTMLAttributes } from "react"

type Local = { variant: "local"; note: string }

export type MixedProps = {
  size?: "sm" | "lg"
} & (Local | HTMLAttributes<HTMLSpanElement>)

export function Mixed({ size }: MixedProps) {
  return null
}
