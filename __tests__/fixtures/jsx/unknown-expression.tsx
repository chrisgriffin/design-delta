export type PriceProps = {
  price: number
}

function formatPrice(value: number) {
  return `$${value}`
}

export function PriceTag({ price }: PriceProps) {
  return <span>{formatPrice(price)}</span>
}
