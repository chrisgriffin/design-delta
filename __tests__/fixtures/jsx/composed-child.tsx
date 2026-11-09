export type ComposedProps = {
  label: string
}

function Icon() {
  return <svg />
}

export function Composed({ label }: ComposedProps) {
  return (
    <div>
      <Icon />
      <span>{label}</span>
    </div>
  )
}
