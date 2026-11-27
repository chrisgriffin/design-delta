/**
 * dock.mjs — the `design-delta dock` subcommand (issue #221): scaffold
 * generic Claude Code artifacts into a consumer's own `.claude/` — a hook,
 * a verify skill and a linked stub per consumer-facing packaged skill — that
 * wrap `verify --json` for agent self-correction and link the consumer to
 * this package's canonical skill and each procedure skill beside it.
 *
 *   design-delta dock [--dir <path>] [--check] [--json]
 *
 * `--check` (#55) writes nothing: it exits 1 when a generated file is
 * missing or stale against the installed package, so a version bump that
 * needs a `dock` re-run fails a CI check instead of going stale quietly.
 *
 * WHY THIS EXISTS. `verify --json` already gives an agent a machine-readable
 * pass/fail; what a consumer lacks is the Claude Code wiring that calls it
 * after every edit and skill guidance that tells an agent to. `dock` emits
 * both as plain files — it never calls out to Claude Code itself, and the
 * generated artifacts live in the CONSUMER repo (default `.claude/`, same
 * directory `init`'s suggested npm scripts already assume a project has).
 *
 * The templates: the hook, the verify skill, and the linked stubs — one
 * pointing at the canonical audit skill, one at each skill `LINKED_SKILLS`
 * names. `init` writes every linked stub too: `linkedStubTemplates` and
 * `writeTemplateFile` are exported for that — `init` invokes `dock`'s own
 * templates + writer rather than growing a second scaffold path, per the
 * grooming note on #336. The hook and the verify skill stay `dock`'s alone:
 * they change how an agent behaves and need wiring. The doctor skill has no
 * stub on purpose: it is the maintainer's procedure and takes a target
 * project a generated file cannot know.
 *
 * GENERIC ONLY — CLAUDE.md's non-negotiable rule. Every path, command, and
 * name in the templates below is either a literal `design-delta` CLI
 * invocation or a placeholder a consumer fills in themselves (the
 * `PostToolUse` matcher in the hook's own doc-comment); nothing here names a
 * project, a component, or a file this package does not itself define.
 *
 * ALWAYS OVERWRITES — with one exception. Unlike `init` (which merges into a
 * hand-edited config) these are generated templates with no user content to
 * preserve — same posture the deleted `codegen --write` took (issue #400). `dock`
 * is meant to be re-run after an engine upgrade to pick up template changes.
 *
 * The exception is the linked stubs (issue #336; each `LINKED_SKILLS` stub
 * follows the same rule for the same reason). `skills/design-delta/` is
 * the natural name a consumer's OWN hand-maintained skill occupies — unlike
 * `skills/design-delta-verify/` and `hooks/design-delta-verify.mjs`, which
 * this package named for itself — so writing it unconditionally would
 * silently destroy a file the package does not own. Its write is therefore
 * guarded by `GENERATED_MARKER`: an existing file without that marker is
 * left untouched and reported as `skipped`. Fail-safe by construction — if
 * the marker text is ever reworded, previously generated stubs stop looking
 * generated and are skipped rather than clobbered.
 *
 * Two stream invariants (D8), matching every other subcommand: progress goes
 * to stderr (unused here — file writes are fast enough to need none), and
 * `--json` writes ONE JSON document to stdout and nothing else.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, isAbsolute, join } from "node:path"
import { fileURLToPath } from "node:url"

import { parseFlags } from "../flags.mjs"

export const FLAG_SPEC = { boolean: ["--json", "--check"], value: ["--dir"] }

export const DEFAULT_DIR = ".claude"

const HOOK_RELATIVE_PATH = "hooks/design-delta-verify.mjs"
const SKILL_RELATIVE_PATH = "skills/design-delta-verify/SKILL.md"
// The linked stub (issue #336) — distinct from SKILL_RELATIVE_PATH above:
// that one teaches an agent to run `verify`/`lint`, this one just points at
// the packaged canonical skill (`skills/design-delta/SKILL.md` in this
// package) so its name matches the canonical skill's own.
export const SKILL_STUB_RELATIVE_PATH = "skills/design-delta/SKILL.md"
// The other linked stubs: one per packaged procedure skill
// (`skills/<name>/SKILL.md` in this package), in the order `dock` writes
// them. Same shape and same guard as the stub above — a pointer, never a
// copy of the procedure. Adding a name here writes its stub, and two other
// files pin this list and change with it: the procedure-skill loop and the
// stub-count floor in `scripts/ci/check-package.sh`, and the `LINKED_SKILLS`
// list and the written paths `__tests__/cli-dock.test.js` expects.
export const LINKED_SKILLS = [
  "design-delta-build",
  "design-delta-author",
  "design-delta-refresh",
  "design-delta-resolve",
  "design-delta-docs",
  "design-delta-token",
  "design-delta-adopt",
  "design-delta-build-design",
]

/** Where a packaged skill lives, in this package and under `--dir` alike. */
export const skillRelativePath = name => `skills/${name}/SKILL.md`

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..")

