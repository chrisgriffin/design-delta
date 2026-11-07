export type SimpleProps = {
  label: string
}

export function Simple({ label }: SimpleProps) {
  return (
    <div>
      <span>{label}</span>
    </div>
  )
}
