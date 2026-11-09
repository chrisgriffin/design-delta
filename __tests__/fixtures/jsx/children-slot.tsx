export type SlotProps = {
  children: unknown
}

export function SlotWidget({ children }: SlotProps) {
  return <div>{children}</div>
}
