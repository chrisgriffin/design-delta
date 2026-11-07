export type StaticProps = {
  label: string
}

export function StaticWidget({ label }: StaticProps) {
  return (
    <div>
      <span>Fixed label</span>
      <span>{label}</span>
    </div>
  )
}
