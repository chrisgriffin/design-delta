// A spread onto an element makes the attribute SET unknowable (issue #364).
export type FieldProps = { rest: Record<string, unknown> }

export function Field({ rest }: FieldProps) {
  return <input type="text" {...rest} />
}
