// The destructured twin of `non-destructured-props.tsx`, with an identical
// props type and identical members. The pair exists so a test can assert the
// two parameter shapes yield the SAME props (issue #154) rather than asserting
// a hand-written expectation twice — the equivalence is the actual contract.
// A default is deliberately absent here: defaults are the one thing the two
// shapes legitimately differ on, and `defaults-*` fixtures cover that path.
interface DestructuredProps {
  label: string
  size?: "sm" | "lg"
}

export const Destructured = ({ label, size }: DestructuredProps) => (
  <div className={size}>{label}</div>
)
