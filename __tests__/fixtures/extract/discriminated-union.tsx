// A discriminated union used as an intersection arm (issue #381): the
// standard TypeScript "exactly one of these prop sets", and what a design
// tool models as a variant axis.
import type { HTMLAttributes } from "react"

type Glyph = { src: string; alt?: string }

type IconProps = { variant: "icon"; icon: Glyph; text?: never }
type TextProps = { variant: "text"; text: string; icon?: never }

export type DisplayProps = {
  size?: "sm" | "md" | "lg"
  className?: string
} & (IconProps | TextProps) &
  Omit<HTMLAttributes<HTMLDivElement>, "children">

export function Display({ size = "md", variant, icon, text }: DisplayProps) {
  return null
}