/**
 * The literal string that identifies a file at `SKILL_STUB_RELATIVE_PATH` or
 * a `LINKED_SKILLS` path as one THIS package generated, and
 * therefore may regenerate. Every stub template is built from this constant
 * so the marker and the text can never drift apart. A file at any of those
 * paths lacking it is a consumer's own — skipped, never overwritten.
 */
export const GENERATED_MARKER = "Generated by `design-delta init`/`dock`"

/**
 * A packaged skill's frontmatter `description`, read from the file this
 * package ships. Every stub copies it rather than restating it: the
 * description is what makes an agent reach for the skill, so a second copy
 * here would be the one line of a stub that could go stale (#55).
 * `__tests__/skill-descriptions.test.js` pins each one, so it changes only
 * on purpose, and `dock --check` reports a consumer's stub that still holds
 * an old one.
 *
 * @param {string} relative `skillRelativePath(name)` or `SKILL_STUB_RELATIVE_PATH`
 */
function packagedDescription(relative) {
  const packaged = readFileSync(join(PACKAGE_ROOT, relative), "utf8")
  return packaged.match(/^description: (.+)$/m)[1]
}

/**
 * The generated PostToolUse hook. A plain Node script — no dependency on the
 * engine's own internals — that shells out to the installed `design-delta`
 * CLI exactly as any other consumer of `verify --json` would, then turns a
 * failing gate into stderr output + a non-zero exit so Claude Code surfaces
 * it as feedback after the edit that caused it.
 *
 * The failure message names the gate that failed and no finding count on
 * purpose: `verify --json` reports `findings.total` across every severity,
 * not the gating ones, and an invalid contract fails a run with no findings
 * at all — so any number printed here would misdescribe what went wrong.
 *
 * Takes the dir the file is being written into, because the wiring comment
 * quotes the hook's own path: under `--dir agent-config` the settings snippet
 * has to point at `agent-config/hooks/…`, or a consumer pastes a command for
 * a path that doesn't exist and the hook silently never fires.
 *
 * @param {string} [dir] the `--dir` value as given (default `.claude`)
 */
export function renderHookTemplate(dir = DEFAULT_DIR) {
  return `#!/usr/bin/env node
// Generated by \`design-delta dock\` — a Claude Code PostToolUse hook that
// runs \`design-delta verify\` after every file edit and surfaces any drift
// the edit introduced, so Claude can self-correct before finishing.
//
// Wire this into your project's .claude/settings.json:
//
//   "hooks": {
//     "PostToolUse": [
//       {
//         "matcher": "Edit|Write",
//         "hooks": [
//           { "type": "command", "command": "node ${join(dir, HOOK_RELATIVE_PATH)}" }
//         ]
//       }
//     ]
//   }
//
// Re-run \`design-delta dock\` after upgrading the engine to pick up template
// changes — this file is generated and safe to overwrite.

import { spawnSync } from "node:child_process"

const result = spawnSync("npx", ["design-delta", "verify", "--json"], {
  encoding: "utf8",
})

let report
try {
  report = JSON.parse(result.stdout || "{}")
} catch {
  // verify produced no readable JSON (e.g. no config yet) — nothing to
  // report, and a hook must never block on a project that isn't set up.
  process.exit(0)
}

if (report.ok === false) {
  console.error("design-delta verify found drift introduced by this edit:")
  console.error(\`  The run did not pass its "\${report.failOn}" gate.\`)
  console.error(
    "Run \`npx design-delta verify\` for details, then fix the drift before continuing.",
  )
  process.exit(2)
}

process.exit(0)
`
}

