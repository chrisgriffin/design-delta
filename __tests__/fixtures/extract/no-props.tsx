// No exported function takes a parameter at all — pins the
// "no-props-type-found" diagnostic path. (Destructuring is NOT what is missing
// here: since #154 a typed parameter reads fine without it. What this fixture
// pins is the zero-parameter shape, which issue #152 covers separately.)
export function NotAComponent() {
  return null
}
