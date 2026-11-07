// A plain typed identifier parameter, never destructured — the idiomatic
// `(props: FooProps) => …` shape. Pins issue #154: the props type is resolvable
// straight off the signature, so it must extract exactly as the destructured
// form does. Its twin is `destructured-props.tsx`, which declares an identical
// props type and differs ONLY in parameter shape, so the two can be compared
// member for member.
interface NonDestructuredProps {
  label: string
  size?: "sm" | "lg"
}

export const NonDestructured = (props: NonDestructuredProps) => (
  <div className={props.size}>{props.label}</div>
)
