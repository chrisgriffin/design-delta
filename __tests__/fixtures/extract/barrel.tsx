// Declares NO component of its own — it only re-exports them from elsewhere.
// Pins the "no-component-found" path: a file under the component root that is
// not a component at all must NOT be added to the contract worklist.
import { Alpha } from "./widget"
import { Beta } from "./panel"

export { Alpha, Beta }
