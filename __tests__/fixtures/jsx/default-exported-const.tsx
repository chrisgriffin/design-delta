type WidgetProps = { label: string }

const Widget = ({ label }: WidgetProps) => {
  return <div className="widget">{label}</div>
}

export default Widget
