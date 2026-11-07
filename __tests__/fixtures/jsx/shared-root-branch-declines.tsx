// Both branches share a root, but one of them renders a `.map(...)`. A branch
// this module cannot resolve on its own is not made resolvable by having a
// sibling, so the whole component declines with that branch's own reason.
export type ListyProps = { many?: boolean; items: string[] }

export function Listy({ many, items }: ListyProps) {
  if (many)
    return (
      <ul>
        {items.map(item => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    )
  return (
    <ul>
      <li>none</li>
    </ul>
  )
}