/**
 * The generated skill: tells an agent working in the consumer repo to run
 * `verify`/`lint --json` and fix what they report before calling a change to
 * a component or its tokens done.
 */
export function renderSkillTemplate() {
  return `---
name: design-delta-verify
description: Check for design-token and component drift with design-delta and fix any findings before finishing a change. Use whenever you edit a component or a design token in this project.
---

# design-delta verify

This project uses \`design-delta\` to keep component code and
its design contracts in sync. Before treating a change to a component or its
tokens as complete, run:

    npx design-delta verify --json

If the result has \`"ok": false\`, read the \`findings\` it reports — or run
\`npx design-delta lint --json\` for static token-convention issues — fix the
drift, and re-run \`verify\` until it reports \`"ok": true\`.
`
}

/**
 * The generated linked stub (issue #336): Claude Code never discovers a
 * skill inside `node_modules`, so this is what a consumer keeps discovered
 * — trigger frontmatter plus a pointer to the canonical skill this package
 * ships at `skills/design-delta/SKILL.md`, which versions with the engine
 * and carries the actual instructions. This file contains no engine prose
 * of its own on purpose: nothing here can go stale across an engine
 * upgrade, so re-running `dock`/`init` only ever needs to refresh the link
 * text, never a fact about engine behavior.
 *
 * Its description is the packaged router's (#55): deliberately broad, so
 * every design-delta request lands here and the router sends it to the
 * procedure skill for the task — including one added in a release this
 * project has not re-run `dock` since.
 */
export function renderSkillStubTemplate() {
  return `---
name: design-delta
description: ${packagedDescription(SKILL_STUB_RELATIVE_PATH)}
---

# design-delta

This is a stub — the real instructions live in the installed package and
version with it, so read them first:

    node_modules/design-delta/skills/design-delta/SKILL.md

Then read this project's own \`design-delta.json\`, especially its
\`_\`-prefixed keys (\`_knownFindings\`, \`_doc\`, …), for the local decisions
the canonical file above can't know.

${GENERATED_MARKER} — safe to overwrite, and refreshed by re-running either
after an engine upgrade. Delete that line to claim this file as your own:
\`init\`/\`dock\` skip a file here that does not carry it.
`
}

/**
 * The generated stub for one packaged procedure skill. Its frontmatter
 * `description` is READ from the packaged skill rather than restated here:
 * the description is what makes an agent reach for the skill, so a second
 * copy would be the one line of this stub that could go stale. Everything
 * else is the same pointer-plus-marker shape `renderSkillStubTemplate` has.
 *
 * @param {string} name a `LINKED_SKILLS` entry
 */
export function renderPackagedSkillStubTemplate(name) {
  const relative = skillRelativePath(name)
  return `---
name: ${name}
description: ${packagedDescription(relative)}
---

# ${name.replace(/^design-delta-/, "design-delta ")}

This is a stub — the real procedure lives in the installed package and
versions with it, so read it first and follow it:

    node_modules/design-delta/${relative}

${GENERATED_MARKER} — safe to overwrite, and refreshed by re-running either
after an engine upgrade. Delete that line to claim this file as your own:
\`init\`/\`dock\` skip a file here that does not carry it.
`
}

function readIfExists(fs, path) {
  try {
    return fs.readFileSync(path, "utf8")
  } catch {
    return null
  }
}

function writeFile(fs, path, content) {
  fs.mkdirSync(dirname(path), { recursive: true })
  fs.writeFileSync(path, content)
}

