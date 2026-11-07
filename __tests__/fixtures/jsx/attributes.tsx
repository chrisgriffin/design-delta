// DOM attributes on elements (issue #364): literal strings, a bare boolean, a
// computed value, and a component (whose props are NOT attributes).
export type CloseProps = { label: string; onClose: () => void }

export function Close({ label, onClose }: CloseProps) {
  return (
    <button type="button" aria-label={label} disabled onClick={onClose}>
      <Icon name="x" aria-hidden="true" />
    </button>
  )
}
