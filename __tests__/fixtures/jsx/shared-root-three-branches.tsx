// THREE branches sharing a root, with differing child counts. Pins the fold
// bug: `intersectNodes` builds a fresh node each call, so a
// `childrenResolved: false` set on the first fold could be dropped by the
// second when it compared two already-emptied lists and found their lengths
// equal. Two-branch fixtures cannot reach this.
export type TriProps = { mode?: "a" | "b"; label: string }

export function Tri({ mode, label }: TriProps) {
  if (mode === "a")
    return (
      <div>
        <span>{label}</span>
      </div>
    )
  if (mode === "b")
    return (
      <div>
        <span>{label}</span>
        <em>more</em>
      </div>
    )
  return <div />
}