/**
 * Write one generated template under `dir`, skipping the write when the
 * file already holds this content, line endings aside — same overwrite-safe posture
 * `runDock` itself uses. Exported so `init` (issue #336) writes the linked
 * skill stub through this instead of a second scaffold path.
 *
 * `requireMarker` opts a template into the stronger guard the linked stubs
 * need: an existing file that does not contain that literal string is one
 * this package did not generate and does not own, so it is left exactly as
 * it is and reported as `skipped`. Omitting it keeps the plain
 * always-overwrite posture the hook and the verify skill have always had —
 * both live at names this package chose for itself, and adding the guard
 * there would make every existing consumer's `dock` upgrade a no-op.
 *
 * @param {object} fs injectable `node:fs`-shaped object
 * @param {string} root the project root the `dir` is resolved against
 * @param {string} dir the `--dir` value (or default), as given
 * @param {string} relative the path under `dir`: one of the
 *   `*_RELATIVE_PATH` constants above, or `skillRelativePath(name)` for a
 *   `LINKED_SKILLS` stub
 * @param {string} content the rendered template
 * @param {{requireMarker?: string}} [options]
 * @returns {{path: string, action: "wrote" | "up-to-date" | "skipped"}}
 */
export function writeTemplateFile(fs, root, dir, relative, content, options) {
  const dirAbs = isAbsolute(dir) ? dir : join(root, dir)
  const abs = join(dirAbs, relative)
  const existing = readIfExists(fs, abs)
  const path = join(dir, relative)
  if (existing !== null && sameText(existing, content)) {
    return { path, action: "up-to-date" }
  }
  const marker = options?.requireMarker
  if (existing !== null && marker && !existing.includes(marker)) {
    return { path, action: "skipped" }
  }
  writeFile(fs, abs, content)
  return { path, action: "wrote" }
}

/**
 * `--check`'s counterpart to `writeTemplateFile` (#55): what writing would
 * do, without writing. A stub that is `missing` or `stale` is drift a version
 * bump left behind; `skipped` is a consumer-owned file, never drift. `absent`
 * is an `optional` template (the hook and the verify skill, which only `dock`
 * writes and `init` never does) that was never written — not drift either,
 * since a project need not have them; once written, a stale one is.
 *
 * @returns {{path: string, action: "up-to-date" | "stale" | "missing" | "skipped" | "absent"}}
 */
export function checkTemplateFile(fs, root, dir, relative, content, options) {
  const dirAbs = isAbsolute(dir) ? dir : join(root, dir)
  const existing = readIfExists(fs, join(dirAbs, relative))
  const path = join(dir, relative)
  if (existing !== null && sameText(existing, content)) {
    return { path, action: "up-to-date" }
  }
  if (existing === null) {
    return { path, action: options?.optional ? "absent" : "missing" }
  }
  const marker = options?.requireMarker
  if (marker && !existing.includes(marker)) return { path, action: "skipped" }
  return { path, action: "stale" }
}

/**
 * Whether two texts differ only in line endings. A checkout can rewrite a
 * committed stub's endings (git's `core.autocrlf`, on by default on Windows,
 * gives it CRLF), and re-running `dock` cannot undo that: git rewrites them
 * again on the next checkout. So `--check` compares the text, not the bytes,
 * or such a project reads `stale` on every run with no way to clear it.
 */
function sameText(a, b) {
  return a.replace(/\r\n/g, "\n") === b.replace(/\r\n/g, "\n")
}

const DRIFT_ACTIONS = new Set(["stale", "missing"])

const ACTION_LABELS = {
  wrote: "WROTE",
  "up-to-date": "SAME ",
  skipped: "SKIP ",
  stale: "STALE",
  missing: "MISS ",
  absent: "NONE ",
}

/**
 * The `dock` command that rewrites what `--check` checked: under a
 * non-default `--dir` it has to name that dir, or running it writes the
 * default one and the check stays red.
 */
function dockCommand(dir) {
  if (dir === DEFAULT_DIR) return "npx design-delta dock"
  const arg = /^[\w./-]+$/.test(dir) ? dir : `'${dir.replace(/'/g, "'\\''")}'`
  return `npx design-delta dock --dir ${arg}`
}

