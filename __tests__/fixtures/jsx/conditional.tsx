export type ConditionalProps = {
  hasIcon?: boolean
  label: string
}

export function Conditional({ hasIcon, label }: ConditionalProps) {
  return (
    <div>
      {hasIcon && <span className="icon" />}
      <span>{label}</span>
    </div>
  )
}
