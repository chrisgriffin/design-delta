# Plan: A design-delta version bump is the whole skill update

## Technical context

- `src/cli/commands/dock.mjs`: `renderSkillStubTemplate` hard-codes the router description, a second copy of the packaged router's. It reads the packaged one instead, through the same helper `renderPackagedSkillStubTemplate` uses.
- `skills/design-delta/SKILL.md`: the description widens to every kind of design-delta work and says to use it for any design-delta request, which it routes to the right procedure skill.
- `--check`: each template is compared with what is on disk without writing. States: `up-to-date`, `stale`, `missing`, `skipped` (consumer-owned) and `absent` (the hook or verify skill, which only `dock` writes and `init` never does, not written at all). `stale` or `missing` exits 1.
- `__tests__/skill-descriptions.test.js` pins the router's and every `LINKED_SKILLS` description.
- `action.yml`: a `check-skills` input; when `"true"`, a step runs `npx --yes design-delta dock --check` before `verify`.

## Surfaces touched

- `src/cli/commands/dock.mjs`, `skills/design-delta/SKILL.md`.
- `__tests__/cli-dock.test.js`, new `__tests__/skill-descriptions.test.js`.
- `action.yml` `inputs:` and `docs/github-action.md`'s Inputs table, together (CLAUDE.md § Architecture; `__tests__/docs-parity.test.js`).
- Published surface: the `dock` command gains `--check` and a `--json` shape for it; the Action gains an input. `README.md` § Agent skills and `docs/cli.md` § `dock` updated. CHANGELOG is written by the release workflow from the `feat:` commit.
- Additive: an existing consumer's `dock` re-run rewrites the router stub with the new description; nothing they own is touched.
- No workflow, ruleset, required check, cron, vault note or Routine; no directory added under `src/`; no added cost.
