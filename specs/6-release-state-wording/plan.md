# Plan: The npm description and README status describe design-delta as it is released

## Technical context

- One word in `package.json`'s `description`: `design-drift` becomes `design-delta`. `package-lock.json` carries no description, so it does not change.
- The README's status blockquote is reworded from the registry's answer, checked during the build: `https://registry.npmjs.org/design-delta` returns 404, and the repo has no `v0.27.0` tag or Release, so the note says 0.27.0 is released but not yet on npm and publishes from the next release. The closed #2 link goes, since it no longer describes a pending step.
- The README's history note about the 0.26.0 cut is untouched.
- The README's Install section says the npm install works once the package is on npm, so it does not contradict the status note above it.

## Surfaces touched

- `package.json` `description`: a published surface; npmjs.com shows it from the next publish. No other doc restates it.
- `README.md` status note and Install section: no other doc restates the release state (`docs/releasing.md` describes the mechanism, not the state).
- No workflow, ruleset, vault note, Routine or cron.
