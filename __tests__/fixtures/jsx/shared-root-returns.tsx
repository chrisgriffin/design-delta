// Two branches that both render the SAME root element, differing only below
// it. Resolves to their INTERSECTION: the root is asserted normally, the one
// child position the branches disagree on becomes `unresolved` and is
// reported via `unresolvedAt` rather than guessed at.
export type SharedRootProps = { compact?: boolean; label: string }

export function SharedRoot({ compact, label }: SharedRootProps) {
  if (compact) return <time>{label}</time>
  return (
    <time>
      <span>{label}</span>
    </time>
  )
}
