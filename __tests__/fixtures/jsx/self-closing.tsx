export type IconOnlyProps = {
  name: string
}

export function IconOnly({ name }: IconOnlyProps) {
  return <svg data-icon={name} />
}
