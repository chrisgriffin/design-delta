/**
 * A GitHub Actions job with no `timeout-minutes` inherits GitHub's default
 * ceiling of SIX HOURS. That is not a theoretical bill: an intermittent hang
 * in `conventional-recommended-bump` stalled five runs of the shared
 * `_reusable-release-pr.yml` — four of them this repo's — and each burned the
 * full 6h before being force-cancelled, 1,824 billed minutes in one 48-hour
 * window.
 *
 * The fix is one line per job, which is exactly the kind of line a new
 * workflow forgets. This walks the directory rather than a hardcoded list so
 * a workflow added tomorrow is covered without anyone remembering to add it
 * here.
 *
 * Deliberately a text walk, not a YAML parse: this repo ships no YAML parser,
 * and `workflow-stubs.test.js` already asserts on these same files
 * as text. Indentation is what makes the two distinctions readable, and these
 * files are uniform — `jobs:` at column 0, job ids at two spaces, job-level
 * keys at four. A job-level `uses:` sits at four spaces where a step's `- uses:`
 * sits at six; a job-level `timeout-minutes:` at four where a step's sits at
 * eight. Matching the exact indent is what keeps a step-level timeout from
 * being miscounted as a job-level one.
 *
 * ponytail: regex, not a parser — swap in js-yaml if these files ever grow
 * anchors, flow mappings, or quoted job ids.
 */
import { readdirSync, readFileSync } from "fs"
import { join } from "path"

const WORKFLOWS = join(process.cwd(), ".github", "workflows")
const FILES = readdirSync(WORKFLOWS).filter(f => f.endsWith(".yml"))

function jobsIn(file) {
  const body = readFileSync(join(WORKFLOWS, file), "utf8").split(/\njobs:\n/)[1]
  if (!body) return []
  // split() with a capture group interleaves [preamble, id, chunk, id, chunk…]
  const parts = body.split(/^ {2}([\w-]+):$/m).slice(1)
  const jobs = []
  for (let i = 0; i < parts.length; i += 2) {
    jobs.push({ id: parts[i], body: parts[i + 1] })
  }
  return jobs
}

// A job that calls a reusable workflow: GitHub rejects `timeout-minutes` on
// one outright, so its cap belongs on the called workflow in the shared workflows repo.
const isCall = job => /^ {4}uses:/m.test(job.body)

describe("workflow job timeouts", () => {
  it("the walk actually finds both kinds of job", () => {
    // Without this, a broken split would find zero jobs and the assertion
    // below would pass vacuously — a guard that always passes is worse than
    // no guard, because it reads like coverage.
    const all = FILES.flatMap(jobsIn)
    // 6 since evaluator-trigger.yml went with the Evaluator routine;
    // 7 before that, when request-reviewer.yml became CODEOWNERS.
    expect(FILES.length).toBeGreaterThanOrEqual(6)
    // The non-call floor was 7 while ci.yml carried 7 mirror jobs pairing
    // each `uses:` call with a plain job that only existed to keep an old
    // required-check name alive (GitHub renames a `uses:`
    // job's check-run, and a ruleset requires checks by exact string). Those
    // mirrors were deleted 2026-08-22 once both of this repo's rulesets were
    // updated to require the NEW `<job id> / ci` names directly — see
    // ci-workflow.test.js.
    //
    // It dropped to 1 again on 2026-08-23 when pr-issue-reference.yml was
    // deleted fleet-wide — it had been carrying the
    // last mirror job. `publish.yml` is now the only workflow here with a
    // plain `runs-on:` job, so it alone keeps the timeout guard below
    // non-vacuous. If publish.yml ever becomes a `uses:` call too, that
    // guard stops asserting anything and should be deleted rather than left
    // reading like coverage.
    expect(all.filter(j => !isCall(j)).length).toBeGreaterThanOrEqual(1)
    expect(all.filter(isCall).length).toBeGreaterThanOrEqual(7)
  })

  it("every job that isn't a reusable-workflow call declares timeout-minutes", () => {
    const missing = []
    for (const file of FILES) {
      for (const job of jobsIn(file)) {
        if (isCall(job)) continue
        if (!/^ {4}timeout-minutes: \d+$/m.test(job.body)) {
          missing.push(`${file} → ${job.id}`)
        }
      }
    }
    expect(missing).toEqual([])
  })
})
