# Plan: The README says design-delta is on npm

## Technical context

- Checked during the build: `https://registry.npmjs.org/design-delta` lists `latest: 0.27.0`, published 2026-11-10.
- The status blockquote loses its first sentence (released but not on npm, publishes from the next release); the ADR-001 pointer and the 0.26.0 history note stay as they are. No version number goes back in, so nothing is left to go stale on the next release.
- § Install loses its "Once the package is on npm" lead-in; the commands and the no-auth line stay.
- No test pins this text, so this is a README-only edit.

## Surfaces touched

- `README.md` status note and § Install: no other doc restates the release state (`docs/releasing.md` describes the mechanism, not the state; grep for "on npm" finds only these two lines).
- No workflow, ruleset, vault note, Routine or cron.
