export type FragmentProps = {
  label: string
}

export function FragmentWidget({ label }: FragmentProps) {
  return (
    <>
      <span>{label}</span>
    </>
  )
}
