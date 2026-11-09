// The React framework adapter, as one object (issue #117). Everything a CLI
// command needs from `sources/react/` — resolved through
// `sources/frameworks.mjs`, never imported by framework name from cli/.
import { REACT_NON_COMPONENT_FILE_SUFFIXES } from "./extract.mjs"

export const name = "react"

/** File conventions this adapter owns: which files are components and which
 * files inside a component dir are not the component. Formerly a global
 * default in core/config.mjs (`.tsx` baked into the engine). A project's
 * `conventions.nonComponentFileSuffixes` still overrides the list wholesale. */
export const conventions = {
  componentFileExtension: ".tsx",
  nonComponentFileSuffixes: REACT_NON_COMPONENT_FILE_SUFFIXES,
}

export {
  extractComponent,
  extractComponents,
  findComponentFiles,
} from "./extract.mjs"
export { extractJsxComponent, extractJsxComponents } from "./jsx.mjs"
