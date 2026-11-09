#!/usr/bin/env node
/**
 * check-ruleset.mjs — compare the pinned required-check record against the
 * live branch rulesets (#607).
 *
 * `required-checks.mjs` records the contexts this repo's rulesets require,
 * and `__tests__/ci-workflow.test.js` holds that record against `ci.yml` — but
 * only this script holds it against the rulesets themselves. A stale pin
 * passes every test (#596), and a ruleset entry naming a check nobody reports
 * blocks every PR in this repo forever.
 *
 * Reads every active ruleset on the repo `package.json` names, then reports
 * each disagreement: a context some ruleset requires that the record does not
 * pin, and a pinned context no ruleset requires any more. Exits 1 on any,
 * 0 when they agree. Needs `GH_TOKEN` or `GITHUB_TOKEN`; deliberately not a
 * `checks` job command — see docs/ci.md.
 */

import { spawnSync } from "child_process"
import { readFileSync } from "fs"
import { dirname, join } from "path"
import { fileURLToPath } from "url"

import { OTHER_REQUIRED_CHECKS, REQUIRED_CHECKS } from "./required-checks.mjs"

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..")

/** The contexts a ruleset's `required_status_checks` rules require. */
export function requiredContexts(ruleset) {
  return (ruleset.rules ?? [])
    .filter(rule => rule.type === "required_status_checks")
    .flatMap(rule => rule.parameters?.required_status_checks ?? [])
    .map(check => check.context)
}

/**
 * Pure: `pinned` is a list of contexts, `rulesets` a list of
 * `{ id, name, contexts }`. Returns one `{ context, direction, rulesets }` per
 * disagreement — `unpinned` with the rulesets that require it, or `stale`
 * with the rulesets read, none of which require it. A ruleset requiring a
 * subset of the pin is not a disagreement: the pin records what any requires.
 */
export function diffRulesets(pinned, rulesets) {
  const pinnedSet = new Set(pinned)
  const unpinned = new Map()
  for (const ruleset of rulesets) {
    for (const context of ruleset.contexts) {
      if (pinnedSet.has(context)) continue
      if (!unpinned.has(context)) unpinned.set(context, [])
      unpinned.get(context).push(ruleset)
    }
  }
  const required = new Set(rulesets.flatMap(r => r.contexts))
  return [
    ...[...unpinned].map(([context, from]) => ({
      context,
      direction: "unpinned",
      rulesets: from,
    })),
    ...pinned
      .filter(context => !required.has(context))
      .map(context => ({ context, direction: "stale", rulesets })),
  ]
}

function explain({ context, direction, rulesets }) {
  const names = rulesets.map(r => `${r.id} "${r.name}"`).join(", ")
  return direction === "unpinned"
    ? `required but not pinned: "${context}" — required by ${names}`
    : `pinned but no longer required: "${context}" — not required by ${names}`
}

function repoSlug() {
  const pkg = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8"))
  const match = /github\.com[/:]([^/]+\/[^/.]+)/.exec(pkg.repository?.url ?? "")
  if (!match)
    throw new Error("package.json repository.url names no GitHub repo")
  return match[1]
}

async function api(path, token) {
  const res = await fetch(`https://api.github.com${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  })
  if (!res.ok) {
    throw new Error(`GET ${path} → ${res.status} ${await res.text()}`)
  }
  return res.json()
}

async function main() {
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN
  if (!token) {
    console.error(
      "check-ruleset: set GH_TOKEN or GITHUB_TOKEN to a token that can read this repo's rulesets (docs/ci.md)",
    )
    return 2
  }
  const slug = repoSlug()
  const list = await api(`/repos/${slug}/rulesets?per_page=100`, token)
  const rulesets = []
  for (const { id, name, enforcement } of list) {
    if (enforcement !== "active") continue
    const detail = await api(`/repos/${slug}/rulesets/${id}`, token)
    rulesets.push({ id, name, contexts: requiredContexts(detail) })
  }
  const pinned = [...REQUIRED_CHECKS, ...Object.keys(OTHER_REQUIRED_CHECKS)]
  const diffs = diffRulesets(pinned, rulesets)
  if (diffs.length === 0) {
    console.log(
      `check-ruleset: ${rulesets.length} active ruleset(s) on ${slug} agree with scripts/ci/required-checks.mjs`,
    )
    return 0
  }
  for (const diff of diffs) console.error(`check-ruleset: ${explain(diff)}`)
  console.error(
    "check-ruleset: update scripts/ci/required-checks.mjs or the ruleset — a ruleset edit lands before the workflow change (CLAUDE.md § CI)",
  )
  return 1
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const proxy = process.env.HTTPS_PROXY || process.env.https_proxy
  if (proxy && !process.env.NODE_USE_ENV_PROXY) {
    // Node 22's fetch ignores HTTPS_PROXY unless NODE_USE_ENV_PROXY is set at
    // startup, so re-run once with it — a proxied sandbox reaches nothing
    // otherwise.
    const child = spawnSync(
      process.execPath,
      ["--disable-warning=UNDICI-EHPA", ...process.argv.slice(1)],
      { stdio: "inherit", env: { ...process.env, NODE_USE_ENV_PROXY: "1" } },
    )
    process.exit(child.status ?? 1)
  }
  main().then(
    code => process.exit(code),
    err => {
      console.error(`check-ruleset: ${err.message}`)
      process.exit(2)
    },
  )
}
