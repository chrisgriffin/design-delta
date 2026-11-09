// Two branches that build the IDENTICAL tree (differing only in a prop passed
// to an attribute, which this census does not model). The intersection finds
// no disagreement, so the component is FULLY resolved — it must not be
// flagged partial, since there is nothing that went uncompared.
export type TwinProps = { compact?: boolean; label: string }

export function Twin({ compact, label }: TwinProps) {
  if (compact) return <time className="compact">{label}</time>
  return <time className="full">{label}</time>
}
