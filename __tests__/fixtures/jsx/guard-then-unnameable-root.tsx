// One branch is a plain element, the other is a ternary — which has no single
// nameable root. Stays "multiple-returns" rather than "divergent-roots":
// claiming the roots diverge would assert more than is known.
export type MixedProps = { a?: boolean; b?: boolean; label: string }

export function Mixed({ a, b, label }: MixedProps) {
  if (a) return <div>{label}</div>
  return b ? <div>{label}</div> : <span>{label}</span>
}
