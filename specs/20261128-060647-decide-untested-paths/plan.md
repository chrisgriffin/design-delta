# Plan: Test the two `decide` paths that write nothing

Spec: [spec.md](./spec.md).

- Export `save` from `src/cli/commands/decide.mjs` as `saveAnswers`, so the
  schema guard can be driven with a state whose config is already invalid:
  no real answer can produce one, since `applyAnswers` only appends valid
  exemption entries. The guard stays as a backstop.
- SIGINT test: start `runDecide` on port 0, wait for its address, emit
  `SIGINT` on `process`, await 130, compare both files' bytes.

## Surfaces touched

- `src/cli/commands/decide.mjs` — `save` exported as `saveAnswers`, no behavior change
- `__tests__/cli-decide.test.js` — the two tests
- published surface — none: `saveAnswers` is not in the package's `exports`
- migration — none
- cost — none
- ops after-merge issue — none owed
