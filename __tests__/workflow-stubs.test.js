/**
 * Every workflow this repo carries is a thin trigger stub: the job bodies
 * live in reusable workflows in the public chrisgriffin/workflows repo and
 * are tested there. What is worth locking here is what only the caller can
 * get wrong: that each stub still triggers correctly, still calls the right
 * reusable workflow, still passes its secrets by name (never
 * `secrets: inherit`, which would hand a public repo's every secret to the
 * callee), and still grants the token scopes its called body needs. A called
 * workflow can only narrow the caller's GITHUB_TOKEN, never widen it, so a
 * dropped `permissions:` block on this side downgrades every job in the
 * called workflow to this repo's default and the writes fail silently.
 *
 * What the `uses:` assertions below deliberately do NOT prove: that the
 * workflow on the other end of that string exists. They are text matches on
 * another repo's path, and reaching for the network would cost the suite its
 * determinism. A stub pointing at a workflow that was never merged passes
 * every test in this file and then fails at dispatch time with zero jobs
 * scheduled, which surfaces as a *missing* check on the PR rather than a red
 * one. The only real verification is the called job's check appearing on a
 * PR here.
 */
import { existsSync, readFileSync } from "fs"
import { join } from "path"

const WORKFLOWS = join(process.cwd(), ".github", "workflows")

// A stub names each secret it passes; `secrets: inherit` never appears.
const SECRETS_BY_NAME =
  /^ {4}secrets:\n {6}[A-Z_]+: \$\{\{ secrets\.[A-Z_]+ \}\}$/m

function workflowText(name) {
  return readFileSync(join(WORKFLOWS, `${name}.yml`), "utf8")
}

describe("claude-mention.yml — trigger stub", () => {
  const SOURCE = workflowText("claude-mention")

  it("fires on every thread event only this repo can observe", () => {
    for (const event of [
      "issue_comment",
      "pull_request_review_comment",
      "pull_request_review",
      "issues",
    ]) {
      expect(SOURCE).toMatch(new RegExp(`^ {2}${event}:$`, "m"))
    }
  })

  it("calls the public reusable workflow with the target and secrets by name", () => {
    expect(SOURCE).toContain(
      "uses: chrisgriffin/workflows/.github/workflows/_reusable-claude-mention.yml@v1",
    )
    expect(SOURCE).toContain("target: design-delta")
    expect(SOURCE).toMatch(SECRETS_BY_NAME)
  })

  it("grants the write scopes the called job needs", () => {
    // Without them the 👀 reaction and the "couldn't dispatch"
    // comment run at this repo's default and fail silently.
    expect(SOURCE).toMatch(
      /^permissions:\n {2}issues: write\n {2}pull-requests: write$/m,
    )
  })
})

describe("sync-main-to-develop.yml — trigger stub", () => {
  const SOURCE = workflowText("sync-main-to-develop")

  it("triggers on push to main", () => {
    expect(SOURCE).toMatch(/^ {4}branches: \[main\]$/m)
  })

  it("calls the public reusable workflow with secrets by name", () => {
    expect(SOURCE).toContain(
      "uses: chrisgriffin/workflows/.github/workflows/_reusable-sync-main-to-develop.yml@v1",
    )
    expect(SOURCE).toMatch(SECRETS_BY_NAME)
  })

  it("grants the write scopes the called job needs", () => {
    // The called job pushes the merge-back to develop and opens the conflict
    // PR when the merge fails.
    expect(SOURCE).toMatch(
      /^ {4}permissions:\n {6}contents: write\n {6}pull-requests: write$/m,
    )
  })
})

// release-pr.yml's job body lives in the shared _reusable-release-pr.yml;
// the reviewer-request and no-re-request-on-edit invariants are tested there.
describe("release-pr.yml — trigger stub", () => {
  it("triggers on push to develop and calls the public reusable workflow", () => {
    const text = workflowText("release-pr")
    expect(text).toContain("- develop")
    expect(text).toContain(
      "uses: chrisgriffin/workflows/.github/workflows/_reusable-release-pr.yml@v1",
    )
    expect(text).toMatch(SECRETS_BY_NAME)
  })

  it("grants the scopes the called job needs", () => {
    // The called body pushes release/next and opens/edits the PR. Without the caller's grant the whole
    // workflow_call is capped at this repo's default — and unlike the other
    // stubs this one only ever runs on push to develop, so the failure never
    // surfaces as a red check on a PR.
    expect(workflowText("release-pr")).toMatch(
      /^ {4}permissions:\n {6}contents: write\n {6}pull-requests: write\n {6}statuses: write$/m,
    )
  })
})

