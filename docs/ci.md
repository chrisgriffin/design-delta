# CI

The job layout behind `CLAUDE.md` § CI, which states only what a session runs
and the traps it can hit.

## Jobs

`.github/workflows/ci.yml` runs on every PR into `develop`/`main`, and on
pushes to `main` — not `develop`, whose every commit a PR already checked.
Four independent jobs, two of them required checks.

`test_22`, `test_24` and `test_26` are three separate jobs rather than a
`strategy.matrix` on one, because each calls the shared reusable workflow with
its own `node_version` input. `test_24` and `test_26` run on a push to `main`
or a manual run, never on a PR: about 7 billed minutes per PR push for a version skew that has never
differed from 22. The four fast checks share one `checks` job because GitHub
bills every job rounded up to a whole minute and they did 66 seconds of work
between them. The commands run cheapest-first as one shell block, so the
first failure fails the job.

## Thin stubs

Every job `uses:` the shared `_reusable-node-ci.yml`, hosted in the public
[chrisgriffin/workflows](https://github.com/chrisgriffin/workflows) repo, for
its actual work — 4 jobs, 2 required checks, no mirror overhead. Both branch
rulesets require the checks by their `<job id> / ci` names directly, rather
than pairing each `uses:` job with a plain job that exists only to keep an
old bare check name alive.

## The required-check list

`checks / ci` + `test_22 / ci`, plus `Evaluator`, the commit status the PR
review gate sets. A `uses:` job skipped by its `if:` emits no check-run at
all, so the push-only `test_24` and `test_26` can never be required without
blocking every PR.

**A ruleset edit has to land _before_ the workflow change that renames or gates
a check**, or every PR blocks forever on a check that can no longer report.
`__tests__/ci-workflow.test.js` locks the job-id-to-check mapping and the
push-only pair against the record in `scripts/ci/required-checks.mjs`.

## Checking the record against the live rulesets

That record is typed in by hand, so a ruleset edit leaves it stale with every
test green. Compare it live:

```bash
GH_TOKEN=<token> node scripts/ci/check-ruleset.mjs
```

It reads every active ruleset on the repo `package.json` names and exits `1`
naming each context the rulesets require that the record does not pin, each
pinned context no ruleset requires, and the ruleset each came from; `0` when
they agree. `GITHUB_TOKEN` works too. The token needs only read access to this
repo's rulesets: `metadata: read` for a fine-grained token or GitHub App, the
`repo` scope for a classic token.

It is deliberately **not** one of the `checks` job's commands: every other
command there runs with no token, and a required check that cannot run on a
fork PR is the same class of breakage this script exists to catch. It is run
by hand.
