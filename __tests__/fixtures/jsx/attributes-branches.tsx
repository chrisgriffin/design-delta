// Two branches sharing a root: an attribute survives the fold only where
// both agree (issue #364).
export type ToggleProps = { on: boolean }

export function Toggle({ on }: ToggleProps) {
  if (on) return <button role="switch" aria-checked="true" />
  return <button role="switch" aria-checked="false" />
}
