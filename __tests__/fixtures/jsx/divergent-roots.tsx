// Two branches rendering DIFFERENT root elements — the `button` shape from
// issue #156 (`<Link>` when `href` is set, `<button>` otherwise). No common
// structure exists to describe, and no resolver change can produce one: this
// needs a variant-keyed contract. Pins the "divergent-roots" reason.
export type DivergentProps = { href?: string; label: string }

export function Divergent({ href, label }: DivergentProps) {
  if (href) return <a href={href}>{label}</a>
  return <button>{label}</button>
}
