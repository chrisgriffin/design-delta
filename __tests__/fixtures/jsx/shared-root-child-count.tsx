// Two branches sharing a root whose children lists differ in LENGTH. Aligning
// them positionally would synthesize a tree matching neither branch, so the
// whole children list is marked unresolved instead.
export type CountProps = { extra?: boolean; label: string }

export function Count({ extra, label }: CountProps) {
  if (extra)
    return (
      <div>
        <span>{label}</span>
        <em>more</em>
      </div>
    )
  return (
    <div>
      <span>{label}</span>
    </div>
  )
}
