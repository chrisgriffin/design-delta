// `{cond ? <Icon/> : null}` — a very common idiom that renders ZERO OR ONE
// node. Marking a definite position here would shift `<em>` from index 1 to
// index 0 whenever the null arm is taken, inventing an alignment that holds
// only half the time. The parent's whole child list is withheld instead.
export type MaybeProps = { on?: boolean; label: string }

export function Maybe({ on, label }: MaybeProps) {
  return (
    <div>
      {on ? <span className="icon" /> : null}
      <em>{label}</em>
    </div>
  )
}
