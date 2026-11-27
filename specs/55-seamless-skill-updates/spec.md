# Spec: A design-delta version bump is the whole skill update

Issue: #55. Agreed on #50.

## Problem

Every stub `dock`/`init` writes points into `node_modules`, so a version bump
already updates every procedure. Two things are copied into the consumer's
repo and go stale on a bump: a skill added in a release has no stub until
`dock` runs again, and a stub's copied `description` drifts from the packaged
one. Nothing reports either, so they go stale quietly.

## Approach

- The router stub (`skills/design-delta/SKILL.md`) is the one stub every
  consumer has. Its description becomes broad and stable, read from the
  packaged router like every other stub's, and the packaged router lists every
  procedure skill, so a skill added in a release is reached through it.
- A test pins every linked skill's description, so one changes only on
  purpose.
- `dock --check` reports a missing or stale stub with exit 1, and the Action
  can run it.

## Success criteria

- The packaged router skill's `description` covers any design-delta work (audits, contracts, building a component to its contract, documentation, tokens, the design tool), and the router stub `dock`/`init` write reads it from the packaged router instead of restating it.
- A test fails, naming the skill, when any packaged skill a stub links has its `description` changed, added or removed without updating the pinned copy, and the failure says consumers keep the old one until they re-run `dock`.
- `design-delta dock --check` writes nothing and exits 1 when a linked stub is missing or stale, or a hook or verify skill `dock` wrote is stale; it exits 0 when all are current, and a consumer-owned file (`skipped`) or a hook/verify skill never written does not fail it. `--json` reports each file's state.
- The GitHub Action takes an opt-in `check-skills` input (default `"false"`) that runs `dock --check`, documented in `docs/github-action.md`.
- `README.md` § Agent skills and `docs/cli.md` § `dock` say a version bump updates every procedure, the router reaches a skill added in a release, and `dock --check` catches a stale stub.
- **Runnable:** `npm run verify` exits 0.

## Out of scope

- A Claude Code plugin, and running `dock` from `postinstall` or a hook: ruled out on #50.
