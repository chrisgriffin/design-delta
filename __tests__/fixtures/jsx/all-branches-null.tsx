// Every branch renders nothing. Once null-returning branches are dropped
// there are no candidates left, so this is "no-jsx-returned" — not
// "multiple-returns", which would imply competing trees that do not exist.
export type NeverRendersProps = { on?: boolean }

export function NeverRenders({ on }: NeverRendersProps) {
  if (on) return null
  return null
}
