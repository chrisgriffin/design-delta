# Releasing

A release of this repo publishes the `design-delta` package to
the public npm registry, at a `vX.Y.Z` tag with a GitHub Release.

## How a release happens

1. Work merges into `develop` through a PR.
2. Every push to `develop` runs `release-pr.yml`. It computes the next
   version from the Conventional Commits since the last `vX.Y.Z` tag,
   updates `package.json` and `CHANGELOG.md`, and keeps one rolling
   `release/next` PR into `main` up to date. A push that only merges `main`
   back into `develop` has nothing to release and changes nothing.
3. A human merges `release/next` into `main`. That merge is the release.
4. The merge runs `create-github-release.yml`, which tags `vX.Y.Z` and
   creates the GitHub Release from that version's `CHANGELOG.md` entry,
   along with anything this repo builds or publishes (below).
5. `sync-main-to-develop.yml` merges `main` back into `develop`. When the
   merge conflicts, or `develop`'s ruleset refuses the push, it opens a
   `sync/main-to-develop-*` PR instead, for a human to merge.

All three files are thin stubs calling the shared release workflows in the
public `chrisgriffin/workflows` repo.

## Versioning

- `feat` is a minor bump; `fix`, `perf` and every other type are a patch; a
  `type!:` subject or a `BREAKING CHANGE:` footer is a major, or a minor
  while the version is below `1.0.0`.
- Tags are bare `vX.Y.Z`.
- `release-pr.yml` pushes and opens the release PR with `RELEASE_PR_TOKEN`,
  a personal access token, because GitHub starts no workflows for events
  created by the built-in `GITHUB_TOKEN`: without it, the release PR's
  checks never run on their own.

## Hotfixes

A hotfix is only a change the maintainer calls a hotfix. It branches off `main` as
`hotfix/<name>`, opens its PR into `main`, and bumps the patch version and
adds its `CHANGELOG.md` entry in that same PR, because it never passes
through `release-pr.yml`. Merging it runs steps 4 and 5 above.

## What this repo ships

- The `design-delta` npm package, published to the public npm registry
  (`https://registry.npmjs.org`, unscoped) with the `NPM_TOKEN` secret by
  step 4's own job —
  not a separate workflow reacting to `release: published`, for the same
  `GITHUB_TOKEN` reason the fixed text gives above.
- The package carries `src/`, `schema/`, `docs/` and `skills/`
  (`package.json`'s `files`), and exposes the single `design-delta` bin.
- The tag is also what a consumer pins `action.yml`, this repo's composite
  GitHub Action, to — see [the GitHub Action reference](./github-action.md).

## Manual steps

- None in the normal path: merging `release/next` tags, releases and
  publishes in one job.
- `publish.yml` is a manual `workflow_dispatch` escape hatch, for re-running
  the publish alone when step 4's publish needs a retry without re-cutting
  the release.
- Never hand-bump `version`, and never write a `BREAKING CHANGE:` footer or a
  `type!:` subject (decided 2026-08-03). This package stays `0.x` until it is
  stable, and `0.x` promises no compatibility, so the marker adds nothing
  below `1.0.0`, where the rules above make it a minor. Describe a breaking
  change in the commit body and the PR instead.
