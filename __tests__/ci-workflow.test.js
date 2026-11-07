/**
 * `.github/workflows/ci.yml` centralized onto the shared `_reusable-node-ci.yml`
 * (hosted in the public chrisgriffin/workflows repo
 * (2026-08-22). First shipped with 7 mirror-job pairs (one per required
 * check), because a `uses:` job's check-run is renamed
 * `<caller job id> / <called job id>` and this repo's branch rulesets require
 * checks by exact old bare-name string. That's real overhead when
 * the ruleset can't be touched — but it CAN be here, so both rulesets were
 * updated (2026-08-22, via an admin identity) to require the new two-part
 * names directly, and the 7 mirror jobs were deleted: 7 checks for 7 real
 * jobs, not 14.
 *
 * What this locks: every job id maps to a check context (`<id> / ci`) that
 * matches what the LIVE ruleset actually requires — recorded in
 * scripts/ci/required-checks.mjs, which `node scripts/ci/check-ruleset.mjs`
 * compares against the live rulesets, not copied from the workflow file
 * itself, which would let a mismatch between the two agree with each other
 * and pass. Get the job id wrong and every PR
 * into this repo blocks forever on a check that can no longer report, same
 * failure shape as the mirror-job version was built to prevent — the risk
 * didn't go away when the shim did, it just moved to "the job id IS the
 * contract" instead of "the mirror job's name IS the contract".
 *
 * Text walk, matching workflow-timeouts.test.js's own reasoning: no YAML
 * parser in this repo's dependency tree, and these files are uniformly
 * indented enough that a job-level key is unambiguous from a step-level one.
 */
import { existsSync, readFileSync } from "fs"
import { join } from "path"

import {
  OTHER_REQUIRED_CHECKS,
  PUSH_ONLY,
  REQUIRED_CHECKS,
} from "../scripts/ci/required-checks.mjs"

const CI = readFileSync(
  join(process.cwd(), ".github", "workflows", "ci.yml"),
  "utf8",
)

function jobsIn(text) {
  const body = text.split(/\njobs:\n/)[1]
  const parts = body.split(/^ {2}([\w-]+):$/m).slice(1)
  const jobs = []
  for (let i = 0; i < parts.length; i += 2) {
    jobs.push({ id: parts[i], body: parts[i + 1] })
  }
  return jobs
}

const JOBS = jobsIn(CI)

describe("ci.yml reports every check the live ruleset requires, with no mirror overhead", () => {
  it("found jobs to check — an empty parse would make every assertion below vacuous", () => {
    expect(JOBS.length).toBeGreaterThan(0)
  })

  it("has exactly one job per required check plus the push-only matrix — no mirror job, no orphan", () => {
    // Both directions: a job with no ruleset entry burns minutes for a check
    // nothing gates on, and a ruleset entry with no job blocks every PR
    // forever. Equality is what catches the second one.
    expect(JOBS.map(j => j.id).sort()).toEqual(
      [...REQUIRED_CHECKS.map(c => c.split(" / ")[0]), ...PUSH_ONLY].sort(),
    )
  })

  for (const id of PUSH_ONLY) {
    it(`\`${id}\` runs on push only — never on a PR, where its skipped call would report nothing`, () => {
      const job = JOBS.find(j => j.id === id)
      expect(job).toBeDefined()
      expect(job.body).toMatch(
        /^ {4}if: github\.event_name != 'pull_request'$/m,
      )
      expect(REQUIRED_CHECKS).not.toContain(`${id} / ci`)
    })
  }

  it("every job calls the reusable workflow directly — nothing local to skip on", () => {
    for (const job of JOBS) {
      // Pinned to the `v1` release tag, never `@develop`: a push there must
      // not change this repo's CI without a release (#672).
      expect(job.body).toMatch(
        /^ {4}uses: chrisgriffin\/workflows\/\.github\/workflows\/_reusable-node-ci\.yml@v1$/m,
      )
      // A public repo's `uses:` of a private repo's workflow fails before a
      // job is scheduled. Only the public workflows repo is ever called.
      expect(job.body).toMatch(/^ {4}uses: chrisgriffin\/workflows\//m)
    }
  })

  for (const check of REQUIRED_CHECKS) {
    it(`some job id reports as \`${check}\``, () => {
      const [id] = check.split(" / ")
      expect(JOBS.some(j => j.id === id)).toBe(true)
    })
  }

  for (const [check, file] of Object.entries(OTHER_REQUIRED_CHECKS)) {
    it(`\`${check}\` is reported by \`${file}\`, which still exists`, () => {
      expect(REQUIRED_CHECKS).not.toContain(check)
      expect(
        existsSync(join(process.cwd(), ".github", "workflows", file)),
      ).toBe(true)
    })
  }

  it("every call job declares no secrets — every dependency here is public", () => {
    // CLAUDE.md: npm ci running with no registry token is load-bearing for
    // this repo going public. `secrets: inherit` "to match the other stubs"
    // is exactly the regression this guards.
    for (const job of JOBS) {
      expect(job.body).not.toMatch(/^ {4}secrets:/m)
    }
  })

  it("every call job grants packages: read — the callee's ceiling", () => {
    // _reusable-node-ci.yml declares `packages: read`, and for
    // workflow_call a callee asking for a scope above the caller's ceiling
    // fails the run outright (startup_failure, zero jobs, no check to
    // notice) rather than being capped. The grant is inert here — this repo
    // pulls nothing private — which is exactly why it's easy to delete as
    // dead weight. Same assertion shape as workflow-stubs.test.js
    // pins for release-pr.yml.
    for (const job of JOBS) {
      expect(job.body).toMatch(/^ {6}packages: read$/m)
    }
  })

  it("the test matrix covers node 22, 24, and 26 — no version silently dropped", () => {
    for (const v of ["22", "24", "26"]) {
      expect(CI).toMatch(new RegExp(`node_version: "${v}"`))
    }
  })

  it("the pull_request trigger fires on ready_for_review", () => {
    // The reusable workflow skips drafts. Without ready_for_review in the
    // trigger types, marking a draft PR ready never re-fires this workflow —
    // live failure mode in a sibling repo (raycast-capture #44, fixed in
    // #46); general case documented in shared/agents/build.md
    // § Reusable workflows item 4. Same assertion shape as
    // workflow-stubs.test.js's "fires on opened, reopened and
    // ready_for_review".
    const types = /types:\s*\[([^\]]*)\]/.exec(CI)
    expect(types).not.toBeNull()
    expect(
      types[1]
        .split(",")
        .map(t => t.trim())
        .sort(),
    ).toEqual(["opened", "ready_for_review", "reopened", "synchronize"])
  })
})
