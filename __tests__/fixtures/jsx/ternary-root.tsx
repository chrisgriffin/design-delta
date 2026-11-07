export type TernaryProps = {
  tone: "a" | "b"
  label: string
}

export function TernaryRoot({ tone, label }: TernaryProps) {
  return tone === "a" ? <span>{label}</span> : <strong>{label}</strong>
}
