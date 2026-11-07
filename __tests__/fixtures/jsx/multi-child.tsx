export type MultiProps = {
  label: string
}

export function MultiChild({ label }: MultiProps) {
  return (
    <div>
      <span className="icon" />
      <span>{label}</span>
    </div>
  )
}
