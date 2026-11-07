export type CallProps = {
  label: string
}

function renderContent(label: string) {
  return <span>{label}</span>
}

export function CallWidget({ label }: CallProps) {
  return renderContent(label)
}
