export type GuardedProps = {
  visible?: boolean
  label: string
}

export function Guarded({ visible = true, label }: GuardedProps) {
  if (!visible) return null
  return <div>{label}</div>
}
