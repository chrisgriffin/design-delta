export type NestedFragmentProps = {
  label: string
}

export function NestedFragment({ label }: NestedFragmentProps) {
  return (
    <div>
      <>
        <span>{label}</span>
      </>
    </div>
  )
}
