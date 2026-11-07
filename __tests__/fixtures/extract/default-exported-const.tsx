type WidgetProps = {
  label: string
  size?: "sm" | "lg"
}

const Widget = ({ label, size = "lg" }: WidgetProps) => {
  return <div data-size={size}>{label}</div>
}

export default Widget
