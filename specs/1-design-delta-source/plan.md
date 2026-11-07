# Plan: design-delta is the engine's source at 0.26.0, renamed and released to npm from a public repo

## Technical context

- The tree is `git archive` of the source at its `v0.26.0` tag, minus `specs/` and `CHANGELOG.md`, laid into an empty checkout.
- One mechanical pass renames the package (`design-delta`), every `design-drift` identifier and path, the `DESIGN_DRIFT_` env prefix and the two skill directories, and rewrites what a public repo never carries: private sibling repo names, operator issue references, attributed decisions and competitor comparisons. The pass is text only; `package-lock.json` changes in its own `name` and `license` fields alone.
- The seven workflow stubs are rewritten in the public shape: short comments, `chrisgriffin/workflows@v1`, secrets by name. `ci.yml` keeps the source's job layout (`checks`, `test_22`, push-only `test_24`/`test_26`) and passes `docs_owed: ""`, since a public repo carries no fleet doc template. The branch rulesets require `checks / ci`, `test_22 / ci` and `Evaluator`, updated before this change (`scripts/ci/required-checks.mjs` records them).
- `publish.yml` becomes the manual npmjs retry with `NPM_TOKEN`; `create-github-release.yml` passes `npm_registry_url`, `npm_scope: ""` and `NPM_TOKEN`; `package.json`'s `publishConfig` names the same registry.
- `__tests__/workflow-stubs.test.js` asserts secrets by name instead of `secrets: inherit`; `__tests__/ci-workflow.test.js` asserts every call targets the public workflows repo.
- `.claude/settings.json` and the two hooks come from the public sibling that already runs this shape.
- Docs: `docs/ci.md` and `docs/adr/README.md` rewritten; `docs/releasing.md`, `docs/architecture.md`, `docs/testing.md` lose their fleet template markers and describe the public registry; `docs/github-action.md` drops the registry-auth setup; `README.md` gains Install; `CLAUDE.md`'s harness section names only the public workflow repo.
- The two generated docs are regenerated; the suite, Prettier, the schema check, the package check and the action check all run locally before the PR.

## Surfaces touched

- `package.json`: name, license, repository, publishConfig, description. A new published package; no consumer exists yet.
- `.github/workflows/*`: all seven stubs. CI runs on this PR; the release stubs run on the first `release/next` merge (#2).
- Branch rulesets: required checks updated to the source's names before this PR.
- `README.md`, `CLAUDE.md`, `docs/`, `skills/`: the public wording and the registry.
- No vault note, Routine or cron.