// create-github-release.yml.
//
// What only the CALLER can get wrong is whether it triggers at all: a
// caller `if:` is evaluated before the call, so a condition that misses
// means the reusable workflow is never reached and the release simply does
// not happen — silently, with a green check.
describe("create-github-release.yml — trigger stub", () => {
  const text = workflowText("create-github-release")

  it("fires on a merged PR into main, and leaves the branch policy to the called workflow", () => {
    // `merged` stays local: without it the stub calls the release workflow on
    // every closed PR into main, merged or not, reaching the secrets it passes
    // for a PR that was abandoned.
    expect(text).toContain("github.event.pull_request.merged == true")
    expect(text).toMatch(/types:\s*\[closed\]/)
    expect(text).toMatch(/branches:\s*\[main\]/)

    // WHICH BRANCHES cut a release must NOT be restated here. It lived in this stub and four others, so
    // teaching the loop about hotfix/ took five PRs — each needing to reach
    // its own repo's main before it counted, and two releases were missed
    // while they had not. It lives once in the shared reusable workflow now.
    expect(text).not.toContain("startsWith(github.event.pull_request.head.ref")
  })

  it("calls the public reusable workflow with secrets by name", () => {
    expect(text).toContain(
      "uses: chrisgriffin/workflows/.github/workflows/_reusable-create-github-release.yml@v1",
    )
    expect(text).toMatch(SECRETS_BY_NAME)
  })

  it("grants the write scope the release needs", () => {
    // For workflow_call the caller's grant is the ceiling — a called
    // workflow can drop permissions but never add them.
    expect(text).toMatch(/^ {4}permissions:\n {6}contents: write$/m)
  })
})

// evaluator-autofix.yml is gone:
// review loop is one dispatcher now, and the gate reads `/autofix` itself —
// there is no separate comment-only stub to trigger it.
describe("evaluator-autofix.yml — removed", () => {
  it("does not exist", () => {
    expect(existsSync(join(WORKFLOWS, "evaluator-autofix.yml"))).toBe(false)
  })
})

// evaluator-gate.yml — the PR review loop's one dispatcher. It reads the loop's recorded state from
// the PR's comments and sets the required `Evaluator` status itself; there is
// no separate CI-completion or review-submitted trigger any more.
describe("evaluator-gate.yml — trigger stub", () => {
  const text = workflowText("evaluator-gate")

  it("is named `Evaluator`, the required status name", () => {
    expect(text).toMatch(/^name: Evaluator$/m)
  })

  it("calls the public reusable workflow with secrets by name", () => {
    expect(text).toContain(
      "uses: chrisgriffin/workflows/.github/workflows/_reusable-evaluator-gate.yml@v1",
    )
    expect(text).toMatch(SECRETS_BY_NAME)
  })

  it("fires only on pull_request and issue_comment — no workflow_run, no pull_request_review", () => {
    // The old CI-completion and review-submitted triggers moved into the
    // dispatcher's own recorded state; a called workflow reacts to comment
    // edits now, not to a separate CI run finishing.
    expect(text).toMatch(
      /^ {2}pull_request:\n {4}types: \[opened, reopened, ready_for_review, converted_to_draft, synchronize\]$/m,
    )
    expect(text).toMatch(
      /^ {2}issue_comment:\n {4}types: \[created, edited\]$/m,
    )
    expect(text).not.toContain("workflow_run")
    expect(text).not.toContain("pull_request_review:")
  })

  it("job is named `evaluator`, so the check-run reads `evaluator / gate`", () => {
    expect(text).toMatch(/^ {2}evaluator:$/m)
  })

  it("grants exactly the four scopes the called workflow declares", () => {
    // A callee asking above the caller's ceiling fails the call outright.
    expect(text).toMatch(
      /^permissions:\n {2}contents: read\n {2}issues: write\n {2}pull-requests: write\n {2}statuses: write$/m,
    )
  })

  // Who may post a verdict is policy, not per-repo config, so the guard
  // lives in the called workflow.
  it("carries no logic — the guard lives in the called workflow", () => {
    expect(text).not.toMatch(/^\s*if:/m)
    expect(text).not.toContain("github.event.comment.user.login")
  })

  it("re-runs on an EDITED comment — that is how the loop reports", () => {
    expect(text).toMatch(/issue_comment:\n\s+types: \[created, edited\]/)
  })
})
