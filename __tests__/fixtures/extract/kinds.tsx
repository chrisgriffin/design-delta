// Exercises every scalar type category the classifier maps to the contract
// vocabulary (boolean/number/string/function), plus destructuring defaults
// for both a boolean and a number (not just a string, which widget.tsx
// already covers).
export type KindsProps = {
  active?: boolean
  count?: number
  name: string
  onSelect?: () => void
}

export function Kinds({
  active = false,
  count = 0,
  name,
  onSelect,
}: KindsProps) {
  return null
}
