// Changelog preset config for conventional-changelog-cli.
// Wraps the `conventionalcommits` preset and overrides the `types` list so
// every conventional-commit type gets its own section in CHANGELOG.md and
// the release PR body — instead of the angular preset's default
// (feat/fix/perf only, plus reverts).
//
// Used by .github/workflows/release-pr.yml and the `changelog` npm scripts.
// Pass via `-n ./changelog-preset.config.mjs` (without `-p`, since the
// preset is loaded inside this file). Using `-p` alongside `-n` would cause
// conventional-changelog to overwrite this config with the bare preset.
//
// Version bumps are still computed by `conventional-recommended-bump -p
// conventionalcommits`, so chore/docs/style/ci do NOT trigger a release on
// their own — they "ride along" with the next feat/fix/perf bump and now
// show up in the changelog under their own sections.
//
// Ported from a sibling repo's changelog-preset.config.mjs — that repo also
// wraps the writer transform to drop non-keyword issue mentions (its bot
// recaps otherwise auto-close issues they only reference). This repo has no
// equivalent auto-referencing bot, so that
// transform is intentionally not ported here.

import createPreset from "conventional-changelog-conventionalcommits"

export default await createPreset({
  types: [
    { type: "feat", section: "Features" },
    { type: "fix", section: "Bug Fixes" },
    { type: "perf", section: "Performance Improvements" },
    { type: "revert", section: "Reverts" },
    { type: "refactor", section: "Code Refactoring" },
    { type: "docs", section: "Documentation" },
    { type: "style", section: "Styles" },
    { type: "test", section: "Tests" },
    { type: "build", section: "Build System" },
    { type: "ci", section: "Continuous Integration" },
    { type: "chore", section: "Chores" },
  ],
})
