export type ListProps = {
  items: string[]
}

export function ListWidget({ items }: ListProps) {
  return (
    <ul>
      {items.map(item => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  )
}