function renderCheckHuman(result) {
  const lines = [`design-delta dock --check: ${result.dir}`, ""]
  for (const file of result.files) {
    lines.push(`  ${ACTION_LABELS[file.action]}  ${file.path}`)
  }
  lines.push("")
  lines.push(
    result.ok
      ? "Every generated file is current with the installed design-delta."
      : `STALE or MISS: run \`${dockCommand(result.dir)}\` to bring the generated ` +
          "files up to date with the installed design-delta, then commit them.",
  )
  return lines.join("\n") + "\n"
}

function renderHuman(result) {
  const lines = [`design-delta dock: scaffolded into ${result.dir}`, ""]
  for (const file of result.files) {
    lines.push(`  ${ACTION_LABELS[file.action]}  ${file.path}`)
  }
  lines.push("")
  if (result.files.some(file => file.action === "skipped")) {
    lines.push(
      "SKIP means the file already exists and is not one this package " +
        "generated, so it was left untouched. Move it aside and re-run to " +
        "get the generated version.",
    )
    lines.push("")
  }
  lines.push(
    "The hook is not active until it's wired into your project's " +
      "`.claude/settings.json` — see the comment at the top of the generated " +
      "hook file for the exact PostToolUse entry to add.",
  )
  return lines.join("\n") + "\n"
}

function renderJson(result) {
  return JSON.stringify(result, null, 2) + "\n"
}

/**
 * Every linked skill stub, as `{relative, content, options}`: the audit stub
 * and one per packaged procedure skill. `dock` and `init` both write from
 * this one list, each entry guarded by `GENERATED_MARKER`.
 *
 * @returns {Array<{relative: string, content: string, options: object}>}
 */
export function linkedStubTemplates() {
  return [
    {
      relative: SKILL_STUB_RELATIVE_PATH,
      content: renderSkillStubTemplate(),
      // One of the guarded templates — see GENERATED_MARKER above.
      options: { requireMarker: GENERATED_MARKER },
    },
    // Guarded like the stub above: a project may already keep a skill of
    // its own under any of these names.
    ...LINKED_SKILLS.map(name => ({
      relative: skillRelativePath(name),
      content: renderPackagedSkillStubTemplate(name),
      options: { requireMarker: GENERATED_MARKER },
    })),
  ]
}

/**
 * Run the subcommand. Returns the exit code; never calls `process.exit`.
 *
 * @param {string[]} cmdArgv
 * @param {{globalOpts: object, io: {stdout: object, stderr: object}, fs?: object, root?: string}} ctx
 *   `fs`/`root` are injectable for tests; production omits them and gets real
 *   `node:fs` and `process.cwd()`.
 * @returns {number}
 */
export function runDock(cmdArgv, ctx) {
  const { io } = ctx
  const fs = ctx.fs || { mkdirSync, readFileSync, writeFileSync }
  const root = ctx.root || process.cwd()
  const { opts, errors } = parseFlags(cmdArgv, FLAG_SPEC)

  if (errors.length > 0) {
    for (const error of errors) io.stderr.write(`design-delta dock: ${error}\n`)
    return 1
  }

  const dir = opts.dir || DEFAULT_DIR

  const templates = [
    {
      relative: HOOK_RELATIVE_PATH,
      content: renderHookTemplate(dir),
      options: { optional: true },
    },
    {
      relative: SKILL_RELATIVE_PATH,
      content: renderSkillTemplate(),
      options: { optional: true },
    },
    ...linkedStubTemplates(),
  ]

  if (opts.check) {
    const files = templates.map(({ relative, content, options }) =>
      checkTemplateFile(fs, root, dir, relative, content, options),
    )
    const ok = !files.some(file => DRIFT_ACTIONS.has(file.action))
    const result = { command: "dock", check: true, ok, dir, files }
    io.stdout.write(opts.json ? renderJson(result) : renderCheckHuman(result))
    return ok ? 0 : 1
  }

  const files = templates.map(({ relative, content, options }) =>
    writeTemplateFile(fs, root, dir, relative, content, options),
  )

  const result = { command: "dock", dir, files }

  io.stdout.write(opts.json ? renderJson(result) : renderHuman(result))

  return 0
}
