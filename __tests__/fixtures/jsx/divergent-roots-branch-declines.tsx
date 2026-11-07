// Divergent roots (`<a>` vs `<button>`) where ONE branch cannot be resolved on
// its own — a nested Fragment. The component still declines as
// "divergent-roots", and NO candidate trees are carried: a list holding only
// the branches that happened to resolve would read as the component's whole
// set of branches. Pins the all-or-nothing rule for ADR-002 D5.
export type BranchDeclinesProps = { href?: string; label: string }

export function BranchDeclines({ href, label }: BranchDeclinesProps) {
  if (href)
    return (
      <a href={href}>
        <>{label}</>
      </a>
    )
  return <button>{label}</button>
}
