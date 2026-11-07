// Generic in-repo fixture (no reference to any specific consuming project).
// Pins the three spike findings (`docs/spikes/prop-extraction.md`) that
// disqualified `react-docgen-typescript`, all in one component:
//
//   - `children`, declared first-party, must be extracted (the disqualifying
//     bug).
//   - `size`'s optional enum values must never include `undefined`.
//   - a first-party intersection arm (`SharedProps`, from a sibling file) is
//     included, while a `node_modules` arm (`ThirdPartyAttrs`) is excluded.
import type { ThirdPartyAttrs } from "third-party-attrs"

import type { SharedProps } from "./shared/shared-props"

export type WidgetProps = {
  children: string
  label: string
  size?: "sm" | "md" | "lg"
} & SharedProps &
  ThirdPartyAttrs

export function Widget({ children, label, size = "sm" }: WidgetProps) {
  return null
}
