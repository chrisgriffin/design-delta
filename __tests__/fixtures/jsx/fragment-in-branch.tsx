// Two branches sharing a root, one containing a nested Fragment. A Fragment
// splices an unknown number of siblings into its parent with no wrapping node,
// which this module does not resolve at all — so unlike a `.map()` or a
// logical conditional it still DECLINES, and having a resolvable sibling
// branch does not lower that bar.
export type FragProps = { split?: boolean; label: string }

export function Frag({ split, label }: FragProps) {
  if (split)
    return (
      <ul>
        <>
          <li>a</li>
          <li>b</li>
        </>
      </ul>
    )
  return (
    <ul>
      <li>{label}</li>
    </ul>
  )
}
