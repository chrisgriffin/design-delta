// A ternary child whose BOTH arms are JSX elements: exactly one node renders
// here either way, so the position is real and only its contents are unknown.
// The sibling after it keeps a trustworthy index — which is what makes marking
// the position (rather than withholding the list) honest.
export type SwapProps = { alt?: boolean; label: string }

export function Swap({ alt, label }: SwapProps) {
  return (
    <div>
      {alt ? <strong>{label}</strong> : <span>{label}</span>}
      <em>after</em>
    </div>
  )
}
