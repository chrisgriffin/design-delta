import base from "@chrisgriffin/config/eslint"
import globals from "globals"

export default [
  // specs/ is Spec Kit's prose; .agents/ and .specify/ are laid by the
  // operator at runtime and never committed; coverage/ and tmp-*/ are scratch.
  { ignores: ["specs/", ".agents/", ".specify/", "coverage/", "tmp-*/"] },
  ...base,
  {
    // `const { dropped, ...rest } = obj` is how this codebase omits a key, so
    // the named sibling of a rest element is unused on purpose.
    rules: { "no-unused-vars": ["error", { ignoreRestSiblings: true }] },
  },
  {
    files: ["__tests__/**"],
    languageOptions: { globals: { ...globals.node, ...globals.jest } },
  },
  {
    // Fixtures are source the engine parses, not code that runs: a component
    // declares props it never reads because the extractor reads the
    // declaration.
    files: ["__tests__/fixtures/**"],
    rules: {
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": "off",
    },
  },
]
