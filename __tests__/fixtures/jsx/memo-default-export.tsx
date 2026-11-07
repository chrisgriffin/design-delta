// A `memo`-wrapped component reached through `export default <Identifier>` —
// the wrapper has to be unwrapped on the default-export pass too, not just the
// inline-export pass.
import { memo } from "react"

const MemoSection = memo(() => (
  <section>
    <p>text</p>
  </section>
))

export default MemoSection
