/**
 * required-checks.mjs — the one record of the contexts this repo's branch
 * rulesets require, and of the push-only jobs that must never be required.
 *
 * `__tests__/ci-workflow.test.js` holds it against `ci.yml`;
 * `check-ruleset.mjs` holds it against the live rulesets. Edit it here only.
 */

// The required_status_checks contexts on both design-delta rulesets. Each is
// `<job id> / ci` — `ci` because that is _reusable-node-ci.yml's own internal
// job id over in chrisgriffin/workflows.
//
// #327 REDUCED THIS FROM SEVEN TO FOUR. `action`, `format`, `package` and
// `schema` were four separate jobs doing 66 seconds of work between them, and
// GitHub bills each JOB rounded up to a whole minute — 4 billed for 1 of
// work. They are now one `checks` job.
//
// THE RULESET EDIT MUST LAND FIRST. A ruleset entry naming a check that can
// no longer report blocks every PR in this repo forever (found live). This list is the record of the contexts the
// rulesets require FROM ci.yml, so it changing is the signal that they have
// to change with it — that is the whole reason this module pins them. It is
// not the whole ruleset: a context another workflow reports is recorded in
// OTHER_REQUIRED_CHECKS below, so ci-workflow.test.js's job-id equality
// assertion stays about ci.yml alone.
export const REQUIRED_CHECKS = ["checks / ci", "test_22 / ci"]

// The rest of the live ruleset (26747072, "Require CI + Evaluator to pass",
// on develop and main; check-ruleset.mjs compares it live): each
// required context that a workflow other than ci.yml reports, keyed to that
// workflow's file.
// `Evaluator` is a commit status the reusable gate sets, not a `<job> / ci`
// check-run, so it never maps to a ci.yml job. ci-workflow.test.js pins only
// that the reporter exists; its name and its call to the public
// `_reusable-evaluator-gate.yml` are pinned in workflow-stubs.test.js
// ("evaluator-gate.yml — trigger stub"), not restated here.
export const OTHER_REQUIRED_CHECKS = { Evaluator: "evaluator-gate.yml" }

// THEN FOUR BECAME TWO. `test_24` and `test_26`
// still exist but run only on push to develop/main (`if:` on the job), and a
// skipped `uses:` job emits NO check-run — so they can never be required
// again without blocking every PR. They are the PUSH_ONLY set.
export const PUSH_ONLY = ["test_24", "test_26"]
